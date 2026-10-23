import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SqliteHostTrustRepository } from '../../apps/desktop/src/adapters/sqlite-host-trust-repository.ts';
import { SqliteSessionCatalogRepository } from '../../apps/desktop/src/adapters/sqlite-session-catalog-repository.ts';
import { storageWorkerErrorCode } from '../../apps/desktop/src/workers/storage-protocol.ts';
import { createSessionCatalog } from '../../packages/application/src/session-catalog.ts';
import { StorageOperationError } from '../../packages/application/src/storage-errors.ts';

test('SQLite catalog creates, searches, favorites and deletes over one thousand non-secret definitions', async () => {
  const database = new DatabaseSync(':memory:');
  try {
    new SqliteHostTrustRepository(database).migrate();
    const catalog = new SqliteSessionCatalogRepository(database);
    const ssh = await catalog.createSession({ kind: 'ssh', name: 'Production gateway', host: 'SSH.Example.com.', port: 2222 });
    const local = await catalog.createSession({ kind: 'local', name: 'Local PowerShell', shell: 'powershell' });
    assert.equal(ssh.kind, 'ssh');
    if (ssh.kind !== 'ssh') throw new Error('Expected SSH definition');
    assert.deepEqual({ host: ssh.host, port: ssh.port }, { host: 'ssh.example.com', port: 2222 });
    assert.ok((await catalog.listSessions('GATEWAY')).some(item => item.id === ssh.id));
    assert.ok((await catalog.listSessions('ssh.example')).some(item => item.id === ssh.id));

    for (let index = 0; index < 1_000; index += 1) {
      await catalog.createSession({ kind: 'local', name: `Connection ${String(index).padStart(4, '0')}`, shell: index % 2 === 0 ? 'powershell' : 'cmd' });
    }
    assert.equal((await catalog.listSessions('Connection')).length, 1_000);
    assert.equal((await catalog.listSessions('')).length, 1_002);
    assert.equal(await catalog.setFavorite(ssh.id, true), true);
    assert.equal((await catalog.listSessions(''))[0]?.id, ssh.id);
    assert.equal(await catalog.removeSession(local.id), true);
    assert.equal(await catalog.removeSession(local.id), false);

    const persistedSsh = database.prepare('SELECT credential_ref, options_json FROM session_definitions WHERE id = ?').get(ssh.id) as {
      readonly credential_ref: string | null; readonly options_json: string;
    };
    assert.equal(persistedSsh.credential_ref, null);
    assert.equal(persistedSsh.options_json, '{}');
    assert.equal((await catalog.listSessions('password')).length, 0);
  } finally {
    database.close();
  }
});

test('SQLite catalog rejects secret-bearing or malformed definitions without writing rows', async () => {
  const database = new DatabaseSync(':memory:');
  try {
    new SqliteHostTrustRepository(database).migrate();
    const catalog = new SqliteSessionCatalogRepository(database);
    await assert.rejects(catalog.createSession({ kind: 'ssh', name: 'Unsafe', host: 'server.example', port: 22,
      password: 'never-save-this' } as never), (error: unknown) => error instanceof StorageOperationError && error.kind === 'unavailable');
    await assert.rejects(catalog.createSession({ kind: 'ssh', name: 'Invalid', host: 'server.example', port: 0 }),
      (error: unknown) => error instanceof StorageOperationError && error.kind === 'unavailable');
    assert.equal((database.prepare('SELECT count(*) AS count FROM session_definitions').get() as { readonly count: number }).count, 0);
  } finally {
    database.close();
  }
});

test('folder moves reject cycles and folder deletion preserves children and sessions transactionally', async () => {
  const database = new DatabaseSync(':memory:');
  try {
    new SqliteHostTrustRepository(database).migrate();
    const catalog = new SqliteSessionCatalogRepository(database);
    const work = await catalog.createFolder({ name: 'Work', parentId: null });
    const lab = await catalog.createFolder({ name: 'Lab', parentId: work.id });
    const labAtRoot = await catalog.createFolder({ name: 'Lab', parentId: null });
    const rootSession = await catalog.createSession({ kind: 'local', name: 'Root session', shell: 'powershell' });
    const childSession = await catalog.createSession({ kind: 'local', name: 'Lab session', shell: 'cmd' });
    const applicationCatalog = createSessionCatalog(catalog);
    assert.equal(await catalog.moveSession(rootSession.id, work.id), true);
    assert.equal(await catalog.moveSession(childSession.id, lab.id), true);
    assert.equal((await catalog.listSessions('')).find(item => item.id === childSession.id)?.folderId, lab.id);

    assert.deepEqual(await applicationCatalog.moveFolder(work.id, lab.id), {
      ok: false, error: { code: 'CONFLICT', target: 'application', retryable: false }
    });
    assert.deepEqual(await applicationCatalog.removeFolder(work.id), {
      ok: false, error: { code: 'CONFLICT', target: 'application', retryable: false }
    });
    assert.equal((await catalog.listSessions('')).find(item => item.id === rootSession.id)?.folderId, work.id,
      'a rejected deletion must not leave sessions partially moved');
    assert.equal((await catalog.listFolders()).find(item => item.id === lab.id)?.parentId, work.id,
      'a rejected deletion must not leave child folders partially reparented');

    assert.equal(await catalog.renameFolder(labAtRoot.id, 'Lab elsewhere'), true);
    assert.equal(await catalog.removeFolder(work.id), true);
    const folders = await catalog.listFolders();
    assert.equal(folders.find(item => item.id === lab.id)?.parentId, null);
    assert.equal(folders.some(item => item.id === work.id), false);
    const sessions = await catalog.listSessions('');
    assert.equal(sessions.find(item => item.id === rootSession.id)?.folderId, null);
    assert.equal(sessions.find(item => item.id === childSession.id)?.folderId, lab.id);
  } finally {
    database.close();
  }
});

test('session catalog forwards cancellation and preserves the cancelled outcome', async () => {
  let forwarded: unknown;
  const catalog = createSessionCatalog({
    async listSessions(_query, cancellation) { forwarded = cancellation; throw new StorageOperationError('cancelled'); },
    async createSession() { throw new Error('not called'); },
    async setFavorite() { throw new Error('not called'); },
    async removeSession() { throw new Error('not called'); },
    async listFolders() { throw new Error('not called'); },
    async createFolder() { throw new Error('not called'); },
    async renameFolder() { throw new Error('not called'); },
    async moveFolder() { throw new Error('not called'); },
    async removeFolder() { throw new Error('not called'); },
    async moveSession() { throw new Error('not called'); }
  });
  const cancellation = { aborted: false, addEventListener() {}, removeEventListener() {} };
  const result = await catalog.list('prod', cancellation);
  assert.equal(forwarded, cancellation);
  assert.deepEqual(result, { ok: false, error: { code: 'CANCELLED', target: 'application', retryable: false } });
});

test('storage worker retains busy and corrupt categories from shared storage errors', () => {
  assert.equal(storageWorkerErrorCode(new StorageOperationError('busy')), 'BUSY');
  assert.equal(storageWorkerErrorCode(new StorageOperationError('conflict')), 'CONFLICT');
  assert.equal(storageWorkerErrorCode(new StorageOperationError('corrupt')), 'CORRUPT');
  assert.equal(storageWorkerErrorCode(new StorageOperationError('not-found')), 'NOT_FOUND');
  assert.equal(storageWorkerErrorCode(new StorageOperationError('unavailable')), 'UNAVAILABLE');
});
