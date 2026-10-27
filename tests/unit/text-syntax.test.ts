import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  highlightTextSyntax,
  MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS,
  MAX_TEXT_SYNTAX_PREVIEW_TOKENS,
  resolveTextSyntaxProfile
} from '../../packages/domain/src/text-syntax.ts';

test('automatic syntax profiles select shell, PowerShell and JSON from the file name', () => {
  assert.equal(resolveTextSyntaxProfile('auto', 'login.ZSH'), 'shell');
  for (const fileName of ['install.ps1', 'module.psm1', 'manifest.psd1', 'session.pssc']) {
    assert.equal(resolveTextSyntaxProfile('auto', fileName), 'powershell');
  }
  assert.equal(resolveTextSyntaxProfile('auto', 'settings.json'), 'json');
  assert.equal(resolveTextSyntaxProfile('auto', 'notes.txt'), 'plain');
  assert.equal(resolveTextSyntaxProfile('json', 'script.sh'), 'json');
  assert.equal(resolveTextSyntaxProfile('shell', 'script.ps1'), 'shell');
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

test('PowerShell syntax preview colors command forms, keywords, parameters, variables, strings, numbers, types and operators', () => {
  const source = [
    'function Get-Items {',
    '  $root = Get-ChildItem -Path ${HOME} -Filter \'*.ps1\'',
    '  if ($root.Count -gt 0 -and $true) {',
    '    Write-Output "$root"',
    '  }',
    '}'
  ].join('\n');
  const tokens = highlightTextSyntax(source, 'powershell').tokens
    .map(token => ({ text: source.slice(token.start, token.end), kind: token.kind }));
  assert.deepEqual(tokens, [
    { text: 'function', kind: 'powershell-keyword' },
    { text: 'Get-Items', kind: 'powershell-command' },
    { text: '{', kind: 'powershell-operator' },
    { text: '$root', kind: 'powershell-variable' },
    { text: '=', kind: 'powershell-operator' },
    { text: 'Get-ChildItem', kind: 'powershell-command' },
    { text: '-Path', kind: 'powershell-parameter' },
    { text: '${HOME}', kind: 'powershell-variable' },
    { text: '-Filter', kind: 'powershell-parameter' },
    { text: "'*.ps1'", kind: 'powershell-string' },
    { text: 'if', kind: 'powershell-keyword' },
    { text: '(', kind: 'powershell-operator' },
    { text: '$root', kind: 'powershell-variable' },
    { text: '.', kind: 'powershell-operator' },
    { text: '-gt', kind: 'powershell-operator' },
    { text: '0', kind: 'powershell-number' },
    { text: '-and', kind: 'powershell-operator' },
    { text: '$true', kind: 'powershell-variable' },
    { text: ')', kind: 'powershell-operator' },
    { text: '{', kind: 'powershell-operator' },
    { text: 'Write-Output', kind: 'powershell-command' },
    { text: '"$root"', kind: 'powershell-string' },
    { text: '}', kind: 'powershell-operator' },
    { text: '}', kind: 'powershell-operator' }
  ]);
});

test('PowerShell syntax preview keeps comments and here-strings opaque and recognizes type literals', () => {
  const source = [
    "$value = [System.IO.FileInfo]'item.txt'",
    '$size = 42KB',
    '# line note',
    '<# block note #>',
    '$text = @"',
    '# still string',
    'Get-ChildItem -Path $HOME',
    '"@'
  ].join('\n');
  const tokens = highlightTextSyntax(source, 'powershell').tokens
    .map(token => ({ text: source.slice(token.start, token.end), kind: token.kind }));
  assert.deepEqual(tokens, [
    { text: '$value', kind: 'powershell-variable' },
    { text: '=', kind: 'powershell-operator' },
    { text: '[System.IO.FileInfo]', kind: 'powershell-type' },
    { text: "'item.txt'", kind: 'powershell-string' },
    { text: '$size', kind: 'powershell-variable' },
    { text: '=', kind: 'powershell-operator' },
    { text: '42KB', kind: 'powershell-number' },
    { text: '# line note', kind: 'powershell-comment' },
    { text: '<# block note #>', kind: 'powershell-comment' },
    { text: '$text', kind: 'powershell-variable' },
    { text: '=', kind: 'powershell-operator' },
    { text: '@"\n# still string\nGet-ChildItem -Path $HOME\n"@', kind: 'powershell-string' }
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

  const longPowerShell = highlightTextSyntax('x'.repeat(MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS + 1), 'powershell');
  assert.equal(longPowerShell.highlightedThrough, MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS);
  assert.equal(longPowerShell.isTruncated, true);
  const manyPowerShellTokens = highlightTextSyntax('$x '.repeat(MAX_TEXT_SYNTAX_PREVIEW_TOKENS + 10), 'powershell');
  assert.equal(manyPowerShellTokens.tokens.length, MAX_TEXT_SYNTAX_PREVIEW_TOKENS);
  assert.equal(manyPowerShellTokens.isTruncated, true);
});

test('a malformed braced variable does not swallow a later expansion', () => {
  const opener = String.fromCharCode(36, 123);
  const source = `${opener}broken ${opener}HOME}`;
  const variables = highlightTextSyntax(source, 'shell').tokens
    .filter(token => token.kind === 'shell-variable')
    .map(token => source.slice(token.start, token.end));
  assert.deepEqual(variables, [`${opener}HOME}`]);
});

test('shell syntax preview keeps malformed expansion scans within a linear allowance', () => {
  const opener = String.fromCharCode(36, 123);
  function medianRuntime(codeUnits: number): number {
    const input = opener.repeat(codeUnits / opener.length);
    highlightTextSyntax(input, 'shell');
    const samples = Array.from({ length: 5 }, () => {
      const start = performance.now();
      highlightTextSyntax(input, 'shell');
      return performance.now() - start;
    }).sort((left, right) => left - right);
    return samples[2]!;
  }

  const smaller = medianRuntime(16_000);
  const boundedPreview = medianRuntime(MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS);
  assert.ok(boundedPreview <= smaller * 8 + 10,
    `64,000 code units took ${boundedPreview.toFixed(1)}ms after 16,000 took ${smaller.toFixed(1)}ms`);
});
