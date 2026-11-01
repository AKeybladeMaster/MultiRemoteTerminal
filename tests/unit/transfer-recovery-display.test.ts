import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeRecoveryFileNameForDisplay } from '../../apps/desktop/src/renderer/transfer-recovery-display.ts';

test('recovery filenames show hidden control and direction marks while preserving ordinary Unicode', () => {
  assert.equal(escapeRecoveryFileNameForDisplay('backup-雪-👩‍💻.tar'), 'backup-雪-👩‍💻.tar');
  assert.equal(escapeRecoveryFileNameForDisplay('report\u202eexe.txt'), 'report[U+202E]exe.txt');
  assert.equal(escapeRecoveryFileNameForDisplay('name\u0085.txt'), 'name[U+0085].txt');
  assert.equal(escapeRecoveryFileNameForDisplay('zero\u200bwidth.txt'), 'zero[U+200B]width.txt');
});
