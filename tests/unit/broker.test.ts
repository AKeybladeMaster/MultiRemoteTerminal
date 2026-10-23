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
const actions = (describe: () => ReturnType<typeof snapshot> = snapshot): CommandActions => ({ describe, terminals: {
  async open(shell) { return { ok: true, result: { sessionId: request.requestId, shell, state: 'running' } }; },
  write: noOp, resize: noOp, acknowledgeOutput: noOp, close: noOp
} });

test('valid sender reaches the application through its interface', async () => {
  assert.deepEqual(await dispatchCommand(owner, request, actions(), () => {}), { requestId: request.requestId, ok: true, result: snapshot() });
  assert.equal((await dispatchCommand({ ...owner, url: APP_URL + '#preview' }, request, actions(), () => {})).ok, true);
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
