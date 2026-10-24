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
  recorder.resume();
  recorder.observeOutput('terminal-a', 'Password: ');
  assert.equal(recorder.snapshot().warning, undefined);
  recorder.observeOutput('terminal-a', '\r\n');
  assert.equal(recorder.snapshot().warning, undefined);
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

test('bounds recording to the domain macro step limit', () => {
  const recorder = createMacroRecorder();
  recorder.start('terminal-a');
  for (let index = 0; index < 70; index++) recorder.recordInput('terminal-a', `command-${index}\r`);
  assert.equal(recorder.snapshot().stepCount, 64);
  assert.equal(recorder.snapshot().warning, 'step-limit');
  assert.equal(recorder.stop('terminal-a')?.steps.length, 64);
});
