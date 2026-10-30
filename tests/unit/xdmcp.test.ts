import assert from 'node:assert/strict';
import test from 'node:test';
import { createXdmcpController, XdmcpProviderError } from '../../packages/application/src/xdmcp.ts';
import { createCancellationSource } from '../../packages/application/src/cancellation.ts';

const requestId = '5726a2ee-03cd-4f5a-a28c-bd72784f80a6';

test('XDMCP controller canonicalizes the target and never launches invalid or cancelled requests', async () => {
  const launches: Array<{ requestId: string; host: string }> = [];
  const controller = createXdmcpController({ async launch(id, host) { launches.push({ requestId: id, host }); } });

  const invalid = await controller.launch(requestId, 'display.example.com -ac');
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.error.code, 'INVALID_REQUEST');
  assert.deepEqual(launches, []);

  const cancellation = createCancellationSource();
  cancellation.abort();
  const cancelled = await controller.launch(requestId, 'display.example.com', cancellation);
  assert.equal(cancelled.ok, false);
  if (!cancelled.ok) assert.equal(cancelled.error.code, 'CANCELLED');
  assert.deepEqual(launches, []);

  const accepted = await controller.launch(requestId, 'DISPLAY.EXAMPLE.COM.', undefined);
  assert.equal(accepted.ok, true);
  assert.deepEqual(launches, [{ requestId, host: 'display.example.com' }]);
});

test('XDMCP controller preserves provider error categories', async () => {
  const controller = createXdmcpController({ async launch() { throw new XdmcpProviderError('NOT_SUPPORTED'); } });
  const reply = await controller.launch(requestId, 'display.example.com');
  assert.equal(reply.ok, false);
  if (!reply.ok) assert.equal(reply.error.code, 'NOT_SUPPORTED');
});
