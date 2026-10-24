import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveShellExecutable } from '../../apps/desktop/src/workers/local-pty-provider.ts';

test('local shells resolve to absolute Windows system executables', () => {
  assert.equal(resolveShellExecutable('powershell', 'C:\\Windows'), 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(resolveShellExecutable('cmd', 'D:\\Windows'), 'D:\\Windows\\System32\\cmd.exe');
  assert.throws(() => resolveShellExecutable('cmd', 'Windows'), /system directory/);
});
