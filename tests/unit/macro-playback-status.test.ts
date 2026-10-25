import assert from 'node:assert/strict';
import test from 'node:test';
import { playbackStatusText } from '../../apps/desktop/src/renderer/macro-playback-status.ts';

test('playback timeout guidance distinguishes uncertain writes from expired text waits', () => {
  const writeMessage = playbackStatusText({
    macroId: 'macro-1',
    sessionId: 'terminal-1',
    targetTitle: 'PowerShell session 1',
    status: 'failed',
    progress: { targetSessionId: 'terminal-1', stepNumber: 1, stepCount: 2, step: { kind: 'send', text: 'Write-Output ready' }, phase: 'sending' },
    error: { code: 'TIMEOUT', target: 'application', retryable: true }
  }, 'Deploy');
  assert.match(writeMessage, /may still be accepted/);
  assert.match(writeMessage, /Inspect the terminal before running Deploy again/);
  assert.doesNotMatch(writeMessage, /adjust the wait/);

  const waitMessage = playbackStatusText({
    macroId: 'macro-1',
    sessionId: 'terminal-1',
    targetTitle: 'PowerShell session 1',
    status: 'failed',
    progress: { targetSessionId: 'terminal-1', stepNumber: 2, stepCount: 2,
      step: { kind: 'waitForText', text: 'READY', timeoutMs: 1_000 }, phase: 'waiting' },
    error: { code: 'TIMEOUT', target: 'terminal', retryable: true }
  }, 'Deploy');
  assert.match(waitMessage, /expected terminal text did not arrive before the wait expired/);
  assert.doesNotMatch(waitMessage, /may still be accepted/);
});
