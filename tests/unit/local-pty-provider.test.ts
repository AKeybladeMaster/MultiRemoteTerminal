import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveShellExecutable } from '../../apps/desktop/src/workers/local-pty-provider.ts';

test('local shells resolve to absolute Windows system executables', () => {
  assert.equal(resolveShellExecutable('powershell', { SystemRoot: 'C:\\Windows' }), 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(resolveShellExecutable('cmd', { SystemRoot: 'D:\\Windows' }), 'D:\\Windows\\System32\\cmd.exe');
  assert.throws(() => resolveShellExecutable('cmd', { SystemRoot: 'Windows' }), /system directory/);
});

test('Bash resolves only to Git for Windows and never to the WSL System32 launcher', () => {
  const environment = { SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\Test\\AppData\\Local' };
  const checked: string[] = [];
  assert.equal(resolveShellExecutable('bash', environment, path => {
    checked.push(path);
    return path === 'C:\\Program Files (x86)\\Git\\bin\\bash.exe';
  }), 'C:\\Program Files (x86)\\Git\\bin\\bash.exe');
  assert.ok(!checked.includes('C:\\Windows\\System32\\bash.exe'));
  assert.throws(() => resolveShellExecutable('bash', { SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files' },
    path => path === 'C:\\Windows\\System32\\bash.exe'), /Git for Windows Bash/);
});
