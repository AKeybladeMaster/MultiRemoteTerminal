import test from 'node:test';
import assert from 'node:assert/strict';
import {
  highlightTextSyntax,
  MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS,
  MAX_TEXT_SYNTAX_PREVIEW_TOKENS,
  resolveTextSyntaxProfile
} from '../../packages/domain/src/text-syntax.ts';

test('automatic syntax profiles select shell and JSON from the file name', () => {
  assert.equal(resolveTextSyntaxProfile('auto', 'login.ZSH'), 'shell');
  assert.equal(resolveTextSyntaxProfile('auto', 'settings.json'), 'json');
  assert.equal(resolveTextSyntaxProfile('auto', 'notes.txt'), 'plain');
  assert.equal(resolveTextSyntaxProfile('json', 'script.sh'), 'json');
});

test('shell syntax preview colors commands, keywords, options, variables, strings, comments and operators', () => {
  const source = 'if test "$HOME"; then\n  git status --short\n  echo $HOME\nfi # finished\n';
  const preview = highlightTextSyntax(source, 'shell');
  const tokens = preview.tokens.map(token => ({ text: source.slice(token.start, token.end), kind: token.kind }));
  assert.deepEqual(tokens, [
    { text: 'if', kind: 'shell-keyword' },
    { text: 'test', kind: 'shell-command' },
    { text: '"$HOME"', kind: 'shell-string' },
    { text: ';', kind: 'shell-operator' },
    { text: 'then', kind: 'shell-keyword' },
    { text: 'git', kind: 'shell-command' },
    { text: '--short', kind: 'shell-option' },
    { text: 'echo', kind: 'shell-command' },
    { text: '$HOME', kind: 'shell-variable' },
    { text: 'fi', kind: 'shell-keyword' },
    { text: '# finished', kind: 'shell-comment' }
  ]);
});

test('JSON syntax preview distinguishes keys, strings, numbers, literals and punctuation', () => {
  const source = '{"name":"MRT","count":3,"enabled":true}';
  const preview = highlightTextSyntax(source, 'json');
  const tokens = preview.tokens.map(token => ({ text: source.slice(token.start, token.end), kind: token.kind }));
  assert.deepEqual(tokens, [
    { text: '{', kind: 'json-punctuation' },
    { text: '"name"', kind: 'json-key' },
    { text: ':', kind: 'json-punctuation' },
    { text: '"MRT"', kind: 'json-string' },
    { text: ',', kind: 'json-punctuation' },
    { text: '"count"', kind: 'json-key' },
    { text: ':', kind: 'json-punctuation' },
    { text: '3', kind: 'json-number' },
    { text: ',', kind: 'json-punctuation' },
    { text: '"enabled"', kind: 'json-key' },
    { text: ':', kind: 'json-punctuation' },
    { text: 'true', kind: 'json-literal' },
    { text: '}', kind: 'json-punctuation' }
  ]);
});

test('syntax preview stops at fixed character and token bounds without splitting a surrogate pair', () => {
  const overlong = `${'x'.repeat(MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS - 1)}😀`;
  const characterBound = highlightTextSyntax(overlong, 'shell');
  assert.equal(characterBound.highlightedThrough, MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS - 1);
  assert.equal(characterBound.isTruncated, true);

  const manyTokens = highlightTextSyntax('if '.repeat(MAX_TEXT_SYNTAX_PREVIEW_TOKENS + 10), 'shell');
  assert.equal(manyTokens.tokens.length, MAX_TEXT_SYNTAX_PREVIEW_TOKENS);
  assert.equal(manyTokens.isTruncated, true);
});
