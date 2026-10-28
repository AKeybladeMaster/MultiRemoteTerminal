import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  highlightTextSyntax,
  highlightShellInputSyntax,
  highlightPowerShellInputSyntax,
  MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS,
  MAX_TEXT_SYNTAX_PREVIEW_TOKENS,
  resolveTextSyntaxProfile,
  type PowerShellSyntaxContinuationState
} from '../../packages/domain/src/text-syntax.ts';

test('automatic syntax profiles select Markdown, Shell, PowerShell, Python, JavaScript/TypeScript, SQL, TOML, YAML, INI, XML and JSON from the file name', () => {
  for (const fileName of ['README.MD', 'guide.markdown']) {
    assert.equal(resolveTextSyntaxProfile('auto', fileName), 'markdown');
  }
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
  for (const fileName of ['schema.sql', 'migration.PGSQL', 'script.psql']) {
    assert.equal(resolveTextSyntaxProfile('auto', fileName), 'sql');
  }
  assert.equal(resolveTextSyntaxProfile('auto', 'settings.TOML'), 'toml');
  for (const fileName of ['settings.ini', 'service.CFG']) {
    assert.equal(resolveTextSyntaxProfile('auto', fileName), 'ini');
  }
  assert.equal(resolveTextSyntaxProfile('ini', 'script.sh'), 'ini');
  for (const fileName of ['service.xml', 'schema.XSD', 'view.xslt', 'icon.svg']) {
    assert.equal(resolveTextSyntaxProfile('auto', fileName), 'xml');
  }
  assert.equal(resolveTextSyntaxProfile('xml', 'page.html'), 'xml');
  for (const fileName of ['settings.yaml', 'inventory.YML']) {
    assert.equal(resolveTextSyntaxProfile('auto', fileName), 'yaml');
  }
  assert.equal(resolveTextSyntaxProfile('auto', 'settings.json'), 'json');
  assert.equal(resolveTextSyntaxProfile('auto', 'notes.txt'), 'plain');
  assert.equal(resolveTextSyntaxProfile('json', 'script.sh'), 'json');
  assert.equal(resolveTextSyntaxProfile('shell', 'script.ps1'), 'shell');
});

test('shell syntax preview colors commands, builtins, keywords, options, variables, strings, comments and operators', () => {
  const source = 'if test "$HOME"; then\n  git status --short\n  echo $HOME\nfi # finished\n';
  const preview = highlightTextSyntax(source, 'shell');
  const tokens = preview.tokens.map(token => ({ text: source.slice(token.start, token.end), kind: token.kind }));
  assert.deepEqual(tokens, [
    { text: 'if', kind: 'shell-keyword' },
    { text: 'test', kind: 'shell-builtin' },
    { text: '"$HOME"', kind: 'shell-string' },
    { text: ';', kind: 'shell-operator' },
    { text: 'then', kind: 'shell-keyword' },
    { text: 'git', kind: 'shell-command' },
    { text: '--short', kind: 'shell-option' },
    { text: 'echo', kind: 'shell-builtin' },
    { text: '$HOME', kind: 'shell-variable' },
    { text: 'fi', kind: 'shell-keyword' },
    { text: '# finished', kind: 'shell-comment' }
  ]);
});

test('shell syntax preview classifies common builtins and follows bounded command wrappers', () => {
  const source = 'if true; then sudo -u admin env PATH="$HOME/bin" git status; fi';
  const tokens = highlightTextSyntax(source, 'shell').tokens.map(token => ({
    text: source.slice(token.start, token.end), kind: token.kind
  }));
  assert.deepEqual(tokens, [
    { text: 'if', kind: 'shell-keyword' },
    { text: 'true', kind: 'shell-builtin' },
    { text: ';', kind: 'shell-operator' },
    { text: 'then', kind: 'shell-keyword' },
    { text: 'sudo', kind: 'shell-command' },
    { text: '-u', kind: 'shell-option' },
    { text: 'env', kind: 'shell-command' },
    { text: 'PATH', kind: 'shell-variable' },
    { text: '"$HOME/bin"', kind: 'shell-string' },
    { text: 'git', kind: 'shell-command' },
    { text: ';', kind: 'shell-operator' },
    { text: 'fi', kind: 'shell-keyword' }
  ]);
});

test('shell syntax preview preserves wrapper command position across expanded assignments', () => {
  const source = 'env PATH=$HOME/bin git status';
  const tokens = highlightTextSyntax(source, 'shell').tokens.map(token => ({
    text: source.slice(token.start, token.end), kind: token.kind
  }));
  assert.deepEqual(tokens, [
    { text: 'env', kind: 'shell-command' },
    { text: 'PATH', kind: 'shell-variable' },
    { text: '$HOME', kind: 'shell-variable' },
    { text: 'git', kind: 'shell-command' }
  ]);
});

test('shell input syntax carries command-wrapper state across explicit backslash continuations', () => {
  const backslash = String.fromCharCode(92);
  const firstLine = 'env ' + backslash;
  const first = highlightShellInputSyntax(firstLine);
  assert.deepEqual(first.tokens.map(token => ({ text: firstLine.slice(token.start, token.end), kind: token.kind })), [
    { text: 'env', kind: 'shell-command' }
  ]);
  assert.ok(first.continuationState);

  const continuationLine = 'PATH=$PATH git --version';
  const continuation = highlightShellInputSyntax(continuationLine, first.continuationState);
  assert.deepEqual(continuation.tokens.map(token => ({
    text: continuationLine.slice(token.start, token.end), kind: token.kind
  })), [
    { text: 'PATH', kind: 'shell-variable' },
    { text: '$PATH', kind: 'shell-variable' },
    { text: 'git', kind: 'shell-command' },
    { text: '--version', kind: 'shell-option' }
  ]);
  assert.equal(continuation.continuationState, undefined);

  const optionLine = 'sudo -u ' + backslash;
  const optionStart = highlightShellInputSyntax(optionLine);
  const optionContinuation = 'mrtadmin git status';
  const optionResult = highlightShellInputSyntax(optionContinuation, optionStart.continuationState);
  assert.deepEqual(optionResult.tokens.map(token => ({
    text: optionContinuation.slice(token.start, token.end), kind: token.kind
  })), [{ text: 'git', kind: 'shell-command' }]);
});

test('shell syntax treats only an odd unquoted trailing backslash as a line continuation', () => {
  const backslash = String.fromCharCode(92);
  assert.equal(highlightShellInputSyntax('env ' + backslash.repeat(2)).continuationState, undefined);
  assert.ok(highlightShellInputSyntax('env ' + backslash.repeat(3)).continuationState);

  const source = 'env ' + backslash + '\ngit --version';
  const tokens = highlightTextSyntax(source, 'shell').tokens.map(token => ({
    text: source.slice(token.start, token.end), kind: token.kind
  }));
  assert.deepEqual(tokens, [
    { text: 'env', kind: 'shell-command' },
    { text: 'git', kind: 'shell-command' },
    { text: '--version', kind: 'shell-option' }
  ]);
});

test('shell syntax does not infer a continuation at the bounded preview boundary', () => {
  const backslash = String.fromCharCode(92);
  const source = 'x'.repeat(MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS - 1) + backslash + 'y';
  const preview = highlightShellInputSyntax(source);
  assert.equal(preview.isTruncated, true);
  assert.equal(preview.continuationState, undefined);
});

test('shell syntax preview treats double-bracket expressions as conditions, not commands', () => {
  const source = 'time git status; if [[ ! -f /tmp/target && -n $HOME ]]; then echo ready; fi';
  const tokens = highlightTextSyntax(source, 'shell').tokens.map(token => ({
    text: source.slice(token.start, token.end), kind: token.kind
  }));
  assert.deepEqual(tokens, [
    { text: 'time', kind: 'shell-keyword' },
    { text: 'git', kind: 'shell-command' },
    { text: ';', kind: 'shell-operator' },
    { text: 'if', kind: 'shell-keyword' },
    { text: '[[', kind: 'shell-keyword' },
    { text: '!', kind: 'shell-keyword' },
    { text: '-f', kind: 'shell-option' },
    { text: '/tmp/target', kind: 'shell-path' },
    { text: '&&', kind: 'shell-operator' },
    { text: '-n', kind: 'shell-option' },
    { text: '$HOME', kind: 'shell-variable' },
    { text: ']]', kind: 'shell-keyword' },
    { text: ';', kind: 'shell-operator' },
    { text: 'then', kind: 'shell-keyword' },
    { text: 'echo', kind: 'shell-builtin' },
    { text: ';', kind: 'shell-operator' },
    { text: 'fi', kind: 'shell-keyword' }
  ]);
});

test('shell syntax preview only colors the double-bracket closing marker in condition context', () => {
  const source = 'echo ]]';
  const tokens = highlightTextSyntax(source, 'shell').tokens.map(token => ({
    text: source.slice(token.start, token.end), kind: token.kind
  }));
  assert.deepEqual(tokens, [{ text: 'echo', kind: 'shell-builtin' }]);
});

test('shell syntax preview does not color an isolated double-bracket closer', () => {
  assert.deepEqual(highlightTextSyntax(']]', 'shell').tokens, []);
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

test('PowerShell input carries bounded lexical state only for unquoted odd trailing backticks', () => {
  const backtick = String.fromCharCode(96);
  const firstLine = `Get-ChildItem ${backtick}`;
  const first = highlightPowerShellInputSyntax(firstLine);
  assert.deepEqual(first.continuationState, { commandExpected: false, previousTokenIsBareWord: false });

  const secondLine = '-Path $HOME';
  const continued = highlightPowerShellInputSyntax(secondLine, first.continuationState);
  assert.deepEqual(continued.tokens.map(token => ({ text: secondLine.slice(token.start, token.end), kind: token.kind })), [
    { text: '-Path', kind: 'powershell-parameter' },
    { text: '$HOME', kind: 'powershell-variable' }
  ]);
  assert.equal(continued.continuationState, undefined);

  assert.equal(highlightPowerShellInputSyntax(`Get-ChildItem ${backtick.repeat(2)}`).continuationState, undefined);
  assert.equal(highlightPowerShellInputSyntax(`Get-ChildItem ${backtick} `).continuationState, undefined,
    'trailing whitespace cancels explicit continuation');
  assert.equal(highlightPowerShellInputSyntax(`'quoted${backtick}`).continuationState, undefined);
  assert.equal(highlightPowerShellInputSyntax(`"quoted${backtick}`).continuationState, undefined);
  assert.equal(highlightPowerShellInputSyntax(`# comment${backtick}`).continuationState, undefined);
  assert.equal(highlightPowerShellInputSyntax(`@"\nstring${backtick}`).continuationState, undefined);
});

test('PowerShell syntax preview does not carry continuation state from a truncated input', () => {
  const source = ' '.repeat(MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS) + String.fromCharCode(96);
  const preview = highlightPowerShellInputSyntax(source);
  assert.equal(preview.isTruncated, true);
  assert.equal(preview.continuationState, undefined);
  const naturalOperatorSource = ' '.repeat(MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS) + '|';
  assert.equal(highlightPowerShellInputSyntax(naturalOperatorSource).continuationState, undefined,
    'a natural operator beyond the bounded preview cannot start a continuation');
});

test('PowerShell input carries bounded lexical state across common natural trailing operators', () => {
  const firstLine = highlightPowerShellInputSyntax('Get-Process |   ');
  assert.deepEqual(firstLine.continuationState, { commandExpected: true, previousTokenIsBareWord: false });

  const secondText = 'Select-Object -First 1 |';
  const secondLine = highlightPowerShellInputSyntax(secondText, firstLine.continuationState);
  assert.deepEqual(secondLine.tokens.map(token => ({ text: secondText.slice(token.start, token.end), kind: token.kind })), [
    { text: 'Select-Object', kind: 'powershell-command' },
    { text: '-First', kind: 'powershell-parameter' },
    { text: '1', kind: 'powershell-number' },
    { text: '|', kind: 'powershell-operator' }
  ]);
  assert.deepEqual(secondLine.continuationState, { commandExpected: true, previousTokenIsBareWord: false });

  const thirdLine = 'Where-Object';
  const completed = highlightPowerShellInputSyntax(thirdLine, secondLine.continuationState);
  assert.deepEqual(completed.tokens.map(token => ({ text: thirdLine.slice(token.start, token.end), kind: token.kind })), [
    { text: 'Where-Object', kind: 'powershell-command' }
  ]);
  assert.equal(completed.continuationState, undefined);

  assert.ok(highlightPowerShellInputSyntax('$value = 1 +').continuationState,
    'a common binary arithmetic operator also continues input');
  assert.ok(highlightPowerShellInputSyntax('1 -eq').continuationState,
    'a PowerShell binary word operator also continues input');
  assert.ok(highlightPowerShellInputSyntax('1,').continuationState,
    'an array separator also continues input');
  for (const operator of ['&&', '||']) {
    const logicalContinuation = highlightPowerShellInputSyntax(`Get-Process ${operator}`);
    assert.deepEqual(logicalContinuation.continuationState,
      { commandExpected: true, previousTokenIsBareWord: false },
      `${operator} expects a pipeline on the next input row`);
    const nextCommand = 'Get-Service';
    assert.deepEqual(highlightPowerShellInputSyntax(nextCommand, logicalContinuation.continuationState).tokens.map(token =>
      ({ text: nextCommand.slice(token.start, token.end), kind: token.kind })), [
      { text: 'Get-Service', kind: 'powershell-command' }
    ], `${operator} continuation colors the next pipeline command`);
  }
  assert.equal(highlightPowerShellInputSyntax(`Get-Process ${String.fromCharCode(96)}|`).continuationState, undefined,
    'a backtick-escaped pipe is not a natural continuation operator');
  assert.equal(highlightPowerShellInputSyntax('Get-Process | # comment').continuationState, undefined,
    'a trailing comment is not treated as a final operator');
  assert.equal(highlightPowerShellInputSyntax('"Get-Process |"').continuationState, undefined,
    'an operator inside a string does not continue input');
});

test('PowerShell input carries a bounded expected-delimiter stack across natural continuation rows', () => {
  const openedArray = highlightPowerShellInputSyntax('$values = @(');
  assert.deepEqual(openedArray.continuationState, {
    commandExpected: true,
    previousTokenIsBareWord: false,
    expectedClosingDelimiters: [')']
  });

  const firstCommand = 'Get-Process |';
  const firstContinuation = highlightPowerShellInputSyntax(firstCommand, openedArray.continuationState);
  assert.deepEqual(firstContinuation.tokens.map(token => ({ text: firstCommand.slice(token.start, token.end), kind: token.kind })), [
    { text: 'Get-Process', kind: 'powershell-command' },
    { text: '|', kind: 'powershell-operator' }
  ]);
  assert.deepEqual(firstContinuation.continuationState?.expectedClosingDelimiters, [')']);

  const secondCommand = 'Select-Object -First 1';
  const secondContinuation = highlightPowerShellInputSyntax(secondCommand, firstContinuation.continuationState);
  assert.deepEqual(secondContinuation.tokens.map(token => ({ text: secondCommand.slice(token.start, token.end), kind: token.kind })), [
    { text: 'Select-Object', kind: 'powershell-command' },
    { text: '-First', kind: 'powershell-parameter' },
    { text: '1', kind: 'powershell-number' }
  ]);
  assert.deepEqual(secondContinuation.continuationState?.expectedClosingDelimiters, [')'],
    'an open delimiter preserves continuation after an otherwise complete input row');
  assert.equal(highlightPowerShellInputSyntax(')', secondContinuation.continuationState).continuationState, undefined,
    'the matching close completes the natural continuation');

  const nested = highlightPowerShellInputSyntax('@{@(');
  assert.deepEqual(nested.continuationState?.expectedClosingDelimiters, ['}', ')']);
  const openBracket = highlightPowerShellInputSyntax('[');
  assert.deepEqual(openBracket.continuationState?.expectedClosingDelimiters, [']']);
  assert.equal(highlightPowerShellInputSyntax(']', openBracket.continuationState).continuationState, undefined);
  const innerClosed = highlightPowerShellInputSyntax(')', nested.continuationState);
  assert.deepEqual(innerClosed.continuationState?.expectedClosingDelimiters, ['}']);
  assert.equal(highlightPowerShellInputSyntax('}', innerClosed.continuationState).continuationState, undefined);
  assert.equal(highlightPowerShellInputSyntax(')', highlightPowerShellInputSyntax('@{').continuationState).continuationState,
    undefined, 'a mismatched close fails closed');
  assert.equal(highlightPowerShellInputSyntax(')').continuationState, undefined,
    'an unmatched closing delimiter cannot start continuation state');

  assert.deepEqual(highlightPowerShellInputSyntax('"value )"', openedArray.continuationState).continuationState?.expectedClosingDelimiters,
    [')'], 'delimiters inside a closed string are opaque');
  assert.deepEqual(highlightPowerShellInputSyntax('# comment )', openedArray.continuationState).continuationState?.expectedClosingDelimiters,
    [')'], 'delimiters inside a line comment are opaque');
  assert.equal(highlightPowerShellInputSyntax('"unfinished', openedArray.continuationState).continuationState, undefined,
    'an incomplete quote suspends continuation state');
  assert.equal(highlightPowerShellInputSyntax("@'\nunfinished", openedArray.continuationState).continuationState, undefined,
    'an incomplete here-string suspends continuation state');
  assert.equal(highlightPowerShellInputSyntax('<# unfinished', openedArray.continuationState).continuationState, undefined,
    'an incomplete block comment suspends continuation state');
  assert.equal(highlightPowerShellInputSyntax('Get-Process <# unfinished', openedArray.continuationState).continuationState, undefined,
    'an incomplete block comment after a bare word suspends continuation state');

  const backtick = String.fromCharCode(96);
  assert.equal(highlightPowerShellInputSyntax(`${backtick}(`).continuationState, undefined,
    'an escaped opener is not tracked');
  assert.deepEqual(highlightPowerShellInputSyntax(`${backtick})`, openedArray.continuationState).continuationState?.expectedClosingDelimiters,
    [')'], 'an escaped closer does not consume the carried stack');

  assert.equal(highlightPowerShellInputSyntax('('.repeat(32)).continuationState?.expectedClosingDelimiters?.length, 32,
    'the maximum supported nesting depth is carried');
  assert.equal(highlightPowerShellInputSyntax('('.repeat(33)).continuationState, undefined,
    'nesting deeper than the fixed bound fails closed');
  const invalidState = { commandExpected: true, previousTokenIsBareWord: false,
    expectedClosingDelimiters: ['x'] } as unknown as PowerShellSyntaxContinuationState;
  assert.equal(highlightPowerShellInputSyntax('Get-Process', invalidState).continuationState, undefined,
    'an invalid incoming stack fails closed');
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

test('SQL syntax preview colors PostgreSQL-style keywords, types, literals, functions, identifiers and bounded lexemes', () => {
  const source = [
    '-- list rows',
    'CREATE TABLE users (id BIGINT PRIMARY KEY, display_name TEXT NOT NULL, active BOOLEAN DEFAULT TRUE);',
    "INSERT INTO users (id, display_name) VALUES ($1, E'Dianne''s $1 -- data');",
    'SELECT "display""name", COUNT(*)::INTEGER FROM users WHERE id >= 1.25e2 AND active = TRUE;',
    '/* outer /* nested */ block */',
    'SELECT $body$SELECT -- literal\n/* also literal */$body$;'
  ].join('\n');
  const tokens = highlightTextSyntax(source, 'sql').tokens.map(token => ({
    text: source.slice(token.start, token.end),
    kind: token.kind
  }));
  const values = (kind: string) => tokens.filter(token => token.kind === kind).map(token => token.text);

  assert.deepEqual(values('sql-keyword'), ['CREATE', 'TABLE', 'PRIMARY', 'KEY', 'NOT', 'DEFAULT', 'INSERT', 'INTO', 'VALUES', 'SELECT', 'FROM', 'WHERE', 'AND', 'SELECT']);
  assert.deepEqual(values('sql-type'), ['BIGINT', 'TEXT', 'BOOLEAN', 'INTEGER']);
  assert.deepEqual(values('sql-literal'), ['NULL', 'TRUE', 'TRUE']);
  assert.deepEqual(values('sql-function'), ['COUNT']);
  assert.deepEqual(values('sql-identifier'), ['"display""name"']);
  assert.deepEqual(values('sql-number'), ['1.25e2']);
  assert.deepEqual(values('sql-parameter'), ['$1']);
  assert.deepEqual(values('sql-string'), ["E'Dianne''s $1 -- data'", '$body$SELECT -- literal\n/* also literal */$body$']);
  assert.deepEqual(values('sql-comment'), ['-- list rows', '/* outer /* nested */ block */']);
  assert.ok(values('sql-operator').includes('::'));
  assert.ok(values('sql-operator').includes('>='));
});

test('SQL syntax preview keeps tokens within the code-unit and token bounds', () => {
  for (const source of [
    `${' '.repeat(MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS - 1)}'tail`,
    `${' '.repeat(MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS - 2)}/*comment*/`,
    `${' '.repeat(MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS - 2)}$tag$tail`,
    `${' '.repeat(MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS - 1)}$1`
  ]) {
    const preview = highlightTextSyntax(source, 'sql');
    assert.ok(preview.highlightedThrough <= MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS);
    assert.ok(preview.tokens.every(token => token.end <= preview.highlightedThrough),
      `token ended past the preview bound at ${preview.highlightedThrough}`);
  }
  const manyComments = highlightTextSyntax('-- comment\n'.repeat(MAX_TEXT_SYNTAX_PREVIEW_TOKENS + 10), 'sql');
  assert.equal(manyComments.tokens.length, MAX_TEXT_SYNTAX_PREVIEW_TOKENS);
  assert.equal(manyComments.isTruncated, true);
});

test('TOML syntax preview colors keys, four string forms, values, comments and table punctuation', () => {
  const source = [
    '# root comment',
    'title = "TOML # value"',
    'escaped = "line\\nvalue"',
    "literal = 'literal # value'",
    'multiline = """first line',
    '# still string content',
    'last line"""',
    'trailingQuote = """ends with a quote""""',
    'following = "recognized"',
    "multilineLiteral = '''first literal line",
    '# still literal content',
    "last literal line'''",
    '"quoted.key" = "quoted key works"',
    'decimal = 1_000',
    'hex = 0xDEAD_BEEF',
    'float = -1.25e+2',
    'positiveFloat = +1.5',
    'dotted = 1.2',
    'enabled = true',
    'disabled = false',
    'infinite = +inf',
    'localDate = 1979-05-27',
    'localDateTime = 1979-05-27 07:32:00',
    'offsetDateTime = 1979-05-27 07:32:00Z',
    '[database.connection]',
    'port = 5432',
    '[[products]]',
    'name = "Hammer"'
  ].join('\n');
  const preview = highlightTextSyntax(source, 'toml');
  const values = (kind: string) => preview.tokens.filter(token => token.kind === kind).map(token => source.slice(token.start, token.end));

  assert.deepEqual(values('toml-comment'), ['# root comment']);
  assert.deepEqual(values('toml-string'), [
    '"TOML # value"', '"line\\nvalue"', "'literal # value'", '"""first line\n# still string content\nlast line"""',
    '"""ends with a quote""""', '"recognized"', "'''first literal line\n# still literal content\nlast literal line'''",
    '"quoted key works"', '"Hammer"'
  ]);
  assert.deepEqual(values('toml-number'), ['1_000', '0xDEAD_BEEF', '-1.25e+2', '+1.5', '1.2', '5432']);
  assert.deepEqual(values('toml-literal'), ['true', 'false', '+inf']);
  assert.deepEqual(values('toml-datetime'), ['1979-05-27', '1979-05-27 07:32:00', '1979-05-27 07:32:00Z']);
  assert.ok(values('toml-key').includes('"quoted.key"'));
  assert.ok(values('toml-key').includes('database'));
  assert.ok(values('toml-key').includes('connection'));
  assert.ok(values('toml-key').includes('products'));
  assert.ok(values('toml-operator').includes('[['));
  assert.ok(values('toml-operator').includes(']]'));
  assert.equal(preview.isTruncated, false);
});

test('TOML syntax preview remains within code-unit and token bounds', () => {
  const longString = `value = "${'x'.repeat(MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS + 100)}"`;
  const characterBound = highlightTextSyntax(longString, 'toml');
  assert.equal(characterBound.highlightedThrough, MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS);
  assert.equal(characterBound.isTruncated, true);
  assert.ok(characterBound.tokens.every(token => token.end <= characterBound.highlightedThrough));

  const manyComments = highlightTextSyntax('# comment\n'.repeat(MAX_TEXT_SYNTAX_PREVIEW_TOKENS + 10), 'toml');
  assert.equal(manyComments.tokens.length, MAX_TEXT_SYNTAX_PREVIEW_TOKENS);
  assert.equal(manyComments.isTruncated, true);
});

test('YAML syntax preview colors keys, YAML 1.2 core scalars, strings and separated comments', () => {
  const source = [
    '---',
    'plain key with spaces: unquoted text',
    'description: this is true',
    '"quoted:key": "double # text"',
    "'single key': 'it''s # text'",
    'url: https://example.test/a#fragment',
    'commented: value # line note',
    'embedded: foo#bar',
    'emptyValue: null',
    'tildeValue: ~',
    'trueValue: TRUE',
    'legacyWord: yes',
    'negative: -42',
    'octal: 0o17',
    'hex: 0xFF',
    'float: -.5e+2',
    'infinity: .Inf',
    'notANumber: .NaN',
    'block punctuation: words[inside], braces{} # comment',
    '...',
  ].join('\n');
  const preview = highlightTextSyntax(source, 'yaml');
  const values = (kind: string) => preview.tokens.filter(token => token.kind === kind).map(token => source.slice(token.start, token.end));

  assert.deepEqual(values('yaml-document'), ['---', '...']);
  assert.deepEqual(values('yaml-comment'), ['# line note', '# comment']);
  assert.deepEqual(values('yaml-key').slice(0, 6), [
    'plain key with spaces', 'description', '"quoted:key"', "'single key'", 'url', 'commented'
  ]);
  assert.ok(values('yaml-string').includes('"double # text"'));
  assert.ok(values('yaml-string').includes("'it''s # text'"));
  assert.ok(values('yaml-string').includes('this is true'));
  assert.ok(values('yaml-string').includes('https://example.test/a#fragment'));
  assert.ok(values('yaml-string').includes('foo#bar'));
  assert.ok(values('yaml-string').includes('yes'));
  assert.ok(values('yaml-string').includes('words[inside], braces{}'));
  assert.deepEqual(values('yaml-literal'), ['null', '~', 'TRUE']);
  assert.deepEqual(values('yaml-number'), ['-42', '0o17', '0xFF', '-.5e+2', '.Inf', '.NaN']);
  assert.equal(preview.isTruncated, false);
});

test('YAML syntax preview recognizes flow collections, tags, anchors, aliases, directives and opaque block scalars', () => {
  const source = [
    '%YAML 1.2 # version',
    '%TAG !example! tag:example.com,2026:',
    '--- !<tag:clarkevans.com,2002:invoice>',
    'flow: {quoted: "value", adjacent:true, words: this is true, nested: [one, "item", -2, {enabled: false}]}',
    'sequencePairs: [foo: bar, baz: qux, "quoted pair": value, "adjacent pair":value]',
    'anchor: &base {name: origin}',
    'copy: *base # reuse',
    'aliasKey: {*base: value}',
    'tagged: !!str literal',
    'literal: |2-',
    '  # stays block text',
    '  echo "not a token"',
    'next: >+2 # folded block header',
    '  this is folded text',
    'tasks:',
    '  - command: |1-',
    '     # sequence body stays opaque',
    '     enabled: true',
    '    name: next',
    'nestedTasks:',
    '  - - command: |1-',
    '       # nested sequence body stays opaque',
    '       enabled: true',
    '      nested name: next',
    'after: true'
  ].join('\n');
  const preview = highlightTextSyntax(source, 'yaml');
  const values = (kind: string) => preview.tokens.filter(token => token.kind === kind).map(token => source.slice(token.start, token.end));

  assert.deepEqual(values('yaml-directive'), ['%YAML 1.2 ', '%TAG !example! tag:example.com,2026:']);
  assert.deepEqual(values('yaml-document'), ['---']);
  assert.deepEqual(values('yaml-comment'), ['# version', '# reuse', '# folded block header']);
  assert.ok(values('yaml-tag').includes('!<tag:clarkevans.com,2002:invoice>'));
  assert.ok(values('yaml-tag').includes('!!str'));
  assert.ok(values('yaml-anchor').includes('&base'));
  assert.ok(values('yaml-alias').includes('*base'));
  assert.ok(values('yaml-operator').includes(':'));
  assert.equal(values('yaml-key').includes('"value"'), false);
  assert.equal(values('yaml-key').includes('"item"'), false);
  assert.equal(values('yaml-key').includes('this is true'), false);
  assert.ok(values('yaml-string').includes('"value"'));
  assert.ok(values('yaml-string').includes('"item"'));
  assert.ok(values('yaml-string').includes('this is true'));
  assert.ok(values('yaml-key').includes('adjacent'));
  assert.ok(values('yaml-literal').includes('false'));
  assert.ok(values('yaml-string').includes('  # stays block text'));
  assert.ok(values('yaml-string').includes('  echo "not a token"'));
  assert.ok(values('yaml-string').includes('  this is folded text'));
  assert.ok(values('yaml-string').includes('     # sequence body stays opaque'));
  assert.ok(values('yaml-string').includes('     enabled: true'));
  assert.equal(values('yaml-comment').includes('     # sequence body stays opaque'), false);
  assert.ok(values('yaml-key').includes('name'));
  assert.ok(values('yaml-key').includes('foo'));
  assert.ok(values('yaml-key').includes('baz'));
  assert.ok(values('yaml-key').includes('"quoted pair"'));
  assert.ok(values('yaml-key').includes('"adjacent pair"'));
  assert.ok(values('yaml-key').includes('nested name'));
  assert.ok(values('yaml-string').includes('bar'));
  assert.ok(values('yaml-string').includes('qux'));
  assert.ok(values('yaml-string').includes('       # nested sequence body stays opaque'));
  assert.ok(values('yaml-key').includes('after'));
});

test('YAML block indicators inside plain scalars and alias mapping colons stay lexical', () => {
  const source = 'message: keep this - value\nreferences: {*base: value}\n';
  const preview = highlightTextSyntax(source, 'yaml');
  const values = (kind: string) => preview.tokens.filter(token => token.kind === kind).map(token => source.slice(token.start, token.end));
  assert.ok(values('yaml-string').includes('keep this - value'));
  assert.ok(values('yaml-alias').includes('*base'));
  assert.ok(values('yaml-operator').includes(':'));
  assert.equal(values('yaml-operator').includes('-'), false);
});

test('YAML syntax preview bounds implicit-key lookahead, characters and token output', () => {
  const longImplicitKey = `${'k'.repeat(1_025)}: value`;
  const keyPreview = highlightTextSyntax(longImplicitKey, 'yaml');
  assert.equal(keyPreview.tokens.some(token => token.kind === 'yaml-key'), false);

  const longScalar = `value: "${'x'.repeat(MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS + 100)}"`;
  const characterBound = highlightTextSyntax(longScalar, 'yaml');
  assert.equal(characterBound.highlightedThrough, MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS);
  assert.equal(characterBound.isTruncated, true);
  assert.ok(characterBound.tokens.every(token => token.end <= characterBound.highlightedThrough));

  const manyComments = highlightTextSyntax('# comment\n'.repeat(MAX_TEXT_SYNTAX_PREVIEW_TOKENS + 10), 'yaml');
  assert.equal(manyComments.tokens.length, MAX_TEXT_SYNTAX_PREVIEW_TOKENS);
  assert.equal(manyComments.isTruncated, true);
});

test('YAML syntax preview keeps malformed low-token flow input within a linear allowance', () => {
  function medianRuntime(codeUnits: number): number {
    const input = `[${'}'.repeat(codeUnits - 1)}`;
    highlightTextSyntax(input, 'yaml');
    const samples = Array.from({ length: 5 }, () => {
      const start = performance.now();
      const preview = highlightTextSyntax(input, 'yaml');
      assert.equal(preview.tokens.length, 1);
      return performance.now() - start;
    }).sort((left, right) => left - right);
    return samples[2]!;
  }

  const smaller = medianRuntime(16_000);
  const boundedPreview = medianRuntime(MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS);
  assert.ok(boundedPreview <= smaller * 8 + 10,
    `64,000 malformed flow code units took ${boundedPreview.toFixed(1)}ms after 16,000 took ${smaller.toFixed(1)}ms`);
});

test('Markdown syntax preview colors common block and inline forms without parsing fenced code', () => {
  const source = [
    '# Release notes',
    '> A **bold** quote',
    '- item with `inline` and [guide](https://example.test)',
    '1. numbered',
    '---',
    '```ts',
    '[not a link] **not emphasis**',
    '```',
    '<!-- note -->'
  ].join('\n');
  const preview = highlightTextSyntax(source, 'markdown');
  const values = (kind: string) => preview.tokens.filter(token => token.kind === kind).map(token => source.slice(token.start, token.end));

  assert.deepEqual(values('markdown-heading'), ['#']);
  assert.deepEqual(values('markdown-quote'), ['>']);
  assert.deepEqual(values('markdown-list'), ['-', '1.']);
  assert.deepEqual(values('markdown-rule'), ['---']);
  assert.deepEqual(values('markdown-emphasis'), ['**bold**']);
  assert.deepEqual(values('markdown-code'), ['`inline`', '[not a link] **not emphasis**\n']);
  assert.deepEqual(values('markdown-link'), ['[guide](https://example.test)']);
  assert.deepEqual(values('markdown-code-fence'), ['```', '```']);
  assert.deepEqual(values('markdown-code-info'), ['ts']);
  assert.deepEqual(values('markdown-comment'), ['<!-- note -->']);
  assert.equal(preview.isTruncated, false);
});

test('Markdown syntax preview closes fences only with a matching delimiter and valid indentation', () => {
  const source = [
    '~~~lang',
    '```',
    '####### not a heading',
    '    ~~~ not a closing fence',
    '~~~~  ',
    '    # not a heading',
    '# visible heading'
  ].join('\n');
  const preview = highlightTextSyntax(source, 'markdown');
  const values = (kind: string) => preview.tokens.filter(token => token.kind === kind).map(token => source.slice(token.start, token.end));

  assert.deepEqual(values('markdown-code-fence'), ['~~~', '~~~~']);
  assert.deepEqual(values('markdown-code'), ['```\n', '####### not a heading\n', '    ~~~ not a closing fence\n']);
  assert.deepEqual(values('markdown-heading'), ['#']);
});

test('Markdown emphasis respects opaque inline constructs and preserves their token colors', () => {
  const source = '*before `*inside*` [label](url*part) <!-- * --> after*';
  const tokens = highlightTextSyntax(source, 'markdown').tokens.map(token => ({
    text: source.slice(token.start, token.end),
    kind: token.kind
  }));

  assert.deepEqual(tokens, [
    { text: '*before ', kind: 'markdown-emphasis' },
    { text: '`*inside*`', kind: 'markdown-code' },
    { text: ' ', kind: 'markdown-emphasis' },
    { text: '[label](url*part)', kind: 'markdown-link' },
    { text: ' ', kind: 'markdown-emphasis' },
    { text: '<!-- * -->', kind: 'markdown-comment' },
    { text: ' after*', kind: 'markdown-emphasis' }
  ]);
});

test('Markdown syntax preview bounds inline lookahead work and token output', () => {
  const longLink = `[${'x'.repeat(MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS + 100)}](https://example.test)`;
  const characterBound = highlightTextSyntax(longLink, 'markdown');
  assert.equal(characterBound.highlightedThrough, MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS);
  assert.equal(characterBound.isTruncated, true);
  assert.equal(characterBound.tokens.some(token => token.kind === 'markdown-link'), false);
  assert.ok(characterBound.tokens.every(token => token.end <= characterBound.highlightedThrough));

  const overLookaheadLink = `[${'x'.repeat(512)}](https://example.test)`;
  const boundedLink = highlightTextSyntax(overLookaheadLink, 'markdown');
  assert.equal(boundedLink.highlightedThrough, overLookaheadLink.length);
  assert.equal(boundedLink.isTruncated, false);
  assert.equal(boundedLink.tokens.some(token => token.kind === 'markdown-link'), false);

  const malformedLinks = '['.repeat(MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS);
  const boundedLookaheadWork = highlightTextSyntax(malformedLinks, 'markdown');
  assert.equal(boundedLookaheadWork.tokens.length, 0);
  assert.ok(boundedLookaheadWork.highlightedThrough < malformedLinks.length);
  assert.equal(boundedLookaheadWork.isTruncated, true);

  const manySpans = '**bold**\n'.repeat(MAX_TEXT_SYNTAX_PREVIEW_TOKENS + 10);
  const tokenBound = highlightTextSyntax(manySpans, 'markdown');
  assert.equal(tokenBound.tokens.length, MAX_TEXT_SYNTAX_PREVIEW_TOKENS);
  assert.ok(tokenBound.tokens.every(token => token.kind === 'markdown-emphasis'));
  assert.equal(tokenBound.isTruncated, true);
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

test('INI syntax preview colors sections, keys, separators, quoted values, literals, numbers and full-line comments', () => {
  const source = [
    '; main settings',
    '[server]',
    'host.name = "local\\"host"',
    'port: 8080',
    'enabled = YES',
    'timeout = -1.5e2',
    'malformed line',
    '[unterminated',
    'unclosed = "not closed',
    'path = C:\\app ; inline text stays uncolored'
  ].join('\n');
  const preview = highlightTextSyntax(source, 'ini');
  const tokens = preview.tokens.map(token => ({ text: source.slice(token.start, token.end), kind: token.kind }));
  assert.deepEqual(tokens, [
    { text: '; main settings', kind: 'ini-comment' },
    { text: '[server]', kind: 'ini-section' },
    { text: 'host.name', kind: 'ini-key' },
    { text: '=', kind: 'ini-operator' },
    { text: '"local\\"host"', kind: 'ini-string' },
    { text: 'port', kind: 'ini-key' },
    { text: ':', kind: 'ini-operator' },
    { text: '8080', kind: 'ini-number' },
    { text: 'enabled', kind: 'ini-key' },
    { text: '=', kind: 'ini-operator' },
    { text: 'YES', kind: 'ini-literal' },
    { text: 'timeout', kind: 'ini-key' },
    { text: '=', kind: 'ini-operator' },
    { text: '-1.5e2', kind: 'ini-number' },
    { text: 'unclosed', kind: 'ini-key' },
    { text: '=', kind: 'ini-operator' },
    { text: 'path', kind: 'ini-key' },
    { text: '=', kind: 'ini-operator' }
  ]);
  assert.equal(preview.isTruncated, false);
});

test('INI syntax preview stops at shared character and token bounds', () => {
  const oversized = highlightTextSyntax(`value = "${'x'.repeat(MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS + 100)}"`, 'ini');
  assert.equal(oversized.highlightedThrough, MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS);
  assert.equal(oversized.isTruncated, true);
  assert.ok(oversized.tokens.every(token => token.end <= oversized.highlightedThrough));

  const manyComments = highlightTextSyntax('; comment\n'.repeat(MAX_TEXT_SYNTAX_PREVIEW_TOKENS + 10), 'ini');
  assert.equal(manyComments.tokens.length, MAX_TEXT_SYNTAX_PREVIEW_TOKENS);
  assert.equal(manyComments.isTruncated, true);
});

test('XML syntax preview colors tags, attributes, quoted values, comments, declarations, CDATA and text entities', () => {
  const source = '<?xml version="1.0"?>\n<!-- service -->\n<server host="127.0.0.1">service &amp; app<![CDATA[<literal>]]></server>\n';
  const preview = highlightTextSyntax(source, 'xml');
  const tokens = preview.tokens.map(token => ({ text: source.slice(token.start, token.end), kind: token.kind }));
  assert.deepEqual(tokens, [
    { text: '<?xml version="1.0"?>', kind: 'xml-declaration' },
    { text: '<!-- service -->', kind: 'xml-comment' },
    { text: '<', kind: 'xml-operator' },
    { text: 'server', kind: 'xml-tag' },
    { text: 'host', kind: 'xml-attribute' },
    { text: '=', kind: 'xml-operator' },
    { text: '"127.0.0.1"', kind: 'xml-string' },
    { text: '>', kind: 'xml-operator' },
    { text: '&amp;', kind: 'xml-entity' },
    { text: '<![CDATA[<literal>]]>', kind: 'xml-cdata' },
    { text: '</', kind: 'xml-operator' },
    { text: 'server', kind: 'xml-tag' },
    { text: '>', kind: 'xml-operator' }
  ]);
  assert.equal(preview.isTruncated, false);

  const doctypeSource = '<!DOCTYPE root [<!-- ] > --> <!ELEMENT root (#PCDATA)>]><root value="a > b"/>';
  const doctype = highlightTextSyntax(doctypeSource, 'xml');
  assert.equal(doctypeSource.slice(doctype.tokens[0]!.start, doctype.tokens[0]!.end), '<!DOCTYPE root [<!-- ] > --> <!ELEMENT root (#PCDATA)>]>');
  assert.equal(doctype.tokens[0]!.kind, 'xml-declaration');
  assert.equal(doctypeSource.slice(doctype.tokens[doctype.tokens.length - 2]!.start, doctype.tokens[doctype.tokens.length - 2]!.end), '"a > b"');
});

test('XML syntax preview leaves malformed constructs uncolored and respects shared preview bounds', () => {
  for (const source of ['<open', '<open <nested/>', '<item value="unterminated', '<!-- no end <nested>']) {
    assert.equal(highlightTextSyntax(source, 'xml').tokens.length, 0);
  }

  const oversized = highlightTextSyntax(`<item>${'x'.repeat(MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS + 100)}`, 'xml');
  assert.equal(oversized.highlightedThrough, MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS);
  assert.equal(oversized.isTruncated, true);
  assert.ok(oversized.tokens.every(token => token.end <= oversized.highlightedThrough));

  const manyTags = highlightTextSyntax('<x/>'.repeat(MAX_TEXT_SYNTAX_PREVIEW_TOKENS), 'xml');
  assert.equal(manyTags.tokens.length, MAX_TEXT_SYNTAX_PREVIEW_TOKENS);
  assert.equal(manyTags.isTruncated, true);
});
