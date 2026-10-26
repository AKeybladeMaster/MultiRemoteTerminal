import test from 'node:test';
import assert from 'node:assert/strict';
import { fileLineEnding, hasMixedLineEndings, lineEndingLabel, textareaContent } from '../../apps/desktop/src/renderer/text-editor-format.ts';

test('text editor detects the first line ending and normalizes mixed endings for display', () => {
  assert.equal(fileLineEnding('first\r\nsecond\nthird\r'), '\r\n');
  assert.equal(hasMixedLineEndings('first\r\nsecond\nthird\r'), true);
  assert.equal(textareaContent('first\r\nsecond\nthird\r'), 'first\nsecond\nthird\n');
  assert.equal(lineEndingLabel(fileLineEnding('first\r\nsecond\n')), 'CRLF');
});

test('text editor recognizes uniform LF, CRLF and CR files', () => {
  for (const [content, ending, label] of [
    ['one\ntwo\n', '\n', 'LF'],
    ['one\r\ntwo\r\n', '\r\n', 'CRLF'],
    ['one\rtwo\r', '\r', 'CR']
  ] as const) {
    assert.equal(fileLineEnding(content), ending);
    assert.equal(hasMixedLineEndings(content), false);
    assert.equal(lineEndingLabel(ending), label);
  }
});
