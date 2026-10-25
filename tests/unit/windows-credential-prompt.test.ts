import assert from 'node:assert/strict';
import { spawn as nodeSpawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { join, resolve } from 'node:path';
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
    '-Purpose', 'ssh-password'
  ]);
  assert.equal(launched?.options.shell, false);
  assert.equal(launched?.options.windowsHide, true);
  assert.deepEqual(launched?.options.stdio, ['ignore', 'pipe', 'ignore']);
  assert.equal(launched?.args.includes('private-password-value'), false);
});

test('passes sanitized prompt context separately from the validated purpose', async () => {
  const child = new FakePromptProcess();
  let launchedArguments: string[] | undefined;
  const prompt = createPrompt((_executable, args) => {
    launchedArguments = args;
    complete(child, '{"kind":"cancelled"}');
    return child;
  });

  assert.deepEqual(await prompt.prompt('ssh-password', undefined, 'SSH destination:\r\n127.0.0.1:2222\0'), { kind: 'cancelled' });
  assert.deepEqual(launchedArguments, [
    '-NoLogo', '-NoProfile', '-WindowStyle', 'Hidden', '-File', 'C:\\app\\credential-prompt.ps1',
    '-Purpose', 'ssh-password', '-Context', 'SSH destination:  127.0.0.1:2222'
  ]);
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

test('real Windows helper accepts contextual SSH and context-free FTP prompt requests', {
  skip: process.platform !== 'win32' || process.arch !== 'x64'
}, async () => {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
  const systemDirectory = join(systemRoot, 'System32');
  const powershell = join(systemDirectory, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const helperPath = resolve('apps/desktop/resources/credential-prompt.ps1');
  let helperOutput = '';
  const spawnWithMockCredentialUi: PromptProcessSpawner = (executable, args, options) => {
    const fileArgument = args.indexOf('-File');
    assert.notEqual(fileArgument, -1);
    const helperFile = args[fileArgument + 1];
    assert.ok(helperFile);
    const purposeArgument = args.indexOf('-Purpose');
    assert.notEqual(purposeArgument, -1);
    const purpose = args[purposeArgument + 1];
    assert.ok(purpose);
    const contextArgument = args.indexOf('-Context');
    const promptContext = contextArgument >= 0 ? args[contextArgument + 1] ?? '' : '';
    const environment = {
      ...process.env,
      MRT_TEST_HELPER_PATH: helperFile,
      MRT_TEST_HELPER_PURPOSE: purpose,
      MRT_TEST_HELPER_CONTEXT: promptContext
    };
    const harness = [
      'function global:Get-Credential {',
      '  param([string]$Message)',
      "  $expectedMessages = @{ 'ssh-password' = 'Enter the SSH account credential.'; 'ssh-key-passphrase' = 'Unlock the selected SSH private key.'; 'ftp-account' = 'Enter the FTP account credential.'; 'master-password' = 'Enter the vault master password.' }",
      '  $expectedMessage = $expectedMessages[$env:MRT_TEST_HELPER_PURPOSE]',
      '  if (-not [string]::IsNullOrEmpty($env:MRT_TEST_HELPER_CONTEXT)) { $expectedMessage = "$expectedMessage`r`n`r`n$env:MRT_TEST_HELPER_CONTEXT" }',
      "  if ($Message -ne $expectedMessage) { throw 'Credential prompt message mismatch' }",
      "  $secure = ConvertTo-SecureString 'mrt-test-placeholder' -AsPlainText -Force",
      "  [System.Management.Automation.PSCredential]::new('mrt-test-user', $secure)",
      '}',
      'if ([string]::IsNullOrEmpty($env:MRT_TEST_HELPER_CONTEXT)) {',
      '  & $env:MRT_TEST_HELPER_PATH -Purpose $env:MRT_TEST_HELPER_PURPOSE',
      '} else {',
      '  & $env:MRT_TEST_HELPER_PATH -Purpose $env:MRT_TEST_HELPER_PURPOSE -Context $env:MRT_TEST_HELPER_CONTEXT',
      '}'
    ].join('\n');
    const child = nodeSpawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', harness], {
      ...options,
      env: environment
    });
    child.stdout?.on('data', chunk => {
      helperOutput += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    });
    return child as PromptProcess;
  };
  const prompt = createWindowsCredentialPrompt({
    systemDirectory: { getSystemDirectory: () => systemDirectory },
    helperPath,
    pathExists: candidate => candidate === powershell || candidate === helperPath,
    spawn: spawnWithMockCredentialUi,
    timeoutMs: 5_000
  });

  assert.deepEqual(await prompt.prompt('ssh-password', undefined, 'SSH destination: 127.0.0.1:2222'), {
    kind: 'provided', username: 'mrt-test-user', secret: 'mrt-test-placeholder'
  });
  assert.deepEqual(JSON.parse(helperOutput), {
    kind: 'provided', username: 'mrt-test-user', secret: 'mrt-test-placeholder'
  });

  helperOutput = '';
  assert.deepEqual(await prompt.prompt('ftp-account'), {
    kind: 'provided', username: 'mrt-test-user', secret: 'mrt-test-placeholder'
  });
  assert.deepEqual(JSON.parse(helperOutput), {
    kind: 'provided', username: 'mrt-test-user', secret: 'mrt-test-placeholder'
  });
});
