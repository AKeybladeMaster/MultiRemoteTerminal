import test from 'node:test';
import assert from 'node:assert/strict';
import { channel } from 'node:diagnostics_channel';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { backup, DatabaseSync } from 'node:sqlite';
import type { UtilityProcess } from 'electron';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HostTrustStoreError } from '../../packages/application/src/host-trust.ts';
import type { CredentialPromptCancellation } from '../../packages/application/src/credential-prompt.ts';
import { sameHostKey } from '../../packages/domain/src/host-trust.ts';
import type { TrustedHostKey } from '../../packages/domain/src/host-trust.ts';
import { SqliteHostTrustRepository } from '../../apps/desktop/src/adapters/sqlite-host-trust-repository.ts';
import { SqliteTunnelRepository } from '../../apps/desktop/src/adapters/sqlite-tunnel-repository.ts';
import { HostTrustJsonStore } from '../../apps/desktop/src/adapters/host-trust-json-store.ts';
import { SqliteStorageStore, STORAGE_DIAGNOSTICS_CHANNEL_NAME } from '../../apps/desktop/src/adapters/sqlite-storage-store.ts';
import { STORAGE_WORKER_PROTOCOL_VERSION } from '../../apps/desktop/src/workers/storage-protocol.ts';
import type { StorageWorkerRequest } from '../../apps/desktop/src/workers/storage-protocol.ts';

class FakeStorageWorker extends EventEmitter {
  private readonly repository: SqliteHostTrustRepository;
  private readonly crashAfterImport: boolean;
  private readonly stallCommand: StorageWorkerRequest['command'] | undefined;
  private readonly notifyStalled: (() => void) | undefined;
  private readonly notifyReadyStalled: (() => void) | undefined;
  killed = false;
  temporaryPath: string | undefined;

  constructor(databasePath = ':memory:', crashAfterImport = false, stallCommand?: StorageWorkerRequest['command'], notifyStalled?: () => void,
    stallReady = false, notifyReadyStalled?: () => void) {
    super();
    this.repository = new SqliteHostTrustRepository(new DatabaseSync(databasePath));
    this.crashAfterImport = crashAfterImport;
    this.stallCommand = stallCommand;
    this.notifyStalled = notifyStalled;
    this.notifyReadyStalled = notifyReadyStalled;
    this.repository.migrate();
    if (stallReady) this.notifyReadyStalled?.();
    else queueMicrotask(() => this.emit('message', { version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'ready' }));
  }

  postMessage(value: unknown): void {
    const request = value as StorageWorkerRequest;
    if (request.command === this.stallCommand) {
      if (request.command === 'session.folder.export') {
        this.temporaryPath = request.temporaryPath;
        writeFileSync(request.temporaryPath, 'partial bundle');
      }
      this.notifyStalled?.();
      return;
    }
    queueMicrotask(() => {
      try {
        if (request.command === 'hostTrust.find') {
          this.reply(request.requestId, { kind: 'identity', value: this.repository.find(request.endpoint) ?? null });
        } else if (request.command === 'hostTrust.trustIfAbsent') {
          this.reply(request.requestId, { kind: 'insert', value: this.repository.trustIfAbsent(request.identity) });
        } else if (request.command === 'hostTrust.remove') {
          this.reply(request.requestId, { kind: 'removed', value: this.repository.remove(request.endpoint) });
        } else if (request.command === 'hostTrust.importLegacy') {
          const value = this.repository.importLegacy(request.identities);
          if (this.crashAfterImport) { this.kill(); return; }
          this.reply(request.requestId, { kind: 'migrated', value });
        } else {
          this.closeRepository();
          this.reply(request.requestId, { kind: 'shutdown' });
        }
      } catch {
        this.emit('message', { version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId: request.requestId, ok: false, errorCode: 'CORRUPT' });
      }
    });
  }

  kill(): boolean {
    if (!this.killed) {
      this.killed = true;
      this.closeRepository();
      this.emit('exit', 0);
    }
    return true;
  }

  private reply(requestId: string, result: unknown): void {
    this.emit('message', { version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true, result });
  }

  private closeRepository(): void {
    try { this.repository.close(); } catch { /* A shutdown reply may already have closed it. */ }
  }
}

test('SQLite host trust schema migrates once and preserves strict insert, match, change, and remove behavior', () => {
  const database = new DatabaseSync(':memory:');
  const repository = new SqliteHostTrustRepository(database);
  try {
    repository.migrate();
    repository.migrate();
    assert.equal((database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 2);
    assert.equal((database.prepare('PRAGMA table_info(tunnel_definitions)').all() as Array<{ name: string }>).some(column => column.name === 'name'), true);
    const insertSession = database.prepare(`
      INSERT INTO session_definitions (id, kind, name, options_version, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?)
    `);
    assert.doesNotThrow(() => insertSession.run('session-valid', 'ssh', 'Valid SSH', '2026-10-23T00:00:00.000Z', '2026-10-23T00:00:00.000Z'));
    assert.throws(() => insertSession.run('session-invalid', 'unknown', 'Invalid', '2026-10-23T00:00:00.000Z', '2026-10-23T00:00:00.000Z'));
    assert.equal(repository.trustIfAbsent(hostKey('db.example', 22, 1)), 'inserted');
    assert.equal(repository.trustIfAbsent(hostKey('db.example', 22, 1)), 'matched');
    assert.equal(repository.trustIfAbsent(hostKey('db.example', 22, 2)), 'changed');
    const saved = repository.find({ host: 'db.example', port: 22 });
    assert.ok(saved && sameHostKey(saved, hostKey('db.example', 22, 1)));
    assert.equal(repository.remove({ host: 'db.example', port: 22 }), true);
    assert.equal(repository.remove({ host: 'db.example', port: 22 }), false);
    repository.trustIfAbsent(hostKey('collision.example', 22, 5));
    assert.throws(() => repository.importLegacy([
      hostKey('would-be-rolled-back.example', 22, 6), hostKey('collision.example', 22, 7)
    ]), (error: unknown) => error instanceof HostTrustStoreError && error.kind === 'corrupt');
    assert.equal(repository.find({ host: 'would-be-rolled-back.example', port: 22 }), undefined);
  } finally {
    database.close();
  }
});

test('SQLite schema v1 upgrades existing saved profiles, tunnel definitions, and host trust', async () => {
  const database = new DatabaseSync(':memory:');
  const initial = new SqliteHostTrustRepository(database);
  try {
    initial.migrate();
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const tunnelId = '22222222-2222-4222-8222-222222222222';
    const timestamp = '2026-10-23T00:00:00.000Z';
    database.prepare(`INSERT INTO session_definitions
      (id, kind, name, host, port, options_json, options_version, created_at, updated_at)
      VALUES (?, 'ssh', 'Existing gateway', 'gateway.example', 22, '{}', 1, ?, ?)`)
      .run(sessionId, timestamp, timestamp);
    database.prepare(`INSERT INTO tunnel_definitions
      (id, session_id, mode, bind_host, bind_port, target_host, target_port, created_at)
      VALUES (?, ?, 'local', '127.0.0.1', 15432, 'db.internal', 5432, ?)`)
      .run(tunnelId, sessionId, timestamp);
    const trusted = hostKey('gateway.example', 22, 7);
    initial.trustIfAbsent(trusted);

    database.exec('ALTER TABLE tunnel_definitions DROP COLUMN name; PRAGMA user_version = 1;');
    const upgraded = new SqliteHostTrustRepository(database);
    upgraded.migrate();

    assert.equal((database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 2);
    assert.equal((database.prepare('SELECT name FROM tunnel_definitions WHERE id = ?').get(tunnelId) as { name: string }).name, 'Local forward');
    assert.equal((database.prepare('SELECT name FROM session_definitions WHERE id = ?').get(sessionId) as { name: string }).name, 'Existing gateway');
    const tunnels = new SqliteTunnelRepository(database);
    assert.equal((await tunnels.getLocalTunnel(tunnelId))?.name, 'Local forward', 'upgraded rows must pass the current runtime decoder');
    const restoredTrust = upgraded.find({ host: 'gateway.example', port: 22 });
    assert.ok(restoredTrust && sameHostKey(restoredTrust, trusted));
  } finally {
    database.close();
  }
});

test('legacy host identities are verified in SQLite before their source file is retired', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-host-trust-migration-'));
  const legacyPath = join(directory, 'ssh-host-keys.json');
  const legacy = new HostTrustJsonStore(legacyPath);
  const identity = hostKey('legacy.example', 2222, 3);
  let sourceWorker: FakeStorageWorker | undefined;
  const store = new SqliteStorageStore(join(directory, 'mrt.sqlite'), legacyPath, 'storage-worker.js', directory,
    () => {
      sourceWorker = new FakeStorageWorker();
      return sourceWorker as unknown as UtilityProcess;
    });
  try {
    assert.equal(await legacy.trustIfAbsent(identity), 'inserted');
    const staleSnapshot = await legacy.exportForMigration();
    assert.equal(await legacy.trustIfAbsent(hostKey('added-during-migration.example', 22, 5)), 'inserted');
    await assert.rejects(legacy.retireAfterMigration(staleSnapshot.sourceSha256),
      (error: unknown) => error instanceof HostTrustStoreError && error.kind === 'unavailable');
    assert.equal((await stat(legacyPath)).isFile(), true);
    const saved = await store.find(identity.endpoint);
    assert.ok(saved && sameHostKey(saved, identity));
    assert.equal(saved?.trustedAt, identity.trustedAt);
    const savedAdded = await store.find({ host: 'added-during-migration.example', port: 22 });
    assert.ok(savedAdded && sameHostKey(savedAdded, hostKey('added-during-migration.example', 22, 5)));
    await assert.rejects(stat(legacyPath), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT');
    assert.equal(await store.trustIfAbsent(hostKey('new.example', 22, 4)), 'inserted');
    await store.shutdown();
    assert.equal(sourceWorker?.killed, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('unsupported SQLite versions fail closed without changing the database', () => {
  const database = new DatabaseSync(':memory:');
  const repository = new SqliteHostTrustRepository(database);
  try {
    database.exec('PRAGMA user_version = 3');
    assert.throws(() => repository.migrate(), (error: unknown) => error instanceof HostTrustStoreError && error.kind === 'corrupt');
    assert.equal((database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 3);
  } finally {
    database.close();
  }
});

test('a committed host-trust migration can be backed up and restored from a WAL database', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-storage-backup-'));
  const databasePath = join(directory, 'source.sqlite');
  const backupPath = join(directory, 'backup.sqlite');
  const identity = hostKey('backup.example', 2200, 11);
  const database = new DatabaseSync(databasePath, { timeout: 5_000, defensive: true });
  try {
    try {
      database.exec('PRAGMA journal_mode = WAL;');
      const repository = new SqliteHostTrustRepository(database);
      repository.migrate();
      assert.equal(repository.trustIfAbsent(identity), 'inserted');
      assert.ok(await backup(database, backupPath) > 0);
    } finally {
      database.close();
    }
    const restored = new DatabaseSync(backupPath, { timeout: 5_000, defensive: true });
    try {
      const restoredRepository = new SqliteHostTrustRepository(restored);
      restoredRepository.migrate();
      assert.ok(sameHostKey(restoredRepository.find(identity.endpoint)!, identity));
      assert.equal((restored.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check, 'ok');
    } finally {
      restored.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('SQLite lock contention maps to the stable busy error', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-storage-lock-'));
  const databasePath = join(directory, 'locked.sqlite');
  const database = new DatabaseSync(databasePath, { timeout: 1 });
  const lockOwner = new DatabaseSync(databasePath, { timeout: 1 });
  try {
    const repository = new SqliteHostTrustRepository(database);
    repository.migrate();
    lockOwner.exec('BEGIN IMMEDIATE');
    assert.throws(() => repository.trustIfAbsent(hostKey('locked.example', 22, 12)),
      (error: unknown) => error instanceof HostTrustStoreError && error.kind === 'busy');
  } finally {
    try { lockOwner.exec('ROLLBACK'); } catch { /* The transaction may not have started. */ }
    lockOwner.close();
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('migration retries idempotently when the storage worker exits after commit before reply', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-storage-retry-'));
  const databasePath = join(directory, 'storage.sqlite');
  const legacyPath = join(directory, 'ssh-host-keys.json');
  const legacy = new HostTrustJsonStore(legacyPath);
  const identity = hostKey('retry.example', 2222, 13);
  let launches = 0;
  const store = new SqliteStorageStore(databasePath, legacyPath, 'storage-worker.js', directory, () => {
    const crashAfterImport = launches === 0;
    launches += 1;
    return new FakeStorageWorker(databasePath, crashAfterImport) as unknown as UtilityProcess;
  });
  try {
    assert.equal(await legacy.trustIfAbsent(identity), 'inserted');
    await assert.rejects(store.find(identity.endpoint),
      (error: unknown) => error instanceof HostTrustStoreError && error.kind === 'unavailable');
    assert.equal((await stat(legacyPath)).isFile(), true);

    const restored = await store.find(identity.endpoint);
    assert.ok(restored && sameHostKey(restored, identity));
    assert.equal(launches, 2);
    await assert.rejects(stat(legacyPath), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT');
    await store.shutdown();
  } finally {
    await store.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});

test('shared initial migration cancels only after its last caller leaves and keeps JSON for retry', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-storage-migration-cancel-'));
  const databasePath = join(directory, 'storage.sqlite');
  const legacyPath = join(directory, 'ssh-host-keys.json');
  const legacy = new HostTrustJsonStore(legacyPath);
  const identity = hostKey('migration-cancel.example', 2222, 14);
  let launches = 0;
  let stalledWorker: FakeStorageWorker | undefined;
  let resolveStalled!: () => void;
  const stalled = new Promise<void>(resolve => { resolveStalled = resolve; });
  const store = new SqliteStorageStore(databasePath, legacyPath, 'storage-worker.js', directory, () => {
    launches += 1;
    const worker = new FakeStorageWorker(databasePath, false, launches === 1 ? 'hostTrust.importLegacy' : undefined,
      launches === 1 ? resolveStalled : undefined);
    if (launches === 1) stalledWorker = worker;
    return worker as unknown as UtilityProcess;
  });
  const first = cancellationSource();
  const last = cancellationSource();
  try {
    assert.equal(await legacy.trustIfAbsent(identity), 'inserted');
    const firstCaller = store.find(identity.endpoint, first.token);
    await stalled;
    const lastCaller = store.find(identity.endpoint, last.token);

    first.abort();
    await assert.rejects(firstCaller, (error: unknown) => error instanceof HostTrustStoreError && error.kind === 'cancelled');
    assert.equal(stalledWorker?.killed, false, 'remaining waiter keeps the shared migration alive');

    last.abort();
    await assert.rejects(lastCaller, (error: unknown) => error instanceof HostTrustStoreError && error.kind === 'cancelled');
    assert.equal(stalledWorker?.killed, true, 'the worker is interrupted after the final waiter cancels');
    assert.equal((await stat(legacyPath)).isFile(), true, 'unverified migration retains the legacy source');

    await new Promise<void>(resolve => setImmediate(resolve));
    const restored = await store.find(identity.endpoint);
    assert.ok(restored && sameHostKey(restored, identity));
    assert.equal(launches, 2);
    await assert.rejects(stat(legacyPath), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT');
  } finally {
    await store.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});

test('cancelling the last request during worker startup terminates the starting worker', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-storage-start-cancel-'));
  const databasePath = join(directory, 'storage.sqlite');
  const legacyPath = join(directory, 'ssh-host-keys.json');
  const legacy = new HostTrustJsonStore(legacyPath);
  const identity = hostKey('startup-cancel.example', 2222, 15);
  let launches = 0;
  let startingWorker: FakeStorageWorker | undefined;
  let resolveStarting!: () => void;
  const starting = new Promise<void>(resolve => { resolveStarting = resolve; });
  const store = new SqliteStorageStore(databasePath, legacyPath, 'storage-worker.js', directory, () => {
    launches += 1;
    const worker = new FakeStorageWorker(databasePath, false, undefined, undefined, launches === 1,
      launches === 1 ? resolveStarting : undefined);
    if (launches === 1) startingWorker = worker;
    return worker as unknown as UtilityProcess;
  });
  const cancellation = cancellationSource();
  try {
    assert.equal(await legacy.trustIfAbsent(identity), 'inserted');
    const pending = store.find(identity.endpoint, cancellation.token);
    await starting;
    cancellation.abort();
    await assert.rejects(pending, (error: unknown) => error instanceof HostTrustStoreError && error.kind === 'cancelled');
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(startingWorker?.killed, true);
    assert.equal((await stat(legacyPath)).isFile(), true, 'startup cancellation leaves the legacy source available');

    await new Promise<void>(resolve => setImmediate(resolve));
    const restored = await store.find(identity.endpoint);
    assert.ok(restored && sameHostKey(restored, identity));
    assert.equal(launches, 2);
  } finally {
    await store.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});

test('caller cancellation aborts a pending worker request and the store restarts cleanly', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-storage-cancel-'));
  const databasePath = join(directory, 'storage.sqlite');
  const legacyPath = join(directory, 'ssh-host-keys.json');
  let launches = 0;
  const workers: FakeStorageWorker[] = [];
  let resolveStalled!: () => void;
  const stalled = new Promise<void>(resolve => { resolveStalled = resolve; });
  const diagnostics = channel(STORAGE_DIAGNOSTICS_CHANNEL_NAME);
  const diagnosticEvents: unknown[] = [];
  const onDiagnostic = (event: unknown) => diagnosticEvents.push(event);
  diagnostics.subscribe(onDiagnostic);
  const store = new SqliteStorageStore(databasePath, legacyPath, 'storage-worker.js', directory, () => {
    launches += 1;
    const worker = new FakeStorageWorker(databasePath, false, launches === 1 ? 'hostTrust.find' : undefined,
      launches === 1 ? resolveStalled : undefined);
    workers.push(worker);
    return worker as unknown as UtilityProcess;
  });
  let aborted = false;
  const abortListeners = new Set<() => void>();
  const cancellation: CredentialPromptCancellation = {
    get aborted() { return aborted; },
    addEventListener(_type, listener) { if (aborted) listener(); else abortListeners.add(listener); },
    removeEventListener(_type, listener) { abortListeners.delete(listener); }
  };
  try {
    assert.equal(await store.remove({ host: 'cancel.example', port: 22 }), false);
    assert.equal(launches, 1);
    const pending = store.find({ host: 'cancel.example', port: 22 }, cancellation);
    await stalled;
    aborted = true;
    for (const listener of [...abortListeners]) { abortListeners.delete(listener); listener(); }
    await assert.rejects(pending, (error: unknown) => error instanceof HostTrustStoreError && error.kind === 'cancelled');
    assert.equal(workers[0]?.killed, true);
    assert.deepEqual(diagnosticEvents, [{ component: 'storage', event: 'request-cancelled', code: 'CANCELLED' }]);
    assert.equal(await store.find({ host: 'cancel.example', port: 22 }), undefined);
    assert.equal(launches, 2);
  } finally {
    diagnostics.unsubscribe(onDiagnostic);
    await store.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});

test('cancelled folder export removes a partial temp file after the storage worker exits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-storage-export-cancel-'));
  const databasePath = join(directory, 'storage.sqlite');
  const legacyPath = join(directory, 'ssh-host-keys.json');
  const destinationPath = join(directory, 'sessions.json');
  let resolveStalled!: () => void;
  const stalled = new Promise<void>(resolve => { resolveStalled = resolve; });
  let worker: FakeStorageWorker | undefined;
  const store = new SqliteStorageStore(databasePath, legacyPath, 'storage-worker.js', directory, () => {
    worker = new FakeStorageWorker(databasePath, false, 'session.folder.export', resolveStalled);
    return worker as unknown as UtilityProcess;
  });
  const cancellation = cancellationSource();
  try {
    const pending = store.exportFolderToFile('11111111-1111-4111-8111-111111111111', destinationPath, cancellation.token);
    await stalled;
    const temporaryPath = worker?.temporaryPath;
    assert.ok(temporaryPath);
    assert.equal((await stat(temporaryPath)).isFile(), true);

    cancellation.abort();
    await assert.rejects(pending, (error: unknown) => error instanceof HostTrustStoreError && error.kind === 'cancelled');
    await assert.rejects(stat(temporaryPath), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT');
    await assert.rejects(stat(destinationPath), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT');
  } finally {
    await store.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});

test('timed-out folder export waits for partial temp-file cleanup before rejecting', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const directory = await mkdtemp(join(tmpdir(), 'mrt-storage-export-timeout-'));
  const databasePath = join(directory, 'storage.sqlite');
  const legacyPath = join(directory, 'ssh-host-keys.json');
  const destinationPath = join(directory, 'sessions.json');
  let resolveStalled!: () => void;
  const stalled = new Promise<void>(resolve => { resolveStalled = resolve; });
  let resolveCleanupStarted!: () => void;
  const cleanupStarted = new Promise<void>(resolve => { resolveCleanupStarted = resolve; });
  let releaseCleanup!: () => void;
  const cleanupRelease = new Promise<void>(resolve => { releaseCleanup = resolve; });
  let worker: FakeStorageWorker | undefined;
  const store = new SqliteStorageStore(databasePath, legacyPath, 'storage-worker.js', directory, () => {
    worker = new FakeStorageWorker(databasePath, false, 'session.folder.export', resolveStalled);
    return worker as unknown as UtilityProcess;
  }, async path => {
    resolveCleanupStarted();
    await cleanupRelease;
    await rm(path, { force: true });
  });
  try {
    const pending = store.exportFolderToFile('11111111-1111-4111-8111-111111111111', destinationPath);
    await stalled;
    const temporaryPath = worker?.temporaryPath;
    assert.ok(temporaryPath);
    assert.equal((await stat(temporaryPath)).isFile(), true);

    let settled = false;
    const observed = pending.then(() => { settled = true; }, () => { settled = true; });
    context.mock.timers.tick(60_000);
    await cleanupStarted;
    await Promise.resolve();
    assert.equal(settled, false, 'timeout must remain pending while temporary-file cleanup is blocked');
    releaseCleanup();
    await assert.rejects(pending, (error: unknown) => error instanceof HostTrustStoreError && error.kind === 'busy');
    await observed;
    await assert.rejects(stat(temporaryPath), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT');
    await assert.rejects(stat(destinationPath), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT');
    assert.equal(worker?.killed, true);
  } finally {
    releaseCleanup();
    context.mock.timers.reset();
    await store.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});

function hostKey(host: string, port: number, byte: number): TrustedHostKey {
  const algorithm = 'ssh-ed25519';
  const algorithmBytes = Buffer.from(algorithm, 'ascii');
  const publicKey = Buffer.concat([Buffer.from([0, 0, 0, algorithmBytes.length]), algorithmBytes, Buffer.alloc(32, byte)]);
  const fingerprint = `SHA256:${createHash('sha256').update(publicKey).digest('base64').replace(/=+$/, '')}`;
  return { endpoint: { host, port }, algorithm, fingerprint, publicKey, trustedAt: 1_800_000_000_000 + byte, approvalSource: 'user' };
}

function cancellationSource(): { readonly token: CredentialPromptCancellation; abort(): void } {
  let aborted = false;
  const listeners = new Set<() => void>();
  return {
    token: {
      get aborted() { return aborted; },
      addEventListener(_type, listener) {
        if (aborted) { listener(); return; }
        listeners.add(listener);
      },
      removeEventListener(_type, listener) { listeners.delete(listener); }
    },
    abort() {
      if (aborted) return;
      aborted = true;
      const pendingListeners = [...listeners];
      listeners.clear();
      for (const listener of pendingListeners) listener();
    }
  };
}
