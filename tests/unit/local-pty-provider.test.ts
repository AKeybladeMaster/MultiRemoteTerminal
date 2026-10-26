import assert from 'node:assert/strict';
import type * as NodePty from 'node-pty';
import test from 'node:test';
import { LocalPtyProvider, resolveWslExecutable } from '../../apps/desktop/src/workers/local-pty-provider.ts';

test('WSL executable resolution is pinned to the Windows system directory', () => {
  assert.equal(resolveWslExecutable('C:\\Windows\\System32'), 'C:\\Windows\\System32\\wsl.exe');
  assert.throws(() => resolveWslExecutable(''), /Windows system directory is unavailable/u);
});

test('a saved WSL distribution that disappeared fails before creating a PTY', {
  skip: process.platform !== 'win32'
}, async () => {
  let spawnCount = 0;
  const ptySpawn = (() => {
    spawnCount++;
    throw new Error('The PTY must not be created for a missing distribution');
  }) as unknown as typeof NodePty.spawn;
  const provider = new LocalPtyProvider(ptySpawn, {
    systemDirectory: 'C:\\Windows\\System32',
    wslDiscovery: { async list() { return [{ name: 'Ubuntu' }]; }, cancel() {} }
  });

  await assert.rejects(provider.open('stale-profile', { shell: 'wsl', distribution: 'Debian Dev' }, { columns: 80, rows: 24 }),
    /selected WSL distribution is no longer installed/u);
  assert.equal(spawnCount, 0);
  await provider.shutdown();
});
