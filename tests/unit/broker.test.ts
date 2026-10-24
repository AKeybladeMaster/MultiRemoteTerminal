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
const actions = (describe: () => ReturnType<typeof snapshot> = snapshot, noteUserActivity: () => void = () => {}): CommandActions => ({
  describe, noteUserActivity, readClipboardText: async () => '', authorizeClipboardPaste: () => false, confirmMultilinePaste: async () => false, terminals: {
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
    renameFolder: noOp, moveFolder: noOp, removeFolder: noOp, moveSession: noOp,
    exportFolder: async () => ({ ok: true, result: { folderCount: 1, sessionCount: 1 } }),
    importFolder: async () => ({ ok: true, result: { folderCount: 1, sessionCount: 1, createdFolderCount: 1, createdSessionCount: 1 } })
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
