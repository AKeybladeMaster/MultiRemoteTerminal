import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRdpViewerController, RdpViewerError } from '../../packages/application/src/rdp-viewer.ts';
import type { RdpSpawn } from '../../apps/desktop/src/adapters/windows-rdp-viewer.ts';
import { WindowsRdpViewer } from '../../apps/desktop/src/adapters/windows-rdp-viewer.ts';
import { canonicalizeRdpEndpoint, formatRdpTarget } from '../../packages/domain/src/rdp.ts';
import { createCancellationSource } from '../../packages/application/src/cancellation.ts';

test('RDP endpoint validation canonicalizes DNS names and brackets IPv6 launch targets', () => {
  assert.deepEqual(canonicalizeRdpEndpoint({ host: 'Desk.Example.com.', port: 3390 }), { host: 'desk.example.com', port: 3390 });
  assert.equal(formatRdpTarget({ host: '2001:db8::1', port: 3389 }), '[2001:db8::1]:3389');
  assert.equal(canonicalizeRdpEndpoint({ host: 'bad/host', port: 3389 }), undefined);
  assert.equal(canonicalizeRdpEndpoint({ host: 'desktop.example.com', port: 0 }), undefined);
});

test('RDP controller reports only that the external viewer launch was requested', async () => {
  const launches: unknown[] = [];
  const controller = createRdpViewerController({ async launch(endpoint) { launches.push(endpoint); } });
  assert.deepEqual(await controller.launch('DESK.Example.com.', 3389), {
    ok: true,
    result: { provider: 'external', endpoint: { host: 'desk.example.com', port: 3389 }, state: 'launch-requested' }
  });
  assert.deepEqual(launches, [{ host: 'desk.example.com', port: 3389 }]);
  assert.equal((await controller.launch('bad/host', 3389)).ok, false);
  assert.equal(launches.length, 1);
  assert.equal((await controller.launch('desk.example.com', 3389, { aborted: true } as AbortSignal)).ok, false);
});

test('RDP controller reports a spawned viewer even if cancellation arrives after ownership transfers', async () => {
  const cancellation = createCancellationSource();
  const controller = createRdpViewerController({ async launch() { cancellation.abort(); } });
  assert.deepEqual(await controller.launch('desk.example.com', 3389, cancellation), {
    ok: true,
    result: { provider: 'external', endpoint: { host: 'desk.example.com', port: 3389 }, state: 'launch-requested' }
  });
});

test('Windows RDP adapter starts System32 mstsc without a shell or credentials', async () => {
  const child = new EventEmitter() as EventEmitter & { unref(): void };
  let detached = false;
  const calls: Array<{ command: string; args: readonly string[]; shell: boolean; windowsHide: boolean }> = [];
  child.unref = () => { detached = true; };
  const spawnProcess: RdpSpawn = (command, args, options) => {
    calls.push({ command, args, shell: options.shell, windowsHide: options.windowsHide });
    setImmediate(() => child.emit('spawn'));
    return child as never;
  };
  const viewer = new WindowsRdpViewer({ getSystemDirectory: () => 'C:\\Windows\\System32' }, spawnProcess, 'win32');

  await viewer.launch({ host: '2001:db8::1', port: 3389 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.command, 'C:\\Windows\\System32\\mstsc.exe');
  assert.deepEqual(calls[0]?.args, ['/v:[2001:db8::1]:3389']);
  assert.equal(calls[0]?.shell, false);
  assert.equal(calls[0]?.windowsHide, true);
  assert.equal(detached, true);
});

test('Windows RDP adapter classifies platform and process launch failures', async () => {
  const unsupported = new WindowsRdpViewer({ getSystemDirectory: () => 'C:\\Windows\\System32' }, undefined, 'linux');
  await assert.rejects(unsupported.launch({ host: 'desk.example.com', port: 3389 }), error =>
    error instanceof RdpViewerError && error.code === 'NOT_SUPPORTED');

  const failedSpawn: RdpSpawn = () => { throw new Error('not found'); };
  const unavailable = new WindowsRdpViewer({ getSystemDirectory: () => 'C:\\Windows\\System32' }, failedSpawn, 'win32');
  await assert.rejects(unavailable.launch({ host: 'desk.example.com', port: 3389 }), error =>
    error instanceof RdpViewerError && error.code === 'UNAVAILABLE');
});

test('Windows RDP adapter kills a pending viewer when the request is cancelled', async () => {
  const child = new EventEmitter() as EventEmitter & { unref(): void; kill(): void };
  let killed = false;
  child.unref = () => {};
  child.kill = () => { killed = true; };
  const spawnProcess: RdpSpawn = () => child as never;
  const viewer = new WindowsRdpViewer({ getSystemDirectory: () => 'C:\\Windows\\System32' }, spawnProcess, 'win32');
  const cancellation = createCancellationSource();
  const pending = viewer.launch({ host: 'desk.example.com', port: 3389 }, cancellation);
  cancellation.abort();

  await assert.rejects(pending, error => error instanceof RdpViewerError && error.code === 'CANCELLED');
  assert.equal(killed, true);
});
