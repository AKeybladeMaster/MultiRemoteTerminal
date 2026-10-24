import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchCommand } from '../../apps/desktop/src/main/broker.ts';
import type { AuditEvent, CommandActions } from '../../apps/desktop/src/main/broker.ts';
import { APP_URL } from '../../packages/contracts/src/commands.ts';
import { describeWorkbench } from '../../packages/application/src/workbench.ts';

const request = { command: 'app.describe', requestId: '5726a2ee-03cd-4f5a-a28c-bd72784f80a6', contractVersion: 1, payload: {} };
const owner = { owned: true, mainFrame: true, url: APP_URL };
const snapshot = () => describeWorkbench({ version: '0.0.0', platform: 'win32' });
const noOp = async () => ({ ok: true, result: {} } as const);
const emptySavedSession = { id: '18f2f903-7b6f-4c8d-9c42-b63a58c4b087', folderId: null, kind: 'local', name: 'Saved', shell: 'cmd', favorite: false,
  createdAt: '2026-10-23T00:00:00.000Z', updatedAt: '2026-10-23T00:00:00.000Z' } as const;
const actions = (describe: () => ReturnType<typeof snapshot> = snapshot, noteUserActivity: () => void = () => {}): CommandActions => ({
  describe, noteUserActivity, terminals: {
    async open(sessionId, shell) { return { ok: true, result: { sessionId, shell, state: 'running' } }; },
    write: noOp, resize: noOp, acknowledgeOutput: noOp, close: noOp
  }, sshTerminals: {
    async open(sessionId, host, port) { return { ok: true, result: { sessionId, endpoint: { host, port }, state: 'running' } }; },
    write: noOp, resize: noOp, acknowledgeOutput: noOp, close: noOp, approveHostKey: noOp,
    rejectHostKey: () => ({ ok: true, result: {} }), revokeHostKey: noOp
  }, sessionCatalog: {
    list: async () => ({ ok: true, result: [] }),
    create: async () => ({ ok: true, result: emptySavedSession }),
    setFavorite: noOp, remove: noOp, listFolders: async () => ({ ok: true, result: [] }),
    createFolder: async () => ({ ok: true, result: { id: emptySavedSession.id, parentId: null, name: 'Folder' } }),
    renameFolder: noOp, moveFolder: noOp, removeFolder: noOp, moveSession: noOp
  }
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

test('saved-session IPC dispatches only validated catalog operations', async () => {
  const calls: string[] = [];
  const forwardedCancellations: unknown[] = [];
  const cancellation = { aborted: false, addEventListener() {}, removeEventListener() {} };
  const base = actions();
  const withCatalog: CommandActions = { ...base, cancellation, sessionCatalog: {
    async list(query, signal) { calls.push(`list:${query}`); forwardedCancellations.push(signal); return { ok: true, result: [] }; },
    async create(draft, signal) { calls.push(`create:${String((draft as { readonly name?: unknown }).name)}`); forwardedCancellations.push(signal); return { ok: true, result: emptySavedSession }; },
    async setFavorite(id, favorite, signal) { calls.push(`favorite:${id}:${favorite}`); forwardedCancellations.push(signal); return { ok: true, result: {} }; },
    async remove(id, signal) { calls.push(`remove:${id}`); forwardedCancellations.push(signal); return { ok: true, result: {} }; },
    async listFolders(signal) { forwardedCancellations.push(signal); return { ok: true, result: [] }; },
    async createFolder(draft, signal) { const name = String((draft as { readonly name?: unknown }).name); calls.push(`folder:${name}`); forwardedCancellations.push(signal); return { ok: true, result: { id: emptySavedSession.id, parentId: null, name } }; },
    async renameFolder(id, name, signal) { calls.push(`rename-folder:${id}:${name}`); forwardedCancellations.push(signal); return { ok: true, result: {} }; },
    async moveFolder(id, parentId, signal) { calls.push(`move-folder:${id}:${parentId}`); forwardedCancellations.push(signal); return { ok: true, result: {} }; },
    async removeFolder(id, signal) { calls.push(`remove-folder:${id}`); forwardedCancellations.push(signal); return { ok: true, result: {} }; },
    async moveSession(id, folderId, signal) { calls.push(`move-session:${id}:${folderId}`); forwardedCancellations.push(signal); return { ok: true, result: {} }; }
  } };
  const requestId = request.requestId;
  const replies = await Promise.all([
    dispatchCommand(owner, { command: 'session.list', requestId, contractVersion: 1, payload: { query: 'Prod' } }, withCatalog, () => {}),
    dispatchCommand(owner, { command: 'session.create', requestId, contractVersion: 1,
      payload: { kind: 'local', name: 'Work shell', shell: 'powershell' } }, withCatalog, () => {}),
    dispatchCommand(owner, { command: 'session.favorite', requestId, contractVersion: 1,
      payload: { id: emptySavedSession.id, favorite: true } }, withCatalog, () => {}),
    dispatchCommand(owner, { command: 'session.delete', requestId, contractVersion: 1,
      payload: { id: emptySavedSession.id } }, withCatalog, () => {})
  ]);
  assert.ok(replies.every(reply => reply.ok));
  assert.deepEqual(calls, ['list:Prod', 'create:Work shell', `favorite:${emptySavedSession.id}:true`, `remove:${emptySavedSession.id}`]);
  assert.deepEqual(forwardedCancellations, Array(4).fill(cancellation));
});

test('only validated local or SSH terminal open, write and close commands count as user activity', async () => {
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

  const resize = { command: 'terminal.resize', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId, columns: 100, rows: 30 } };
  await dispatchCommand(owner, resize, withActivity, () => {});
  const malformedWrite = { command: 'terminal.write', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId, data: 'x', extra: true } };
  await dispatchCommand(owner, malformedWrite, withActivity, () => {});
  assert.equal(activityCount, 6);
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
