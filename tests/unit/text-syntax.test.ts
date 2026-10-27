import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  highlightTextSyntax,
  MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS,
  MAX_TEXT_SYNTAX_PREVIEW_TOKENS,
  resolveTextSyntaxProfile
} from '../../packages/domain/src/text-syntax.ts';

test('automatic syntax profiles select Shell, PowerShell, Python, JavaScript/TypeScript and JSON from the file name', () => {
  assert.equal(resolveTextSyntaxProfile('auto', 'login.ZSH'), 'shell');
  for (const fileName of ['install.ps1', 'module.psm1', 'manifest.psd1', 'session.pssc']) {
    assert.equal(resolveTextSyntaxProfile('auto', fileName), 'powershell');
  }
  for (const fileName of ['tool.py', 'launcher.PYW', 'hints.pyi']) {
    assert.equal(resolveTextSyntaxProfile('auto', fileName), 'python');
  }
  for (const fileName of ['app.js', 'view.JSX', 'worker.mjs', 'legacy.cjs', 'main.ts', 'page.TSX', 'module.mts', 'common.cts', 'types.d.ts']) {
    assert.equal(resolveTextSyntaxProfile('auto', fileName), 'javascript');
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

test('PowerShell syntax preview does not color comment markers embedded in barewords', () => {
  const source = 'Foo#Bar\nFoo<#Bar#>\n# actual comment\n';
  const comments = highlightTextSyntax(source, 'powershell').tokens
    .filter(token => token.kind === 'powershell-comment')
    .map(token => source.slice(token.start, token.end));
  assert.deepEqual(comments, ['# actual comment']);
});

test('PowerShell syntax preview never extends a token beyond its code-unit bound', () => {
  const boundaryCases = [
    `${' '.repeat(MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS - 1)}-Path`,
    `${' '.repeat(MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS - 2)}\${}`,
    `${' '.repeat(MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS - 3)}'a''`,
    `${' '.repeat(MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS - 1)}1.2`,
    `${' '.repeat(MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS - 2)}[X]`,
    `${' '.repeat(MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS - 4)}[X[]]`
  ];
  for (const source of boundaryCases) {
    const preview = highlightTextSyntax(source, 'powershell');
    assert.ok(preview.highlightedThrough <= MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS);
    assert.ok(preview.tokens.every(token => token.end <= preview.highlightedThrough),
      `token ended past the preview bound at ${preview.highlightedThrough}`);
  }
});

test('Python syntax preview colors declarations, keywords, builtins, strings, numbers, comments and operators', () => {
  const source = 'def greet(name: str) -> str:\n    value = 1_000 + .5\n    radix = 0x2A + 0b10 + 0o7 + 1.0e2j\n    enabled = True\n    Print = print(f"Hello, {name}!")\n# finished\n';
  const tokens = highlightTextSyntax(source, 'python').tokens
    .map(token => ({ text: source.slice(token.start, token.end), kind: token.kind }));
  assert.deepEqual(tokens, [
    { text: 'def', kind: 'python-keyword' },
    { text: 'greet', kind: 'python-function' },
    { text: '(', kind: 'python-operator' },
    { text: ':', kind: 'python-operator' },
    { text: 'str', kind: 'python-builtin' },
    { text: ')', kind: 'python-operator' },
    { text: '->', kind: 'python-operator' },
    { text: 'str', kind: 'python-builtin' },
    { text: ':', kind: 'python-operator' },
    { text: '=', kind: 'python-operator' },
    { text: '1_000', kind: 'python-number' },
    { text: '+', kind: 'python-operator' },
    { text: '.5', kind: 'python-number' },
    { text: '=', kind: 'python-operator' },
    { text: '0x2A', kind: 'python-number' },
    { text: '+', kind: 'python-operator' },
    { text: '0b10', kind: 'python-number' },
    { text: '+', kind: 'python-operator' },
    { text: '0o7', kind: 'python-number' },
    { text: '+', kind: 'python-operator' },
    { text: '1.0e2j', kind: 'python-number' },
    { text: '=', kind: 'python-operator' },
    { text: 'True', kind: 'python-keyword' },
    { text: '=', kind: 'python-operator' },
    { text: 'print', kind: 'python-builtin' },
    { text: '(', kind: 'python-operator' },
    { text: 'f"Hello, {name}!"', kind: 'python-string' },
    { text: ')', kind: 'python-operator' },
    { text: '# finished', kind: 'python-comment' }
  ]);
  const classSource = 'class Greeter:\n    pass\n';
  assert.deepEqual(highlightTextSyntax(classSource, 'python').tokens.map(token => ({
    text: classSource.slice(token.start, token.end),
    kind: token.kind
  })), [
    { text: 'class', kind: 'python-keyword' },
    { text: 'Greeter', kind: 'python-type' },
    { text: ':', kind: 'python-operator' },
    { text: 'pass', kind: 'python-keyword' }
  ]);
  const builtinsSource = 'result = dir(complex)\n';
  assert.deepEqual(highlightTextSyntax(builtinsSource, 'python').tokens.map(token => ({
    text: builtinsSource.slice(token.start, token.end),
    kind: token.kind
  })), [
    { text: '=', kind: 'python-operator' },
    { text: 'dir', kind: 'python-builtin' },
    { text: '(', kind: 'python-operator' },
    { text: 'complex', kind: 'python-builtin' },
    { text: ')', kind: 'python-operator' }
  ]);
});

test('Python syntax preview treats prefixed and triple-quoted strings as opaque', () => {
  const source = 'query = r"select # literal"\ndoc = """# also literal\nprint(\"not a token\")"""\n# real comment\n';
  const tokens = highlightTextSyntax(source, 'python').tokens
    .map(token => ({ text: source.slice(token.start, token.end), kind: token.kind }));
  assert.deepEqual(tokens, [
    { text: '=', kind: 'python-operator' },
    { text: 'r"select # literal"', kind: 'python-string' },
    { text: '=', kind: 'python-operator' },
    { text: '"""# also literal\nprint(\"not a token\")"""', kind: 'python-string' },
    { text: '# real comment', kind: 'python-comment' }
  ]);
});

test('Python syntax preview never extends a token beyond its code-unit bound', () => {
  const boundaryCases = [
    `${' '.repeat(MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS - 1)}'tail`,
    `${' '.repeat(MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS - 2)}'''text`,
    `${' '.repeat(MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS - 1)}1.5`,
    `${' '.repeat(MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS - 1)}:=`
  ];
  for (const source of boundaryCases) {
    const preview = highlightTextSyntax(source, 'python');
    assert.ok(preview.highlightedThrough <= MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS);
    assert.ok(preview.tokens.every(token => token.end <= preview.highlightedThrough),
      `token ended past the preview bound at ${preview.highlightedThrough}`);
  }
});

test('JavaScript and TypeScript syntax preview colors declarations, types, builtins, literals and operators', () => {
  const source = [
    'export async function greet(name: string): Promise<string> {',
    '  const count = 1_000 + .5e2 + 42n + 0x2A;',
    '  const values = [true, false, null, undefined];',
    '  const ready = count === 1;',
    '  const current = worker?.name;',
    '  const message = `Hello ${name} // stays in the template`;',
    '  return console.log(message ??= "ready");',
    '} // finished',
    '/* block comment */'
  ].join('\n');
  const tokens = highlightTextSyntax(source, 'javascript').tokens
    .map(token => ({ text: source.slice(token.start, token.end), kind: token.kind }));
  assert.deepEqual(tokens, [
    { text: 'export', kind: 'javascript-keyword' },
    { text: 'async', kind: 'javascript-keyword' },
    { text: 'function', kind: 'javascript-keyword' },
    { text: 'greet', kind: 'javascript-function' },
    { text: '(', kind: 'javascript-operator' },
    { text: ':', kind: 'javascript-operator' },
    { text: 'string', kind: 'javascript-type' },
    { text: ')', kind: 'javascript-operator' },
    { text: ':', kind: 'javascript-operator' },
    { text: 'Promise', kind: 'javascript-builtin' },
    { text: '<', kind: 'javascript-operator' },
    { text: 'string', kind: 'javascript-type' },
    { text: '>', kind: 'javascript-operator' },
    { text: '{', kind: 'javascript-operator' },
    { text: 'const', kind: 'javascript-keyword' },
    { text: '=', kind: 'javascript-operator' },
    { text: '1_000', kind: 'javascript-number' },
    { text: '+', kind: 'javascript-operator' },
    { text: '.5e2', kind: 'javascript-number' },
    { text: '+', kind: 'javascript-operator' },
    { text: '42n', kind: 'javascript-number' },
    { text: '+', kind: 'javascript-operator' },
    { text: '0x2A', kind: 'javascript-number' },
    { text: ';', kind: 'javascript-operator' },
    { text: 'const', kind: 'javascript-keyword' },
    { text: '=', kind: 'javascript-operator' },
    { text: '[', kind: 'javascript-operator' },
    { text: 'true', kind: 'javascript-keyword' },
    { text: ',', kind: 'javascript-operator' },
    { text: 'false', kind: 'javascript-keyword' },
    { text: ',', kind: 'javascript-operator' },
    { text: 'null', kind: 'javascript-keyword' },
    { text: ',', kind: 'javascript-operator' },
    { text: 'undefined', kind: 'javascript-builtin' },
    { text: ']', kind: 'javascript-operator' },
    { text: ';', kind: 'javascript-operator' },
    { text: 'const', kind: 'javascript-keyword' },
    { text: '=', kind: 'javascript-operator' },
    { text: '===', kind: 'javascript-operator' },
    { text: '1', kind: 'javascript-number' },
    { text: ';', kind: 'javascript-operator' },
    { text: 'const', kind: 'javascript-keyword' },
    { text: '=', kind: 'javascript-operator' },
    { text: '?.', kind: 'javascript-operator' },
    { text: ';', kind: 'javascript-operator' },
    { text: 'const', kind: 'javascript-keyword' },
    { text: '=', kind: 'javascript-operator' },
    { text: '`Hello ${name} // stays in the template`', kind: 'javascript-string' },
    { text: ';', kind: 'javascript-operator' },
    { text: 'return', kind: 'javascript-keyword' },
    { text: 'console', kind: 'javascript-builtin' },
    { text: '.', kind: 'javascript-operator' },
    { text: '(', kind: 'javascript-operator' },
    { text: '??=', kind: 'javascript-operator' },
    { text: '"ready"', kind: 'javascript-string' },
    { text: ')', kind: 'javascript-operator' },
    { text: ';', kind: 'javascript-operator' },
    { text: '}', kind: 'javascript-operator' },
    { text: '// finished', kind: 'javascript-comment' },
    { text: '/* block comment */', kind: 'javascript-comment' }
  ]);
  const typeSource = 'interface Client { name: string } type Identifier = number; class Worker {}';
  assert.deepEqual(highlightTextSyntax(typeSource, 'javascript').tokens.map(token => ({
    text: typeSource.slice(token.start, token.end),
    kind: token.kind
  })), [
    { text: 'interface', kind: 'javascript-keyword' },
    { text: 'Client', kind: 'javascript-type' },
    { text: '{', kind: 'javascript-operator' },
    { text: ':', kind: 'javascript-operator' },
    { text: 'string', kind: 'javascript-type' },
    { text: '}', kind: 'javascript-operator' },
    { text: 'type', kind: 'javascript-keyword' },
    { text: 'Identifier', kind: 'javascript-type' },
    { text: '=', kind: 'javascript-operator' },
    { text: 'number', kind: 'javascript-type' },
    { text: ';', kind: 'javascript-operator' },
    { text: 'class', kind: 'javascript-keyword' },
    { text: 'Worker', kind: 'javascript-type' },
    { text: '{', kind: 'javascript-operator' },
    { text: '}', kind: 'javascript-operator' }
  ]);
});

test('JavaScript syntax preview keeps tokens within the preview bound', () => {
  for (const source of [
    `${' '.repeat(MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS - 2)}/*comment*/`,
    `${' '.repeat(MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS - 1)}\`template\``,
    `${' '.repeat(MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS - 2)}??=`
  ]) {
    const preview = highlightTextSyntax(source, 'javascript');
    assert.ok(preview.highlightedThrough <= MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS);
    assert.ok(preview.tokens.every(token => token.end <= preview.highlightedThrough),
      `token ended past the preview bound at ${preview.highlightedThrough}`);
  }
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
  const manyPythonTokens = highlightTextSyntax('# comment\n'.repeat(MAX_TEXT_SYNTAX_PREVIEW_TOKENS + 10), 'python');
  assert.equal(manyPythonTokens.tokens.length, MAX_TEXT_SYNTAX_PREVIEW_TOKENS);
  assert.equal(manyPythonTokens.isTruncated, true);
  const manyJavaScriptTokens = highlightTextSyntax('// comment\n'.repeat(MAX_TEXT_SYNTAX_PREVIEW_TOKENS + 10), 'javascript');
  assert.equal(manyJavaScriptTokens.tokens.length, MAX_TEXT_SYNTAX_PREVIEW_TOKENS);
  assert.equal(manyJavaScriptTokens.isTruncated, true);
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
