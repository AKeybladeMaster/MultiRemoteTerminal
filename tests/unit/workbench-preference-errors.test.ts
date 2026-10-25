import assert from 'node:assert/strict';
import test from 'node:test';
import { workbenchPreferenceFailureMessage } from '../../apps/desktop/src/renderer/workbench-preference-errors.ts';

test('preference failures use actionable messages without exposing internal error codes', () => {
  assert.match(workbenchPreferenceFailureMessage('load', 'BUSY'), /Wait a moment/u);
  assert.match(workbenchPreferenceFailureMessage('save', 'TIMEOUT'), /did not respond in time/u);
  assert.match(workbenchPreferenceFailureMessage('load', 'UNAVAILABLE'), /Restart the app/u);
  assert.match(workbenchPreferenceFailureMessage('load', 'CORRUPT'), /local profile may need repair/u);
  assert.match(workbenchPreferenceFailureMessage('save', 'CONFLICT'), /Reload the value/u);
  assert.match(workbenchPreferenceFailureMessage('save', 'UNAVAILABLE'), /saving the greeting/u);
  assert.doesNotMatch(workbenchPreferenceFailureMessage('load', 'UNAVAILABLE'), /UNAVAILABLE/u);
  assert.doesNotMatch(workbenchPreferenceFailureMessage('save', undefined), /undefined/u);
});
