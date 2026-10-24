import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteHostTrustRepository } from '../../apps/desktop/src/adapters/sqlite-host-trust-repository.ts';
import { SqliteSessionCatalogRepository } from '../../apps/desktop/src/adapters/sqlite-session-catalog-repository.ts';
import { parseStorageWorkerRequest, storageWorkerErrorCode } from '../../apps/desktop/src/workers/storage-protocol.ts';
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
    const futureSessionId = '2d7cd587-9b58-49d9-9f95-781e2d68583b';
    const timestamp = new Date().toISOString();
    database.prepare(`INSERT INTO session_definitions
      (id, folder_id, kind, name, options_json, options_version, favorite, created_at, updated_at)
      VALUES (?, ?, 'rdp', 'Future viewer', '{}', 1, 0, ?, ?)`)
      .run(futureSessionId, work.id, timestamp, timestamp);
    const applicationCatalog = createSessionCatalog(catalog, unusedBundleDialog);
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
    assert.equal((database.prepare('SELECT folder_id FROM session_definitions WHERE id = ?').get(futureSessionId) as { readonly folder_id: string }).folder_id, work.id,
      'folder deletion must preserve saved definitions for providers outside the current UI');

    assert.equal(await catalog.renameFolder(labAtRoot.id, 'Lab elsewhere'), true);
    assert.equal(await catalog.removeFolder(work.id), true);
    const folders = await catalog.listFolders();
    assert.equal(folders.find(item => item.id === lab.id)?.parentId, null);
    assert.equal(folders.some(item => item.id === work.id), false);
    const sessions = await catalog.listSessions('');
    assert.equal(sessions.find(item => item.id === rootSession.id)?.folderId, null);
    assert.equal(sessions.find(item => item.id === childSession.id)?.folderId, lab.id);
    assert.equal((database.prepare('SELECT folder_id FROM session_definitions WHERE id = ?').get(futureSessionId) as { readonly folder_id: string | null }).folder_id, null);
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
    async moveSession() { throw new Error('not called'); },
    async exportFolderToFile() { throw new Error('not called'); },
    async importFolderFromFile() { throw new Error('not called'); }
  }, unusedBundleDialog);
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
  assert.equal(storageWorkerErrorCode(new StorageOperationError('invalid')), 'INVALID_BUNDLE');
});

test('SQLite folder bundle export/import round-trips a subtree without credentials and is idempotent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-folder-bundle-'));
  const sourceDatabase = new DatabaseSync(':memory:');
  const destinationDatabase = new DatabaseSync(':memory:');
  try {
    new SqliteHostTrustRepository(sourceDatabase).migrate();
    new SqliteHostTrustRepository(destinationDatabase).migrate();
    const source = new SqliteSessionCatalogRepository(sourceDatabase);
    const destination = new SqliteSessionCatalogRepository(destinationDatabase);
    const root = await source.createFolder({ name: 'Project', parentId: null });
    const child = await source.createFolder({ name: 'Lab', parentId: root.id });
    const session = await source.createSession({ kind: 'ssh', name: 'Build host', host: 'server.example.com', port: 2222 });
    await source.moveSession(session.id, child.id);
    await source.setFavorite(session.id, true);
    const path = join(directory, 'project.mrt-session-folder.json');

    assert.deepEqual(await source.exportFolderToFile(root.id, path), { folderCount: 2, sessionCount: 1 });
    assert.deepEqual(await source.exportFolderToFile(root.id, path), { folderCount: 2, sessionCount: 1 },
      'exporting again to the selected file replaces it atomically');
    const text = await readFile(path, 'utf8');
    assert.match(text, /"format": "multiremote-terminal\/session-folder"/);
    assert.doesNotMatch(text, /password|credential|privateKey/i);
    assert.deepEqual(await destination.importFolderFromFile(path), {
      folderCount: 2, sessionCount: 1, createdFolderCount: 2, createdSessionCount: 1
    });
    assert.deepEqual(await destination.listFolders(), [root, child]);
    const importedSessions = await destination.listSessions('');
    assert.equal(importedSessions.length, 1);
    const importedSession = importedSessions[0];
    assert.ok(importedSession?.kind === 'ssh');
    if (importedSession?.kind !== 'ssh') throw new Error('Expected an imported SSH definition');
    assert.deepEqual({ id: importedSession.id, folderId: importedSession.folderId, kind: importedSession.kind, name: importedSession.name,
      host: importedSession.host, port: importedSession.port, favorite: importedSession.favorite }, {
      id: session.id, folderId: child.id, kind: 'ssh', name: 'Build host', host: 'server.example.com', port: 2222, favorite: true
    });
    assert.deepEqual(await destination.importFolderFromFile(path), {
      folderCount: 2, sessionCount: 1, createdFolderCount: 0, createdSessionCount: 0
    });
  } finally {
    sourceDatabase.close();
    destinationDatabase.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('invalid and conflicting folder imports leave the SQLite catalog unchanged', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-folder-bundle-'));
  const sourceDatabase = new DatabaseSync(':memory:');
  const destinationDatabase = new DatabaseSync(':memory:');
  try {
    new SqliteHostTrustRepository(sourceDatabase).migrate();
    new SqliteHostTrustRepository(destinationDatabase).migrate();
    const source = new SqliteSessionCatalogRepository(sourceDatabase);
    const destination = new SqliteSessionCatalogRepository(destinationDatabase);
    const root = await source.createFolder({ name: 'Project', parentId: null });
    const child = await source.createFolder({ name: 'Lab', parentId: root.id });
    const leaf = await source.createFolder({ name: 'Tools', parentId: child.id });
    const path = join(directory, 'project.mrt-session-folder.json');
    await source.exportFolderToFile(root.id, path);

    const existingRoot = await destination.createFolder({ name: root.name, parentId: null });
    destinationDatabase.prepare('UPDATE folders SET id = ? WHERE id = ?').run(root.id, existingRoot.id);
    const conflictingLeaf = await destination.createFolder({ name: 'Different name', parentId: root.id });
    destinationDatabase.prepare('UPDATE folders SET id = ? WHERE id = ?').run(leaf.id, conflictingLeaf.id);
    const before = await destination.listFolders();
    await assert.rejects(destination.importFolderFromFile(path), (error: unknown) =>
      error instanceof StorageOperationError && error.kind === 'conflict');
    assert.deepEqual(await destination.listFolders(), before, 'the newly inserted child must roll back with the later ID conflict');

    const invalidPath = join(directory, 'invalid.json');
    await writeFile(invalidPath, '{"format":"bad","password":"secret"}');
    await assert.rejects(destination.importFolderFromFile(invalidPath), (error: unknown) =>
      error instanceof StorageOperationError && error.kind === 'invalid');
    assert.deepEqual(await destination.listFolders(), before);
  } finally {
    sourceDatabase.close();
    destinationDatabase.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('storage worker bundle requests require exact absolute bounded paths', () => {
  const base = { version: 1, type: 'request', requestId: '5726a2ee-03cd-4f5a-a28c-bd72784f80a6' } as const;
  assert.deepEqual(parseStorageWorkerRequest({ ...base, command: 'session.folder.import', path: 'C:\\tmp\\sessions.json' })?.command,
    'session.folder.import');
  assert.equal(parseStorageWorkerRequest({ ...base, command: 'session.folder.import', path: 'relative.json' }), undefined);
  assert.equal(parseStorageWorkerRequest({ ...base, command: 'session.folder.export', folderId: 'bad', path: 'C:\\tmp\\sessions.json' }), undefined);
  assert.equal(parseStorageWorkerRequest({ ...base, command: 'session.folder.import', path: 'C:\\tmp\\sessions.json', secret: 'hidden' }), undefined);
});

const unusedBundleDialog = {
  async selectExportPath() { return undefined; },
  async selectImportPath() { return undefined; }
};
