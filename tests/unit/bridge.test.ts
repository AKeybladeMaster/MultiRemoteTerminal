import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridge } from '../../apps/desktop/src/preload/client.ts';
import { describeWorkbench } from '../../packages/application/src/workbench.ts';

const id = () => '5726a2ee-03cd-4f5a-a28c-bd72784f80a6';
const valid = { requestId: id(), ok: true, result: describeWorkbench({ version: '0.0.0', platform: 'win32' }) };

test('preload sends a fixed command and returns a validated reply', async () => {
  const bridge = createBridge(async request => {
    assert.deepEqual(request, { command: 'app.describe', requestId: id(), contractVersion: 1, payload: {} });
    return valid;
  }, id);
  assert.deepEqual(Object.keys(bridge), ['describe', 'openTerminal', 'writeTerminal', 'pasteTerminal', 'resizeTerminal', 'acknowledgeTerminalOutput', 'closeTerminal',
    'openSshTerminal', 'writeSshTerminal', 'pasteSshTerminal', 'resizeSshTerminal', 'acknowledgeSshTerminalOutput', 'closeSshTerminal', 'approveSshHost', 'rejectSshHost', 'revokeSshHost', 'listSshDirectory',
    'listSavedSessions', 'createSavedSession', 'setSavedSessionFavorite', 'deleteSavedSession', 'listSavedSessionFolders', 'createSavedSessionFolder',
    'renameSavedSessionFolder', 'moveSavedSessionFolder', 'deleteSavedSessionFolder', 'exportSavedSessionFolder', 'importSavedSessionFolder', 'moveSavedSession',
    'onTerminalEvent', 'onSshTrustEvent']);
  assert.deepEqual(await bridge.describe(), valid);
});

test('preload lists an SSH directory using only the fixed validated command', async () => {
  const sessionId = id();
  const listing = { path: '/home/alice', entries: [], truncated: false };
  const bridge = createBridge(async request => {
    assert.deepEqual(request, { command: 'ssh.files.list', requestId: id(), contractVersion: 1, payload: { sessionId, path: '.' } });
    return { requestId: request.requestId, ok: true, result: listing };
  }, id);
  assert.deepEqual(await bridge.listSshDirectory(sessionId, '.'), { requestId: id(), ok: true, result: listing });
});

test('preload waits beyond the worker budget for a bounded SFTP directory request', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const sessionId = id();
  const listing = { path: '/home/alice', entries: [], truncated: false };
  let finish!: (value: unknown) => void;
  const bridge = createBridge(() => new Promise(resolve => { finish = resolve; }), id);
  let settled = false;
  const pending = bridge.listSshDirectory(sessionId, '/home/alice').then(reply => { settled = true; return reply; });
  await Promise.resolve();
  context.mock.timers.tick(31_000);
  await Promise.resolve();
  assert.equal(settled, false, 'the renderer deadline must exceed the worker-host 30-second bound');
  finish({ requestId: id(), ok: true, result: listing });
  assert.deepEqual(await pending, { requestId: id(), ok: true, result: listing });
});

test('preload invokes explicit clipboard paste with only the selected session id', async () => {
  const sessionId = id();
  const seen: unknown[] = [];
  const bridge = createBridge(async request => { seen.push(request); return { requestId: id(), ok: true, result: {} }; }, id,
    undefined, undefined, undefined, () => true);
  assert.equal((await bridge.pasteTerminal(sessionId)).ok, true);
  assert.equal((await bridge.pasteSshTerminal(sessionId)).ok, true);
  assert.deepEqual(seen, [
    { command: 'terminal.paste', requestId: id(), contractVersion: 1, payload: { sessionId } },
    { command: 'ssh.paste', requestId: id(), contractVersion: 1, payload: { sessionId } }
  ]);
});

test('preload does not invoke clipboard paste without a trusted terminal gesture', async () => {
  let calls = 0;
  const bridge = createBridge(async () => { calls++; return { requestId: id(), ok: true, result: {} }; }, id);
  const reply = await bridge.pasteSshTerminal(id());
  assert.equal(reply.ok, false);
  if (!reply.ok) assert.equal(reply.error.code, 'FORBIDDEN');
  assert.equal(calls, 0);
});

test('preload keeps later terminal input behind a paste awaiting gesture authorization', async () => {
  const sessionId = id();
  const commands: string[] = [];
  let allowPaste!: (allowed: boolean) => void;
  let signalAuthorizationRequested!: () => void;
  const authorizationRequested = new Promise<void>(resolve => { signalAuthorizationRequested = resolve; });
  const authorization = new Promise<boolean>(resolve => { allowPaste = resolve; });
  const bridge = createBridge(async request => {
    commands.push(request.command);
    return { requestId: request.requestId, ok: true, result: {} };
  }, id, undefined, undefined, undefined, async () => {
    signalAuthorizationRequested();
    return authorization;
  });
  const paste = bridge.pasteTerminal(sessionId);
  const enter = bridge.writeTerminal(sessionId, '\r');
  await authorizationRequested;
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(commands, [], 'no later input may reach the shell while paste is awaiting authorization');
  allowPaste(true);
  const replies = await Promise.all([paste, enter]);
  assert.equal(replies.every(reply => reply.ok), true);
  assert.deepEqual(commands, ['terminal.paste', 'terminal.write']);
});

test('preload sends a pending write before a paste requested while it is still in flight', async () => {
  const sessionId = id();
  const commands: string[] = [];
  let finishWrite!: (reply: unknown) => void;
  const bridge = createBridge(request => {
    commands.push(request.command);
    if (request.command === 'terminal.write') return new Promise(resolve => { finishWrite = resolve; });
    return Promise.resolve({ requestId: request.requestId, ok: true, result: {} });
  }, id, undefined, undefined, undefined, () => true);
  const write = bridge.writeTerminal(sessionId, 'echo before paste');
  await new Promise<void>(resolve => setImmediate(resolve));
  const paste = bridge.pasteTerminal(sessionId);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(commands, ['terminal.write'], 'paste must wait for input already sent to the main process');
  finishWrite({ requestId: id(), ok: true, result: {} });
  assert.equal((await write).ok, true);
  assert.equal((await paste).ok, true);
  assert.deepEqual(commands, ['terminal.write', 'terminal.paste']);
});

test('a timed-out terminal write stays in the ordering barrier until its invocation settles', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const sessionId = id();
  const commands: string[] = [];
  let finishWrite!: (reply: unknown) => void;
  const bridge = createBridge(request => {
    commands.push(request.command);
    if (request.command === 'terminal.write') return new Promise(resolve => { finishWrite = resolve; });
    return Promise.resolve({ requestId: request.requestId, ok: true, result: {} });
  }, id, undefined, undefined, undefined, () => true);
  const write = bridge.writeTerminal(sessionId, 'previous input');
  await new Promise<void>(resolve => setImmediate(resolve));
  context.mock.timers.tick(5_000);
  const writeReply = await write;
  assert.equal(writeReply.ok, false);
  if (!writeReply.ok) assert.equal(writeReply.error.code, 'TIMEOUT');
  const paste = bridge.pasteTerminal(sessionId);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(commands, ['terminal.write'], 'a timeout reply cannot let later input overtake a still-running invocation');
  finishWrite({ requestId: id(), ok: true, result: {} });
  assert.equal((await paste).ok, true);
  assert.deepEqual(commands, ['terminal.write', 'terminal.paste']);
});

test('preload exposes saved-folder import and export through fixed commands', async () => {
  const folderId = '18f2f903-7b6f-4c8d-9c42-b63a58c4b087';
  const seen: unknown[] = [];
  const bridge = createBridge(async request => {
    seen.push(request);
    return request.command === 'session.folder.export'
      ? { requestId: id(), ok: true, result: { folderCount: 2, sessionCount: 4 } }
      : { requestId: id(), ok: true, result: { folderCount: 2, sessionCount: 4, createdFolderCount: 2, createdSessionCount: 4 } };
  }, id);
  assert.equal((await bridge.exportSavedSessionFolder(folderId)).ok, true);
  assert.equal((await bridge.importSavedSessionFolder()).ok, true);
  assert.deepEqual(seen, [
    { command: 'session.folder.export', requestId: id(), contractVersion: 1, payload: { id: folderId } },
    { command: 'session.folder.import', requestId: id(), contractVersion: 1, payload: {} }
  ]);
});

test('saved-folder native picker requests wait for user dismissal without an IPC deadline', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let finish!: (value: unknown) => void;
  const bridge = createBridge(() => new Promise(resolve => { finish = resolve; }), id);
  let settled = false;
  const pending = bridge.importSavedSessionFolder().then(reply => { settled = true; return reply; });
  await Promise.resolve();
  context.mock.timers.tick(120_000);
  await Promise.resolve();
  assert.equal(settled, false);
  finish({ requestId: id(), ok: true, result: { folderCount: 1, sessionCount: 0, createdFolderCount: 1, createdSessionCount: 0 } });
  assert.equal((await pending).ok, true);
});

test('clipboard paste waits for the main-process confirmation result without a misleading timeout', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let finish!: (value: unknown) => void;
  const bridge = createBridge(() => new Promise(resolve => { finish = resolve; }), id,
    undefined, undefined, undefined, () => true);
  let settled = false;
  const pending = bridge.pasteTerminal(id()).then(reply => { settled = true; return reply; });
  await new Promise<void>(resolve => setImmediate(resolve));
  context.mock.timers.tick(120_000);
  assert.equal(settled, false, 'an open native confirmation is an explicit user decision, not a paste timeout');
  finish({ requestId: id(), ok: true, result: {} });
  assert.deepEqual(await pending, { requestId: id(), ok: true, result: {} });
});

test('preload routes saved-session commands through fixed validated requests', async () => {
  const bridge = createBridge(async request => {
    assert.deepEqual(request, { command: 'session.create', requestId: id(), contractVersion: 1,
      payload: { kind: 'local', name: 'Work shell', shell: 'powershell' } });
    return { requestId: id(), ok: true, result: { id: id(), folderId: null, kind: 'local', name: 'Work shell', shell: 'powershell', favorite: false,
      createdAt: '2026-10-23T00:00:00.000Z', updatedAt: '2026-10-23T00:00:00.000Z' } };
  }, id);
  const reply = await bridge.createSavedSession({ kind: 'local', name: 'Work shell', shell: 'powershell' });
  assert.equal(reply.ok, true);
});

test('preload forwards host-trust reset only for the supplied canonical endpoint', async () => {
  const bridge = createBridge(async request => {
    assert.deepEqual(request, { command: 'ssh.host.revoke', requestId: id(), contractVersion: 1,
      payload: { host: 'server.example.com', port: 22 } });
    return { requestId: id(), ok: true, result: {} };
  }, id);
  assert.deepEqual(await bridge.revokeSshHost('server.example.com', 22), { requestId: id(), ok: true, result: {} });
});

test('preload validates SSH open replies and filters trust events before exposing them', async () => {
  const sessionId = 'c8f87744-bd2c-4c0d-9a18-a4a324dd71fd';
  let invokeCount = 0;
  let trustListener: ((value: unknown) => void) | undefined;
  let receivedTrustEvents = 0;
  const bridge = createBridge(async request => {
    invokeCount++;
    assert.deepEqual(request, {
      command: 'ssh.open', requestId: id(), contractVersion: 1,
      payload: { sessionId, host: 'server.example.com', port: 22, columns: 80, rows: 24 }
    });
    return { requestId: id(), ok: true, result: { sessionId, endpoint: { host: 'server.example.com', port: 22 }, state: 'running' } };
  }, id, undefined, listener => { trustListener = listener; return () => { trustListener = undefined; }; });

  assert.deepEqual(await bridge.openSshTerminal(sessionId, 'server.example.com', 22, 80, 24), {
    requestId: id(), ok: true, result: { sessionId, endpoint: { host: 'server.example.com', port: 22 }, state: 'running' }
  });
  const unsubscribe = bridge.onSshTrustEvent(() => { receivedTrustEvents++; });
  trustListener?.({ kind: 'challenge', sessionId, challenge: { token: 'invalid', host: 'server.example.com', port: 22,
    algorithm: 'ssh-ed25519', fingerprint: `SHA256:${'A'.repeat(43)}` } });
  trustListener?.({ kind: 'changed', sessionId, host: 'server.example.com', port: 22,
    algorithm: 'ssh-ed25519', fingerprint: `SHA256:${'A'.repeat(43)}` });
  unsubscribe();
  assert.equal(invokeCount, 1);
  assert.equal(receivedTrustEvents, 1);
});

test('preload carries a caller-known session id so an opening terminal can be cancelled', async () => {
  const sessionId = 'c8f87744-bd2c-4c0d-9a18-a4a324dd71fd';
  const bridge = createBridge(async request => {
    assert.deepEqual(request, {
      command: 'terminal.open', requestId: id(), contractVersion: 1,
      payload: { sessionId, shell: 'cmd', columns: 80, rows: 24 }
    });
    return { requestId: id(), ok: true, result: { sessionId, shell: 'cmd', state: 'running' } };
  }, id);
  assert.equal((await bridge.openTerminal(sessionId, 'cmd', 80, 24)).ok, true);
});

test('preload redacts rejected and malformed transport responses', async () => {
  for (const invoke of [async () => { throw new Error('private-secret'); }, async () => ({ ...valid, secret: 'private-secret' })]) {
    const reply = await createBridge(invoke, id).describe();
    assert.deepEqual(reply, { requestId: id(), ok: false, error: { code: 'UNAVAILABLE', target: 'application', retryable: true } });
  }
});

test('pending IPC stays bounded and late completion releases one slot after timeout', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const finishers: ((value: unknown) => void)[] = [];
  let calls = 0;
  const bridge = createBridge(() => { calls++; return new Promise(resolve => { finishers.push(resolve); }); }, id);
  const waiting = Array.from({ length: 256 }, () => bridge.describe());
  await Promise.resolve();
  const busy = await bridge.describe();
  assert.equal(busy.ok, false);
  if (!busy.ok) assert.equal(busy.error.code, 'BUSY');
  context.mock.timers.tick(3000);
  const timedOut = await Promise.all(waiting);
  assert.ok(timedOut.every(reply => !reply.ok && reply.error.code === 'TIMEOUT'));
  assert.equal(calls, 256);
  finishers[0]!(valid);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  const next = bridge.describe();
  await Promise.resolve();
  assert.equal(calls, 257);
  finishers[256]!(valid);
  assert.deepEqual(await next, valid);
  for (const finish of finishers.slice(1, 256)) finish(valid);
  await Promise.resolve(); await Promise.resolve();
});

test('saved-session timeout notifies main to cancel the pending catalog operation', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const cancellations: string[] = [];
  let settleCancellation!: () => void;
  let didReturn = false;
  const bridge = createBridge(() => new Promise(() => {}), id, undefined, undefined, requestId => {
    cancellations.push(requestId);
    return new Promise<void>(resolve => { settleCancellation = resolve; });
  });
  const pending = bridge.createSavedSession({ kind: 'local', name: 'Work shell', shell: 'powershell' });
  void pending.then(() => { didReturn = true; });
  context.mock.timers.tick(8_000);
  assert.deepEqual(cancellations, [id()]);
  assert.equal(didReturn, false, 'the timeout waits until main has finished cancelling the request');
  settleCancellation();
  const reply = await pending;
  assert.equal(reply.ok, false);
  if (!reply.ok) assert.equal(reply.error.code, 'TIMEOUT');
});
