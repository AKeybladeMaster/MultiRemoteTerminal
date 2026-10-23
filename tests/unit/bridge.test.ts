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
  assert.deepEqual(Object.keys(bridge), ['describe']);
  assert.deepEqual(await bridge.describe(), valid);
});

test('preload redacts rejected and malformed transport responses', async () => {
  for (const invoke of [async () => { throw new Error('private-secret'); }, async () => ({ ...valid, secret: 'private-secret' })]) {
    const reply = await createBridge(invoke, id).describe();
    assert.deepEqual(reply, { requestId: id(), ok: false, error: { code: 'UNAVAILABLE', target: 'application', retryable: true } });
  }
});

test('timeout does not permit unbounded pending IPC; late completion releases the slot', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let finish: (value: unknown) => void = () => {};
  let calls = 0;
  const bridge = createBridge(() => { calls++; return new Promise(resolve => { finish = resolve; }); }, id);
  const waiting = bridge.describe();
  await Promise.resolve();
  const busy = await bridge.describe();
  assert.equal(busy.ok, false);
  if (!busy.ok) assert.equal(busy.error.code, 'BUSY');
  context.mock.timers.tick(3000);
  const timedOut = await waiting;
  assert.equal(timedOut.ok, false);
  if (!timedOut.ok) assert.equal(timedOut.error.code, 'TIMEOUT');
  for (let i = 0; i < 100; i++) assert.equal((await bridge.describe()).ok, false);
  assert.equal(calls, 1);
  finish(valid);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  const next = bridge.describe();
  await Promise.resolve();
  assert.equal(calls, 2);
  finish(valid);
  assert.deepEqual(await next, valid);
});
