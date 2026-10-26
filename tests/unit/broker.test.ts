import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { dispatchCommand } from '../../apps/desktop/src/main/broker.ts';
import { createCustomLogoPreferenceAccess } from '../../apps/desktop/src/main/custom-logo-preferences.ts';
import type { AuditEvent, CommandActions } from '../../apps/desktop/src/main/broker.ts';
import { bindRendererRequestCancellation } from '../../apps/desktop/src/main/renderer-request-cancellation.ts';
import { APP_URL } from '../../packages/contracts/src/commands.ts';
import { describeWorkbench } from '../../packages/application/src/workbench.ts';
import type { SshAuthenticationSelection } from '../../packages/application/src/ssh-terminals.ts';
import { DEFAULT_WORKBENCH_PREFERENCES, toWorkbenchStartupPreferences } from '../../packages/domain/src/workbench-preferences.ts';
import { failure } from '../../packages/domain/src/errors.ts';
import type { SerialConfiguration } from '../../packages/domain/src/serial.ts';

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
  authorizePowerShellProfileScript: () => false,
  authorizeFtpConsent: () => false, authorizeRdpLaunch: () => false,
  authorizeVncLaunch: () => false, authorizeTftpServerAction: () => false,
  chooseTftpRoot: async () => failure('UNAVAILABLE'), startTftpServer: async () => failure('UNAVAILABLE'),
  confirmMultilinePaste: async () => false,
  selectFtpUploadFile: async () => undefined, selectFtpDownloadPath: async () => undefined, resolveFtpTransferConflict: async () => undefined,
  reportFtpTransferProgress: () => {}, selectSshUploadFile: async () => undefined,
  selectSshPrivateKey: async () => failure('CANCELLED'), selectSshDownloadPath: async () => undefined,
  resolveSshTransferConflict: async () => undefined, reportSshTransferProgress: () => {}, consumeDroppedUpload: () => undefined,
  selectCustomLogo: async () => ({ ok: true, result: { dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC' } }),
  discardDroppedUploadHandles: () => {}, terminals: {
    async open(sessionId, launch) { return { ok: true, result: { sessionId, ...launch, state: 'running' } }; },
    async listWslDistributions() { return { ok: true, result: [{ name: 'Ubuntu' }] }; }, cancelWslDistributionDiscovery: noOp,
    write: noOp, applyPowerShellProfileScript: noOp, resize: noOp, acknowledgeOutput: noOp, close: noOp
  }, sshTerminals: {
    async open(sessionId, host, port) { return { ok: true, result: { sessionId, endpoint: { host, port }, state: 'running' } }; },
    async openFiles(sessionId, host, port) { return { ok: true, result: { sessionId, endpoint: { host, port }, state: 'running' } }; },
    write: noOp, resize: noOp, acknowledgeOutput: noOp, listRemoteDirectory: async () => ({ ok: true, result: { path: '/', entries: [], truncated: false } }),
    uploadRemoteFile: async () => ({ ok: true, result: { direction: 'upload', fileName: 'x', bytesTransferred: 0, state: 'completed' } }),
    downloadRemoteFile: async () => ({ ok: true, result: { direction: 'download', fileName: 'x', bytesTransferred: 0, state: 'completed' } }),
    readRemoteTextFile: async (_id, remotePath) => ({ ok: true, result: { path: remotePath, content: 'contents', revision: 'a'.repeat(64), bytes: 8 } }),
    saveRemoteTextFile: async (_id, _op, remotePath, content) => ({ ok: true, result: { path: remotePath, revision: 'b'.repeat(64), bytesSaved: Buffer.byteLength(content) } }),
    cancelTransfer: noOp, close: noOp, approveHostKey: noOp,
    rejectHostKey: () => ({ ok: true, result: {} }), revokeHostKey: noOp
  }, telnetTerminals: {
    async open(sessionId, host, port) { return { ok: true, result: { sessionId, endpoint: { host, port }, state: 'running' } }; },
    write: noOp, resize: noOp, acknowledgeOutput: noOp, close: noOp
  }, serialTerminals: {
    listPorts: async () => ({ ok: true, result: [] }),
    async open(sessionId, configuration) { return { ok: true, result: { sessionId, configuration: configuration as SerialConfiguration, state: 'running' } }; },
    write: noOp, resize: noOp, acknowledgeOutput: noOp, close: noOp
  }, ftpFiles: {
    async open(sessionId, host, port, secure) { return { ok: true, result: { sessionId, endpoint: { host, port, secure }, state: 'running' } }; },
    listDirectory: async (_sessionId, path) => ({ ok: true, result: { path, entries: [], truncated: false } }),
    async uploadFile() { return { ok: true, result: { direction: 'upload', fileName: 'x', bytesTransferred: 0, state: 'completed' } }; },
    async downloadFile() { return { ok: true, result: { direction: 'download', fileName: 'x', bytesTransferred: 0, state: 'completed' } }; },
    cancelTransfer: noOp, close: noOp
  }, rdpViewer: {
    async launch(host, port) { return { ok: true, result: { provider: 'external', endpoint: { host, port }, state: 'launch-requested' } }; }
  }, vncViewer: {
    async launch(host, port) { return { ok: true, result: { provider: 'external', endpoint: { host, port }, state: 'launch-requested' } }; }
  }, localTextEditor: {
    async open() { return { ok: true, result: { selectionId: '22222222-2222-4222-8222-222222222222', fileName: 'local.txt', content: '', revision: 'a'.repeat(64), bytes: 0 } }; },
    async reload(selectionId) { return { ok: true, result: { selectionId, fileName: 'local.txt', content: '', revision: 'a'.repeat(64), bytes: 0 } }; },
    async save() { return { ok: true, result: { revision: 'b'.repeat(64), bytesSaved: 0 } }; },
    close() { return { ok: true as const, result: {} as Record<string, never> }; }
  }, sessionCatalog: {
    list: async () => ({ ok: true, result: [] }),
    count: async () => ({ ok: true, result: 0 }),
    get: async () => ({ ok: true, result: emptySavedSession }),
    create: async () => ({ ok: true, result: emptySavedSession }),
    remember: async () => ({ ok: true, result: emptySavedSession }),
    setFavorite: noOp, remove: noOp, listFolders: async () => ({ ok: true, result: [] }),
    createFolder: async () => ({ ok: true, result: { id: emptySavedSession.id, parentId: null, name: 'Folder' } }),
    renameFolder: noOp, moveFolder: noOp, removeFolder: noOp, moveSession: noOp,
    exportFolder: async () => ({ ok: true, result: { folderCount: 1, sessionCount: 1 } }),
    importFolder: async () => ({ ok: true, result: { folderCount: 1, sessionCount: 1, createdFolderCount: 1, createdSessionCount: 1 } })
  }, sessionCredentials: {
    state: () => ({ state: 'available', mode: 'windows-account' } as const), lock() {},
    async unlock() { return { ok: true, result: { state: 'available', mode: 'windows-account' } } as const; },
    async enableMasterPassword() { return { ok: true, result: { state: 'available', mode: 'master-password' } } as const; },
    async disableMasterPassword() { return { ok: true, result: { state: 'available', mode: 'windows-account' } } as const; },
    async resetVault() { return { ok: true, result: { state: 'available', mode: 'windows-account' } } as const; },
    async hasSshCredential() { return { ok: true, result: false } as const; },
    async saveSshCredential() { return { ok: true, result: {} } as const; },
    async forgetSshCredential() { return { ok: true, result: {} } as const; },
    async resolveSshCredential() { return { ok: true, result: undefined } as const; }
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
  }, powerShellProfileScripts: {
    async preview() { return { ok: true, result: { previewId: '18f2f903-7b6f-4c8d-9c42-b63a58c4b087', script: 'Write-Output "ready"' } }; },
    apply: noOp
  }, preferences: {
    read: async () => ({ ok: true, result: DEFAULT_WORKBENCH_PREFERENCES }),
    readStartup: async () => ({ ok: true, result: toWorkbenchStartupPreferences(DEFAULT_WORKBENCH_PREFERENCES) }),
    save: async value => ({ ok: true, result: value as typeof DEFAULT_WORKBENCH_PREFERENCES })
  }, tftpServer: { getStatus: () => ({ state: 'stopped' }), stop: noOp }
});

test('PowerShell profile application requires the trusted main-process gesture before using a saved preview', async () => {
  let authorized = false;
  let applied = 0;
  let activity = 0;
  const base = actions(snapshot, () => { activity++; });
  const guarded: CommandActions = {
    ...base,
    authorizePowerShellProfileScript: () => authorized,
    powerShellProfileScripts: {
      ...base.powerShellProfileScripts,
      async apply(sessionId, previewId) {
        applied++;
        assert.equal(sessionId, request.requestId);
        assert.equal(previewId, '18f2f903-7b6f-4c8d-9c42-b63a58c4b087');
        return { ok: true, result: {} };
      }
    }
  };
  const input = { command: 'powershell.profile.apply', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId: request.requestId, previewId: '18f2f903-7b6f-4c8d-9c42-b63a58c4b087' } };

  const denied = await dispatchCommand(owner, input, guarded, () => {});
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.error.code, 'FORBIDDEN');
  assert.equal(applied, 0, 'unauthorized renderer requests cannot reach profile execution');
  assert.equal(activity, 0, 'unauthorized profile applies must not count as user activity');

  authorized = true;
  const accepted = await dispatchCommand(owner, input, guarded, () => {});
  assert.deepEqual(accepted, { requestId: request.requestId, ok: true, result: {} });
  assert.equal(applied, 1);
  assert.equal(activity, 1, 'an authorized profile apply records user activity once');

  await dispatchCommand(owner, { command: 'powershell.profile.preview', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId: request.requestId } }, guarded, () => {});
  assert.equal(activity, 2, 'a profile preview records user activity once');
});

test('session auto-save requires the persisted opt-in preference at the main-process broker', async () => {
  let enabled = false;
  let saved = 0;
  let activity = 0;
  const base = actions(snapshot, () => { activity++; });
  const guarded: CommandActions = { ...base,
    preferences: { ...base.preferences, async read() {
      return { ok: true, result: { ...DEFAULT_WORKBENCH_PREFERENCES, autoSaveSessions: enabled } };
    } },
    sessionCatalog: { ...base.sessionCatalog, async remember() { saved++; return { ok: true, result: emptySavedSession }; } }
  };
  const input = { command: 'session.remember', requestId: request.requestId, contractVersion: 1,
    payload: { kind: 'ssh', name: 'Build host', host: 'server.example.com', port: 22 } };

  const denied = await dispatchCommand(owner, input, guarded, () => {});
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.error.code, 'FORBIDDEN');
  assert.equal(saved, 0);

  enabled = true;
  const allowed = await dispatchCommand(owner, input, guarded, () => {});
  assert.equal(allowed.ok, true);
  assert.equal(saved, 1);
  assert.equal(activity, 2);
});

test('custom logo selection uses only the native main-process picker action', async () => {
  let activity = 0;
  const reply = await dispatchCommand(owner, { command: 'branding.logo.select', requestId: request.requestId, contractVersion: 1, payload: {} },
    actions(snapshot, () => { activity++; }), () => {});
  assert.deepEqual(reply, { requestId: request.requestId, ok: true,
    result: { dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC' } });
  assert.equal(activity, 1);
});

test('preferences broker accepts changed logos only from the bounded main-process picker', async () => {
  const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOQm/D/PwAFKgKti6zvbAAAAABJRU5ErkJggg==';
  let stored = DEFAULT_WORKBENCH_PREFERENCES;
  let saveCount = 0;
  const manager = {
    async read() { return { ok: true as const, result: stored }; },
    async readStartup() { return { ok: true as const, result: toWorkbenchStartupPreferences(stored) }; },
    async save(value: unknown) {
      saveCount++;
      stored = value as typeof DEFAULT_WORKBENCH_PREFERENCES;
      return { ok: true as const, result: stored };
    }
  };
  const logoAccess = createCustomLogoPreferenceAccess(manager, { async select() { return { ok: true, result: { dataUrl } }; } });
  const guardedActions: CommandActions = { ...actions(), preferences: logoAccess.preferences, selectCustomLogo: logoAccess.select };
  const saveRequest = (customLogoDataUrl: string | null) => ({ command: 'preferences.save', requestId: request.requestId,
    contractVersion: 1, payload: { preferences: { ...DEFAULT_WORKBENCH_PREFERENCES, customLogoDataUrl } } });

  const oversized = Buffer.alloc(524_290);
  oversized.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 0);
  oversized.writeUInt32BE(1, 16);
  oversized.writeUInt32BE(1, 20);
  const tooLargeDataUrl = `data:image/png;base64,${oversized.toString('base64')}`;
  const overLimit = await dispatchCommand(owner, saveRequest(tooLargeDataUrl), guardedActions, () => {});
  assert.equal(overLimit.ok, false);
  if (!overLimit.ok) assert.equal(overLimit.error.code, 'INVALID_REQUEST');
  assert.equal(saveCount, 0);

  const forged = await dispatchCommand(owner, saveRequest(dataUrl), guardedActions, () => {});
  assert.equal(forged.ok, false);
  if (!forged.ok) assert.equal(forged.error.code, 'INVALID_REQUEST');
  assert.equal(saveCount, 0);

  const selection = await dispatchCommand(owner, { command: 'branding.logo.select', requestId: request.requestId, contractVersion: 1, payload: {} },
    guardedActions, () => {});
  assert.equal(selection.ok, true);
  const accepted = await dispatchCommand(owner, saveRequest(dataUrl), guardedActions, () => {});
  assert.equal(accepted.ok, true);
  assert.equal(saveCount, 1);

  const unchanged = await dispatchCommand(owner, saveRequest(dataUrl), guardedActions, () => {});
  assert.equal(unchanged.ok, true);
  const cleared = await dispatchCommand(owner, saveRequest(null), guardedActions, () => {});
  assert.equal(cleared.ok, true);
  assert.equal(saveCount, 3);
  assert.equal(stored.customLogoDataUrl, null);
});

test('startup preference command omits the PowerShell script and Settings can read it explicitly', async () => {
  const stored = { ...DEFAULT_WORKBENCH_PREFERENCES, powerShellProfileScript: 'Write-Output "private setting"' };
  const base = actions();
  const guarded: CommandActions = { ...base, preferences: {
    ...base.preferences,
    async read() { return { ok: true, result: stored }; },
    async readStartup() { return { ok: true, result: toWorkbenchStartupPreferences(stored) }; }
  } };
  const startup = await dispatchCommand(owner, { command: 'preferences.get', requestId: request.requestId, contractVersion: 1, payload: {} }, guarded, () => {});
  assert.equal(startup.ok, true);
  if (startup.ok) {
    const result = startup.result as Record<string, unknown>;
    assert.equal(Object.hasOwn(result, 'powerShellProfileScript'), false);
    assert.equal(result.startupGreeting, stored.startupGreeting);
  }
  const settings = await dispatchCommand(owner, { command: 'preferences.settings.get', requestId: request.requestId,
    contractVersion: 1, payload: {} }, guarded, () => {});
  assert.equal(settings.ok, true);
  if (settings.ok) assert.equal((settings.result as Record<string, unknown>).powerShellProfileScript, stored.powerShellProfileScript);
});

test('saved SSH opens resolve the profile credential in main and clear it after provider handoff', async () => {
  const profileId = '11111111-1111-4111-8111-111111111111';
  const secret = { username: 'alice', password: 'must-not-reach-renderer' };
  let received: { username: string; password: string } | undefined;
  const base = actions();
  const wired: CommandActions = {
    ...base,
    sessionCredentials: { ...base.sessionCredentials, async resolveSshCredential(id, host, port) {
      assert.equal(id, profileId);
      assert.equal(host, 'server.example.com');
      assert.equal(port, 22);
      return { ok: true, result: secret };
    } },
    sshTerminals: { ...base.sshTerminals, async open(sessionId, host, port, _size, _gateways, authentication) {
      received = authentication?.method === 'password' ? authentication.savedCredentials : undefined;
      return { ok: true, result: { sessionId, endpoint: { host, port }, state: 'running' } };
    } }
  };
  const reply = await dispatchCommand(owner, { command: 'ssh.open', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId: 'c8f87744-bd2c-4c0d-9a18-a4a324dd71fd', host: 'server.example.com', port: 22, columns: 80, rows: 24, profileId } }, wired, () => {});
  assert.equal(reply.ok, true);
  assert.equal(received?.password, '');
  assert.deepEqual(secret, { username: '', password: '' });
  assert.equal(JSON.stringify(reply).includes('must-not-reach-renderer'), false);
});

test('SSH key selection is held in main, passed once to the controller and cleared before the reply', async () => {
  const sessionId = 'c8f87744-bd2c-4c0d-9a18-a4a324dd71fd';
  const selected = { data: Buffer.from('one-time-private-key'), fileName: 'id_ed25519' };
  const expected = Buffer.from(selected.data);
  let received: Buffer | undefined;
  let receivedFileName: string | undefined;
  const base = actions();
  const wired: CommandActions = { ...base,
    async selectSshPrivateKey() { return { ok: true, result: selected }; },
    sshTerminals: { ...base.sshTerminals, async open(id, host, port, _size, _gateways, authentication) {
      assert.equal(id, sessionId);
      const privateKey = authentication?.method === 'private-key' ? authentication.privateKey : undefined;
      received = Buffer.from(privateKey?.data ?? []);
      receivedFileName = privateKey?.fileName;
      return { ok: true, result: { sessionId: id, endpoint: { host, port }, state: 'running' } };
    } }
  };
  const reply = await dispatchCommand(owner, { command: 'ssh.open', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId, host: 'server.example.net', port: 22, columns: 80, rows: 24, authenticationMethod: 'private-key' } }, wired, () => {});
  assert.equal(reply.ok, true);
  assert.deepEqual(received, expected);
  assert.equal(receivedFileName, 'id_ed25519');
  assert.deepEqual([...selected.data], new Array(expected.length).fill(0));
  assert.equal(JSON.stringify(reply).includes('one-time-private-key'), false);
  assert.equal(JSON.stringify(reply).includes('id_ed25519'), false);
});

test('SSH agent selection stays a semantic auth mode and does not resolve saved passwords', async () => {
  const sessionId = 'c8f87744-bd2c-4c0d-9a18-a4a324dd71fd';
  let received: SshAuthenticationSelection | undefined;
  let resolvedSavedCredential = false;
  let selectedPrivateKey = false;
  const base = actions();
  const wired: CommandActions = {
    ...base,
    async selectSshPrivateKey() { selectedPrivateKey = true; return failure('CANCELLED'); },
    sessionCredentials: { ...base.sessionCredentials, async resolveSshCredential() {
      resolvedSavedCredential = true;
      return failure('UNAVAILABLE');
    } },
    sshTerminals: { ...base.sshTerminals, async open(_id, _host, _port, _size, _gateways, authentication) {
      received = authentication;
      return { ok: true, result: { sessionId, endpoint: { host: 'server.example.net', port: 22 }, state: 'running' } };
    } }
  };
  const reply = await dispatchCommand(owner, { command: 'ssh.open', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId, host: 'server.example.net', port: 22, columns: 80, rows: 24, profileId: '11111111-1111-4111-8111-111111111111',
      authenticationMethod: 'agent' } }, wired, () => {});
  assert.equal(reply.ok, true);
  assert.deepEqual(received, { method: 'agent' });
  assert.equal(selectedPrivateKey, false);
  assert.equal(resolvedSavedCredential, false);

  const fileOnly = await dispatchCommand(owner, { command: 'sftp.open', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId: 'd8f87744-bd2c-4c0d-9a18-a4a324dd71fd', host: 'server.example.net', port: 22, authenticationMethod: 'agent' } }, {
    ...wired, sshTerminals: { ...wired.sshTerminals, async openFiles(_id, _host, _port, authentication) { received = authentication; return { ok: true,
      result: { sessionId: _id, endpoint: { host: 'server.example.net', port: 22 }, state: 'running' } }; } }
  }, () => {});
  assert.equal(fileOnly.ok, true);
  assert.deepEqual(received, { method: 'agent' });
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

test('dropped SFTP and FTP uploads consume the bound local selection and reuse transfer conflict policy', async () => {
  const sessionId = 'c8f87744-bd2c-4c0d-9a18-a4a324dd71fd';
  const operationId = 'cf66fcda-f195-45f0-b8be-1873b56319e3';
  const token = 'ce2b576c-476b-4e85-86d8-96ca612fc716';
  const observed: unknown[] = [];
  const base = actions();
  const withDroppedUploads: CommandActions = { ...base,
    consumeDroppedUpload(context, receivedToken) {
      observed.push({ kind: 'consume', context, token: receivedToken });
      return receivedToken === token ? { localPath: 'C:\\private\\dropped.txt', fileName: 'dropped.txt' } : undefined;
    },
    discardDroppedUploadHandles(context, tokens) { observed.push({ kind: 'discard', context, tokens }); },
    resolveSshTransferConflict: async (direction, fileName) => { observed.push({ kind: 'ssh-policy', direction, fileName }); return 'overwrite'; },
    resolveFtpTransferConflict: async (direction, fileName) => { observed.push({ kind: 'ftp-policy', direction, fileName }); return 'rename'; },
    sshTerminals: { ...base.sshTerminals, async uploadRemoteFile(id, op, localPath, remoteDirectory, fileName, policy) {
      observed.push({ kind: 'ssh-upload', id, op, localPath, remoteDirectory, fileName, policy });
      return { ok: true, result: { direction: 'upload', fileName, bytesTransferred: 4, state: 'completed' } };
    } },
    ftpFiles: { ...base.ftpFiles, async uploadFile(id, op, localPath, remoteDirectory, fileName, policy) {
      observed.push({ kind: 'ftp-upload', id, op, localPath, remoteDirectory, fileName, policy });
      return { ok: true, result: { direction: 'upload', fileName, bytesTransferred: 4, state: 'completed' } };
    } }
  };
  const ssh = await dispatchCommand(owner, { command: 'ssh.files.upload-dropped', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId, operationId, remoteDirectory: '/incoming', token } }, withDroppedUploads, () => {});
  assert.deepEqual(ssh, { requestId: request.requestId, ok: true,
    result: { direction: 'upload', fileName: 'dropped.txt', bytesTransferred: 4, state: 'completed' } });
  const ftp = await dispatchCommand(owner, { command: 'ftp.files.upload-dropped', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId, operationId, remoteDirectory: '/incoming', token } }, withDroppedUploads, () => {});
  assert.deepEqual(ftp, { requestId: request.requestId, ok: true,
    result: { direction: 'upload', fileName: 'dropped.txt', bytesTransferred: 4, state: 'completed' } });
  const discardTokens = [token, '18f2f903-7b6f-4c8d-9c42-b63a58c4b087'];
  const discarded = await dispatchCommand(owner, { command: 'files.drop.discard', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId, transport: 'sftp', remoteDirectory: '/incoming', tokens: discardTokens } }, withDroppedUploads, () => {});
  assert.deepEqual(discarded, { requestId: request.requestId, ok: true, result: {} });
  assert.deepEqual(observed, [
    { kind: 'consume', context: { transport: 'sftp', sessionId, remoteDirectory: '/incoming' }, token },
    { kind: 'ssh-policy', direction: 'upload', fileName: 'dropped.txt' },
    { kind: 'ssh-upload', id: sessionId, op: operationId, localPath: 'C:\\private\\dropped.txt', remoteDirectory: '/incoming', fileName: 'dropped.txt', policy: 'overwrite' },
    { kind: 'consume', context: { transport: 'ftp', sessionId, remoteDirectory: '/incoming' }, token },
    { kind: 'ftp-policy', direction: 'upload', fileName: 'dropped.txt' },
    { kind: 'ftp-upload', id: sessionId, op: operationId, localPath: 'C:\\private\\dropped.txt', remoteDirectory: '/incoming', fileName: 'dropped.txt', policy: 'rename' },
    { kind: 'discard', context: { sessionId, transport: 'sftp', remoteDirectory: '/incoming' }, tokens: discardTokens }
  ]);
});

test('valid sender reaches the application through its interface', async () => {
  assert.deepEqual(await dispatchCommand(owner, request, actions(), () => {}), { requestId: request.requestId, ok: true, result: snapshot() });
  assert.equal((await dispatchCommand({ ...owner, url: APP_URL + '#preview' }, request, actions(), () => {})).ok, true);
});

test('terminal open forwards the preallocated id for close-during-startup cancellation', async () => {
  const sessionId = 'c8f87744-bd2c-4c0d-9a18-a4a324dd71fd';
  const input = { command: 'terminal.open', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId, launch: { shell: 'cmd' }, columns: 80, rows: 24 } };
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

test('SFTP text editor broker forwards the exact path, revision, cancellation, and progress', async () => {
  const sessionId = request.requestId;
  const operationId = '22222222-2222-4222-8222-222222222222';
  const remotePath = '/home/alice/config.txt';
  const content = 'new configuration';
  const revision = 'a'.repeat(64);
  const cancellation = new AbortController().signal;
  const progress: unknown[] = [];
  const calls: unknown[] = [];
  const base = actions();
  const withEditor: CommandActions = { ...base, cancellation, reportSshTransferProgress: event => progress.push(event), sshTerminals: {
    ...base.sshTerminals,
    async readRemoteTextFile(id, op, path, signal, onProgress) {
      calls.push({ kind: 'read', id, op, path, signal });
      onProgress?.({ sessionId: id, operationId: op, direction: 'download', phase: 'transferring', fileName: 'config.txt', bytesTransferred: 3, totalBytes: 3 });
      return { ok: true, result: { path, content: 'old', revision, bytes: 3 } };
    },
    async saveRemoteTextFile(id, op, path, text, expectedRevision, signal, onProgress) {
      calls.push({ kind: 'save', id, op, path, text, expectedRevision, signal });
      onProgress?.({ sessionId: id, operationId: op, direction: 'upload', phase: 'committing', fileName: 'config.txt', bytesTransferred: 3, totalBytes: 3 });
      return { ok: true, result: { path, revision: 'b'.repeat(64), bytesSaved: Buffer.byteLength(text) } };
    }
  } };
  const read = await dispatchCommand(owner, { command: 'ssh.files.read-text', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId, operationId, remotePath } }, withEditor, () => {});
  assert.deepEqual(read, { requestId: request.requestId, ok: true,
    result: { path: remotePath, content: 'old', revision, bytes: 3 } });
  const save = await dispatchCommand(owner, { command: 'ssh.files.write-text', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId, operationId, remotePath, content, expectedRevision: revision } }, withEditor, () => {});
  assert.deepEqual(save, { requestId: request.requestId, ok: true,
    result: { path: remotePath, revision: 'b'.repeat(64), bytesSaved: Buffer.byteLength(content) } });
  assert.deepEqual(calls, [
    { kind: 'read', id: sessionId, op: operationId, path: remotePath, signal: cancellation },
    { kind: 'save', id: sessionId, op: operationId, path: remotePath, text: content, expectedRevision: revision, signal: cancellation }
  ]);
  assert.equal(progress.length, 2);
});

test('local text editor broker exposes an opaque selection and typed save only', async () => {
  const selectionId = '22222222-2222-4222-8222-222222222222';
  const selectedPath = 'C:\\private\\settings.txt';
  const calls: unknown[] = [];
  const base = actions();
  const withLocalEditor: CommandActions = { ...base, localTextEditor: {
    async open(signal) {
      calls.push({ kind: 'open', signal });
      return { ok: true, result: { selectionId, fileName: 'settings.txt', content: 'name=old', revision: 'a'.repeat(64), bytes: 8 } };
    },
    async reload(id, signal) {
      calls.push({ kind: 'reload', id, signal });
      return { ok: true, result: { selectionId: id, fileName: 'settings.txt', content: 'name=old', revision: 'a'.repeat(64), bytes: 8 } };
    },
    async save(id, content, expectedRevision, signal) {
      calls.push({ kind: 'save', id, content, expectedRevision, signal });
      return { ok: true, result: { revision: 'b'.repeat(64), bytesSaved: Buffer.byteLength(content) } };
    },
    close(id) { calls.push({ kind: 'close', id }); return { ok: true, result: {} }; }
  } };
  const opened = await dispatchCommand(owner, { command: 'local-text.open', requestId: request.requestId, contractVersion: 1, payload: {} }, withLocalEditor, () => {});
  assert.deepEqual(opened, { requestId: request.requestId, ok: true,
    result: { selectionId, fileName: 'settings.txt', content: 'name=old', revision: 'a'.repeat(64), bytes: 8 } });
  assert.equal(JSON.stringify(opened).includes(selectedPath), false);
  const saved = await dispatchCommand(owner, { command: 'local-text.save', requestId: request.requestId, contractVersion: 1,
    payload: { selectionId, content: 'name=new', expectedRevision: 'a'.repeat(64) } }, withLocalEditor, () => {});
  assert.deepEqual(saved, { requestId: request.requestId, ok: true, result: { revision: 'b'.repeat(64), bytesSaved: 8 } });
  assert.deepEqual(calls.slice(0, 2), [
    { kind: 'open', signal: undefined },
    { kind: 'save', id: selectionId, content: 'name=new', expectedRevision: 'a'.repeat(64), signal: undefined }
  ]);
});

test('saved-session IPC dispatches only validated catalog operations', async () => {
  const calls: string[] = [];
  const forwardedCancellations: unknown[] = [];
  const cancellation = { aborted: false, addEventListener() {}, removeEventListener() {} };
  const base = actions();
  const withCatalog: CommandActions = { ...base, cancellation, sessionCatalog: {
    async list(query, signal) { calls.push(`list:${query}`); forwardedCancellations.push(signal); return { ok: true, result: [] }; },
    async count(signal) { calls.push('count'); forwardedCancellations.push(signal); return { ok: true, result: 1_009 }; },
    async get(id, signal) { calls.push(`get:${id}`); forwardedCancellations.push(signal); return { ok: true, result: emptySavedSession }; },
    async create(draft, signal) { calls.push(`create:${String((draft as { readonly name?: unknown }).name)}`); forwardedCancellations.push(signal); return { ok: true, result: emptySavedSession }; },
    async remember(draft, signal) { calls.push(`remember:${String((draft as { readonly name?: unknown }).name)}`); forwardedCancellations.push(signal); return { ok: true, result: emptySavedSession }; },
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
    dispatchCommand(owner, { command: 'session.count', requestId, contractVersion: 1, payload: {} }, withCatalog, () => {}),
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
  assert.deepEqual(calls, ['list:Prod', 'count', 'create:Work shell', `favorite:${emptySavedSession.id}:true`, `remove:${emptySavedSession.id}`,
    `export-folder:${emptySavedSession.id}`, 'import-folder']);
  assert.deepEqual(forwardedCancellations, Array(7).fill(cancellation));
});

test('RDP IPC dispatches an explicit external viewer launch through the application controller', async () => {
  const seen: Array<{ host: string; port: number }> = [];
  let activityCount = 0;
  const withRdp: CommandActions = {
    ...actions(snapshot, () => { activityCount += 1; }),
    authorizeRdpLaunch: (host, port) => host === 'desk.example.com' && port === 3390,
    rdpViewer: { async launch(host, port) {
      seen.push({ host, port });
      return { ok: true, result: { provider: 'external', endpoint: { host, port }, state: 'launch-requested' } };
    } }
  };
  const reply = await dispatchCommand(owner, { command: 'rdp.launch', requestId: request.requestId, contractVersion: 1,
    payload: { host: 'desk.example.com', port: 3390 } }, withRdp, () => {});
  assert.deepEqual(reply, { requestId: request.requestId, ok: true, result: {
    provider: 'external', endpoint: { host: 'desk.example.com', port: 3390 }, state: 'launch-requested'
  } });
  assert.deepEqual(seen, [{ host: 'desk.example.com', port: 3390 }]);
  assert.equal(activityCount, 1);

  const denied = await dispatchCommand(owner, { command: 'rdp.launch', requestId: request.requestId, contractVersion: 1,
    payload: { host: 'attacker.example.com', port: 3389 } }, actions(), () => {});
  assert.deepEqual(denied, { requestId: request.requestId, ok: false,
    error: { code: 'FORBIDDEN', target: 'application', retryable: false } });
});

test('VNC IPC dispatch consumes an explicit one-shot approval before launching TigerVNC', async () => {
  const seen: Array<{ host: string; port: number }> = [];
  let activityCount = 0;
  const withVnc: CommandActions = {
    ...actions(snapshot, () => { activityCount += 1; }),
    authorizeVncLaunch: (host, port) => host === 'vnc.example.com' && port === 5901,
    vncViewer: { async launch(host, port) {
      seen.push({ host, port });
      return { ok: true, result: { provider: 'external', endpoint: { host, port }, state: 'launch-requested' } };
    } }
  };
  const reply = await dispatchCommand(owner, { command: 'vnc.launch', requestId: request.requestId, contractVersion: 1,
    payload: { host: 'vnc.example.com', port: 5901 } }, withVnc, () => {});
  assert.deepEqual(reply, { requestId: request.requestId, ok: true, result: {
    provider: 'external', endpoint: { host: 'vnc.example.com', port: 5901 }, state: 'launch-requested'
  } });
  assert.deepEqual(seen, [{ host: 'vnc.example.com', port: 5901 }]);
  assert.equal(activityCount, 1);

  const denied = await dispatchCommand(owner, { command: 'vnc.launch', requestId: request.requestId, contractVersion: 1,
    payload: { host: 'attacker.example.com', port: 5900 } }, actions(), () => {});
  assert.deepEqual(denied, { requestId: request.requestId, ok: false,
    error: { code: 'FORBIDDEN', target: 'application', retryable: false } });
});

test('only validated local, SSH or Telnet terminal open, write and close commands count as user activity', async () => {
  let activityCount = 0;
  const withActivity = actions(snapshot, () => { activityCount += 1; });
  await dispatchCommand(owner, request, withActivity, () => {});
  assert.equal(activityCount, 0);

  const sessionId = 'c8f87744-bd2c-4c0d-9a18-a4a324dd71fd';
  const commands = [
    { command: 'terminal.open', payload: { sessionId, launch: { shell: 'cmd' }, columns: 80, rows: 24 } },
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
