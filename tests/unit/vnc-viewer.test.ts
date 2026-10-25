import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createVncViewerController, VncViewerError } from '../../packages/application/src/vnc-viewer.ts';
import type { VncSpawn } from '../../apps/desktop/src/adapters/windows-vnc-viewer.ts';
import { resolveTigerVncViewerPath, WindowsVncViewer } from '../../apps/desktop/src/adapters/windows-vnc-viewer.ts';
import { canonicalizeVncEndpoint, formatVncTarget } from '../../packages/domain/src/vnc.ts';
import { createCancellationSource } from '../../packages/application/src/cancellation.ts';

test('VNC endpoints canonicalize DNS and format IPv6 for a TigerVNC direct target', () => {
  assert.deepEqual(canonicalizeVncEndpoint({ host: 'VNC.Example.com.', port: 5901 }), { host: 'vnc.example.com', port: 5901 });
  assert.equal(formatVncTarget({ host: 'vnc.example.com', port: 5901 }), 'vnc.example.com::5901');
  assert.equal(formatVncTarget({ host: '2001:db8::1', port: 5900 }), '[2001:db8::1]::5900');
  assert.equal(canonicalizeVncEndpoint({ host: 'bad/host', port: 5900 }), undefined);
  assert.equal(canonicalizeVncEndpoint({ host: 'vnc.example.com', port: 65_536 }), undefined);
});

test('VNC controller reports only an external viewer launch request', async () => {
  const launches: unknown[] = [];
  const controller = createVncViewerController({ async launch(endpoint) { launches.push(endpoint); } });
  assert.deepEqual(await controller.launch('VNC.Example.com.', 5901), {
    ok: true,
    result: { provider: 'external', endpoint: { host: 'vnc.example.com', port: 5901 }, state: 'launch-requested' }
  });
  assert.deepEqual(launches, [{ host: 'vnc.example.com', port: 5901 }]);
  assert.equal((await controller.launch('bad/host', 5900)).ok, false);
  assert.equal(launches.length, 1);
  assert.equal((await controller.launch('vnc.example.com', 5900, { aborted: true } as AbortSignal)).ok, false);
});

test('TigerVNC discovery checks only fixed paths inside OS-known Program Files directories', () => {
  const checked: string[] = [];
  const executable = resolveTigerVncViewerPath(['C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\Attacker'], candidate => {
    checked.push(candidate);
    return candidate === 'C:\\Program Files (x86)\\TigerVNC\\vncviewer.exe';
  });
  assert.equal(executable, 'C:\\Program Files (x86)\\TigerVNC\\vncviewer.exe');
  assert.deepEqual(checked, [
    'C:\\Program Files\\TigerVNC\\vncviewer.exe',
    'C:\\Program Files (x86)\\TigerVNC\\vncviewer.exe'
  ]);
  assert.equal(resolveTigerVncViewerPath(['relative\\path', 'C:\\Program Files'], () => true), 'C:\\Program Files\\TigerVNC\\vncviewer.exe');
  assert.equal(resolveTigerVncViewerPath(['C:\\Attacker'], () => false), undefined);
});

test('Windows VNC adapter spawns TigerVNC with a validated target and no shell', async () => {
  const child = new EventEmitter() as EventEmitter & { unref(): void };
  let detached = false;
  const calls: Array<{ command: string; args: readonly string[]; shell: boolean; windowsHide: boolean; env: NodeJS.ProcessEnv }> = [];
  child.unref = () => { detached = true; };
  const spawnProcess: VncSpawn = (command, args, options) => {
    calls.push({ command, args, shell: options.shell, windowsHide: options.windowsHide, env: options.env });
    setImmediate(() => child.emit('spawn'));
    return child as never;
  };
  const viewer = new WindowsVncViewer({ getProgramFilesDirectories: () => ['C:\\Program Files'] }, spawnProcess, 'win32',
    candidate => candidate === 'C:\\Program Files\\TigerVNC\\vncviewer.exe',
    { PATH: 'C:\\Windows\\System32', VNC_USERNAME: 'ambient-user', Vnc_Password: 'ambient-secret', vnc_username: 'mixed-case-user', MRT_TEST_SETTING: 'preserved' });

  await viewer.launch({ host: '2001:db8::1', port: 5900 });
  assert.equal(calls.length, 1);
  assert.deepEqual({ command: calls[0]?.command, args: calls[0]?.args, shell: calls[0]?.shell, windowsHide: calls[0]?.windowsHide }, {
    command: 'C:\\Program Files\\TigerVNC\\vncviewer.exe', args: ['[2001:db8::1]::5900'], shell: false, windowsHide: true
  });
  assert.equal(Object.keys(calls[0]?.env ?? {}).some(name => /^VNC_(USERNAME|PASSWORD)$/iu.test(name)), false);
  assert.equal(calls[0]?.env.MRT_TEST_SETTING, 'preserved');
  assert.equal(detached, true);
});

test('Windows VNC adapter reports missing viewers and unsupported platforms', async () => {
  const notFound = new WindowsVncViewer({ getProgramFilesDirectories: () => ['C:\\Program Files'] }, undefined, 'win32', () => false);
  await assert.rejects(notFound.launch({ host: 'vnc.example.com', port: 5900 }), error =>
    error instanceof VncViewerError && error.code === 'UNAVAILABLE');

  let directoriesRead = false;
  const unsupported = new WindowsVncViewer({ getProgramFilesDirectories() { directoriesRead = true; return []; } }, undefined, 'linux');
  await assert.rejects(unsupported.launch({ host: 'vnc.example.com', port: 5900 }), error =>
    error instanceof VncViewerError && error.code === 'NOT_SUPPORTED');
  assert.equal(directoriesRead, false);
});

test('Windows VNC adapter kills a pending viewer on cancellation and rejects spawn failure', async () => {
  const child = new EventEmitter() as EventEmitter & { unref(): void; kill(): void };
  let killed = false;
  child.unref = () => {};
  child.kill = () => { killed = true; };
  const viewer = new WindowsVncViewer({ getProgramFilesDirectories: () => ['C:\\Program Files'] }, (() => child as never) as VncSpawn, 'win32', () => true);
  const cancellation = createCancellationSource();
  const pending = viewer.launch({ host: 'vnc.example.com', port: 5900 }, cancellation);
  cancellation.abort();
  await assert.rejects(pending, error => error instanceof VncViewerError && error.code === 'CANCELLED');
  assert.equal(killed, true);

  const failed = new WindowsVncViewer({ getProgramFilesDirectories: () => ['C:\\Program Files'] }, (() => { throw new Error('missing'); }) as VncSpawn, 'win32', () => true);
  await assert.rejects(failed.launch({ host: 'vnc.example.com', port: 5900 }), error =>
    error instanceof VncViewerError && error.code === 'UNAVAILABLE');
});
