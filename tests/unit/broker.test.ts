import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { dispatchCommand } from '../../apps/desktop/src/main/broker.ts';
import type { AuditEvent, CommandActions } from '../../apps/desktop/src/main/broker.ts';
import { bindRendererRequestCancellation } from '../../apps/desktop/src/main/renderer-request-cancellation.ts';
import { APP_URL } from '../../packages/contracts/src/commands.ts';
import { describeWorkbench } from '../../packages/application/src/workbench.ts';

const request = { command: 'app.describe', requestId: '5726a2ee-03cd-4f5a-a28c-bd72784f80a6', contractVersion: 1, payload: {} };
const owner = { owned: true, mainFrame: true, url: APP_URL };
const snapshot = () => describeWorkbench({ version: '0.0.0', platform: 'win32' });
const noOp = async () => ({ ok: true, result: {} } as const);
const emptySavedSession = { id: '18f2f903-7b6f-4c8d-9c42-b63a58c4b087', folderId: null, kind: 'local', name: 'Saved', shell: 'cmd', favorite: false,
  createdAt: '2026-10-23T00:00:00.000Z', updatedAt: '2026-10-23T00:00:00.000Z' } as const;
const emptyMacro = { id: '7c08b18a-57cc-4b44-a8b3-2d404850e81c', schemaVersion: 1 as const, name: 'Build', steps: [],
  createdAt: '2026-10-25T10:00:00.000Z', updatedAt: '2026-10-25T10:00:00.000Z' };
const actions = (describe: () => ReturnType<typeof snapshot> = snapshot, noteUserActivity: () => void = () => {}): CommandActions => ({
  describe, noteUserActivity, readClipboardText: async () => '', authorizeClipboardPaste: () => false, authorizeTelnetConsent: () => false,
  authorizeFtpConsent: () => false,
  confirmMultilinePaste: async () => false,
  selectFtpUploadFile: async () => undefined, selectFtpDownloadPath: async () => undefined, resolveFtpTransferConflict: async () => undefined,
  reportFtpTransferProgress: () => {}, selectSshUploadFile: async () => undefined, selectSshDownloadPath: async () => undefined,
  resolveSshTransferConflict: async () => undefined, reportSshTransferProgress: () => {}, terminals: {
    async open(sessionId, shell) { return { ok: true, result: { sessionId, shell, state: 'running' } }; },
    write: noOp, resize: noOp, acknowledgeOutput: noOp, close: noOp
  }, sshTerminals: {
    async open(sessionId, host, port) { return { ok: true, result: { sessionId, endpoint: { host, port }, state: 'running' } }; },
    async openFiles(sessionId, host, port) { return { ok: true, result: { sessionId, endpoint: { host, port }, state: 'running' } }; },
    write: noOp, resize: noOp, acknowledgeOutput: noOp, listRemoteDirectory: async () => ({ ok: true, result: { path: '/', entries: [], truncated: false } }),
    uploadRemoteFile: async () => ({ ok: true, result: { direction: 'upload', fileName: 'x', bytesTransferred: 0, state: 'completed' } }),
    downloadRemoteFile: async () => ({ ok: true, result: { direction: 'download', fileName: 'x', bytesTransferred: 0, state: 'completed' } }),
    cancelTransfer: noOp, close: noOp, approveHostKey: noOp,
    rejectHostKey: () => ({ ok: true, result: {} }), revokeHostKey: noOp
  }, telnetTerminals: {
    async open(sessionId, host, port) { return { ok: true, result: { sessionId, endpoint: { host, port }, state: 'running' } }; },
    write: noOp, resize: noOp, acknowledgeOutput: noOp, close: noOp
  }, ftpFiles: {
    async open(sessionId, host, port, secure) { return { ok: true, result: { sessionId, endpoint: { host, port, secure }, state: 'running' } }; },
    listDirectory: async (_sessionId, path) => ({ ok: true, result: { path, entries: [], truncated: false } }),
    async uploadFile() { return { ok: true, result: { direction: 'upload', fileName: 'x', bytesTransferred: 0, state: 'completed' } }; },
    async downloadFile() { return { ok: true, result: { direction: 'download', fileName: 'x', bytesTransferred: 0, state: 'completed' } }; },
    cancelTransfer: noOp, close: noOp
  }, sessionCatalog: {
    list: async () => ({ ok: true, result: [] }),
    get: async () => ({ ok: true, result: emptySavedSession }),
    create: async () => ({ ok: true, result: emptySavedSession }),
    setFavorite: noOp, remove: noOp, listFolders: async () => ({ ok: true, result: [] }),
    createFolder: async () => ({ ok: true, result: { id: emptySavedSession.id, parentId: null, name: 'Folder' } }),
    renameFolder: noOp, moveFolder: noOp, removeFolder: noOp, moveSession: noOp,
    exportFolder: async () => ({ ok: true, result: { folderCount: 1, sessionCount: 1 } }),
    importFolder: async () => ({ ok: true, result: { folderCount: 1, sessionCount: 1, createdFolderCount: 1, createdSessionCount: 1 } })
  }, macros: {
    list: async () => ({ ok: true, result: [] }),
    create: async () => ({ ok: true, result: emptyMacro }),
    update: async () => ({ ok: true, result: emptyMacro }),
    remove: noOp,
    listShortcuts: async () => ({ ok: true, result: [] }),
    setShortcut: async macroId => ({ ok: true, result: { macroId: macroId as string, code: 'F2' } }),
    removeShortcut: noOp
  }, tunnels: {
    list: async () => ({ ok: true, result: [] }), save: async () => ({ ok: false, error: { code: 'INVALID_REQUEST', target: 'application', retryable: false } }),
    remove: noOp, async start(id) { return { ok: true, result: { tunnelId: id as string, state: 'stopped' } }; },
    async stop(id) { return { ok: true, result: { tunnelId: id as string, state: 'stopped' } }; }
  }, preferences: {
    read: async () => ({ ok: true, result: { startupGreeting: '' } }),
    save: async value => ({ ok: true, result: value as { readonly startupGreeting: string } })
  }
});

test('standalone SFTP broker path opens and closes an SSH-backed files session', async () => {
  const sessionId = 'c8f87744-bd2c-4c0d-9a18-a4a324dd71fd';
  const calls: string[] = [];
  const base = actions();
  const tracked: CommandActions = { ...base, sshTerminals: { ...base.sshTerminals,
    async openFiles(id, host, port) { calls.push(`open-files:${id}:${host}:${port}`); return { ok: true, result: { sessionId: id, endpoint: { host, port }, state: 'running' } }; },
    async listRemoteDirectory(id, path) { calls.push(`list:${id}:${path}`); return { ok: true, result: { path, entries: [], truncated: false } }; },
    async close(id) { calls.push(`close:${id}`); return { ok: true, result: {} }; }
  } };
  const open = await dispatchCommand(owner, { command: 'sftp.open', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId, host: 'server.example.net', port: 22 } }, tracked, () => {});
  const listing = await dispatchCommand(owner, { command: 'ssh.files.list', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId, path: '.' } }, tracked, () => {});
  const close = await dispatchCommand(owner, { command: 'sftp.close', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId } }, tracked, () => {});
  assert.equal(open.ok, true);
  assert.equal(listing.ok, true);
  assert.equal(close.ok, true);
  assert.deepEqual(calls, [`open-files:${sessionId}:server.example.net:22`, `list:${sessionId}:.`, `close:${sessionId}`]);
});

test('SSH broker resolves selected gateway profile IDs before opening the route', async () => {
  const sessionId = 'c8f87744-bd2c-4c0d-9a18-a4a324dd71fd';
  const gatewayOneId = '11111111-1111-4111-8111-111111111111';
  const gatewayTwoId = '22222222-2222-4222-8222-222222222222';
  const profiles = new Map([
    [gatewayOneId, { ...emptySavedSession, id: gatewayOneId, kind: 'ssh' as const, name: 'First gateway', host: 'first.example.net', port: 2201 }],
    [gatewayTwoId, { ...emptySavedSession, id: gatewayTwoId, kind: 'ssh' as const, name: 'Second gateway', host: 'second.example.net', port: 2202 }]
  ]);
  const selected: unknown[] = [];
  const base = actions();
  const routed: CommandActions = { ...base,
    sessionCatalog: { ...base.sessionCatalog, async get(id) {
      const profile = profiles.get(id as string);
      return profile ? { ok: true, result: profile } : { ok: false, error: { code: 'NOT_FOUND', target: 'application', retryable: false } };
    } },
    sshTerminals: { ...base.sshTerminals, async open(id, host, port, _size, route) {
      selected.push(route);
      return { ok: true, result: { sessionId: id, endpoint: { host, port }, state: 'running' } };
    } }
  };
  const reply = await dispatchCommand(owner, { command: 'ssh.open', requestId: request.requestId, contractVersion: 1, payload: {
    sessionId, host: 'target.example.net', port: 22, columns: 80, rows: 24, gatewayProfileIds: [gatewayOneId, gatewayTwoId]
  } }, routed, () => {});
  assert.equal(reply.ok, true);
  assert.deepEqual(selected, [[
    { host: 'first.example.net', port: 2201 },
    { host: 'second.example.net', port: 2202 }
  ]]);
});

test('macro catalog commands reach only the typed catalog and count as user activity', async () => {
  const calls: string[] = [];
  const updateCalls: unknown[] = [];
  let activity = 0;
  const base = actions(snapshot, () => { activity++; });
  const tracked: CommandActions = { ...base, macros: {
    async list() { calls.push('list'); return { ok: true, result: [emptyMacro] }; },
    async create() { calls.push('create'); return { ok: true, result: emptyMacro }; },
    async update(id, draft) { calls.push('update'); updateCalls.push({ id, draft }); return { ok: true, result: emptyMacro }; },
    async remove() { calls.push('remove'); return { ok: true, result: {} }; },
    async listShortcuts() { calls.push('list-shortcuts'); return { ok: true, result: [] }; },
    async setShortcut(macroId, code) { calls.push(`set-shortcut:${macroId}:${code}`); return { ok: true, result: { macroId: macroId as string, code: code as 'F2' } }; },
    async removeShortcut() { calls.push('remove-shortcut'); return { ok: true, result: {} }; }
  } };
  const requests = [
    { command: 'macro.list', payload: {} },
    { command: 'macro.create', payload: { name: 'Build', steps: [] } },
    { command: 'macro.update', payload: { id: emptyMacro.id, name: 'Build', steps: [] } },
    { command: 'macro.delete', payload: { id: emptyMacro.id } },
    { command: 'macro.shortcut.list', payload: {} },
    { command: 'macro.shortcut.set', payload: { macroId: emptyMacro.id, code: 'F2' } },
    { command: 'macro.shortcut.delete', payload: { macroId: emptyMacro.id } }
  ];
  const replies = await Promise.all(requests.map(item => dispatchCommand(owner, { ...item, requestId: request.requestId, contractVersion: 1 }, tracked, () => {})));
  assert.equal(replies.every(reply => reply.ok), true);
  assert.deepEqual(calls, ['list', 'create', 'update', 'remove', 'list-shortcuts', `set-shortcut:${emptyMacro.id}:F2`, 'remove-shortcut']);
  assert.deepEqual(updateCalls, [{ id: emptyMacro.id, draft: { name: 'Build', steps: [] } }]);
  assert.equal(activity, 7);
});

test('Telnet open requires a fresh plaintext-consent gesture at the main-process broker', async () => {
  const sessionId = 'c8f87744-bd2c-4c0d-9a18-a4a324dd71fd';
  let connections = 0;
  const base = actions();
  const input = { command: 'telnet.open', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId, host: 'console.example.net', port: 23, columns: 80, rows: 24 } };
  const denied = await dispatchCommand(owner, input, base, () => {});
  assert.deepEqual(denied, { requestId: request.requestId, ok: false,
    error: { code: 'FORBIDDEN', target: 'application', retryable: false } });
  assert.equal(connections, 0);

  const authorized: CommandActions = { ...base, authorizeTelnetConsent: id => id === sessionId,
    telnetTerminals: { ...base.telnetTerminals, async open(id, host, port) {
      connections++;
      return { ok: true, result: { sessionId: id, endpoint: { host, port }, state: 'running' } };
    } } };
  assert.equal((await dispatchCommand(owner, input, authorized, () => {})).ok, true);
  assert.equal(connections, 1);
});

test('plain FTP requires a fresh consent gesture while FTPS and file operations use the typed broker', async () => {
  const sessionId = 'c8f87744-bd2c-4c0d-9a18-a4a324dd71fd';
  const cancellation = new AbortController().signal;
  let authorized = 0;
  const calls: string[] = [];
  const base = actions();
  const tracked: CommandActions = { ...base, cancellation,
    authorizeFtpConsent: id => { authorized++; return id === sessionId; },
    ftpFiles: {
      ...base.ftpFiles,
      async open(id, host, port, secure, signal) {
        calls.push(`open:${secure}:${id}`);
        assert.equal(signal, cancellation);
        return { ok: true, result: { sessionId: id, endpoint: { host, port, secure }, state: 'running' } };
      },
      async listDirectory(id, path, signal) {
        calls.push(`list:${id}:${path}`);
        assert.equal(signal, cancellation);
        return { ok: true, result: { path, entries: [], truncated: false } };
      },
      async close(id) { calls.push(`close:${id}`); return { ok: true, result: {} }; }
    }
  };
  const plaintext = { command: 'ftp.open', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId, host: 'files.example.net', port: 21, secure: false } };
  const denied = await dispatchCommand(owner, plaintext, base, () => {});
  assert.equal(denied.ok, false);
  assert.equal(authorized, 0);
  assert.deepEqual(calls, []);

  const permitted = await dispatchCommand(owner, plaintext, tracked, () => {});
  assert.equal(permitted.ok, true);
  const ftps = await dispatchCommand(owner, { ...plaintext, payload: { ...plaintext.payload, port: 21, secure: true } }, tracked, () => {});
  assert.equal(ftps.ok, true);
  assert.equal(authorized, 1, 'encrypted FTP does not consume the plaintext consent gate');
  const listing = await dispatchCommand(owner, { command: 'ftp.files.list', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId, path: '/home' } }, tracked, () => {});
  const closed = await dispatchCommand(owner, { command: 'ftp.close', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId } }, tracked, () => {});
  assert.equal(listing.ok, true);
  assert.equal(closed.ok, true);
  assert.deepEqual(calls, [`open:false:${sessionId}`, `open:true:${sessionId}`, `list:${sessionId}:/home`, `close:${sessionId}`]);
});

test('FTP transfers keep local paths in main, forward explicit conflict choices, progress, and cancellation', async () => {
  const sessionId = 'c8f87744-bd2c-4c0d-9a18-a4a324dd71fd';
  const operationId = 'f43d82ce-551e-4b4d-8f0d-8a14ae0326bd';
  const cancellation = new AbortController().signal;
  const progressEvents: unknown[] = [];
  const observed: unknown[] = [];
  const progress = { sessionId, operationId, direction: 'upload' as const, phase: 'transferring' as const,
    fileName: 'archive.bin', bytesTransferred: 5, totalBytes: 10 };
  const base = actions();
  const withTransfers: CommandActions = { ...base, cancellation,
    selectFtpUploadFile: async () => ({ localPath: 'C:\\private\\archive.bin', fileName: 'archive.bin' }),
    selectFtpDownloadPath: async name => { observed.push(`select-download:${name}`); return 'C:\\private\\chosen-download.bin'; },
    resolveFtpTransferConflict: async (direction, name) => { observed.push(`policy:${direction}:${name}`); return direction === 'upload' ? 'rename' : 'overwrite'; },
    reportFtpTransferProgress: event => progressEvents.push(event),
    ftpFiles: { ...base.ftpFiles,
      async uploadFile(id, op, localPath, directory, fileName, policy, signal, onProgress) {
        observed.push({ kind: 'upload', id, op, localPath, directory, fileName, policy, signal });
        onProgress?.(progress);
        return { ok: true, result: { direction: 'upload', fileName: 'archive (1).bin', bytesTransferred: 10, state: 'completed' } };
      },
      async downloadFile(id, op, remotePath, localPath, policy, signal) {
        observed.push({ kind: 'download', id, op, remotePath, localPath, policy, signal });
        return { ok: true, result: { direction: 'download', fileName: 'download.bin', bytesTransferred: 7, state: 'completed' } };
      },
      async cancelTransfer(id, op) { observed.push(`cancel:${id}:${op}`); return { ok: true, result: {} }; }
    }
  };
  const upload = await dispatchCommand(owner, { command: 'ftp.files.upload', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId, operationId, remoteDirectory: '/incoming' } }, withTransfers, () => {});
  assert.deepEqual(upload, { requestId: request.requestId, ok: true,
    result: { direction: 'upload', fileName: 'archive (1).bin', bytesTransferred: 10, state: 'completed' } });
  assert.deepEqual(progressEvents, [progress]);
  assert.deepEqual(observed.slice(0, 2), ['policy:upload:archive.bin',
    { kind: 'upload', id: sessionId, op: operationId, localPath: 'C:\\private\\archive.bin', directory: '/incoming',
      fileName: 'archive.bin', policy: 'rename', signal: cancellation }]);

  const download = await dispatchCommand(owner, { command: 'ftp.files.download', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId, operationId, remotePath: '/incoming/download.bin' } }, withTransfers, () => {});
  assert.equal(download.ok, true);
  assert.deepEqual(observed.slice(2, 5), ['select-download:download.bin', 'policy:download:chosen-download.bin',
    { kind: 'download', id: sessionId, op: operationId, remotePath: '/incoming/download.bin', localPath: 'C:\\private\\chosen-download.bin',
      policy: 'overwrite', signal: cancellation }]);
  assert.ok(observed.includes('policy:download:chosen-download.bin'));
  const cancelled = await dispatchCommand(owner, { command: 'ftp.files.cancel', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId, operationId } }, withTransfers, () => {});
  assert.deepEqual(cancelled, { requestId: request.requestId, ok: true, result: {} });
  assert.equal(observed.at(-1), `cancel:${sessionId}:${operationId}`);
});

test('valid sender reaches the application through its interface', async () => {
  assert.deepEqual(await dispatchCommand(owner, request, actions(), () => {}), { requestId: request.requestId, ok: true, result: snapshot() });
  assert.equal((await dispatchCommand({ ...owner, url: APP_URL + '#preview' }, request, actions(), () => {})).ok, true);
});

test('terminal open forwards the preallocated id for close-during-startup cancellation', async () => {
  const sessionId = 'c8f87744-bd2c-4c0d-9a18-a4a324dd71fd';
  const input = { command: 'terminal.open', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId, shell: 'cmd', columns: 80, rows: 24 } };
  assert.deepEqual(await dispatchCommand(owner, input, actions(), () => {}), {
    requestId: request.requestId, ok: true, result: { sessionId, shell: 'cmd', state: 'running' }
  });
});

test('host-trust reset dispatches only the validated canonical endpoint', async () => {
  let revoked: { host: string; port: number } | undefined;
  const base = actions();
  const withRevoke: CommandActions = { ...base, sshTerminals: { ...base.sshTerminals, async revokeHostKey(host, port) {
    revoked = { host, port };
    return { ok: true, result: {} };
  } } };
  const input = { command: 'ssh.host.revoke', requestId: request.requestId, contractVersion: 1,
    payload: { host: 'server.example.com', port: 22 } };
  assert.deepEqual(await dispatchCommand(owner, input, withRevoke, () => {}), { requestId: request.requestId, ok: true, result: {} });
  assert.deepEqual(revoked, { host: 'server.example.com', port: 22 });
});

test('SSH remote-directory browsing forwards the validated path and cancellation signal', async () => {
  const sessionId = 'c8f87744-bd2c-4c0d-9a18-a4a324dd71fd';
  const cancellation = new AbortController().signal;
  let observed: { readonly sessionId: string; readonly path: string; readonly signal: unknown } | undefined;
  const base = actions();
  const withSftp: CommandActions = { ...base, cancellation, sshTerminals: { ...base.sshTerminals, async listRemoteDirectory(id, path, signal) {
    observed = { sessionId: id, path, signal };
    return { ok: true, result: { path, entries: [], truncated: false } };
  } } };
  const reply = await dispatchCommand(owner, { command: 'ssh.files.list', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId, path: '/home/alice' } }, withSftp, () => {});
  assert.deepEqual(reply, { requestId: request.requestId, ok: true, result: { path: '/home/alice', entries: [], truncated: false } });
  assert.deepEqual(observed, { sessionId, path: '/home/alice', signal: cancellation });
});

test('SFTP transfer broker keeps local selections in main and forwards explicit policy, progress and cancellation', async () => {
  const sessionId = 'c8f87744-bd2c-4c0d-9a18-a4a324dd71fd';
  const operationId = 'f43d82ce-551e-4b4d-8f0d-8a14ae0326bd';
  const cancellation = new AbortController().signal;
  const seen: unknown[] = [];
  const progressEvents: unknown[] = [];
  const base = actions();
  const withSftpTransfers: CommandActions = { ...base, cancellation,
    selectSshUploadFile: async () => ({ localPath: 'C:\\private\\report.txt', fileName: 'report.txt' }),
    selectSshDownloadPath: async fileName => { seen.push(`select:${fileName}`); return 'C:\\private\\saved.txt'; },
    resolveSshTransferConflict: async (direction, fileName) => { seen.push(`policy:${direction}:${fileName}`); return 'rename'; },
    reportSshTransferProgress: progress => progressEvents.push(progress),
    sshTerminals: { ...base.sshTerminals,
      async uploadRemoteFile(id, op, localPath, directory, fileName, policy, signal, onProgress) {
        seen.push({ kind: 'upload', id, op, localPath, directory, fileName, policy, signal });
        const progress = { sessionId: id, operationId: op, direction: 'upload' as const, phase: 'transferring' as const,
          fileName, bytesTransferred: 4, totalBytes: 8 };
        onProgress?.(progress);
        return { ok: true, result: { direction: 'upload', fileName, bytesTransferred: 8, state: 'completed' } };
      },
      async downloadRemoteFile(id, op, remotePath, localPath, policy, signal) {
        seen.push({ kind: 'download', id, op, remotePath, localPath, policy, signal });
        return { ok: true, result: { direction: 'download', fileName: 'saved.txt', bytesTransferred: 7, state: 'completed' } };
      },
      async cancelTransfer(id, op) { seen.push(`cancel:${id}:${op}`); return { ok: true, result: {} }; }
    }
  };
  const upload = await dispatchCommand(owner, { command: 'ssh.files.upload', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId, operationId, remoteDirectory: '/home/alice' } }, withSftpTransfers, () => {});
  assert.deepEqual(upload, { requestId: request.requestId, ok: true,
    result: { direction: 'upload', fileName: 'report.txt', bytesTransferred: 8, state: 'completed' } });
  assert.deepEqual(seen.slice(0, 2), ['policy:upload:report.txt',
    { kind: 'upload', id: sessionId, op: operationId, localPath: 'C:\\private\\report.txt', directory: '/home/alice',
      fileName: 'report.txt', policy: 'rename', signal: cancellation }]);
  assert.equal(progressEvents.length, 1);

  const download = await dispatchCommand(owner, { command: 'ssh.files.download', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId, operationId, remotePath: '/home/alice/remote.txt' } }, withSftpTransfers, () => {});
  assert.equal(download.ok, true);
  assert.deepEqual(seen.slice(2, 5), ['select:remote.txt', 'policy:download:saved.txt',
    { kind: 'download', id: sessionId, op: operationId, remotePath: '/home/alice/remote.txt', localPath: 'C:\\private\\saved.txt',
      policy: 'rename', signal: cancellation }]);
  const cancelled = await dispatchCommand(owner, { command: 'ssh.files.cancel', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId, operationId } }, withSftpTransfers, () => {});
  assert.deepEqual(cancelled, { requestId: request.requestId, ok: true, result: {} });
  assert.equal(seen.at(-1), `cancel:${sessionId}:${operationId}`);
});

test('saved-session IPC dispatches only validated catalog operations', async () => {
  const calls: string[] = [];
  const forwardedCancellations: unknown[] = [];
  const cancellation = { aborted: false, addEventListener() {}, removeEventListener() {} };
  const base = actions();
  const withCatalog: CommandActions = { ...base, cancellation, sessionCatalog: {
    async list(query, signal) { calls.push(`list:${query}`); forwardedCancellations.push(signal); return { ok: true, result: [] }; },
    async get(id, signal) { calls.push(`get:${id}`); forwardedCancellations.push(signal); return { ok: true, result: emptySavedSession }; },
    async create(draft, signal) { calls.push(`create:${String((draft as { readonly name?: unknown }).name)}`); forwardedCancellations.push(signal); return { ok: true, result: emptySavedSession }; },
    async setFavorite(id, favorite, signal) { calls.push(`favorite:${id}:${favorite}`); forwardedCancellations.push(signal); return { ok: true, result: {} }; },
    async remove(id, signal) { calls.push(`remove:${id}`); forwardedCancellations.push(signal); return { ok: true, result: {} }; },
    async listFolders(signal) { forwardedCancellations.push(signal); return { ok: true, result: [] }; },
    async createFolder(draft, signal) { const name = String((draft as { readonly name?: unknown }).name); calls.push(`folder:${name}`); forwardedCancellations.push(signal); return { ok: true, result: { id: emptySavedSession.id, parentId: null, name } }; },
    async renameFolder(id, name, signal) { calls.push(`rename-folder:${id}:${name}`); forwardedCancellations.push(signal); return { ok: true, result: {} }; },
    async moveFolder(id, parentId, signal) { calls.push(`move-folder:${id}:${parentId}`); forwardedCancellations.push(signal); return { ok: true, result: {} }; },
    async removeFolder(id, signal) { calls.push(`remove-folder:${id}`); forwardedCancellations.push(signal); return { ok: true, result: {} }; },
    async moveSession(id, folderId, signal) { calls.push(`move-session:${id}:${folderId}`); forwardedCancellations.push(signal); return { ok: true, result: {} }; },
    async exportFolder(id, signal) { calls.push(`export-folder:${id}`); forwardedCancellations.push(signal); return { ok: true, result: { folderCount: 1, sessionCount: 0 } }; },
    async importFolder(signal) { calls.push('import-folder'); forwardedCancellations.push(signal); return { ok: true, result: { folderCount: 1, sessionCount: 0, createdFolderCount: 1, createdSessionCount: 0 } }; }
  } };
  const requestId = request.requestId;
  const replies = await Promise.all([
    dispatchCommand(owner, { command: 'session.list', requestId, contractVersion: 1, payload: { query: 'Prod' } }, withCatalog, () => {}),
    dispatchCommand(owner, { command: 'session.create', requestId, contractVersion: 1,
      payload: { kind: 'local', name: 'Work shell', shell: 'powershell' } }, withCatalog, () => {}),
    dispatchCommand(owner, { command: 'session.favorite', requestId, contractVersion: 1,
      payload: { id: emptySavedSession.id, favorite: true } }, withCatalog, () => {}),
    dispatchCommand(owner, { command: 'session.delete', requestId, contractVersion: 1,
      payload: { id: emptySavedSession.id } }, withCatalog, () => {}),
    dispatchCommand(owner, { command: 'session.folder.export', requestId, contractVersion: 1,
      payload: { id: emptySavedSession.id } }, withCatalog, () => {}),
    dispatchCommand(owner, { command: 'session.folder.import', requestId, contractVersion: 1, payload: {} }, withCatalog, () => {})
  ]);
  assert.ok(replies.every(reply => reply.ok));
  assert.deepEqual(calls, ['list:Prod', 'create:Work shell', `favorite:${emptySavedSession.id}:true`, `remove:${emptySavedSession.id}`,
    `export-folder:${emptySavedSession.id}`, 'import-folder']);
  assert.deepEqual(forwardedCancellations, Array(6).fill(cancellation));
});

test('only validated local, SSH or Telnet terminal open, write and close commands count as user activity', async () => {
  let activityCount = 0;
  const withActivity = actions(snapshot, () => { activityCount += 1; });
  await dispatchCommand(owner, request, withActivity, () => {});
  assert.equal(activityCount, 0);

  const sessionId = 'c8f87744-bd2c-4c0d-9a18-a4a324dd71fd';
  const commands = [
    { command: 'terminal.open', payload: { sessionId, shell: 'cmd', columns: 80, rows: 24 } },
    { command: 'terminal.write', payload: { sessionId, data: 'echo ready' } },
    { command: 'terminal.close', payload: { sessionId } }
  ];
  for (const command of commands) {
    await dispatchCommand(owner, { ...command, requestId: request.requestId, contractVersion: 1 }, withActivity, () => {});
  }
  assert.equal(activityCount, 3);

  const sshCommands = [
    { command: 'ssh.open', payload: { sessionId, host: 'server.example.net', port: 22, columns: 80, rows: 24 } },
    { command: 'ssh.write', payload: { sessionId, data: 'echo remote' } },
    { command: 'ssh.close', payload: { sessionId } }
  ];
  for (const command of sshCommands) {
    await dispatchCommand(owner, { ...command, requestId: request.requestId, contractVersion: 1 }, withActivity, () => {});
  }
  assert.equal(activityCount, 6);

  const telnetCommands = [
    { command: 'telnet.open', payload: { sessionId, host: 'console.example.net', port: 23, columns: 80, rows: 24 } },
    { command: 'telnet.write', payload: { sessionId, data: 'login' } },
    { command: 'telnet.close', payload: { sessionId } }
  ];
  for (const command of telnetCommands) {
    await dispatchCommand(owner, { ...command, requestId: request.requestId, contractVersion: 1 }, withActivity, () => {});
  }
  assert.equal(activityCount, 9);

  const resize = { command: 'terminal.resize', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId, columns: 100, rows: 30 } };
  await dispatchCommand(owner, resize, withActivity, () => {});
  const malformedWrite = { command: 'terminal.write', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId, data: 'x', extra: true } };
  await dispatchCommand(owner, malformedWrite, withActivity, () => {});
  assert.equal(activityCount, 9);
});

test('clipboard paste reads only in the broker, bounds text, and writes to the requested terminal', async () => {
  const sessionId = 'c8f87744-bd2c-4c0d-9a18-a4a324dd71fd';
  const operations: { readonly sessionId: string; readonly data: string }[] = [];
  let clipboardReads = 0;
  const base = actions();
  const withClipboard: CommandActions = { ...base,
    authorizeClipboardPaste: () => true,
    readClipboardText: async () => { clipboardReads++; return 'clipboard-secret Ж雪'; },
    terminals: { ...base.terminals, async write(id, data) { operations.push({ sessionId: id, data }); return { ok: true, result: {} }; } }
  };
  const requestId = request.requestId;
  const pasted = await dispatchCommand(owner, { command: 'terminal.paste', requestId, contractVersion: 1, payload: { sessionId } }, withClipboard, () => {});
  assert.deepEqual(pasted, { requestId, ok: true, result: {} });
  assert.deepEqual(operations, [{ sessionId, data: 'clipboard-secret Ж雪' }]);
  assert.equal(clipboardReads, 1);

  const oversized: CommandActions = { ...withClipboard, readClipboardText: async () => 'x'.repeat(16_385) };
  const rejected = await dispatchCommand(owner, { command: 'ssh.paste', requestId, contractVersion: 1, payload: { sessionId } }, oversized, () => {});
  assert.deepEqual(rejected, { requestId, ok: false, error: { code: 'OUTPUT_LIMIT', target: 'terminal', retryable: false } });
  const nulText: CommandActions = { ...withClipboard, readClipboardText: async () => 'clipboard\0text' };
  const invalid = await dispatchCommand(owner, { command: 'terminal.paste', requestId, contractVersion: 1, payload: { sessionId } }, nulText, () => {});
  assert.deepEqual(invalid, { requestId, ok: false, error: { code: 'INVALID_REQUEST', target: 'application', retryable: false } });
  assert.equal(operations.length, 1);
});

test('clipboard paste through the renderer command broker is denied without a fresh gesture', async () => {
  let clipboardReads = 0;
  const sessionId = 'c8f87744-bd2c-4c0d-9a18-a4a324dd71fd';
  const base = actions();
  const withClipboard: CommandActions = { ...base, readClipboardText: async () => { clipboardReads++; return 'sensitive'; } };
  const reply = await dispatchCommand(owner, { command: 'terminal.paste', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId } }, withClipboard, () => {});
  assert.deepEqual(reply, { requestId: request.requestId, ok: false,
    error: { code: 'FORBIDDEN', target: 'application', retryable: false } });
  assert.equal(clipboardReads, 0);
});

test('multiline clipboard paste is not written until the user confirms it', async () => {
  const sessionId = 'c8f87744-bd2c-4c0d-9a18-a4a324dd71fd';
  let writes = 0;
  const base = actions();
  const withClipboard: CommandActions = { ...base, readClipboardText: async () => 'echo first\r\necho second',
    authorizeClipboardPaste: () => true,
    terminals: { ...base.terminals, async write() { writes++; return { ok: true, result: {} }; } } };
  await dispatchCommand(owner, { command: 'terminal.paste', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId } }, withClipboard, () => {});
  assert.equal(writes, 0, 'a multiline clipboard payload must wait for an explicit confirmation');
});

test('confirmed multiline clipboard paste is sent only after the native confirmation decision', async () => {
  const sessionId = 'c8f87744-bd2c-4c0d-9a18-a4a324dd71fd';
  let prompts = 0;
  const writes: string[] = [];
  const base = actions();
  const withClipboard: CommandActions = { ...base, authorizeClipboardPaste: () => true,
    readClipboardText: async () => 'echo first\r\necho second',
    confirmMultilinePaste: async () => { prompts++; return true; },
    terminals: { ...base.terminals, async write(_id, data) { writes.push(data); return { ok: true, result: {} }; } } };
  const reply = await dispatchCommand(owner, { command: 'terminal.paste', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId } }, withClipboard, () => {});
  assert.equal(reply.ok, true);
  assert.equal(prompts, 1);
  assert.deepEqual(writes, ['echo first\r\necho second']);
});

test('renderer teardown cancels pending multiline paste before any terminal write', async () => {
  const sessionId = 'c8f87744-bd2c-4c0d-9a18-a4a324dd71fd';
  let writes = 0;
  let confirmPaste!: (approved: boolean) => void;
  let confirmationRequested!: () => void;
  const requested = new Promise<void>(resolve => { confirmationRequested = resolve; });
  const confirmation = new Promise<boolean>(resolve => { confirmPaste = resolve; });
  const cancellation = new AbortController();
  const sender = new EventEmitter() as EventEmitter & { isDestroyed(): boolean };
  sender.isDestroyed = () => false;
  const unbind = bindRendererRequestCancellation(sender as unknown as Parameters<typeof bindRendererRequestCancellation>[0], cancellation);
  const base = actions();
  const withClipboard: CommandActions = { ...base, cancellation: cancellation.signal, authorizeClipboardPaste: () => true,
    readClipboardText: async () => 'echo first\necho second',
    confirmMultilinePaste: async () => { confirmationRequested(); return confirmation; },
    terminals: { ...base.terminals, async write() { writes++; return { ok: true, result: {} }; } } };
  const pending = dispatchCommand(owner, { command: 'terminal.paste', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId } }, withClipboard, () => {});
  await requested;
  sender.emit('destroyed');
  confirmPaste(true);
  const reply = await pending;
  unbind();
  assert.equal(reply.ok, false);
  if (!reply.ok) assert.equal(reply.error.code, 'CANCELLED');
  assert.equal(writes, 0);
});

test('rejects foreign windows, subframes, origins and documents before dispatch', async () => {
  let dispatched = false;
  for (const sender of [{ ...owner, owned: false }, { ...owner, mainFrame: false },
    { ...owner, url: 'https://example.com' }, { ...owner, url: 'mrt://evil/index.html' },
    { ...owner, url: APP_URL + '?foreign' }, { ...owner, url: 'mrt://app/other.html' }]) {
    const reply = await dispatchCommand(sender, request, { ...actions(), describe: () => { dispatched = true; return snapshot(); } }, () => {});
    assert.equal(reply.ok, false);
    if (!reply.ok) assert.equal(reply.error.code, 'FORBIDDEN');
  }
  assert.equal(dispatched, false);
});

test('unknown and malformed requests do not dispatch or leak values into logs', async () => {
  const events: AuditEvent[] = [];
  let dispatched = false;
  for (const input of [{ ...request, command: 'fs.read', payload: {} }, { ...request, payload: { password: 'sensitive-canary' } }]) {
    const reply = await dispatchCommand(owner, input, { ...actions(), describe: () => { dispatched = true; return snapshot(); } }, e => events.push(e));
    assert.equal(reply.ok, false);
    assert.equal(reply.requestId, request.requestId);
  }
  assert.equal(dispatched, false);
  assert.equal(JSON.stringify(events).includes('sensitive-canary'), false);
  assert.deepEqual(events.map(e => e.code), ['UNKNOWN_COMMAND', 'INVALID_REQUEST']);
});

test('application failure returns a stable error without exception details', async () => {
  const events: AuditEvent[] = [];
  const reply = await dispatchCommand(owner, request, actions(() => { throw new Error('private-path-and-secret'); }), e => events.push(e));
  assert.deepEqual(reply, { requestId: request.requestId, ok: false, error: { code: 'UNAVAILABLE', target: 'application', retryable: true } });
  assert.equal(JSON.stringify({ reply, events }).includes('private-path'), false);
});
