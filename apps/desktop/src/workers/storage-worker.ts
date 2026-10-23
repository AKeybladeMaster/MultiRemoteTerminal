import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { HostTrustStoreError } from '../../../../packages/application/src/host-trust.ts';
import { SqliteHostTrustRepository, toHostTrustStoreError } from '../adapters/sqlite-host-trust-repository.ts';
import { parseStorageWorkerRequest, STORAGE_WORKER_PROTOCOL_VERSION } from './storage-protocol.ts';

const parent = process.parentPort;
if (!parent) throw new Error('Storage worker requires an Electron utility process');

const databasePath = process.env.MRT_STORAGE_DB_PATH;
if (!databasePath || !isAbsolute(databasePath)) throw new Error('Storage worker requires an absolute database path');

let repository: SqliteHostTrustRepository;
try {
  await mkdir(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath, {
    timeout: 5_000,
    enableForeignKeyConstraints: true,
    allowExtension: false,
    defensive: true
  });
  database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  repository = new SqliteHostTrustRepository(database);
  repository.migrate();
} catch (error) {
  const normalizedError = toHostTrustStoreError(error);
  const errorCode = normalizedError.kind.toUpperCase() as 'BUSY' | 'CORRUPT' | 'UNAVAILABLE';
  try { parent.postMessage({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'startup-error', errorCode }); } catch { /* Main observes worker exit. */ }
  process.exit(1);
}

function send(value: unknown): void {
  try { parent.postMessage(value); } catch { /* The main process owns worker teardown. */ }
}

function errorCode(error: unknown): 'BUSY' | 'CORRUPT' | 'UNAVAILABLE' {
  if (error instanceof HostTrustStoreError) return error.kind.toUpperCase() as 'BUSY' | 'CORRUPT' | 'UNAVAILABLE';
  return 'UNAVAILABLE';
}

let closed = false;
parent.on('message', event => {
  const request = parseStorageWorkerRequest(event.data);
  if (!request) return;
  const requestId = request.requestId;
  try {
    if (closed) throw new HostTrustStoreError('unavailable');
    if (request.command === 'hostTrust.find') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'identity', value: repository.find(request.endpoint) ?? null } });
    } else if (request.command === 'hostTrust.trustIfAbsent') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'insert', value: repository.trustIfAbsent(request.identity) } });
    } else if (request.command === 'hostTrust.remove') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'removed', value: repository.remove(request.endpoint) } });
    } else if (request.command === 'hostTrust.importLegacy') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'migrated', value: repository.importLegacy(request.identities) } });
    } else {
      closed = true;
      repository.close();
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true, result: { kind: 'shutdown' } });
    }
  } catch (error) {
    send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: false, errorCode: errorCode(error) });
  }
});

send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'ready' });
