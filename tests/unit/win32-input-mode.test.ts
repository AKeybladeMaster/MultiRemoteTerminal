import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeSupplementaryCharactersForWin32Input, Win32InputModeTracker } from '../../apps/desktop/src/workers/win32-input-mode.ts';

test('Win32 input mode tracker recognizes requests split across output chunks and later resets', () => {
  const tracker = new Win32InputModeTracker();
  assert.equal(tracker.enabled, false);
  tracker.observeOutput('before\x1b[?900');
  assert.equal(tracker.enabled, false);
  tracker.observeOutput('1hafter');
  assert.equal(tracker.enabled, true);
  tracker.observeOutput('\x1b[?9001l');
  assert.equal(tracker.enabled, false);
});

test('Win32 paste encoding preserves ordinary text and emits UTF-16 records for supplementary characters', () => {
  assert.equal(encodeSupplementaryCharactersForWin32Input('printf "🙂"'),
    'printf "\x1b[;;55357;1_\x1b[;;56898;1_"');
});

test('Win32 paste encoding preserves malformed surrogate input for the existing PTY conversion path', () => {
  const malformed = String.fromCharCode(0xd83d);
  assert.equal(encodeSupplementaryCharactersForWin32Input(malformed), malformed);
});
