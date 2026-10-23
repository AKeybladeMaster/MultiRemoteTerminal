import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { HostTrustStoreError } from '../../../../packages/application/src/host-trust.ts';
import { SqliteHostTrustRepository, toHostTrustStoreError } from '../adapters/sqlite-host-trust-repository.ts';
import { SqliteSessionCatalogRepository } from '../adapters/sqlite-session-catalog-repository.ts';
import { parseStorageWorkerRequest, storageWorkerErrorCode, STORAGE_WORKER_PROTOCOL_VERSION } from './storage-protocol.ts';

const parent = process.parentPort;
if (!parent) throw new Error('Storage worker requires an Electron utility process');

const databasePath = process.env.MRT_STORAGE_DB_PATH;
if (!databasePath || !isAbsolute(databasePath)) throw new Error('Storage worker requires an absolute database path');

let repository: SqliteHostTrustRepository;
let sessionCatalogRepository: SqliteSessionCatalogRepository;
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
  sessionCatalogRepository = new SqliteSessionCatalogRepository(database);
} catch (error) {
  const normalizedError = toHostTrustStoreError(error);
  const errorCode = storageWorkerErrorCode(normalizedError);
  try { parent.postMessage({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'startup-error', errorCode }); } catch { /* Main observes worker exit. */ }
  process.exit(1);
}

function send(value: unknown): void {
  try { parent.postMessage(value); } catch { /* The main process owns worker teardown. */ }
}

let closed = false;
parent.on('message', async event => {
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
    } else if (request.command === 'session.list') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'sessions', value: await sessionCatalogRepository.listSessions(request.query) } });
    } else if (request.command === 'session.create') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'session', value: await sessionCatalogRepository.createSession(request.draft) } });
    } else if (request.command === 'session.favorite') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'changed', value: await sessionCatalogRepository.setFavorite(request.id, request.favorite) } });
    } else if (request.command === 'session.remove') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'changed', value: await sessionCatalogRepository.removeSession(request.id) } });
    } else if (request.command === 'session.folder.list') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'folders', value: await sessionCatalogRepository.listFolders() } });
    } else if (request.command === 'session.folder.create') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'folder', value: await sessionCatalogRepository.createFolder(request.draft) } });
    } else if (request.command === 'session.folder.rename') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'changed', value: await sessionCatalogRepository.renameFolder(request.id, request.name) } });
    } else if (request.command === 'session.folder.move') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'changed', value: await sessionCatalogRepository.moveFolder(request.id, request.parentId) } });
    } else if (request.command === 'session.folder.remove') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'changed', value: await sessionCatalogRepository.removeFolder(request.id) } });
    } else if (request.command === 'session.move') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'changed', value: await sessionCatalogRepository.moveSession(request.id, request.folderId) } });
    } else {
      closed = true;
      repository.close();
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true, result: { kind: 'shutdown' } });
    }
  } catch (error) {
    send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: false, errorCode: storageWorkerErrorCode(error) });
  }
});

send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'ready' });
