import test from 'node:test';
import assert from 'node:assert/strict';
import { textEditorErrorMessage } from '../../apps/desktop/src/renderer/text-editor-errors.ts';

test('local text editor uses one user-facing mapping for open, save and reload failures', () => {
  assert.equal(textEditorErrorMessage('OUTPUT_LIMIT', 'local'), 'This file exceeds the 512 KB editor limit.');
  assert.equal(textEditorErrorMessage('FORBIDDEN', 'local'), 'Windows denied access to this file. Check the file permissions.');
  assert.equal(textEditorErrorMessage('UNKNOWN', 'local'), 'The local text file could not be opened, saved or reloaded.');
});
