import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import {
  createWindowsCredentialPrompt,
  resolveWindowsPowerShellPath
} from '../../apps/desktop/src/adapters/windows-credential-prompt.ts';
import type { PromptProcess, PromptProcessSpawner } from '../../apps/desktop/src/adapters/windows-credential-prompt.ts';

class FakePromptProcess extends EventEmitter implements PromptProcess {
  readonly stdout = new PassThrough();
  killCount = 0;

  kill(): boolean {
    this.killCount++;
    return true;
  }
}

function createPrompt(spawn: PromptProcessSpawner, timeoutMs?: number) {
  return createWindowsCredentialPrompt({
    systemDirectory: { getSystemDirectory: () => 'C:\\Windows\\System32' },
    helperPath: 'C:\\app\\credential-prompt.ps1',
    pathExists: () => true,
    spawn,
    ...(timeoutMs === undefined ? {} : { timeoutMs })
  });
}

function complete(child: FakePromptProcess, output: Buffer | string, code = 0): void {
  queueMicrotask(() => {
    child.stdout.write(output);
    child.emit('close', code);
  });
}

test('resolves PowerShell from the Win32 system directory, ignoring overridden environment paths', () => {
  const oldSystemRoot = process.env.SystemRoot;
  const oldWindir = process.env.WINDIR;
  try {
    process.env.SystemRoot = 'Z:\\untrusted';
    process.env.WINDIR = 'Z:\\untrusted';
    const resolved = resolveWindowsPowerShellPath('C:\\Windows\\System32', () => true);
    assert.equal(resolved, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    assert.equal(resolveWindowsPowerShellPath('relative\\path', () => true), undefined);
  } finally {
    if (oldSystemRoot === undefined) delete process.env.SystemRoot;
    else process.env.SystemRoot = oldSystemRoot;
    if (oldWindir === undefined) delete process.env.WINDIR;
    else process.env.WINDIR = oldWindir;
  }
});

test('receives credentials only through the private output pipe and launches a fixed helper without a shell', async () => {
  const child = new FakePromptProcess();
  let launched: { executable: string; args: string[]; options: Parameters<PromptProcessSpawner>[2] } | undefined;
  const prompt = createPrompt((executable, args, options) => {
    launched = { executable, args, options };
    complete(child, JSON.stringify({ kind: 'provided', username: 'alice', secret: 'private-password-value' }));
    return child;
  });

  assert.deepEqual(await prompt.prompt('ssh-password'), {
    kind: 'provided', username: 'alice', secret: 'private-password-value'
  });
  assert.equal(launched?.executable, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.deepEqual(launched?.args, [
    '-NoLogo', '-NoProfile', '-WindowStyle', 'Hidden', '-File', 'C:\\app\\credential-prompt.ps1',
    '-Message', 'Enter the SSH account credential.'
  ]);
  assert.equal(launched?.options.shell, false);
  assert.equal(launched?.options.windowsHide, true);
  assert.deepEqual(launched?.options.stdio, ['ignore', 'pipe', 'ignore']);
  assert.equal(launched?.args.includes('private-password-value'), false);
});

test('maps native-dialog cancel, malformed or oversized output, and process failure to safe results', async () => {
  const cancelled = new FakePromptProcess();
  complete(cancelled, '{"kind":"cancelled"}');
  assert.deepEqual(await createPrompt(() => cancelled).prompt('ssh-password'), { kind: 'cancelled' });

  const malformed = new FakePromptProcess();
  complete(malformed, '{not-json');
  assert.deepEqual(await createPrompt(() => malformed).prompt('ssh-password'), { kind: 'unavailable' });

  const oversized = new FakePromptProcess();
  const oversizedResult = await createPrompt(() => {
    queueMicrotask(() => oversized.stdout.write(Buffer.alloc(65_537)));
    return oversized;
  }).prompt('ssh-password');
  assert.deepEqual(oversizedResult, { kind: 'unavailable' });
  assert.equal(oversized.killCount, 1);

  const failed = new FakePromptProcess();
  const failureResult = createPrompt(() => {
    queueMicrotask(() => failed.emit('error', new Error('sensitive child error')));
    return failed;
  });
  assert.deepEqual(await failureResult.prompt('ssh-password'), { kind: 'unavailable' });
});

test('aborting or timing out terminates the credential helper', async () => {
  const controller = new AbortController();
  const abortedChild = new FakePromptProcess();
  const pending = createPrompt(() => abortedChild).prompt('ssh-password', controller.signal);
  controller.abort();
  assert.deepEqual(await pending, { kind: 'cancelled' });
  assert.equal(abortedChild.killCount, 1);

  const timedOutChild = new FakePromptProcess();
  assert.deepEqual(await createPrompt(() => timedOutChild, 5).prompt('ssh-key-passphrase'), { kind: 'timeout' });
  assert.equal(timedOutChild.killCount, 1);
});
