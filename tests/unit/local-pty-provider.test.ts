import assert from 'node:assert/strict';
import type * as NodePty from 'node-pty';
import test from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { LocalPtyProvider, resolveWslExecutable } from '../../apps/desktop/src/workers/local-pty-provider.ts';

test('only Git Bash in negotiated Win32 input mode gets an empty key-up after resize', {
  skip: process.platform !== 'win32'
}, async () => {
  await mkdir(resolve('.tmp'), { recursive: true });
  const root = await mkdtemp(join(resolve('.tmp'), 'mrt-pty-resize-unit-'));
  const previousRoot = process.env.ProgramW6432;
  try {
    await mkdir(join(root, 'Git', 'bin'), { recursive: true });
    await writeFile(join(root, 'Git', 'bin', 'bash.exe'), '');
    process.env.ProgramW6432 = root;
    for (const shell of ['bash', 'powershell'] as const) {
      const actions: unknown[] = [];
      let output: (data: string) => void = () => {};
      let exit: (event: { exitCode: number }) => void = () => {};
      const pty = {
        pid: 1,
        write(data: string) { actions.push(data); },
        resize(columns: number, rows: number) { actions.push({ columns, rows }); },
        onData(listener: typeof output) { output = listener; return { dispose() {} }; },
        onExit(listener: typeof exit) { exit = listener; return { dispose() {} }; },
        pause() {}, resume() {}, kill() { exit({ exitCode: 0 }); }
      } as unknown as NodePty.IPty;
      const provider = new LocalPtyProvider((() => pty) as typeof NodePty.spawn);
      try {
        await provider.open('resize', { shell }, { columns: 80, rows: 24 });
        await provider.resize('resize', { columns: 90, rows: 30 });
        assert.deepEqual(actions.splice(0), [{ columns: 90, rows: 30 }]);
        output('\x1b[?9001h');
        await provider.resize('resize', { columns: 100, rows: 40 });
        assert.deepEqual(actions.splice(0), [{ columns: 100, rows: 40 }, ...(shell === 'bash' ? ['\x1b[;;;0_'] : [])]);
        await provider.write('resize', 'printf test\r');
        assert.deepEqual(actions.splice(0), ['printf test\r']);
        output('\x1b[?9001l');
        await provider.resize('resize', { columns: 80, rows: 24 });
        assert.deepEqual(actions, [{ columns: 80, rows: 24 }]);
      } finally { await provider.shutdown(); }
    }
  } finally {
    if (previousRoot === undefined) delete process.env.ProgramW6432;
    else process.env.ProgramW6432 = previousRoot;
    await rm(root, { recursive: true, force: true });
  }
});

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
