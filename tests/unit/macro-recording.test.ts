import assert from 'node:assert/strict';
import test from 'node:test';
import { createMacroRecorder } from '../../packages/application/src/macro-recording.ts';

test('records only complete single-line input for the selected terminal', () => {
  const recorder = createMacroRecorder();
  recorder.start('terminal-a');
  recorder.recordInput('terminal-b', 'must not be captured\r');
  recorder.recordInput('terminal-a', 'echo helx');
  recorder.recordInput('terminal-a', '\x7flo\r');
  recorder.recordInput('terminal-a', 'unfinished');

  assert.deepEqual(recorder.stop('terminal-a'), {
    sessionId: 'terminal-a',
    steps: [{ kind: 'send', text: 'echo hello' }]
  });
});

test('suppresses input after ANSI styled password prompts and pauses until explicit resume', () => {
  const recorder = createMacroRecorder();
  recorder.start('terminal-a');
  const command = 'Write-Host -NoNewline Password:; Read-Host -AsSecureString';
  recorder.recordInput('terminal-a', `${command}\r`);
  recorder.observeOutput('terminal-a', `PS> ${command}\r\n`);
  recorder.observeOutput('terminal-a', '\u001b[1;31mPass');
  recorder.observeOutput('terminal-a', 'word:\u001b[0m ');
  assert.equal(recorder.snapshot().warning, 'secret-prompt');
  recorder.recordInput('terminal-a', 'never-store-this\r');
  assert.equal(recorder.snapshot().status, 'paused');
  assert.equal(recorder.snapshot().warning, 'secret-prompt');
  recorder.recordInput('terminal-a', 'must-not-be-recorded-while-paused\r');
  recorder.observeOutput('terminal-a', 'Password: ********\r\n');
  recorder.observeOutput('terminal-a', 'Verification code: secret-echo\r\n');
  assert.equal(recorder.snapshot().warning, 'secret-prompt');
  recorder.resume();
  recorder.observeOutput('terminal-a', 'Password: ');
  assert.equal(recorder.snapshot().warning, 'secret-prompt');
  recorder.recordInput('terminal-a', 'never-store-this-repeat\r');
  assert.equal(recorder.snapshot().status, 'paused');
  recorder.observeOutput('terminal-a', 'Password: ********\r\n');
  recorder.resume();
  recorder.observeOutput('terminal-a', '\r\n');
  recorder.observeOutput('terminal-a', 'Verification code: ');
  assert.equal(recorder.snapshot().warning, 'secret-prompt');
  recorder.recordInput('terminal-a', '123456\r');
  assert.equal(recorder.snapshot().status, 'paused');
  recorder.observeOutput('terminal-a', '\r\n');
  recorder.resume();
  recorder.observeOutput('terminal-a', '\r\n');
  recorder.recordInput('terminal-a', 'Write-Output safe\r');
  recorder.observeOutput('terminal-a', 'Password: ');
  assert.equal(recorder.snapshot().warning, 'secret-prompt');

  assert.deepEqual(recorder.stop('terminal-a'), {
    sessionId: 'terminal-a',
    steps: [
      { kind: 'send', text: 'Write-Host -NoNewline Password:; Read-Host -AsSecureString' },
      { kind: 'send', text: 'Write-Output safe' }
    ]
  });
});

test('does not mistake echoed commands containing password text for an authentication prompt', () => {
  const recorder = createMacroRecorder();
  recorder.start('terminal-a');
  const command = "Write-Host -NoNewline 'Password: '; Read-Host -AsSecureString";
  recorder.recordInput('terminal-a', `${command}\r`);
  recorder.observeOutput('terminal-a', `PS C:\\> ${command}`);
  assert.equal(recorder.snapshot().warning, undefined);
  recorder.observeOutput('terminal-a', '\r\n');
  recorder.observeOutput('terminal-a', 'Password: ');
  assert.equal(recorder.snapshot().warning, 'secret-prompt');
  assert.deepEqual(recorder.stop('terminal-a')?.steps, [{ kind: 'send', text: command }]);
});

test('ignores secret prompt text inside terminal screen redraws after resume', () => {
  const recorder = createMacroRecorder();
  recorder.start('terminal-a');
  recorder.recordInput('terminal-a', 'safe command\r');
  recorder.observeOutput('terminal-a', 'Password: ');
  recorder.recordInput('terminal-a', 'never-store-this\r');
  recorder.resume();
  recorder.observeOutput('terminal-a', '\u001b[HPS> safe command\u001b[K\r\nPassword: ********\u001b[K\r\nVerification code: old echo\u001b[K\r\nPS> \u001b[K');

  assert.equal(recorder.snapshot().warning, undefined);
  recorder.observeOutput('terminal-a', '\u001b[?25l\u001b[HPS> safe command\u001b[K\r\nPassword: ********\u001b[K\r\nVerification code: \u001b[K\u001b[?25h');
  assert.equal(recorder.snapshot().warning, 'secret-prompt');
  recorder.recordInput('terminal-a', 'never-store-this-code\r');
  assert.equal(recorder.snapshot().status, 'paused');
  recorder.resume();
  recorder.observeOutput('terminal-a', 'Verification code: ');
  assert.equal(recorder.snapshot().warning, 'secret-prompt');
});

test('resume stays paused when a recognized secret prompt is already open', () => {
  const recorder = createMacroRecorder();
  recorder.start('terminal-a');
  recorder.recordInput('terminal-a', 'Read-Host -Prompt Password\r');
  recorder.observeOutput('terminal-a', 'Password: ');
  recorder.recordInput('terminal-a', 'first-secret\r');
  recorder.observeOutput('terminal-a', 'Verification code: ');

  recorder.resume();
  assert.equal(recorder.snapshot().status, 'paused');
  assert.equal(recorder.snapshot().warning, 'secret-prompt');
  recorder.recordInput('terminal-a', 'second-secret\r');
  assert.equal(recorder.snapshot().status, 'paused');

  recorder.observeOutput('terminal-a', '\r\nPS> ');
  recorder.resume();
  recorder.recordInput('terminal-a', 'safe command\r');
  assert.deepEqual(recorder.stop('terminal-a')?.steps, [
    { kind: 'send', text: 'Read-Host -Prompt Password' },
    { kind: 'send', text: 'safe command' }
  ]);
});

test('ignores xterm focus reports without discarding the next submitted command', () => {
  const recorder = createMacroRecorder();
  recorder.start('terminal-a');
  recorder.recordInput('terminal-a', '\u001b[I');
  recorder.recordInput('terminal-a', 'Write-Output focused\r');
  assert.deepEqual(recorder.stop('terminal-a')?.steps, [{ kind: 'send', text: 'Write-Output focused' }]);
});

test('pause and unsafe control input discard the in-progress remote line', () => {
  const recorder = createMacroRecorder();
  recorder.start('terminal-a');
  recorder.recordInput('terminal-a', 'unfinished');
  recorder.pause();
  recorder.recordInput('terminal-a', ' command\r');
  recorder.recordInput('terminal-a', 'paused input\r');
  recorder.resume();
  recorder.recordInput('terminal-a', 'safe command\r');
  recorder.recordInput('terminal-a', 'partial');
  recorder.recordInput('terminal-a', '\u001b[A');
  recorder.recordInput('terminal-a', 'history result\r');
  recorder.recordInput('terminal-a', 'another safe command\r');

  assert.deepEqual(recorder.stop('terminal-a'), {
    sessionId: 'terminal-a',
    steps: [
      { kind: 'send', text: 'safe command' },
      { kind: 'send', text: 'another safe command' }
    ]
  });
});

test('manual pause with no partially entered line preserves the next submitted line', () => {
  const recorder = createMacroRecorder();
  recorder.start('terminal-a');
  recorder.pause();
  recorder.resume();
  recorder.recordInput('terminal-a', 'first command after resume\r');

  assert.deepEqual(recorder.stop('terminal-a')?.steps, [{ kind: 'send', text: 'first command after resume' }]);
});

test('manual pause and resume keep a recognized secret prompt suppressed through submission', () => {
  const recorder = createMacroRecorder();
  recorder.start('terminal-a');
  recorder.observeOutput('terminal-a', 'Password: ');
  recorder.pause();
  recorder.resume();
  recorder.recordInput('terminal-a', 'never-store-this\r');
  assert.equal(recorder.snapshot().status, 'paused');

  recorder.observeOutput('terminal-a', '\r\nPS> ');
  recorder.resume();
  recorder.recordInput('terminal-a', 'safe command\r');
  assert.deepEqual(recorder.stop('terminal-a')?.steps, [{ kind: 'send', text: 'safe command' }]);
});

test('prompt scanning ignores ANSI control-string payloads', () => {
  const recorder = createMacroRecorder();
  recorder.start('terminal-a');
  const controlStrings = [
    '\u001bPhidden Password: payload\u001b\\',
    '\u001bXhidden Password: payload\u001b\\',
    '\u001b^hidden Password: payload\u001b\\',
    '\u001b_hidden Password: payload\u001b\\',
    '\u009dhidden Password: payload\u009c',
    '\u0090hidden Password: payload\u009c',
    '\u0098hidden Password: payload\u009c',
    '\u009ehidden Password: payload\u009c',
    '\u009fhidden Password: payload\u009c'
  ];
  for (const controlString of controlStrings) {
    recorder.observeOutput('terminal-a', controlString);
    assert.equal(recorder.snapshot().warning, undefined);
  }
  recorder.observeOutput('terminal-a', 'Password: ');
  assert.equal(recorder.snapshot().warning, 'secret-prompt');
  assert.equal(recorder.stop('terminal-a')?.steps.length, 0);
});

test('recording honors the total macro text size limit as well as per-line limits', () => {
  const recorder = createMacroRecorder();
  recorder.start('terminal-a', 256);
  for (let index = 0; index < 5; index++) recorder.recordInput('terminal-a', `${'x'.repeat(4096)}\r`);

  assert.equal(recorder.snapshot().stepCount, 3);
  assert.equal(recorder.snapshot().warning, 'text-limit');
  assert.equal(recorder.stop('terminal-a')?.steps.length, 3);
});

test('bounds recording to the domain macro step limit', () => {
  const recorder = createMacroRecorder();
  recorder.start('terminal-a');
  for (let index = 0; index < 70; index++) recorder.recordInput('terminal-a', `command-${index}\r`);
  assert.equal(recorder.snapshot().stepCount, 64);
  assert.equal(recorder.snapshot().warning, 'step-limit');
  assert.equal(recorder.stop('terminal-a')?.steps.length, 64);
});
