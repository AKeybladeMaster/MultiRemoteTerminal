import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ChildProcessByStdio, spawn } from 'node:child_process';
import type { Readable } from 'node:stream';
import test from 'node:test';
import { createWslDistributionDiscovery } from '../../apps/desktop/src/workers/wsl-distribution-discovery.ts';

type SpawnProcess = typeof spawn;

interface FakeChild extends EventEmitter {
  readonly stdout: EventEmitter;
  killed: boolean;
  kill(): boolean;
}

function createFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  Object.defineProperty(child, 'stdout', { value: new EventEmitter() });
  child.killed = false;
  child.kill = () => { child.killed = true; return true; };
  return child;
}

test('WSL discovery invokes only the fixed quiet list command and decodes its output', async () => {
  const child = createFakeChild();
  let invocation: { executable: string; args: readonly string[]; options: { windowsHide?: boolean; stdio?: readonly string[] } } | undefined;
  const spawnProcess = ((executable: string, args: readonly string[], options: { windowsHide?: boolean; stdio?: readonly string[] }) => {
    invocation = { executable, args, options };
    queueMicrotask(() => {
      child.stdout.emit('data', Buffer.from('\uFEFFUbuntu\r\nDebian Dev\r\n', 'utf16le'));
      child.emit('close', 0, null);
    });
    return child as unknown as ChildProcessByStdio<null, Readable, null>;
  }) as unknown as SpawnProcess;
  const discovery = createWslDistributionDiscovery('C:\\Windows\\System32', spawnProcess);

  assert.deepEqual(await discovery.list(), [{ name: 'Ubuntu' }, { name: 'Debian Dev' }]);
  assert.deepEqual(invocation, {
    executable: 'C:\\Windows\\System32\\wsl.exe',
    args: ['--list', '--quiet'],
    options: { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
  });
});

test('WSL discovery terminates the list process when redirected output fails', async () => {
  const child = createFakeChild();
  const spawnProcess = (() => child as unknown as ChildProcessByStdio<null, Readable, null>) as unknown as SpawnProcess;
  const discovery = createWslDistributionDiscovery('C:\\Windows\\System32', spawnProcess);
  const listing = discovery.list();

  child.stdout.emit('error', new Error('fixture read failure'));
  await assert.rejects(listing, /WSL distribution output could not be read/u);
  assert.equal(child.killed, true);
  child.emit('close', null, 'SIGTERM');
});
