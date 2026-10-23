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
  assert.deepEqual(Object.keys(bridge), ['describe', 'openTerminal', 'writeTerminal', 'resizeTerminal', 'acknowledgeTerminalOutput', 'closeTerminal', 'onTerminalEvent']);
  assert.deepEqual(await bridge.describe(), valid);
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
