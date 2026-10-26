import test from 'node:test';
import assert from 'node:assert/strict';
import { createTftpServerController } from '../../packages/application/src/tftp-server.ts';
import type { TftpServerProvider } from '../../packages/application/src/tftp-server.ts';
import { createCancellationSource } from '../../packages/application/src/cancellation.ts';

const selection = { absolutePath: 'C:\\fixtures\\firmware', folderName: 'firmware' };

function harness(start: () => Promise<number> = async () => 51_234) {
  const exits = new Set<() => void>();
  const calls = { starts: 0, stops: 0, shutdowns: 0 };
  const provider: TftpServerProvider = {
    async start() { calls.starts++; return start(); },
    async stop() { calls.stops++; },
    async shutdown() { calls.shutdowns++; },
    subscribeToExit(listener) { exits.add(listener); return () => exits.delete(listener); }
  };
  return { controller: createTftpServerController(provider), calls, emitExit() { for (const listener of exits) listener(); } };
}

test('TFTP controller publishes loopback status and shutdown is idempotent', async () => {
  const { controller, calls } = harness();
  const events: string[] = [];
  controller.subscribe(status => events.push(status.state));

  assert.deepEqual(controller.getStatus(), { state: 'stopped' });
  assert.deepEqual(await controller.start(selection, 0), {
    ok: true, result: { state: 'running', address: '127.0.0.1', port: 51_234, folderName: 'firmware' }
  });
  assert.deepEqual(controller.getStatus(), { state: 'running', address: '127.0.0.1', port: 51_234, folderName: 'firmware' });
  await Promise.all([controller.closeAll(), controller.closeAll()]);

  assert.deepEqual(events, ['running', 'stopped']);
  assert.deepEqual(calls, { starts: 1, stops: 1, shutdowns: 1 });
  assert.deepEqual(await controller.start(selection, 69), { ok: false, error: { code: 'UNAVAILABLE', target: 'application', retryable: true } });
});

test('TFTP controller rejects overlapping starts and cleans up a cancelled startup', async () => {
  let finishStart!: (port: number) => void;
  const { controller, calls } = harness(() => new Promise<number>(resolve => { finishStart = resolve; }));
  const cancellation = createCancellationSource();
  const starting = controller.start(selection, 69, cancellation);
  await new Promise<void>(resolve => setImmediate(resolve));

  assert.deepEqual(await controller.start(selection, 69), {
    ok: false, error: { code: 'BUSY', target: 'application', retryable: true }
  });
  cancellation.abort();
  finishStart(51_235);

  assert.deepEqual(await starting, { ok: false, error: { code: 'CANCELLED', target: 'application', retryable: false } });
  assert.equal(controller.getStatus().state, 'stopped');
  assert.equal(calls.stops, 1);
  await controller.closeAll();
});

test('unexpected TFTP worker exit clears the running status', async () => {
  const { controller, emitExit } = harness();
  const events: string[] = [];
  controller.subscribe(status => events.push(status.state));
  await controller.start(selection, 69);

  emitExit();

  assert.deepEqual(controller.getStatus(), { state: 'stopped' });
  assert.deepEqual(events, ['running', 'stopped']);
  await controller.closeAll();
});
