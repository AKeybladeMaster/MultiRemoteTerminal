import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteHostTrustRepository } from '../../apps/desktop/src/adapters/sqlite-host-trust-repository.ts';
import { SqliteSessionCatalogRepository } from '../../apps/desktop/src/adapters/sqlite-session-catalog-repository.ts';
import { parseStorageWorkerMessage, parseStorageWorkerRequest, storageWorkerErrorCode } from '../../apps/desktop/src/workers/storage-protocol.ts';
import { createSessionCatalog } from '../../packages/application/src/session-catalog.ts';
import type { SessionCatalogStore } from '../../packages/application/src/session-catalog.ts';
import type { CancellationSignal } from '../../packages/application/src/cancellation.ts';
import { StorageOperationError } from '../../packages/application/src/storage-errors.ts';
import { parseCredentialReference } from '../../packages/domain/src/credentials.ts';

test('SQLite catalog creates, searches, favorites and deletes over one thousand non-secret definitions', async () => {
  const database = new DatabaseSync(':memory:');
  try {
    new SqliteHostTrustRepository(database).migrate();
    const catalog = new SqliteSessionCatalogRepository(database);
    const ssh = await catalog.createSession({ kind: 'ssh', name: 'Production gateway', host: 'SSH.Example.com.', port: 2222 });
    const sftp = await catalog.createSession({ kind: 'sftp', name: 'Build files', host: 'SSH.Example.com.', port: 22 });
    const telnet = await catalog.createSession({ kind: 'telnet', name: 'Legacy switch', host: 'TELNET.Example.com.', port: 23 });
    const ftp = await catalog.createSession({ kind: 'ftp', name: 'Secure file host', host: 'Files.Example.com.', port: 2121, secure: true });
    const rdp = await catalog.createSession({ kind: 'rdp', name: 'Windows desktop', host: 'Desk.Example.com.', port: 3390 });
    const vnc = await catalog.createSession({ kind: 'vnc', name: 'Linux desktop', host: 'VNC.Example.com.', port: 5901 });
    const serialConfiguration = { path: 'COM19', baudRate: 115_200, dataBits: 8, parity: 'even', stopBits: 1.5, flowControl: 'rtscts' } as const;
    const serial = await catalog.createSession({ kind: 'serial', name: 'Controller', configuration: serialConfiguration });
    const local = await catalog.createSession({ kind: 'local', name: 'Local PowerShell', shell: 'powershell' });
    const bash = await catalog.createSession({ kind: 'local', name: 'Local Bash', shell: 'bash' });
    const wsl = await catalog.createSession({ kind: 'local', name: 'Ubuntu', shell: 'wsl', distribution: 'Ubuntu' });
    assert.equal(ssh.kind, 'ssh');
    assert.equal(sftp.kind, 'sftp');
    assert.equal(telnet.kind, 'telnet');
    assert.equal(ftp.kind, 'ftp');
    assert.deepEqual(rdp.kind === 'rdp' ? { host: rdp.host, port: rdp.port } : undefined, { host: 'desk.example.com', port: 3390 });
    assert.deepEqual(vnc.kind === 'vnc' ? { host: vnc.host, port: vnc.port } : undefined, { host: 'vnc.example.com', port: 5901 });
    assert.deepEqual(serial.kind === 'serial' ? serial.configuration : undefined, serialConfiguration);
    if (ftp.kind !== 'ftp') throw new Error('Expected FTP definition');
    assert.deepEqual({ host: ftp.host, port: ftp.port, secure: ftp.secure }, { host: 'files.example.com', port: 2121, secure: true });
    if (telnet.kind !== 'telnet') throw new Error('Expected Telnet definition');
    assert.deepEqual({ host: telnet.host, port: telnet.port }, { host: 'telnet.example.com', port: 23 });
    assert.equal(bash.kind, 'local');
    if (bash.kind !== 'local') throw new Error('Expected Bash definition');
    assert.equal(bash.shell, 'bash');
    assert.deepEqual(wsl.kind === 'local' && wsl.shell === 'wsl' ? { shell: wsl.shell, distribution: wsl.distribution } : undefined,
      { shell: 'wsl', distribution: 'Ubuntu' });
    assert.equal((await catalog.getSessionDefinition(wsl.id))?.kind, 'local');
    const persistedWsl = database.prepare('SELECT host, port, credential_ref, options_json FROM session_definitions WHERE id = ?').get(wsl.id) as {
      readonly host: string | null; readonly port: number | null; readonly credential_ref: string | null; readonly options_json: string;
    };
    assert.deepEqual({ ...persistedWsl }, { host: null, port: null, credential_ref: null, options_json: '{"shell":"wsl","distribution":"Ubuntu"}' });
    if (ssh.kind !== 'ssh') throw new Error('Expected SSH definition');
    assert.deepEqual({ host: ssh.host, port: ssh.port }, { host: 'ssh.example.com', port: 2222 });
    const applicationCatalog = createSessionCatalog(catalog, unusedBundleDialog);
    assert.deepEqual(await applicationCatalog.get(ssh.id), { ok: true, result: ssh });
    assert.deepEqual(await applicationCatalog.get('33333333-3333-4333-8333-333333333333'), {
      ok: false, error: { code: 'NOT_FOUND', target: 'application', retryable: false }
    });
    assert.deepEqual(await applicationCatalog.get('invalid'), {
      ok: false, error: { code: 'INVALID_REQUEST', target: 'application', retryable: false }
    });
    assert.ok((await catalog.listSessions('GATEWAY')).some(item => item.id === ssh.id));
    assert.ok((await catalog.listSessions('ssh.example')).some(item => item.id === ssh.id));
    assert.ok((await catalog.listSessions('ssh.example')).some(item => item.id === sftp.id));
    assert.ok((await catalog.listSessions('telnet.example')).some(item => item.id === telnet.id));
    assert.ok((await catalog.listSessions('files.example')).some(item => item.id === ftp.id));
    assert.ok((await catalog.listSessions('desk.example')).some(item => item.id === rdp.id));
    assert.ok((await catalog.listSessions('vnc.example')).some(item => item.id === vnc.id));
    assert.ok((await catalog.listSessions('Controller')).some(item => item.id === serial.id));

    for (let index = 0; index < 1_000; index += 1) {
      await catalog.createSession({ kind: 'local', name: `Connection ${String(index).padStart(4, '0')}`, shell: index % 2 === 0 ? 'powershell' : 'cmd' });
    }
    assert.equal((await catalog.listSessions('Connection')).length, 1_000);
    assert.equal((await catalog.listSessions('')).length, 1_010);
    assert.equal(await catalog.countSessions(), 1_010);
    assert.deepEqual(await applicationCatalog.count(), { ok: true, result: 1_010 });
    assert.equal((await catalog.listSessions('Local Bash')).some(item => item.id === bash.id), true);
    assert.equal(await catalog.setFavorite(ssh.id, true), true);
    assert.equal(await catalog.setFavorite(telnet.id, true), true);
    assert.equal(await catalog.setFavorite(serial.id, true), true);
    assert.equal(await catalog.removeSession(local.id), true);
    assert.equal(await catalog.removeSession(local.id), false);

    const persistedSsh = database.prepare('SELECT credential_ref, options_json FROM session_definitions WHERE id = ?').get(ssh.id) as {
      readonly credential_ref: string | null; readonly options_json: string;
    };
    assert.equal(persistedSsh.credential_ref, null);
    assert.equal(persistedSsh.options_json, '{}');
    const persistedSftp = database.prepare('SELECT kind, username, credential_ref, options_json FROM session_definitions WHERE id = ?').get(sftp.id) as {
      readonly kind: string; readonly username: string | null; readonly credential_ref: string | null; readonly options_json: string;
    };
    assert.equal(persistedSftp.kind, 'ssh', 'SFTP-only transport mode is stored in SSH options for compatibility with existing schemas');
    assert.equal(persistedSftp.username, null);
    assert.equal(persistedSftp.credential_ref, null);
    assert.equal(persistedSftp.options_json, '{"sftpOnly":true}');
    const persistedTelnet = database.prepare('SELECT credential_ref, options_json FROM session_definitions WHERE id = ?').get(telnet.id) as {
      readonly credential_ref: string | null; readonly options_json: string;
    };
    assert.equal(persistedTelnet.credential_ref, null);
    assert.equal(persistedTelnet.options_json, '{}');
    const persistedFtp = database.prepare('SELECT username, credential_ref, options_json FROM session_definitions WHERE id = ?').get(ftp.id) as {
      readonly username: string | null; readonly credential_ref: string | null; readonly options_json: string;
    };
    assert.equal(persistedFtp.username, null);
    assert.equal(persistedFtp.credential_ref, null);
    assert.equal(persistedFtp.options_json, '{"secure":true}');
    const persistedVnc = database.prepare('SELECT credential_ref, options_json FROM session_definitions WHERE id = ?').get(vnc.id) as {
      readonly credential_ref: string | null; readonly options_json: string;
    };
    assert.equal(persistedVnc.credential_ref, null);
    assert.equal(persistedVnc.options_json, '{}');
    const persistedSerial = database.prepare('SELECT host, port, credential_ref, options_json FROM session_definitions WHERE id = ?').get(serial.id) as {
      readonly host: string | null; readonly port: number | null; readonly credential_ref: string | null; readonly options_json: string;
    };
    assert.equal(persistedSerial.host, null);
    assert.equal(persistedSerial.port, null);
    assert.equal(persistedSerial.credential_ref, null);
    assert.equal(persistedSerial.options_json, JSON.stringify(serialConfiguration));
    assert.equal((await catalog.listSessions('password')).length, 0);
    const favorites = await catalog.listSessions('');
    assert.deepEqual(new Set(favorites.slice(0, 3).map(item => item.id)), new Set([ssh.id, telnet.id, serial.id]));
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
    await assert.rejects(catalog.createSession({ kind: 'vnc', name: 'Unsafe viewer', host: 'server.example', port: 5900,
      password: 'never-save-this' } as never), (error: unknown) => error instanceof StorageOperationError && error.kind === 'unavailable');
    await assert.rejects(catalog.createSession({ kind: 'ssh', name: 'Invalid', host: 'server.example', port: 0 }),
      (error: unknown) => error instanceof StorageOperationError && error.kind === 'unavailable');
    assert.equal((database.prepare('SELECT count(*) AS count FROM session_definitions').get() as { readonly count: number }).count, 0);
  } finally {
    database.close();
  }
});

test('credential references bind only SSH terminal profiles and remain absent from definitions', async () => {
  const database = new DatabaseSync(':memory:');
  try {
    new SqliteHostTrustRepository(database).migrate();
    const catalog = new SqliteSessionCatalogRepository(database);
    const ssh = await catalog.createSession({ kind: 'ssh', name: 'Build', host: 'build.example.net', port: 22 });
    const sftp = await catalog.createSession({ kind: 'sftp', name: 'Build files', host: 'build.example.net', port: 22 });
    const reference = parseCredentialReference('b64504d8-9bbc-4e11-a4e2-345fcc039841');
    assert.ok(reference);
    assert.equal(await catalog.setSessionCredentialReference(ssh.id, reference, null), true);
    assert.equal(await catalog.getSessionCredentialReference(ssh.id), reference);
    assert.equal(await catalog.setSessionCredentialReference(ssh.id, reference, null), false, 'a stale credential update cannot replace an attached reference');
    assert.equal(await catalog.setSessionCredentialReference(sftp.id, reference, null), false);
    assert.equal(await catalog.getSessionCredentialReference(sftp.id), undefined);
    assert.equal(await catalog.setSessionCredentialReference(ssh.id, null, null), false, 'clear requires the current expected reference');
    assert.equal(await catalog.setSessionCredentialReference(ssh.id, null, reference), true);
    assert.equal(await catalog.getSessionCredentialReference(ssh.id), undefined);
    assert.equal(await catalog.setSessionCredentialReference(ssh.id, reference, null), true);
    const exposedProfile = await catalog.getSessionDefinition(ssh.id);
    assert.ok(exposedProfile);
    assert.equal(Object.hasOwn(exposedProfile, 'credential_ref'), false);
    const raw = database.prepare('SELECT credential_ref FROM session_definitions WHERE id = ?').get(ssh.id) as { readonly credential_ref: string };
    assert.equal(raw.credential_ref, reference);
    const updatedAtBeforeReset = (database.prepare('SELECT updated_at FROM session_definitions WHERE id = ?').get(ssh.id) as { readonly updated_at: string }).updated_at;
    await catalog.clearAllSessionCredentialReferences();
    assert.equal((database.prepare('SELECT credential_ref FROM session_definitions WHERE id = ?').get(ssh.id) as { readonly credential_ref: string | null }).credential_ref, null);
    assert.ok(await catalog.getSessionDefinition(ssh.id), 'vault reset must preserve saved session definitions');
    assert.equal((database.prepare('SELECT updated_at FROM session_definitions WHERE id = ?').get(ssh.id) as { readonly updated_at: string }).updated_at,
      updatedAtBeforeReset, 'credential cleanup must not change saved-session recency');
  } finally { database.close(); }
});

test('remembering a connection reuses its normalized profile and updates its last-used time', async () => {
  const database = new DatabaseSync(':memory:');
  try {
    new SqliteHostTrustRepository(database).migrate();
    const catalog = new SqliteSessionCatalogRepository(database);
    const saved = await catalog.createSession({ kind: 'ssh', name: 'Production', host: 'SSH.Example.com.', port: 2222 });
    database.prepare('UPDATE session_definitions SET updated_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', saved.id);

    const remembered = await catalog.rememberSession({ kind: 'ssh', name: 'ssh.example.com:2222 - SSH', host: 'ssh.example.com', port: 2222 });
    assert.equal(remembered.id, saved.id);
    assert.equal(remembered.name, 'Production', 'a user-named saved profile keeps its name');
    assert.ok(Date.parse(remembered.updatedAt) > Date.parse('2020-01-01T00:00:00.000Z'));

    const files = await catalog.rememberSession({ kind: 'sftp', name: 'Files', host: 'ssh.example.com', port: 2222 });
    assert.notEqual(files.id, saved.id, 'SSH terminal and SFTP-only profiles remain distinct');
    assert.equal((database.prepare('SELECT credential_ref FROM session_definitions WHERE id = ?').get(files.id) as { credential_ref: string | null }).credential_ref, null);
    assert.equal((await catalog.listSessions('')).length, 2);
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
      VALUES (?, ?, 'xdmcp', 'Future viewer', '{}', 1, 0, ?, ?)`)
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
    async countSessions(cancellation) { forwarded = cancellation; throw new StorageOperationError('cancelled'); },
    async getSessionDefinition() { throw new Error('not called'); },
    async createSession() { throw new Error('not called'); },
    async rememberSession() { throw new Error('not called'); },
    async getSessionCredentialReference() { throw new Error('not called'); },
    async setSessionCredentialReference() { throw new Error('not called'); },
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
  assert.deepEqual(await catalog.count(cancellation), { ok: false, error: { code: 'CANCELLED', target: 'application', retryable: false } });
  assert.equal(forwarded, cancellation);
});

test('storage worker validates exact session-count requests and non-negative integer replies', () => {
  const requestId = '8cc8c44e-8660-4232-961b-ff7760afc745';
  const request = { version: 1, type: 'request', requestId, command: 'session.count' };
  assert.deepEqual(parseStorageWorkerRequest(request), request);
  assert.equal(parseStorageWorkerRequest({ ...request, extra: true }), undefined);
  const reply = { version: 1, type: 'reply', requestId, ok: true, result: { kind: 'sessionCount', value: 1_000 } };
  assert.deepEqual(parseStorageWorkerMessage(reply), reply);
  assert.equal(parseStorageWorkerMessage({ ...reply, result: { kind: 'sessionCount', value: -1 } }), undefined);
  assert.equal(parseStorageWorkerMessage({ ...reply, result: { kind: 'sessionCount', value: 1.5 } }), undefined);
});

test('storage worker requires exact expected credential references for compare-and-set updates', () => {
  const base = { version: 1, type: 'request', requestId: '00000000-0000-4000-8000-000000000001', command: 'session.credential.set',
    id: '11111111-1111-4111-8111-111111111111', reference: '22222222-2222-4222-8222-222222222222', expectedReference: null };
  assert.deepEqual(parseStorageWorkerRequest(base), base);
  assert.equal(parseStorageWorkerRequest({ ...base, expectedReference: '../credentials.json' }), undefined);
  assert.equal(parseStorageWorkerRequest({ ...base, expectedReference: undefined }), undefined);
  assert.equal(parseStorageWorkerRequest({ ...base, secret: 'never-store' }), undefined);
});

test('session removal respects the tunnel guard and always releases its deletion reservation', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const calls = { removed: 0, began: 0, ended: 0 };
  let allowed = false;
  const store = { async removeSession() { calls.removed += 1; return true; } } as unknown as SessionCatalogStore;
  const guard = {
    beginSessionRemoval() { calls.began += 1; return allowed; },
    endSessionRemoval() { calls.ended += 1; }
  };
  const catalog = createSessionCatalog(store, unusedBundleDialog, guard);

  assert.deepEqual(await catalog.remove(id), { ok: false, error: { code: 'BUSY', target: 'application', retryable: true } });
  assert.equal(calls.removed, 0);
  allowed = true;
  assert.deepEqual(await catalog.remove(id), { ok: true, result: {} });
  assert.deepEqual(calls, { removed: 1, began: 2, ended: 1 });
});

test('folder bundle pickers return CANCELLED on dismissal and discard paths selected after caller cancellation', async () => {
  const folderId = '11111111-1111-4111-8111-111111111111';
  let exportCalls = 0;
  let importCalls = 0;
  const store = {
    async listFolders() { return [{ id: folderId, parentId: null, name: 'Project' }]; },
    async exportFolderToFile() { exportCalls += 1; return { folderCount: 1, sessionCount: 0 }; },
    async importFolderFromFile() { importCalls += 1; return { folderCount: 1, sessionCount: 0, createdFolderCount: 1, createdSessionCount: 0 }; }
  } as unknown as SessionCatalogStore;

  const dismissed = createSessionCatalog(store, {
    async selectExportPath() { return undefined; },
    async selectImportPath() { return undefined; }
  });
  assert.deepEqual(await dismissed.importFolder(), {
    ok: false, error: { code: 'CANCELLED', target: 'application', retryable: false }
  });
  assert.deepEqual(await dismissed.exportFolder(folderId), {
    ok: false, error: { code: 'CANCELLED', target: 'application', retryable: false }
  });

  let resolveImportPath!: (path: string | undefined) => void;
  let resolveExportPath!: (path: string | undefined) => void;
  const pendingPickers = createSessionCatalog(store, {
    selectExportPath() { return new Promise(resolve => { resolveExportPath = resolve; }); },
    selectImportPath() { return new Promise(resolve => { resolveImportPath = resolve; }); }
  });
  let aborted = false;
  const cancelled = { get aborted() { return aborted; }, addEventListener() {}, removeEventListener() {} } satisfies CancellationSignal;
  const pendingImport = pendingPickers.importFolder(cancelled);
  assert.equal(typeof resolveImportPath, 'function', 'the import picker is open before cancellation');
  aborted = true;
  resolveImportPath('C:\\tmp\\sessions.json');
  assert.deepEqual(await pendingImport, {
    ok: false, error: { code: 'CANCELLED', target: 'application', retryable: false }
  });
  aborted = false;
  const pendingExport = pendingPickers.exportFolder(folderId, cancelled);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(typeof resolveExportPath, 'function', 'the export picker is open before cancellation');
  aborted = true;
  resolveExportPath('C:\\tmp\\sessions.json');
  assert.deepEqual(await pendingExport, {
    ok: false, error: { code: 'CANCELLED', target: 'application', retryable: false }
  });
  assert.equal(exportCalls, 0, 'a path selected after cancellation must not start export storage work');
  assert.equal(importCalls, 0, 'a path selected after cancellation must not start import storage work');
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
    const unicodeUpper = await source.createFolder({ name: 'Device Ä', parentId: root.id });
    const unicodeLower = await source.createFolder({ name: 'Device ä', parentId: root.id });
    const session = await source.createSession({ kind: 'ssh', name: 'Build host', host: 'server.example.com', port: 2222 });
    const telnet = await source.createSession({ kind: 'telnet', name: 'Lab console', host: 'console.example.com', port: 23 });
    const ftp = await source.createSession({ kind: 'ftp', name: 'Archive files', host: 'files.example.com', port: 2121, secure: false });
    const sftp = await source.createSession({ kind: 'sftp', name: 'Build artifacts', host: 'build.example.com', port: 22 });
    const rdp = await source.createSession({ kind: 'rdp', name: 'Windows desktop', host: 'desktop.example.com', port: 3390 });
    const vnc = await source.createSession({ kind: 'vnc', name: 'Linux desktop', host: 'linux.example.com', port: 5901 });
    const serialConfiguration = { path: 'COM7', baudRate: 115_200, dataBits: 7, parity: 'odd', stopBits: 2, flowControl: 'xonxoff' } as const;
    const serial = await source.createSession({ kind: 'serial', name: 'Control board', configuration: serialConfiguration });
    const wsl = await source.createSession({ kind: 'local', name: 'Ubuntu', shell: 'wsl', distribution: 'Ubuntu-24.04' });
    await source.moveSession(session.id, child.id);
    await source.moveSession(telnet.id, root.id);
    await source.moveSession(ftp.id, child.id);
    await source.moveSession(sftp.id, child.id);
    await source.moveSession(rdp.id, child.id);
    await source.moveSession(vnc.id, child.id);
    await source.moveSession(serial.id, child.id);
    await source.moveSession(wsl.id, child.id);
    await source.setFavorite(session.id, true);
    const path = join(directory, 'project.mrt-session-folder.json');

    assert.deepEqual(await source.exportFolderToFile(root.id, path), { folderCount: 4, sessionCount: 8 });
    assert.deepEqual(await source.exportFolderToFile(root.id, path), { folderCount: 4, sessionCount: 8 },
      'exporting again to the selected file replaces it atomically');
    const text = await readFile(path, 'utf8');
    assert.match(text, /"format": "multiremote-terminal\/session-folder"/);
    assert.doesNotMatch(text, /password|credential|privateKey/i);
    assert.deepEqual(await destination.importFolderFromFile(path), {
      folderCount: 4, sessionCount: 8, createdFolderCount: 4, createdSessionCount: 8
    });
    assert.deepEqual((await destination.listSessions('Ubuntu')).map(session =>
      session.kind === 'local' && session.shell === 'wsl' ? { shell: session.shell, distribution: session.distribution } : undefined),
    [{ shell: 'wsl', distribution: 'Ubuntu-24.04' }]);
    assert.deepEqual(new Set((await destination.listFolders()).map(folder => folder.name)),
      new Set([root.name, child.name, unicodeUpper.name, unicodeLower.name]));
    const importedSessions = await destination.listSessions('');
    assert.equal(importedSessions.length, 8);
    const importedSession = importedSessions.find(item => item.kind === 'ssh');
    assert.ok(importedSession?.kind === 'ssh');
    if (importedSession?.kind !== 'ssh') throw new Error('Expected an imported SSH definition');
    assert.deepEqual({ id: importedSession.id, folderId: importedSession.folderId, kind: importedSession.kind, name: importedSession.name,
      host: importedSession.host, port: importedSession.port, favorite: importedSession.favorite }, {
      id: session.id, folderId: child.id, kind: 'ssh', name: 'Build host', host: 'server.example.com', port: 2222, favorite: true
    });
    const currentSourceTelnet = (await source.listSessions('')).find(item => item.kind === 'telnet');
    assert.ok(currentSourceTelnet?.kind === 'telnet');
    assert.deepEqual(importedSessions.find(item => item.kind === 'telnet'), currentSourceTelnet,
      'the bundle preserves the latest definition timestamp after folder moves');
    const importedFtp = importedSessions.find(item => item.kind === 'ftp');
    assert.ok(importedFtp?.kind === 'ftp');
    if (importedFtp?.kind !== 'ftp') throw new Error('Expected an imported FTP definition');
    assert.deepEqual({ id: importedFtp.id, folderId: importedFtp.folderId, kind: importedFtp.kind, name: importedFtp.name,
      host: importedFtp.host, port: importedFtp.port, secure: importedFtp.secure }, {
      id: ftp.id, folderId: child.id, kind: 'ftp', name: 'Archive files', host: 'files.example.com', port: 2121, secure: false
    });
    const importedSftp = importedSessions.find(item => item.kind === 'sftp');
    assert.ok(importedSftp?.kind === 'sftp');
    if (importedSftp?.kind !== 'sftp') throw new Error('Expected an imported SFTP definition');
    assert.deepEqual({ id: importedSftp.id, folderId: importedSftp.folderId, kind: importedSftp.kind, name: importedSftp.name,
      host: importedSftp.host, port: importedSftp.port }, {
      id: sftp.id, folderId: child.id, kind: 'sftp', name: 'Build artifacts', host: 'build.example.com', port: 22
    });
    const importedRdp = importedSessions.find(item => item.kind === 'rdp');
    const sourceRdp = (await source.listSessions('')).find(item => item.kind === 'rdp');
    assert.ok(importedRdp?.kind === 'rdp' && sourceRdp?.kind === 'rdp');
    assert.deepEqual(importedRdp, sourceRdp);
    const importedVnc = importedSessions.find(item => item.kind === 'vnc');
    const sourceVnc = (await source.listSessions('')).find(item => item.kind === 'vnc');
    assert.ok(importedVnc?.kind === 'vnc' && sourceVnc?.kind === 'vnc');
    assert.deepEqual(importedVnc, sourceVnc);
    const importedSerial = importedSessions.find(item => item.kind === 'serial');
    const sourceSerial = (await source.listSessions('')).find(item => item.kind === 'serial');
    assert.ok(importedSerial?.kind === 'serial' && sourceSerial?.kind === 'serial');
    assert.deepEqual(importedSerial, sourceSerial);
    assert.deepEqual(await destination.importFolderFromFile(path), {
      folderCount: 4, sessionCount: 8, createdFolderCount: 0, createdSessionCount: 0
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
  assert.deepEqual(parseStorageWorkerRequest({ ...base, command: 'session.folder.export', folderId: '11111111-1111-4111-8111-111111111111',
    path: 'C:\\tmp\\sessions.json', temporaryPath: 'C:\\tmp\\.sessions.json.5726a2ee-03cd-4f5a-a28c-bd72784f80a6.tmp' })?.command,
  'session.folder.export');
  assert.equal(parseStorageWorkerRequest({ ...base, command: 'session.folder.import', path: 'relative.json' }), undefined);
  assert.equal(parseStorageWorkerRequest({ ...base, command: 'session.folder.export', folderId: 'bad', path: 'C:\\tmp\\sessions.json' }), undefined);
  assert.equal(parseStorageWorkerRequest({ ...base, command: 'session.folder.import', path: 'C:\\tmp\\sessions.json', secret: 'hidden' }), undefined);
  assert.equal(parseStorageWorkerRequest({ ...base, command: 'session.folder.export', folderId: '11111111-1111-4111-8111-111111111111',
    path: 'C:\\tmp\\sessions.json', temporaryPath: 'C:\\other\\.sessions.json.5726a2ee-03cd-4f5a-a28c-bd72784f80a6.tmp' }), undefined);
});

const unusedBundleDialog = {
  async selectExportPath() { return undefined; },
  async selectImportPath() { return undefined; }
};
