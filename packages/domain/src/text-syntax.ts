export const MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS = 64_000;
export const MAX_TEXT_SYNTAX_PREVIEW_TOKENS = 4_096;
const MAX_POWERSHELL_NAME_SCAN_CODE_UNITS = 256;
const MAX_POWERSHELL_CONTINUATION_DELIMITER_DEPTH = 32;
const MAX_SQL_DOLLAR_TAG_CODE_UNITS = 63;
const MAX_MARKDOWN_INLINE_LOOKAHEAD_CODE_UNITS = 512;
const MAX_MARKDOWN_INLINE_LOOKAHEAD_STEPS = 256_000;
const MAX_TOML_DOTTED_KEY_LOOKAHEAD_CODE_UNITS = 512;
const MAX_YAML_KEY_LOOKAHEAD_CODE_UNITS = 1_024;
const MAX_XML_ENTITY_CODE_UNITS = 64;
const iniLiterals = new Set(['false', 'no', 'off', 'on', 'true', 'yes']);
const iniNumberPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;

export const TEXT_SYNTAX_PROFILES = ['auto', 'plain', 'markdown', 'shell', 'powershell', 'python', 'javascript', 'sql', 'toml', 'yaml', 'ini', 'xml', 'html', 'dotenv', 'properties', 'json'] as const;
export type TextSyntaxProfile = typeof TEXT_SYNTAX_PROFILES[number];
export type ResolvedTextSyntaxProfile = Exclude<TextSyntaxProfile, 'auto'>;

export type TextSyntaxTokenKind =
  | 'shell-command' | 'shell-builtin' | 'shell-keyword' | 'shell-option' | 'shell-string' | 'shell-variable' | 'shell-comment' | 'shell-operator' | 'shell-path'
  | 'powershell-command' | 'powershell-keyword' | 'powershell-parameter' | 'powershell-string' | 'powershell-variable'
  | 'powershell-comment' | 'powershell-operator' | 'powershell-number' | 'powershell-type'
  | 'python-builtin' | 'python-keyword' | 'python-string' | 'python-comment' | 'python-number' | 'python-operator'
  | 'python-function' | 'python-type'
  | 'javascript-builtin' | 'javascript-keyword' | 'javascript-string' | 'javascript-comment' | 'javascript-number'
  | 'javascript-operator' | 'javascript-function' | 'javascript-type'
  | 'sql-function' | 'sql-keyword' | 'sql-literal' | 'sql-string' | 'sql-comment' | 'sql-number' | 'sql-operator'
  | 'sql-parameter' | 'sql-type' | 'sql-identifier'
  | 'toml-key' | 'toml-string' | 'toml-number' | 'toml-literal' | 'toml-datetime' | 'toml-comment' | 'toml-operator'
  | 'ini-section' | 'ini-key' | 'ini-string' | 'ini-number' | 'ini-literal' | 'ini-comment' | 'ini-operator'
  | 'dotenv-key' | 'dotenv-value' | 'dotenv-string' | 'dotenv-comment' | 'dotenv-operator' | 'dotenv-export'
  | 'properties-key' | 'properties-value' | 'properties-comment' | 'properties-operator'
  | 'xml-tag' | 'xml-attribute' | 'xml-string' | 'xml-comment' | 'xml-cdata' | 'xml-declaration' | 'xml-entity' | 'xml-operator'
  | 'html-tag' | 'html-attribute' | 'html-string' | 'html-comment' | 'html-declaration' | 'html-entity' | 'html-operator'
  | 'yaml-key' | 'yaml-string' | 'yaml-number' | 'yaml-literal' | 'yaml-comment' | 'yaml-operator'
  | 'yaml-anchor' | 'yaml-alias' | 'yaml-tag' | 'yaml-document' | 'yaml-directive'
  | 'markdown-heading' | 'markdown-list' | 'markdown-quote' | 'markdown-rule' | 'markdown-code'
  | 'markdown-code-fence' | 'markdown-code-info' | 'markdown-link' | 'markdown-emphasis' | 'markdown-comment'
  | 'json-key' | 'json-string' | 'json-number' | 'json-literal' | 'json-punctuation';

export interface TextSyntaxToken {
  readonly start: number;
  readonly end: number;
  readonly kind: TextSyntaxTokenKind;
}

export interface TextSyntaxPreview {
  readonly tokens: readonly TextSyntaxToken[];
  readonly highlightedThrough: number;
  readonly isTruncated: boolean;
}

export interface ShellSyntaxContinuationState {
  readonly commandExpected: boolean;
  readonly commandPrefixPending: boolean;
  readonly commandPrefixOptionValueExpected: boolean;
  readonly shellAssignmentValuePending: boolean;
  readonly shellCommandPrefix: string | undefined;
  readonly insideShellTest: boolean;
}

export interface ShellSyntaxInputPreview extends TextSyntaxPreview {
  readonly continuationState?: ShellSyntaxContinuationState | undefined;
}

export type PowerShellExpectedClosingDelimiter = ')' | ']' | '}';

export interface PowerShellSyntaxContinuationState {
  readonly commandExpected: boolean;
  readonly previousTokenIsBareWord: boolean;
  readonly expectedClosingDelimiters?: readonly PowerShellExpectedClosingDelimiter[] | undefined;
}

export interface PowerShellSyntaxInputPreview extends TextSyntaxPreview {
  readonly continuationState?: PowerShellSyntaxContinuationState | undefined;
}

const shellKeywords = new Set(['!', '[[', ']]', 'case', 'do', 'done', 'elif', 'else', 'esac', 'fi', 'for', 'function', 'if', 'in', 'select', 'then', 'time', 'until', 'while']);
const commandContinuingKeywords = new Set(['!', 'case', 'do', 'elif', 'else', 'for', 'function', 'if', 'in', 'select', 'then', 'time', 'until', 'while']);
const shellBuiltins = new Set([
  '.', '[', 'alias', 'autoload', 'bg', 'bind', 'break', 'builtin', 'caller', 'cd', 'command', 'compgen', 'complete', 'continue',
  'declare', 'dirs', 'disown', 'echo', 'enable', 'eval', 'exec', 'exit', 'export', 'false', 'fc', 'fg', 'getopts', 'hash', 'help',
  'history', 'jobs', 'kill', 'let', 'limit', 'local', 'logout', 'mapfile', 'popd', 'printf', 'pushd', 'pwd', 'read', 'readarray',
  'readonly', 'rehash', 'return', 'set', 'shift', 'shopt', 'source', 'suspend', 'test', 'times', 'trap', 'true', 'type', 'typeset',
  'ulimit', 'umask', 'unalias', 'unlimit', 'unset', 'vared', 'wait', 'where', 'whence', 'zle', 'zmodload'
]);
const shellCommandPrefixes = new Set(['builtin', 'command', 'doas', 'env', 'exec', 'nice', 'nohup', 'sudo']);
const shellCommandPrefixOptionsWithValues: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  doas: new Set(['-C', '-u']),
  env: new Set(['-C', '--argv0', '--chdir', '--split-string', '--unset', '-S', '-a', '-u']),
  exec: new Set(['-a']),
  nice: new Set(['--adjustment', '-n']),
  sudo: new Set(['--chdir', '--close-from', '--group', '--host', '--other-user', '--prompt', '--role', '--type', '--user', '-C', '-D', '-g', '-h', '-p', '-R', '-r', '-t', '-u'])
});
const powershellKeywords = new Set([
  'begin', 'break', 'catch', 'class', 'continue', 'data', 'do', 'dynamicparam', 'else', 'elseif', 'end', 'enum', 'exit',
  'filter', 'finally', 'for', 'foreach', 'from', 'function', 'if', 'in', 'param', 'process', 'return', 'switch', 'throw',
  'trap', 'try', 'until', 'using', 'while', 'workflow'
]);
const powershellCommandDeclarationKeywords = new Set(['filter', 'function']);
const powershellWordOperators = new Set([
  '-and', '-as', '-band', '-bnot', '-bor', '-bxor', '-f', '-is', '-isnot', '-join', '-not', '-or', '-replace', '-shl',
  '-shr', '-split', '-xor',
  ...['contains', 'eq', 'ge', 'gt', 'in', 'le', 'like', 'lt', 'match', 'ne', 'notcontains', 'notin', 'notlike', 'notmatch']
    .flatMap(operator => ['', 'c', 'i'].map(prefix => `-${prefix}${operator}`))
]);
const powershellSymbolOperators = [
  '+=', '-=', '*=', '/=', '%=', '++', '--', '&&', '||', '??', '?.', '::', '..', '|', '&', '=', '+', '-', '*', '/', '%',
  '!', '<', '>', '{', '}', '(', ')', '[', ']', ':', ';', ',', '.'
] as const;
const powershellNaturalContinuationOperators = new Set([
  '|', '+', '-', '*', '/', '%', '=', '+=', '-=', '*=', '/=', '%=', '&&', '||', '??', ',',
  '-and', '-as', '-band', '-bor', '-bxor', '-contains', '-eq', '-f', '-ge', '-gt', '-in', '-is', '-isnot', '-join',
  '-le', '-like', '-lt', '-match', '-ne', '-notcontains', '-notin', '-notlike', '-notmatch', '-or', '-replace',
  '-shl', '-shr', '-split', '-xor'
]);
const pythonKeywords = new Set([
  'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except',
  'False', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'None', 'nonlocal', 'not',
  'or', 'pass', 'raise', 'return', 'True', 'try', 'while', 'with', 'yield'
]);
const pythonDeclarationKinds = new Map<string, 'python-function' | 'python-type'>([
  ['def', 'python-function'], ['class', 'python-type']
]);
const pythonBuiltins = new Set([
  'abs', 'aiter', 'all', 'anext', 'any', 'ascii', 'bin', 'bool', 'breakpoint', 'bytearray', 'bytes', 'callable', 'chr',
  'classmethod', 'compile', 'complex', 'delattr', 'dict', 'dir', 'divmod', 'enumerate', 'eval', 'exec', 'filter', 'float',
  'format', 'frozendict', 'frozenset', 'getattr', 'globals', 'hasattr', 'hash', 'help', 'hex', 'id', 'input', 'int',
  'isinstance', 'issubclass', 'iter', 'len', 'list', 'locals', 'map', 'max', 'memoryview', 'min', 'next', 'object', 'oct',
  'open', 'ord', 'pow', 'print', 'property', 'range', 'repr', 'reversed', 'round', 'set', 'setattr', 'sentinel', 'slice',
  'sorted', 'staticmethod', 'str', 'sum', 'super', 'tuple', 'type', 'vars', 'zip', '__import__'
]);
const pythonStringPrefixes = new Set(['b', 'br', 'f', 'fr', 'rb', 'rf', 'rt', 'r', 't', 'tr', 'u']);
const pythonOperators = [
  '**=', '//=', '<<=', '>>=', '...', '==', '!=', '<=', '>=', '->', ':=', '+=', '-=', '*=', '/=', '%=', '@=', '&=', '|=', '^=',
  '**', '//', '<<', '>>', '+', '-', '*', '/', '%', '@', '&', '|', '^', '~', '<', '>', '=', '(', ')', '[', ']', '{', '}', ',',
  ':', '.', ';'
] as const;
const javascriptKeywords = new Set([
  'abstract', 'as', 'assert', 'asserts', 'async', 'await', 'break', 'case', 'catch', 'class',
  'const', 'continue', 'debugger', 'declare', 'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false',
  'finally', 'for', 'from', 'function', 'if', 'implements', 'import', 'in', 'infer', 'instanceof', 'interface', 'is',
  'keyof', 'let', 'module', 'namespace', 'new', 'null', 'package', 'private', 'protected', 'public', 'readonly', 'return',
  'satisfies', 'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'type', 'typeof', 'unique', 'using', 'var',
  'while', 'with', 'yield'
]);
const javascriptTypeKeywords = new Set(['any', 'bigint', 'boolean', 'never', 'number', 'object', 'string', 'symbol', 'unknown', 'void']);
const javascriptDeclarationKinds = new Map<string, 'javascript-function' | 'javascript-type'>([
  ['class', 'javascript-type'], ['enum', 'javascript-type'], ['function', 'javascript-function'],
  ['interface', 'javascript-type'], ['type', 'javascript-type']
]);
const javascriptBuiltins = new Set([
  'Array', 'BigInt', 'Boolean', 'Date', 'Error', 'Function', 'Infinity', 'Intl', 'JSON', 'Map', 'Math', 'NaN', 'Number',
  'Object', 'Promise', 'Proxy', 'Reflect', 'RegExp', 'Set', 'String', 'Symbol', 'WeakMap', 'WeakSet', 'console',
  'globalThis', 'isFinite', 'isNaN', 'parseFloat', 'parseInt', 'undefined'
]);
const javascriptOperators = [
  '>>>=', '===', '!==', '**=', '&&=', '||=', '??=', '<<=', '>>=', '>>>', '...', '=>', '?.', '??', '&&', '||', '==', '!=',
  '<=', '>=', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>', '+', '-', '*', '/', '%', '&',
  '|', '^', '~', '!', '<', '>', '=', '?', ':', ';', ',', '.', '(', ')', '[', ']', '{', '}', '#'
] as const;
const sqlKeywords = new Set([
  'all', 'alter', 'analyze', 'and', 'any', 'array', 'as', 'asc', 'begin', 'between', 'by', 'case', 'cast', 'check',
  'collate', 'column', 'commit', 'conflict', 'constraint', 'copy', 'create', 'cross', 'current_date', 'current_time',
  'current_timestamp', 'database', 'default', 'delete', 'desc', 'distinct', 'do', 'drop', 'else', 'end', 'except',
  'exists', 'explain', 'fetch', 'for', 'foreign', 'from', 'full', 'grant', 'group', 'having', 'ilike', 'in', 'index',
  'inner', 'insert', 'intersect', 'into', 'is', 'join', 'key', 'lateral', 'left', 'like', 'limit', 'natural', 'not', 'nulls',
  'offset', 'on', 'only', 'or', 'order', 'outer', 'over', 'partition', 'primary', 'recursive', 'references',
  'returning', 'right', 'rollback', 'row', 'select', 'set', 'table', 'then', 'to', 'union', 'unique', 'update',
  'using', 'values', 'when', 'where', 'window', 'with'
]);
const sqlLiterals = new Set(['false', 'null', 'true']);
const sqlTypes = new Set([
  'bigint', 'bigserial', 'bit', 'bool', 'boolean', 'bytea', 'char', 'character', 'date', 'decimal', 'double', 'float',
  'inet', 'int', 'int2', 'int4', 'int8', 'integer', 'interval', 'json', 'jsonb', 'numeric', 'real', 'serial',
  'smallint', 'smallserial', 'text', 'time', 'timestamp', 'timestamptz', 'uuid', 'varchar', 'xml'
]);
const sqlFunctions = new Set([
  'abs', 'avg', 'array_agg', 'coalesce', 'concat', 'count', 'date_trunc', 'generate_series', 'greatest', 'json_agg',
  'jsonb_build_object', 'least', 'length', 'lower', 'max', 'min', 'now', 'round', 'string_agg', 'substring', 'sum', 'upper'
]);
const sqlOperators = [
  '!~~*', '!~~', '!~*', '#>>', '->>', '<<=', '>>=', '<=', '>=', '<>', '!=', '::', ':=', '=>', '->', '#>', '#-', '?|', '?&',
  '@>', '<@', '||', '&&', '~~*', '~~', '~*', '@?', '@@', '+', '-', '*', '/', '%', '=', '<', '>', '~', '!', '@', '#', '&',
  '|', '^', '?', ':', '.', ',', ';', '(', ')', '[', ']'
] as const;
const tomlLiterals = new Set(['false', 'inf', 'nan', 'true']);
const tomlDateTimePattern = /^(?:\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})?)?|\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/u;
const tomlSpaceDateTimePrefixPattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})?/u;
const tomlDecimalIntegerPattern = /^[+-]?(?:0|[1-9](?:_?\d)*)$/u;
const tomlDecimalFloatPattern = /^[+-]?(?:(?:0|[1-9](?:_?\d)*)(?:\.\d(?:_?\d)*)?(?:[eE][+-]?\d(?:_?\d)*)?)$/u;
const tomlBasedIntegerPattern = /^0(?:x[0-9A-Fa-f](?:_?[0-9A-Fa-f])*|o[0-7](?:_?[0-7])*|b[01](?:_?[01])*)$/u;
const yamlNulls = new Set(['null', 'Null', 'NULL', '~']);
const yamlBooleans = new Set(['true', 'True', 'TRUE', 'false', 'False', 'FALSE']);
const yamlIntegerPattern = /^[-+]?(?:0|[0-9]+)$/u;
const yamlOctalPattern = /^0o[0-7]+$/u;
const yamlHexPattern = /^0x[0-9A-Fa-f]+$/u;
const yamlFloatPattern = /^[-+]?(?:(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?)$/u;
const yamlInfinityPattern = /^[-+]?\.inf$/iu;
const yamlNanPattern = /^\.nan$/iu;

export function resolveTextSyntaxProfile(profile: TextSyntaxProfile, fileName: string): ResolvedTextSyntaxProfile {
  if (profile !== 'auto') return profile;
  const name = fileName.toLowerCase();
  if (/(?:^|[\\/])(?:\.env(?:\.[^\\/]+)?|[^\\/]+\.env)$/.test(name)) return 'dotenv';
  if (/\.properties$/.test(name)) return 'properties';
  if (/\.(?:md|markdown)$/.test(name)) return 'markdown';
  if (/\.(?:sql|pgsql|psql)$/.test(name)) return 'sql';
  if (/\.toml$/.test(name)) return 'toml';
  if (/\.(?:yaml|yml)$/.test(name)) return 'yaml';
  if (/\.(?:ini|cfg)$/.test(name)) return 'ini';
  if (/\.(?:xml|xsd|xsl|xslt|svg)$/.test(name)) return 'xml';
  if (/\.html?$/.test(name)) return 'html';
  if (/\.(?:ps1|psm1|psd1|pssc)$/.test(name)) return 'powershell';
  if (/\.(?:py|pyw|pyi)$/.test(name)) return 'python';
  if (/\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$/.test(name)) return 'javascript';
  if (/\.(?:sh|bash|zsh|ksh)$/.test(name)) return 'shell';
  if (/\.json$/.test(name)) return 'json';
  return 'plain';
}

export function highlightTextSyntax(text: string, profile: ResolvedTextSyntaxProfile): TextSyntaxPreview {
  const empty: readonly TextSyntaxToken[] = Object.freeze([]);
  if (profile === 'plain' || text.length === 0) return Object.freeze({ tokens: empty, highlightedThrough: text.length, isTruncated: false });
  if (profile === 'shell') return highlightShellInputSyntax(text);
  if (profile === 'powershell') return highlightPowerShellInputSyntax(text);

  let limit = Math.min(text.length, MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS);
  if (limit < text.length && isHighSurrogate(text.charCodeAt(limit - 1))) limit -= 1;
  const tokens: TextSyntaxToken[] = [];
  const scannedThrough = profile === 'markdown' ? scanMarkdown(text, limit, tokens)
      : profile === 'python' ? scanPython(text, limit, tokens)
        : profile === 'javascript' ? scanJavaScript(text, limit, tokens)
          : profile === 'sql' ? scanSql(text, limit, tokens)
            : profile === 'toml' ? scanToml(text, limit, tokens)
              : profile === 'yaml' ? scanYaml(text, limit, tokens)
                : profile === 'ini' ? scanIni(text, limit, tokens)
                  : profile === 'xml' ? scanXml(text, limit, tokens)
                      : profile === 'html' ? scanHtml(text, limit, tokens)
                        : profile === 'dotenv' ? scanDotenv(text, limit, tokens)
                          : profile === 'properties' ? scanProperties(text, limit, tokens)
                            : scanJson(text, limit, tokens);
  return Object.freeze({ tokens: Object.freeze(tokens), highlightedThrough: scannedThrough, isTruncated: scannedThrough < text.length });
}

export function highlightShellInputSyntax(text: string, initialState?: ShellSyntaxContinuationState): ShellSyntaxInputPreview {
  const empty: readonly TextSyntaxToken[] = Object.freeze([]);
  if (text.length === 0) return Object.freeze({ tokens: empty, highlightedThrough: 0, isTruncated: false });
  let limit = Math.min(text.length, MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS);
  if (limit < text.length && isHighSurrogate(text.charCodeAt(limit - 1))) limit -= 1;
  const tokens: TextSyntaxToken[] = [];
  const scan = scanShell(text, limit, tokens, initialState);
  return Object.freeze({ tokens: Object.freeze(tokens), highlightedThrough: scan.scannedThrough,
    isTruncated: scan.scannedThrough < text.length, continuationState: scan.continuationState });
}

export function highlightPowerShellInputSyntax(text: string, initialState?: PowerShellSyntaxContinuationState): PowerShellSyntaxInputPreview {
  const empty: readonly TextSyntaxToken[] = Object.freeze([]);
  if (text.length === 0) return Object.freeze({ tokens: empty, highlightedThrough: 0, isTruncated: false });
  let limit = Math.min(text.length, MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS);
  if (limit < text.length && isHighSurrogate(text.charCodeAt(limit - 1))) limit -= 1;
  const tokens: TextSyntaxToken[] = [];
  const scan = scanPowerShell(text, limit, tokens, initialState);
  return Object.freeze({ tokens: Object.freeze(tokens), highlightedThrough: scan.scannedThrough,
    isTruncated: scan.scannedThrough < text.length, continuationState: scan.continuationState });
}

interface ShellScanResult {
  readonly scannedThrough: number;
  readonly continuationState?: ShellSyntaxContinuationState | undefined;
}

interface PowerShellScanResult {
  readonly scannedThrough: number;
  readonly continuationState?: PowerShellSyntaxContinuationState | undefined;
}

interface ShellLineContinuationEnd {
  readonly end: number;
  readonly explicitEndOfInput: boolean;
}

function shellLineContinuationEnd(text: string, index: number, limit: number): ShellLineContinuationEnd | undefined {
  if (index > 0 && text[index - 1] === '\\') return undefined;
  let end = index;
  while (end < limit && text[end] === '\\') end += 1;
  if ((end - index) % 2 === 0) return undefined;
  if (end === limit) return limit === text.length ? { end, explicitEndOfInput: true } : undefined;
  if (text[end] === '\n') return { end: end + 1, explicitEndOfInput: false };
  if (text[end] === '\r') return { end: end + (text[end + 1] === '\n' ? 2 : 1), explicitEndOfInput: false };
  return undefined;
}

function scanShell(text: string, limit: number, tokens: TextSyntaxToken[], initialState?: ShellSyntaxContinuationState): ShellScanResult {
  let index = 0;
  let commandExpected = initialState?.commandExpected ?? true;
  let commandPrefixPending = initialState?.commandPrefixPending ?? false;
  let commandPrefixOptionValueExpected = initialState?.commandPrefixOptionValueExpected ?? false;
  let shellAssignmentValuePending = initialState?.shellAssignmentValuePending ?? false;
  let shellCommandPrefix = initialState?.shellCommandPrefix;
  let insideShellTest = initialState?.insideShellTest ?? false;
  let explicitLineContinuation = false;

  function resetCommandPrefix(): void {
    commandPrefixPending = false;
    commandPrefixOptionValueExpected = false;
    shellAssignmentValuePending = false;
    shellCommandPrefix = undefined;
  }

  function consumeShellCommandWord(): void {
    commandExpected = false;
    resetCommandPrefix();
  }

  while (index < limit) {
    const character = text[index]!;
    if (character === '\\') {
      const continuation = shellLineContinuationEnd(text, index, limit);
      if (continuation) {
        explicitLineContinuation = continuation.explicitEndOfInput && continuation.end === limit;
        index = continuation.end;
        continue;
      }
    }
    if (character === '\n' || character === '\r') {
      explicitLineContinuation = false;
      index += character === '\r' && text[index + 1] === '\n' ? 2 : 1;
      commandExpected = !insideShellTest;
      resetCommandPrefix();
      continue;
    }
    if (isWhitespace(character)) {
      explicitLineContinuation = false;
      shellAssignmentValuePending = false;
      index += 1;
      continue;
    }

    if (character === '#' && (index === 0 || isWhitespace(text[index - 1]!))) {
      const start = index;
      index = scanLineEnd(text, index, limit);
      if (!addToken(tokens, start, index, 'shell-comment')) return { scannedThrough: start };
      continue;
    }

    if (character === '\'' || character === '"') {
      const start = index;
      const quote = character;
      index += 1;
      while (index < limit) {
        if (text[index] === '\\' && quote === '"' && index + 1 < limit) { index += 2; continue; }
        if (text[index] === quote) { index += 1; break; }
        index += 1;
      }
      if (!addToken(tokens, start, index, 'shell-string')) return { scannedThrough: start };
      if (commandPrefixOptionValueExpected) commandPrefixOptionValueExpected = false;
      else if (!shellAssignmentValuePending && (commandExpected || commandPrefixPending)) consumeShellCommandWord();
      continue;
    }

    if (character === '$') {
      const end = scanShellVariable(text, index, limit);
      if (end > index + 1) {
        if (!addToken(tokens, index, end, 'shell-variable')) return { scannedThrough: index };
        index = end;
        if (commandPrefixOptionValueExpected) commandPrefixOptionValueExpected = false;
        else if (!shellAssignmentValuePending && (commandExpected || commandPrefixPending)) consumeShellCommandWord();
        continue;
      }
    }

    if (isShellOperator(character)) {
      const start = index;
      index = scanOperator(text, index, limit);
      if (!addToken(tokens, start, index, 'shell-operator')) return { scannedThrough: start };
      const operator = text.slice(start, index);
      if (!insideShellTest && (operator === ';' || operator === '|' || operator === '||' || operator === '&' || operator === '&&' || operator === '(')) {
        commandExpected = true;
        resetCommandPrefix();
      }
      continue;
    }

    const start = index;
    while (index < limit && !isWhitespace(text[index]!) && !isShellOperator(text[index]!) && !isQuote(text[index]!) && text[index] !== '$' &&
        !(text[index] === '\\' && shellLineContinuationEnd(text, index, limit) !== undefined)) index += 1;
    if (index === start) { index += 1; continue; }
    const word = text.slice(start, index);
    if (commandPrefixOptionValueExpected) {
      commandPrefixOptionValueExpected = false;
      continue;
    }
    if (word === ']]' && !insideShellTest) continue;
    if (shellAssignmentValuePending) continue;
    if (shellKeywords.has(word) && !commandPrefixPending &&
        ((commandExpected && word !== ']]') || (insideShellTest && (word === ']]' || word === '!')))) {
      if (!addToken(tokens, start, index, 'shell-keyword')) return { scannedThrough: start };
      if (word === '[[') {
        insideShellTest = true;
        commandExpected = false;
      } else if (word === ']]') {
        insideShellTest = false;
        commandExpected = false;
      } else {
        commandExpected = insideShellTest ? false : commandContinuingKeywords.has(word);
      }
      resetCommandPrefix();
    } else if ((commandExpected || commandPrefixPending) && isShellAssignment(word)) {
      const assignment = word.indexOf('=');
      if (!addToken(tokens, start, start + assignment, 'shell-variable')) return { scannedThrough: start };
      shellAssignmentValuePending = true;
    } else if (commandPrefixPending && word.startsWith('-') && word.length > 1) {
      if (!addToken(tokens, start, index, 'shell-option')) return { scannedThrough: start };
      commandPrefixOptionValueExpected = shellCommandPrefixOptionsWithValues[shellCommandPrefix ?? '']?.has(word) ?? false;
    } else if (commandExpected || commandPrefixPending) {
      const tokenKind = shellBuiltins.has(word) ? 'shell-builtin' : 'shell-command';
      if (!addToken(tokens, start, index, tokenKind)) return { scannedThrough: start };
      commandExpected = false;
      commandPrefixPending = shellCommandPrefixes.has(word);
      shellCommandPrefix = commandPrefixPending ? word : undefined;
    } else if (word.startsWith('-') && word.length > 1) {
      if (!addToken(tokens, start, index, 'shell-option')) return { scannedThrough: start };
    } else if (word.includes('/') || word.startsWith('~')) {
      if (!addToken(tokens, start, index, 'shell-path')) return { scannedThrough: start };
    }
  }
  const continuationState = explicitLineContinuation ? Object.freeze({ commandExpected, commandPrefixPending,
    commandPrefixOptionValueExpected, shellAssignmentValuePending, shellCommandPrefix, insideShellTest }) : undefined;
  return { scannedThrough: limit, continuationState };
}

function scanPowerShell(text: string, limit: number, tokens: TextSyntaxToken[], initialState?: PowerShellSyntaxContinuationState): PowerShellScanResult {
  let index = 0;
  let commandExpected = initialState?.commandExpected ?? true;
  let previousTokenIsBareWord = initialState?.previousTokenIsBareWord ?? false;
  const initialDelimiterState = copyPowerShellExpectedClosingDelimiters(initialState?.expectedClosingDelimiters);
  const expectedClosingDelimiters = initialDelimiterState.delimiters;
  let delimiterStateIsValid = initialDelimiterState.isValid;
  let hasIncompleteString = false;
  let hasIncompleteBlockComment = false;
  while (index < limit) {
    const character = text[index]!;
    if (isWhitespace(character)) {
      if (character === '\n' || character === '\r') commandExpected = true;
      previousTokenIsBareWord = false;
      index += 1;
      continue;
    }

    if (character === '<' && index + 1 < limit && text[index + 1] === '#' && previousTokenIsBareWord) {
      index += 2;
      continue;
    }

    if ((character === '#' || (character === '<' && index + 1 < limit && text[index + 1] === '#')) && !previousTokenIsBareWord) {
      const start = index;
      let end = limit;
      if (character === '#') {
        end = scanLineEnd(text, index, limit);
      } else {
        const close = findTextWithinLimit(text, '#>', index + 2, limit);
        if (close >= 0) end = close + 2;
        else hasIncompleteBlockComment = true;
      }
      if (!addToken(tokens, start, end, 'powershell-comment')) return { scannedThrough: start };
      if (character === '<' && /[\r\n]/u.test(text.slice(start, end))) commandExpected = true;
      previousTokenIsBareWord = false;
      index = end;
      continue;
    }

    const hereStringEnd = scanPowerShellHereString(text, index, limit);
    if (hereStringEnd !== undefined) {
      if (!addToken(tokens, index, hereStringEnd.end, 'powershell-string')) return { scannedThrough: index };
      hasIncompleteString ||= !hereStringEnd.isClosed;
      index = hereStringEnd.end;
      commandExpected = false;
      previousTokenIsBareWord = false;
      continue;
    }

    if (character === '\'' || character === '"') {
      const quotedString = scanPowerShellQuotedString(text, index, limit);
      if (!addToken(tokens, index, quotedString.end, 'powershell-string')) return { scannedThrough: index };
      hasIncompleteString ||= !quotedString.isClosed;
      index = quotedString.end;
      commandExpected = false;
      previousTokenIsBareWord = false;
      continue;
    }

    if (character === '$') {
      const end = scanPowerShellVariable(text, index, limit);
      if (end > index + 1 && !addToken(tokens, index, end, 'powershell-variable')) return { scannedThrough: index };
      index = Math.max(end, index + 1);
      commandExpected = false;
      previousTokenIsBareWord = false;
      continue;
    }

    if (isDigit(character)) {
      const end = scanPowerShellNumber(text, index, limit);
      if (!addToken(tokens, index, end, 'powershell-number')) return { scannedThrough: index };
      index = end;
      commandExpected = false;
      previousTokenIsBareWord = false;
      continue;
    }

    if (character === '[' && !isPowerShellEscapedAt(text, index)) {
      const end = scanPowerShellType(text, index, limit);
      if (end !== undefined) {
        if (!addToken(tokens, index, end, 'powershell-type')) return { scannedThrough: index };
        index = end;
        commandExpected = false;
        previousTokenIsBareWord = false;
        continue;
      }
    }

    if (character === '-' && index + 1 < limit && isPowerShellNameStart(text[index + 1]!)) {
      const end = scanPowerShellWord(text, index + 1, limit);
      const operator = `-${text.slice(index + 1, end).toLowerCase()}`;
      const kind = powershellWordOperators.has(operator) ? 'powershell-operator' : 'powershell-parameter';
      if (!addToken(tokens, index, end, kind)) return { scannedThrough: index };
      index = end;
      commandExpected = false;
      previousTokenIsBareWord = kind === 'powershell-parameter';
      continue;
    }

    const operatorEnd = scanPowerShellSymbolOperator(text, index, limit);
    if (operatorEnd > index) {
      const operator = text.slice(index, operatorEnd);
      if (!addToken(tokens, index, operatorEnd, 'powershell-operator')) return { scannedThrough: index };
      const isEscaped = isPowerShellEscapedAt(text, index);
      if (delimiterStateIsValid && !applyPowerShellDelimiterOperator(expectedClosingDelimiters, operator, isEscaped)) {
        delimiterStateIsValid = false;
      }
      index = operatorEnd;
      commandExpected = !isEscaped && isPowerShellCommandBoundary(operator);
      previousTokenIsBareWord = false;
      continue;
    }

    if (isPowerShellNameStart(character)) {
      const end = scanPowerShellWord(text, index, limit);
      const word = text.slice(index, end);
      const normalized = word.toLowerCase();
      if (powershellKeywords.has(normalized)) {
        if (!addToken(tokens, index, end, 'powershell-keyword')) return { scannedThrough: index };
        commandExpected = powershellCommandDeclarationKeywords.has(normalized);
      } else if (commandExpected) {
        if (!addToken(tokens, index, end, 'powershell-command')) return { scannedThrough: index };
        commandExpected = false;
      }
      previousTokenIsBareWord = true;
      index = end;
      continue;
    }

    index += 1;
  }
  const continuationStart = powershellLineContinuationStart(text, limit);
  const lastToken = tokens.at(-1);
  const isOpaqueContinuation = continuationStart !== undefined && lastToken !== undefined && lastToken.end === limit &&
    lastToken.start < limit && (lastToken.kind === 'powershell-string' || lastToken.kind === 'powershell-comment');
  const hasNaturalContinuation = limit === text.length && isPowerShellNaturalContinuation(text, limit, lastToken);
  const hasDelimiterContinuation = expectedClosingDelimiters.length > 0;
  const continuationState = delimiterStateIsValid && !hasIncompleteString && !hasIncompleteBlockComment &&
    ((continuationStart !== undefined && !isOpaqueContinuation) || hasNaturalContinuation || hasDelimiterContinuation) && limit === text.length
    ? Object.freeze({ commandExpected, previousTokenIsBareWord,
      ...(hasDelimiterContinuation ? { expectedClosingDelimiters: Object.freeze([...expectedClosingDelimiters]) } : {}) })
    : undefined;
  return { scannedThrough: limit, continuationState };
}

function copyPowerShellExpectedClosingDelimiters(value: unknown): {
  readonly delimiters: PowerShellExpectedClosingDelimiter[];
  readonly isValid: boolean;
} {
  if (value === undefined) return { delimiters: [], isValid: true };
  if (!Array.isArray(value) || value.length > MAX_POWERSHELL_CONTINUATION_DELIMITER_DEPTH) {
    return { delimiters: [], isValid: false };
  }
  const delimiters: PowerShellExpectedClosingDelimiter[] = [];
  for (const item of value as unknown[]) {
    if (item !== ')' && item !== ']' && item !== '}') return { delimiters: [], isValid: false };
    delimiters.push(item);
  }
  return { delimiters, isValid: true };
}

function applyPowerShellDelimiterOperator(stack: PowerShellExpectedClosingDelimiter[], operator: string, isEscaped: boolean): boolean {
  if (isEscaped) return true;
  const expectedCloser = operator === '(' ? ')' : operator === '[' ? ']' : operator === '{' ? '}' : undefined;
  if (expectedCloser) {
    if (stack.length >= MAX_POWERSHELL_CONTINUATION_DELIMITER_DEPTH) return false;
    stack.push(expectedCloser);
    return true;
  }
  if (operator !== ')' && operator !== ']' && operator !== '}') return true;
  if (stack.at(-1) !== operator) return false;
  stack.pop();
  return true;
}

function isPowerShellNaturalContinuation(text: string, limit: number, lastToken: TextSyntaxToken | undefined): boolean {
  if (!lastToken || lastToken.kind !== 'powershell-operator' || lastToken.end > limit) return false;
  if (text.slice(lastToken.end, limit).trim().length > 0) return false;
  if (isPowerShellEscapedAt(text, lastToken.start)) return false;
  return powershellNaturalContinuationOperators.has(text.slice(lastToken.start, lastToken.end).toLowerCase());
}

function isPowerShellEscapedAt(text: string, index: number): boolean {
  let backtickCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '`'; cursor -= 1) backtickCount += 1;
  return backtickCount % 2 === 1;
}

function powershellLineContinuationStart(text: string, limit: number): number | undefined {
  if (limit === 0 || text[limit - 1] !== '`') return undefined;
  let start = limit - 1;
  while (start > 0 && text[start - 1] === '`') start -= 1;
  return (limit - start) % 2 === 1 ? start : undefined;
}

interface PowerShellStringScanResult {
  readonly end: number;
  readonly isClosed: boolean;
}

function scanPowerShellHereString(text: string, start: number, limit: number): PowerShellStringScanResult | undefined {
  if (text[start] !== '@' || start + 1 >= limit || (text[start + 1] !== '\'' && text[start + 1] !== '"')) return undefined;
  const quote = text[start + 1]!;
  let lineStart = start + 2;
  if (lineStart >= limit) return undefined;
  if (text[lineStart] === '\r' && lineStart + 1 < limit && text[lineStart + 1] === '\n') lineStart += 2;
  else if (text[lineStart] === '\n' || text[lineStart] === '\r') lineStart += 1;
  else return undefined;

  const closingMark = `${quote}@`;
  while (lineStart < limit) {
    const lineEnd = scanLineEnd(text, lineStart, limit);
    if (lineEnd - lineStart === closingMark.length && text.startsWith(closingMark, lineStart)) return { end: lineEnd, isClosed: true };
    if (lineEnd >= limit) return { end: limit, isClosed: false };
    lineStart = lineEnd + (text[lineEnd] === '\r' && lineEnd + 1 < limit && text[lineEnd + 1] === '\n' ? 2 : 1);
  }
  return { end: limit, isClosed: false };
}

function scanPowerShellQuotedString(text: string, start: number, limit: number): PowerShellStringScanResult {
  const quote = text[start]!;
  let index = start + 1;
  let isClosed = false;
  while (index < limit) {
    if (quote === '"' && text[index] === '`' && index + 1 < limit) {
      index += 2;
      continue;
    }
    if (text[index] === quote) {
      if (quote === '\'' && index + 1 < limit && text[index + 1] === '\'') {
        index += 2;
        continue;
      }
      index += 1;
      isClosed = true;
      break;
    }
    index += 1;
  }
  return { end: index, isClosed };
}

function scanPowerShellVariable(text: string, start: number, limit: number): number {
  let index = start + 1;
  if (index < limit && text[index] === '{') {
    const scanLimit = Math.min(limit, index + MAX_POWERSHELL_NAME_SCAN_CODE_UNITS);
    while (index < scanLimit && text[index] !== '}' && text[index] !== '\n' && text[index] !== '\r') index += 1;
    return index < scanLimit && index < limit && text[index] === '}' ? index + 1 : start + 1;
  }
  if (index < limit && '?^!'.includes(text[index]!)) return index + 1;
  if (index >= limit || !isPowerShellNameStart(text[index]!)) return start + 1;

  index = scanPowerShellVariableName(text, index, limit);
  while (index + 1 < limit && text[index] === ':' && isPowerShellNameStart(text[index + 1]!)) {
    index = scanPowerShellVariableName(text, index + 1, limit);
  }
  return index;
}

function scanPowerShellVariableName(text: string, start: number, limit: number): number {
  let index = start + 1;
  while (index < limit && isPowerShellNamePart(text[index]!)) index += 1;
  return index;
}

function scanPowerShellNumber(text: string, start: number, limit: number): number {
  let index = start;
  if (index + 1 < limit && text[index] === '0' && (text[index + 1] === 'x' || text[index + 1] === 'X')) {
    index += 2;
    while (index < limit && (isDigit(text[index]!) || /[A-Fa-f_]/u.test(text[index]!))) index += 1;
    return index;
  }
  while (index < limit && (isDigit(text[index]!) || text[index] === '_')) index += 1;
  if (index + 1 < limit && text[index] === '.' && text[index + 1] !== '.' && isDigit(text[index + 1]!)) {
    index += 1;
    while (index < limit && (isDigit(text[index]!) || text[index] === '_')) index += 1;
  }
  if (index + 1 < limit && (text[index] === 'e' || text[index] === 'E') &&
      (isDigit(text[index + 1]!) || ((text[index + 1] === '+' || text[index + 1] === '-') && index + 2 < limit && isDigit(text[index + 2]!)))) {
    index += 1;
    if (text[index] === '+' || text[index] === '-') index += 1;
    while (index < limit && isDigit(text[index]!)) index += 1;
  }
  while (index < limit && /[A-Za-z]/u.test(text[index]!)) index += 1;
  return index;
}

function scanPowerShellType(text: string, start: number, limit: number): number | undefined {
  let index = start + 1;
  if (index >= limit || !isPowerShellNameStart(text[index]!)) return undefined;
  while (index < limit && index - start <= MAX_POWERSHELL_NAME_SCAN_CODE_UNITS &&
      (isPowerShellNamePart(text[index]!) || text[index] === '.' || text[index] === '+')) index += 1;
  if (index + 2 < limit && text[index] === '[' && text[index + 1] === ']' && text[index + 2] === ']') return index + 3;
  return index < limit && text[index] === ']' ? index + 1 : undefined;
}

function scanPowerShellWord(text: string, start: number, limit: number): number {
  let index = start + 1;
  while (index < limit && (isPowerShellNamePart(text[index]!) || text[index] === '-')) index += 1;
  return index;
}

function scanPowerShellSymbolOperator(text: string, start: number, limit: number): number {
  for (const operator of powershellSymbolOperators) {
    if (start + operator.length <= limit && text.startsWith(operator, start)) return start + operator.length;
  }
  return start;
}

function isPowerShellCommandBoundary(operator: string): boolean {
  return operator === '|' || operator === '||' || operator === '&&' || operator === ';' || operator === '&' ||
    operator === '=' || operator === '+=' ||
    operator === '-=' || operator === '*=' || operator === '/=' || operator === '%=' || operator === '{' ||
    operator === '}' || operator === '(' || operator === ',';
}

function isPowerShellNameStart(character: string): boolean {
  return character === '_' || (character >= 'A' && character <= 'Z') || (character >= 'a' && character <= 'z');
}

function isPowerShellNamePart(character: string): boolean {
  return isPowerShellNameStart(character) || isDigit(character);
}

function scanLineEnd(text: string, start: number, limit: number): number {
  let index = start;
  while (index < limit && text[index] !== '\n' && text[index] !== '\r') index += 1;
  return index;
}

function scanPython(text: string, limit: number, tokens: TextSyntaxToken[]): number {
  let index = 0;
  let declarationKind: 'python-function' | 'python-type' | undefined;
  while (index < limit) {
    const character = text[index]!;
    if (isWhitespace(character)) {
      if (character === '\n' || character === '\r') declarationKind = undefined;
      index += 1;
      continue;
    }

    if (character === '#') {
      const end = scanLineEnd(text, index, limit);
      if (!addToken(tokens, index, end, 'python-comment')) return index;
      index = end;
      continue;
    }

    const stringEnd = scanPythonString(text, index, limit);
    if (stringEnd !== undefined) {
      if (!addToken(tokens, index, stringEnd, 'python-string')) return index;
      index = stringEnd;
      declarationKind = undefined;
      continue;
    }

    if (isDigit(character) || (character === '.' && index + 1 < limit && isDigit(text[index + 1]!))) {
      const end = scanPythonNumber(text, index, limit);
      if (!addToken(tokens, index, end, 'python-number')) return index;
      index = end;
      declarationKind = undefined;
      continue;
    }

    if (isPythonNameStart(character)) {
      const end = scanPythonName(text, index, limit);
      const word = text.slice(index, end);
      const declarationToken = declarationKind;
      if (pythonKeywords.has(word)) {
        if (!addToken(tokens, index, end, 'python-keyword')) return index;
        declarationKind = pythonDeclarationKinds.get(word);
      } else if (declarationToken !== undefined) {
        if (!addToken(tokens, index, end, declarationToken)) return index;
        declarationKind = undefined;
      } else if (pythonBuiltins.has(word)) {
        if (!addToken(tokens, index, end, 'python-builtin')) return index;
      } else {
        declarationKind = undefined;
      }
      index = end;
      continue;
    }

    const operatorEnd = scanPythonOperator(text, index, limit);
    if (operatorEnd > index) {
      if (!addToken(tokens, index, operatorEnd, 'python-operator')) return index;
      index = operatorEnd;
      declarationKind = undefined;
      continue;
    }

    index += 1;
    declarationKind = undefined;
  }
  return limit;
}

function scanPythonString(text: string, start: number, limit: number): number | undefined {
  let quoteStart = start;
  const initial = text[start]!;
  if (initial !== '\'' && initial !== '"') {
    let prefixEnd = start;
    while (prefixEnd < limit && prefixEnd - start < 2 && isPythonNameStart(text[prefixEnd]!)) prefixEnd += 1;
    if (!pythonStringPrefixes.has(text.slice(start, prefixEnd).toLowerCase()) || prefixEnd >= limit ||
        (text[prefixEnd] !== '\'' && text[prefixEnd] !== '"')) return undefined;
    quoteStart = prefixEnd;
  }

  const quote = text[quoteStart]!;
  const triple = quoteStart + 2 < limit && text[quoteStart + 1] === quote && text[quoteStart + 2] === quote;
  let index = quoteStart + (triple ? 3 : 1);
  while (index < limit) {
    if (text[index] === '\\') {
      index += index + 1 < limit ? 2 : 1;
      continue;
    }
    if (triple) {
      if (index + 2 < limit && text[index] === quote && text[index + 1] === quote && text[index + 2] === quote) {
        index += 3;
        break;
      }
    } else {
      if (text[index] === quote) {
        index += 1;
        break;
      }
      if (text[index] === '\n' || text[index] === '\r') break;
    }
    index += 1;
  }
  return index;
}

function scanPythonNumber(text: string, start: number, limit: number): number {
  let index = start;
  if (text[index] === '.' && index + 1 < limit && isDigit(text[index + 1]!)) {
    index += 1;
    while (index < limit && (isDigit(text[index]!) || text[index] === '_')) index += 1;
  } else if (index + 1 < limit && text[index] === '0') {
    const basePrefix = text[index + 1]!.toLowerCase();
    if (basePrefix === 'b' || basePrefix === 'o' || basePrefix === 'x') {
      index += 2;
      while (index < limit && (text[index] === '_' ||
          (basePrefix === 'x' && isHexDigit(text[index]!)) ||
          (basePrefix === 'o' && text[index]! >= '0' && text[index]! <= '7') ||
          (basePrefix === 'b' && (text[index] === '0' || text[index] === '1')))) index += 1;
      return index;
    }
    while (index < limit && (isDigit(text[index]!) || text[index] === '_')) index += 1;
  } else {
    while (index < limit && (isDigit(text[index]!) || text[index] === '_')) index += 1;
  }

  if (index < limit && text[index] === '.' && (index + 1 >= limit || text[index + 1] !== '.')) {
    index += 1;
    while (index < limit && (isDigit(text[index]!) || text[index] === '_')) index += 1;
  }
  if (index + 1 < limit && (text[index] === 'e' || text[index] === 'E')) {
    let exponentStart = index + 1;
    if (text[exponentStart] === '+' || text[exponentStart] === '-') exponentStart += 1;
    if (exponentStart < limit && isDigit(text[exponentStart]!)) {
      index = exponentStart + 1;
      while (index < limit && (isDigit(text[index]!) || text[index] === '_')) index += 1;
    }
  }
  if (index < limit && (text[index] === 'j' || text[index] === 'J')) index += 1;
  return index;
}

function scanPythonName(text: string, start: number, limit: number): number {
  let index = start + 1;
  while (index < limit && (isPythonNameStart(text[index]!) || isDigit(text[index]!))) index += 1;
  return index;
}

function scanPythonOperator(text: string, start: number, limit: number): number {
  for (const operator of pythonOperators) {
    if (start + operator.length <= limit && text.startsWith(operator, start)) return start + operator.length;
  }
  return start;
}

function isPythonNameStart(character: string): boolean {
  return character === '_' || (character >= 'A' && character <= 'Z') || (character >= 'a' && character <= 'z');
}

function isHexDigit(character: string): boolean {
  return isDigit(character) || (character >= 'A' && character <= 'F') || (character >= 'a' && character <= 'f');
}

function scanJavaScript(text: string, limit: number, tokens: TextSyntaxToken[]): number {
  let index = 0;
  let declarationKind: 'javascript-function' | 'javascript-type' | undefined;
  while (index < limit) {
    const character = text[index]!;
    if (isWhitespace(character)) { index += 1; continue; }

    if (character === '/' && index + 1 < limit && text[index + 1] === '/') {
      const end = scanLineEnd(text, index, limit);
      if (!addToken(tokens, index, end, 'javascript-comment')) return index;
      index = end;
      continue;
    }

    if (character === '/' && index + 1 < limit && text[index + 1] === '*') {
      const terminator = findTextWithinLimit(text, '*/', index + 2, limit);
      const end = terminator < 0 ? limit : terminator + 2;
      if (!addToken(tokens, index, end, 'javascript-comment')) return index;
      index = end;
      continue;
    }

    if (character === '\'' || character === '"' || character === '`') {
      const end = scanJavaScriptString(text, index, limit);
      if (!addToken(tokens, index, end, 'javascript-string')) return index;
      index = end;
      declarationKind = undefined;
      continue;
    }

    if (isDigit(character) || (character === '.' && index + 1 < limit && isDigit(text[index + 1]!))) {
      const end = scanJavaScriptNumber(text, index, limit);
      if (!addToken(tokens, index, end, 'javascript-number')) return index;
      index = end;
      declarationKind = undefined;
      continue;
    }

    if (isJavaScriptNameStart(character)) {
      const end = scanJavaScriptName(text, index, limit);
      const word = text.slice(index, end);
      const declarationToken = declarationKind;
      if (javascriptKeywords.has(word)) {
        if (!addToken(tokens, index, end, 'javascript-keyword')) return index;
        declarationKind = javascriptDeclarationKinds.get(word);
      } else if (declarationToken !== undefined) {
        if (!addToken(tokens, index, end, declarationToken)) return index;
        declarationKind = undefined;
      } else if (javascriptTypeKeywords.has(word)) {
        if (!addToken(tokens, index, end, 'javascript-type')) return index;
      } else if (javascriptBuiltins.has(word)) {
        if (!addToken(tokens, index, end, 'javascript-builtin')) return index;
      } else {
        declarationKind = undefined;
      }
      index = end;
      continue;
    }

    const operatorEnd = scanJavaScriptOperator(text, index, limit);
    if (operatorEnd > index) {
      const operator = text.slice(index, operatorEnd);
      if (!addToken(tokens, index, operatorEnd, 'javascript-operator')) return index;
      index = operatorEnd;
      if (!(declarationKind === 'javascript-function' && operator === '*')) declarationKind = undefined;
      continue;
    }

    index += 1;
    declarationKind = undefined;
  }
  return limit;
}

function scanJavaScriptString(text: string, start: number, limit: number): number {
  const quote = text[start]!;
  let index = start + 1;
  while (index < limit) {
    if (text[index] === '\\') {
      if (index + 1 < limit && text[index + 1] === '\r' && index + 2 < limit && text[index + 2] === '\n') index += 3;
      else index += index + 1 < limit ? 2 : 1;
      continue;
    }
    if (text[index] === quote) { index += 1; break; }
    if (quote !== '`' && (text[index] === '\n' || text[index] === '\r')) break;
    index += 1;
  }
  return index;
}

function scanJavaScriptNumber(text: string, start: number, limit: number): number {
  let index = start;
  let hasFraction = false;
  let hasExponent = false;
  if (text[index] === '.' && index + 1 < limit && isDigit(text[index + 1]!)) {
    index += 1;
    while (index < limit && (isDigit(text[index]!) || text[index] === '_')) index += 1;
    hasFraction = true;
  } else if (index + 1 < limit && text[index] === '0') {
    const basePrefix = text[index + 1]!.toLowerCase();
    if (basePrefix === 'b' || basePrefix === 'o' || basePrefix === 'x') {
      index += 2;
      while (index < limit && (text[index] === '_' ||
          (basePrefix === 'x' && isHexDigit(text[index]!)) ||
          (basePrefix === 'o' && text[index]! >= '0' && text[index]! <= '7') ||
          (basePrefix === 'b' && (text[index] === '0' || text[index] === '1')))) index += 1;
      if (index < limit && text[index] === 'n') index += 1;
      return index;
    }
    while (index < limit && (isDigit(text[index]!) || text[index] === '_')) index += 1;
  } else {
    while (index < limit && (isDigit(text[index]!) || text[index] === '_')) index += 1;
  }

  if (!hasFraction && index < limit && text[index] === '.' &&
      !(index + 2 < limit && text[index + 1] === '.' && text[index + 2] === '.')) {
    index += 1;
    while (index < limit && (isDigit(text[index]!) || text[index] === '_')) index += 1;
    hasFraction = true;
  }
  if (index + 1 < limit && (text[index] === 'e' || text[index] === 'E')) {
    let exponentStart = index + 1;
    if (text[exponentStart] === '+' || text[exponentStart] === '-') exponentStart += 1;
    if (exponentStart < limit && isDigit(text[exponentStart]!)) {
      index = exponentStart + 1;
      while (index < limit && (isDigit(text[index]!) || text[index] === '_')) index += 1;
      hasExponent = true;
    }
  }
  if (!hasFraction && !hasExponent && index < limit && text[index] === 'n') index += 1;
  return index;
}

function scanJavaScriptName(text: string, start: number, limit: number): number {
  let index = start + 1;
  while (index < limit && isJavaScriptNamePart(text[index]!)) index += 1;
  return index;
}

function scanJavaScriptOperator(text: string, start: number, limit: number): number {
  for (const operator of javascriptOperators) {
    if (start + operator.length <= limit && text.startsWith(operator, start)) return start + operator.length;
  }
  return start;
}

function isJavaScriptNameStart(character: string): boolean {
  return character === '_' || character === '$' || (character >= 'A' && character <= 'Z') || (character >= 'a' && character <= 'z');
}

function isJavaScriptNamePart(character: string): boolean {
  return isJavaScriptNameStart(character) || isDigit(character);
}

function findTextWithinLimit(text: string, target: string, start: number, limit: number): number {
  for (let index = start; index + target.length <= limit; index += 1) {
    if (text.startsWith(target, index)) return index;
  }
  return -1;
}

function scanSql(text: string, limit: number, tokens: TextSyntaxToken[]): number {
  let index = 0;
  while (index < limit) {
    const character = text[index]!;
    if (isWhitespace(character)) { index += 1; continue; }

    if (character === '-' && index + 1 < limit && text[index + 1] === '-') {
      const end = scanLineEnd(text, index, limit);
      if (!addToken(tokens, index, end, 'sql-comment')) return index;
      index = end;
      continue;
    }

    if (character === '/' && index + 1 < limit && text[index + 1] === '*') {
      const end = scanSqlBlockComment(text, index, limit);
      if (!addToken(tokens, index, end, 'sql-comment')) return index;
      index = end;
      continue;
    }

    const stringEnd = scanSqlString(text, index, limit);
    if (stringEnd !== undefined) {
      if (!addToken(tokens, index, stringEnd, 'sql-string')) return index;
      index = stringEnd;
      continue;
    }

    if (character === '"') {
      const end = scanSqlQuotedIdentifier(text, index, limit);
      if (!addToken(tokens, index, end, 'sql-identifier')) return index;
      index = end;
      continue;
    }

    if (character === '$') {
      const stringEnd = scanSqlDollarQuotedString(text, index, limit);
      if (stringEnd !== undefined) {
        if (!addToken(tokens, index, stringEnd, 'sql-string')) return index;
        index = stringEnd;
        continue;
      }
      if (index + 1 < limit && isDigit(text[index + 1]!)) {
        let end = index + 2;
        while (end < limit && isDigit(text[end]!)) end += 1;
        if (!addToken(tokens, index, end, 'sql-parameter')) return index;
        index = end;
        continue;
      }
    }

    if (isDigit(character) || (character === '.' && index + 1 < limit && isDigit(text[index + 1]!))) {
      const end = scanSqlNumber(text, index, limit);
      if (!addToken(tokens, index, end, 'sql-number')) return index;
      index = end;
      continue;
    }

    if (isSqlNameStart(character)) {
      const end = scanSqlName(text, index, limit);
      const word = text.slice(index, end).toLowerCase();
      const kind = sqlLiterals.has(word) ? 'sql-literal'
        : sqlKeywords.has(word) ? 'sql-keyword'
          : sqlTypes.has(word) ? 'sql-type'
            : sqlFunctions.has(word) && isSqlFunctionCall(text, end, limit) ? 'sql-function'
              : undefined;
      if (kind && !addToken(tokens, index, end, kind)) return index;
      index = end;
      continue;
    }

    const operatorEnd = scanSqlOperator(text, index, limit);
    if (operatorEnd > index) {
      if (!addToken(tokens, index, operatorEnd, 'sql-operator')) return index;
      index = operatorEnd;
      continue;
    }

    index += 1;
  }
  return limit;
}

function scanSqlBlockComment(text: string, start: number, limit: number): number {
  let index = start + 2;
  let depth = 1;
  while (index + 1 < limit) {
    if (text[index] === '/' && text[index + 1] === '*') {
      depth += 1;
      index += 2;
      continue;
    }
    if (text[index] === '*' && text[index + 1] === '/') {
      depth -= 1;
      index += 2;
      if (depth === 0) return index;
      continue;
    }
    index += 1;
  }
  return limit;
}

function scanSqlString(text: string, start: number, limit: number): number | undefined {
  let quoteStart = start;
  let backslashEscapes = false;
  const character = text[start]!;
  if ((character === 'e' || character === 'E') && start + 1 < limit && text[start + 1] === '\'' &&
      (start === 0 || !isSqlNamePart(text[start - 1]!))) {
    quoteStart = start + 1;
    backslashEscapes = true;
  } else if ((character === 'b' || character === 'B' || character === 'x' || character === 'X') &&
      start + 1 < limit && text[start + 1] === '\'' && (start === 0 || !isSqlNamePart(text[start - 1]!))) {
    quoteStart = start + 1;
  } else if (character !== '\'') {
    return undefined;
  }

  let index = quoteStart + 1;
  while (index < limit) {
    if (backslashEscapes && text[index] === '\\') {
      index += index + 1 < limit ? 2 : 1;
      continue;
    }
    if (text[index] === '\'') {
      if (index + 1 < limit && text[index + 1] === '\'') { index += 2; continue; }
      return index + 1;
    }
    index += 1;
  }
  return limit;
}

function scanSqlQuotedIdentifier(text: string, start: number, limit: number): number {
  let index = start + 1;
  while (index < limit) {
    if (text[index] === '"') {
      if (index + 1 < limit && text[index + 1] === '"') { index += 2; continue; }
      return index + 1;
    }
    index += 1;
  }
  return limit;
}

function scanSqlDollarQuotedString(text: string, start: number, limit: number): number | undefined {
  let tagEnd = start + 1;
  if (tagEnd < limit && text[tagEnd] !== '$') {
    if (!isSqlNameStart(text[tagEnd]!)) return undefined;
    tagEnd += 1;
    while (tagEnd < limit && isSqlDollarTagPart(text[tagEnd]!)) tagEnd += 1;
    if (tagEnd - start - 1 > MAX_SQL_DOLLAR_TAG_CODE_UNITS) return undefined;
    if (tagEnd >= limit || text[tagEnd] !== '$') return undefined;
  }
  if (tagEnd >= limit || text[tagEnd] !== '$') return undefined;

  const delimiterEnd = tagEnd + 1;
  const delimiter = text.slice(start, delimiterEnd);
  const terminator = findTextWithinLimit(text, delimiter, delimiterEnd, limit);
  return terminator < 0 ? limit : terminator + delimiter.length;
}

function scanSqlNumber(text: string, start: number, limit: number): number {
  let index = start;
  if (text[index] === '.') index += 1;
  while (index < limit && isDigit(text[index]!)) index += 1;
  if (text[index] === '.') {
    index += 1;
    while (index < limit && isDigit(text[index]!)) index += 1;
  }
  if (index < limit && (text[index] === 'e' || text[index] === 'E')) {
    let exponentEnd = index + 1;
    if (text[exponentEnd] === '+' || text[exponentEnd] === '-') exponentEnd += 1;
    if (exponentEnd < limit && isDigit(text[exponentEnd]!)) {
      index = exponentEnd + 1;
      while (index < limit && isDigit(text[index]!)) index += 1;
    }
  }
  return index;
}

function scanSqlName(text: string, start: number, limit: number): number {
  let index = start + 1;
  while (index < limit && isSqlNamePart(text[index]!)) index += 1;
  return index;
}

function scanSqlOperator(text: string, start: number, limit: number): number {
  for (const operator of sqlOperators) {
    if (start + operator.length <= limit && text.startsWith(operator, start)) return start + operator.length;
  }
  return start;
}

function isSqlFunctionCall(text: string, end: number, limit: number): boolean {
  let index = end;
  while (index < limit && isWhitespace(text[index]!)) index += 1;
  return index < limit && text[index] === '(';
}

function isSqlNameStart(character: string): boolean {
  return character === '_' || (character >= 'A' && character <= 'Z') || (character >= 'a' && character <= 'z');
}

function isSqlNamePart(character: string): boolean {
  return isSqlNameStart(character) || isDigit(character) || character === '$';
}

function isSqlDollarTagPart(character: string): boolean {
  return isSqlNameStart(character) || isDigit(character);
}

function scanToml(text: string, limit: number, tokens: TextSyntaxToken[]): number {
  let index = 0;
  let lineHasContent = false;
  let inTableHeader = false;
  let collectionDepth = 0;

  while (index < limit) {
    const character = text[index]!;
    if (character === '\n' || character === '\r') {
      index += character === '\r' && index + 1 < limit && text[index + 1] === '\n' ? 2 : 1;
      lineHasContent = false;
      inTableHeader = false;
      continue;
    }
    if (character === ' ' || character === '\t') { index += 1; continue; }

    if (character === '#') {
      const end = scanLineEnd(text, index, limit);
      if (!addToken(tokens, index, end, 'toml-comment')) return index;
      index = end;
      lineHasContent = true;
      continue;
    }

    if (character === '"' || character === '\'') {
      const end = scanTomlString(text, index, limit);
      const kind = inTableHeader || isTomlKeyAssignment(text, end, limit) ? 'toml-key' : 'toml-string';
      if (!addToken(tokens, index, end, kind)) return index;
      index = end;
      lineHasContent = true;
      continue;
    }

    if (isTomlBareKeyCharacter(character) || character === '+') {
      let end = index + 1;
      while (end < limit && isTomlBareKeyCharacter(text[end]!)) end += 1;
      if (inTableHeader || isTomlKeyAssignment(text, end, limit)) {
        if (!addToken(tokens, index, end, 'toml-key')) return index;
      } else {
        const scalarEnd = scanTomlScalar(text, index, limit);
        const scalar = text.slice(index, scalarEnd);
        const signedLiteral = /^[+-](?:inf|nan)$/u.test(scalar);
        const kind = tomlLiterals.has(scalar) || signedLiteral ? 'toml-literal'
          : tomlDateTimePattern.test(scalar) ? 'toml-datetime'
            : tomlDecimalIntegerPattern.test(scalar) || tomlDecimalFloatPattern.test(scalar) || tomlBasedIntegerPattern.test(scalar)
              ? 'toml-number' : undefined;
        if (kind && !addToken(tokens, index, scalarEnd, kind)) return index;
        end = scalarEnd;
      }
      index = end;
      lineHasContent = true;
      continue;
    }

    if (character === '[') {
      const isTableHeader = !lineHasContent && collectionDepth === 0;
      const end = index + (text[index + 1] === '[' && index + 1 < limit ? 2 : 1);
      if (isTableHeader) inTableHeader = true;
      else collectionDepth += 1;
      if (!addToken(tokens, index, end, 'toml-operator')) return index;
      index = end;
      lineHasContent = true;
      continue;
    }

    if (character === ']') {
      const isArrayTableClose = inTableHeader && index + 1 < limit && text[index + 1] === ']';
      const end = index + (isArrayTableClose ? 2 : 1);
      if (inTableHeader) inTableHeader = false;
      else collectionDepth = Math.max(0, collectionDepth - 1);
      if (!addToken(tokens, index, end, 'toml-operator')) return index;
      index = end;
      lineHasContent = true;
      continue;
    }

    if (character === '{') collectionDepth += 1;
    else if (character === '}') collectionDepth = Math.max(0, collectionDepth - 1);
    if ('={}.,}'.includes(character)) {
      if (!addToken(tokens, index, index + 1, 'toml-operator')) return index;
    }
    index += 1;
    lineHasContent = true;
  }
  return limit;
}

function scanIni(text: string, limit: number, tokens: TextSyntaxToken[]): number {
  let lineStart = 0;
  while (lineStart < limit) {
    const lineEnd = scanLineEnd(text, lineStart, limit);
    let contentStart = lineStart;
    while (contentStart < lineEnd && (text[contentStart] === ' ' || text[contentStart] === '\t')) contentStart += 1;

    if (contentStart < lineEnd && (text[contentStart] === ';' || text[contentStart] === '#')) {
      if (!addToken(tokens, contentStart, lineEnd, 'ini-comment')) return contentStart;
    } else if (contentStart < lineEnd && text[contentStart] === '[') {
      let close = contentStart + 1;
      while (close < lineEnd && text[close] !== ']') close += 1;
      if (close < lineEnd && close > contentStart + 1) {
        let trailing = close + 1;
        while (trailing < lineEnd && (text[trailing] === ' ' || text[trailing] === '\t')) trailing += 1;
        if (trailing === lineEnd && !addToken(tokens, contentStart, close + 1, 'ini-section')) return contentStart;
      }
    } else if (contentStart < lineEnd) {
      let separator = contentStart;
      while (separator < lineEnd && text[separator] !== '=' && text[separator] !== ':') separator += 1;
      if (separator < lineEnd) {
        let keyEnd = separator;
        while (keyEnd > contentStart && (text[keyEnd - 1] === ' ' || text[keyEnd - 1] === '\t')) keyEnd -= 1;
        if (keyEnd > contentStart) {
          if (!addToken(tokens, contentStart, keyEnd, 'ini-key')) return contentStart;
          if (!addToken(tokens, separator, separator + 1, 'ini-operator')) return separator;

          let valueStart = separator + 1;
          while (valueStart < lineEnd && (text[valueStart] === ' ' || text[valueStart] === '\t')) valueStart += 1;
          let valueEnd = lineEnd;
          while (valueEnd > valueStart && (text[valueEnd - 1] === ' ' || text[valueEnd - 1] === '\t')) valueEnd -= 1;
          if (valueStart < valueEnd) {
            if (text[valueStart] === '"' || text[valueStart] === '\'') {
              const stringEnd = scanIniQuotedValue(text, valueStart, valueEnd);
              if (stringEnd === valueEnd && !addToken(tokens, valueStart, stringEnd, 'ini-string')) return valueStart;
            } else {
              const value = text.slice(valueStart, valueEnd);
              const literal = iniLiterals.has(value.toLowerCase());
              if (literal && !addToken(tokens, valueStart, valueEnd, 'ini-literal')) return valueStart;
              if (!literal && iniNumberPattern.test(value) && !addToken(tokens, valueStart, valueEnd, 'ini-number')) return valueStart;
            }
          }
        }
      }
    }

    if (lineEnd >= limit) break;
    lineStart = lineEnd + (text[lineEnd] === '\r' && lineEnd + 1 < limit && text[lineEnd + 1] === '\n' ? 2 : 1);
  }
  return limit;
}

function scanIniQuotedValue(text: string, start: number, end: number): number {
  const quote = text[start]!;
  let index = start + 1;
  while (index < end) {
    if (text[index] === '\\') { index += index + 1 < end ? 2 : 1; continue; }
    if (text[index] === quote) return index + 1;
    index += 1;
  }
  return start;
}

function scanDotenv(text: string, limit: number, tokens: TextSyntaxToken[]): number {
  let lineStart = 0;
  while (lineStart < limit) {
    const lineEnd = scanLineEnd(text, lineStart, limit);
    if (lineEnd === limit && limit < text.length) return lineStart;
    let contentStart = lineStart;
    while (contentStart < lineEnd && (text[contentStart] === ' ' || text[contentStart] === '\t')) contentStart += 1;

    if (contentStart < lineEnd && text[contentStart] === '#') {
      if (!addToken(tokens, contentStart, lineEnd, 'dotenv-comment')) return contentStart;
    } else if (contentStart < lineEnd) {
      let keyStart = contentStart;
      const exportEnd = contentStart + 'export'.length;
      const hasExport = text.startsWith('export', contentStart) && exportEnd < lineEnd &&
        (text[exportEnd] === ' ' || text[exportEnd] === '\t');
      if (hasExport) {
        keyStart = exportEnd;
        while (keyStart < lineEnd && (text[keyStart] === ' ' || text[keyStart] === '\t')) keyStart += 1;
      }

      const keyEnd = scanDotenvKey(text, keyStart, lineEnd);
      let separator = keyEnd;
      while (separator < lineEnd && (text[separator] === ' ' || text[separator] === '\t')) separator += 1;
      if (keyEnd > keyStart && text[separator] === '=') {
        if (hasExport && !addToken(tokens, contentStart, exportEnd, 'dotenv-export')) return contentStart;
        if (!addToken(tokens, keyStart, keyEnd, 'dotenv-key')) return keyStart;
        if (!addToken(tokens, separator, separator + 1, 'dotenv-operator')) return separator;
        const stop = scanDotenvValue(text, separator + 1, lineEnd, tokens);
        if (stop !== undefined) return stop;
      }
    }

    if (lineEnd >= limit) break;
    lineStart = lineEnd + (text[lineEnd] === '\r' && lineEnd + 1 < limit && text[lineEnd + 1] === '\n' ? 2 : 1);
  }
  return limit;
}

function scanDotenvKey(text: string, start: number, end: number): number {
  if (start >= end || !isDotenvKeyStart(text.charCodeAt(start))) return start;
  let index = start + 1;
  while (index < end && isDotenvKeyPart(text.charCodeAt(index))) index += 1;
  return index;
}

function isDotenvKeyStart(unit: number): boolean {
  return unit === 95 || (unit >= 65 && unit <= 90) || (unit >= 97 && unit <= 122);
}

function isDotenvKeyPart(unit: number): boolean {
  return isDotenvKeyStart(unit) || (unit >= 48 && unit <= 57);
}

function scanDotenvValue(text: string, start: number, end: number, tokens: TextSyntaxToken[]): number | undefined {
  let valueStart = start;
  while (valueStart < end && (text[valueStart] === ' ' || text[valueStart] === '\t')) valueStart += 1;
  let valueEnd = end;
  while (valueEnd > valueStart && (text[valueEnd - 1] === ' ' || text[valueEnd - 1] === '\t')) valueEnd -= 1;
  if (valueStart >= valueEnd) return undefined;

  if (text[valueStart] === '"' || text[valueStart] === "'") {
    const stringEnd = scanIniQuotedValue(text, valueStart, valueEnd);
    if (stringEnd === valueStart) return undefined;
    let trailing = stringEnd;
    while (trailing < valueEnd && (text[trailing] === ' ' || text[trailing] === '\t')) trailing += 1;
    if (trailing === valueEnd) {
      return addToken(tokens, valueStart, stringEnd, 'dotenv-string') ? undefined : valueStart;
    }
    if (trailing > stringEnd && text[trailing] === '#') {
      if (!addToken(tokens, valueStart, stringEnd, 'dotenv-string')) return valueStart;
      if (!addToken(tokens, trailing, end, 'dotenv-comment')) return trailing;
    }
    return undefined;
  }

  let commentStart = -1;
  for (let index = valueStart; index < valueEnd; index += 1) {
    if (text[index] === '#' && (text[index - 1] === ' ' || text[index - 1] === '\t')) {
      commentStart = index;
      break;
    }
  }
  let plainEnd = commentStart < 0 ? valueEnd : commentStart;
  while (plainEnd > valueStart && (text[plainEnd - 1] === ' ' || text[plainEnd - 1] === '\t')) plainEnd -= 1;
  if (plainEnd > valueStart && !addToken(tokens, valueStart, plainEnd, 'dotenv-value')) return valueStart;
  if (commentStart >= 0 && !addToken(tokens, commentStart, end, 'dotenv-comment')) return commentStart;
  return undefined;
}

function scanProperties(text: string, limit: number, tokens: TextSyntaxToken[]): number {
  let lineStart = 0;
  let continues = false;
  while (lineStart < limit) {
    const lineEnd = scanLineEnd(text, lineStart, limit);
    if (lineEnd === limit && limit < text.length) return lineStart;
    let contentStart = lineStart;
    while (contentStart < lineEnd && isPropertiesWhitespace(text.charCodeAt(contentStart))) contentStart += 1;
    const commentLine: boolean = !continues && contentStart < lineEnd && (text[contentStart] === '#' || text[contentStart] === '!');
    const nextContinues: boolean = !commentLine && lineEnd < limit && hasOddTrailingPropertiesBackslashes(text, lineStart, lineEnd);

    if (!continues && !nextContinues && commentLine) {
      if (!addToken(tokens, contentStart, lineEnd, 'properties-comment')) return contentStart;
    } else if (!continues && !nextContinues && contentStart < lineEnd) {
      const keyEnd = scanPropertiesKey(text, contentStart, lineEnd);
      if (keyEnd > contentStart) {
        if (!addToken(tokens, contentStart, keyEnd, 'properties-key')) return contentStart;
        let valueStart = keyEnd;
        while (valueStart < lineEnd && isPropertiesWhitespace(text.charCodeAt(valueStart))) valueStart += 1;
        const hasWhitespaceSeparator = valueStart > keyEnd;
        if (text[valueStart] === '=' || text[valueStart] === ':') {
          valueStart += 1;
          while (valueStart < lineEnd && isPropertiesWhitespace(text.charCodeAt(valueStart))) valueStart += 1;
          if (!addToken(tokens, keyEnd, valueStart, 'properties-operator')) return keyEnd;
          if (valueStart < lineEnd && !addToken(tokens, valueStart, lineEnd, 'properties-value')) return valueStart;
        } else if (hasWhitespaceSeparator) {
          if (!addToken(tokens, keyEnd, valueStart, 'properties-operator')) return keyEnd;
          if (valueStart < lineEnd && !addToken(tokens, valueStart, lineEnd, 'properties-value')) return valueStart;
        }
      }
    }

    continues = nextContinues;
    if (lineEnd >= limit) break;
    lineStart = lineEnd + (text[lineEnd] === '\r' && lineEnd + 1 < limit && text[lineEnd + 1] === '\n' ? 2 : 1);
  }
  return limit;
}

function scanPropertiesKey(text: string, start: number, end: number): number {
  let index = start;
  let escaped = false;
  while (index < end) {
    const unit = text.charCodeAt(index);
    if (escaped) escaped = false;
    else if (unit === 92) escaped = true;
    else if (unit === 61 || unit === 58 || isPropertiesWhitespace(unit)) break;
    index += 1;
  }
  return index;
}

function isPropertiesWhitespace(unit: number): boolean {
  return unit === 32 || unit === 9 || unit === 12;
}

function hasOddTrailingPropertiesBackslashes(text: string, start: number, end: number): boolean {
  let count = 0;
  for (let index = end - 1; index >= start && text.charCodeAt(index) === 92; index -= 1) count += 1;
  return count % 2 === 1;
}

function scanHtml(text: string, limit: number, tokens: TextSyntaxToken[]): number {
  let index = 0;
  while (index < limit) {
    if (text.startsWith('<!--', index)) {
      const close = findXmlSequenceEnd(text, '-->', index + 4, limit);
      if (close === undefined) return limit;
      if (!addToken(tokens, index, close + 3, 'html-comment')) return index;
      index = close + 3;
      continue;
    }

    if (text[index] === '<' && (text.startsWith('<!', index) || text.startsWith('<?', index))) {
      const end = findHtmlDeclarationEnd(text, index, limit);
      if (end === undefined) return limit;
      if (!addToken(tokens, index, end, 'html-declaration')) return index;
      index = end;
      continue;
    }

    if (text[index] === '<') {
      const closing = text[index + 1] === '/';
      const nameStart = index + (closing ? 2 : 1);
      if (nameStart < limit && isHtmlTagNameStart(text[nameStart]!)) {
        const tagEnd = findHtmlTagEnd(text, index, limit);
        if (tagEnd === undefined) return limit;
        const nameEnd = findHtmlTagNameEnd(text, nameStart, tagEnd);
        if (nameEnd === nameStart) { index += 1; continue; }
        const tagName = text.slice(nameStart, nameEnd).toLowerCase();
        if (!addToken(tokens, index, nameStart, 'html-operator')) return index;
        if (!addToken(tokens, nameStart, nameEnd, 'html-tag')) return nameStart;

        if (closing) {
          if (!addToken(tokens, tagEnd, tagEnd + 1, 'html-operator')) return tagEnd;
          index = tagEnd + 1;
          continue;
        }

        let cursor = nameEnd;
        let selfClosing = false;
        while (cursor < tagEnd) {
          if (isHtmlWhitespace(text[cursor]!)) { cursor += 1; continue; }
          if (text[cursor] === '/' && cursor + 1 === tagEnd) {
            if (!addToken(tokens, cursor, tagEnd + 1, 'html-operator')) return cursor;
            selfClosing = true;
            cursor += 1;
            continue;
          }

          const attributeStart = cursor;
          while (cursor < tagEnd && !isHtmlWhitespace(text[cursor]!) && text[cursor] !== '=' &&
            text[cursor] !== '>' && text[cursor] !== '<' && text[cursor] !== '"' && text[cursor] !== '\'' &&
            !(text[cursor] === '/' && cursor + 1 === tagEnd)) cursor += 1;
          if (cursor === attributeStart) { cursor += 1; continue; }
          if (!addToken(tokens, attributeStart, cursor, 'html-attribute')) return attributeStart;

          while (cursor < tagEnd && isHtmlWhitespace(text[cursor]!)) cursor += 1;
          if (text[cursor] !== '=') continue;
          if (!addToken(tokens, cursor, cursor + 1, 'html-operator')) return cursor;
          cursor += 1;
          while (cursor < tagEnd && isHtmlWhitespace(text[cursor]!)) cursor += 1;
          if (text[cursor] === '"' || text[cursor] === '\'') {
            const quote = text[cursor]!;
            let valueEnd = cursor + 1;
            while (valueEnd < tagEnd && text[valueEnd] !== quote) valueEnd += 1;
            if (valueEnd < tagEnd) valueEnd += 1;
            if (!addToken(tokens, cursor, valueEnd, 'html-string')) return cursor;
            cursor = valueEnd;
          } else {
            const valueStart = cursor;
            while (cursor < tagEnd && !isHtmlWhitespace(text[cursor]!)) cursor += 1;
            if (!addToken(tokens, valueStart, cursor, 'html-string')) return valueStart;
          }
        }

        if (!selfClosing && !addToken(tokens, tagEnd, tagEnd + 1, 'html-operator')) return tagEnd;
        index = tagEnd + 1;
        if (isHtmlRawTextElement(tagName)) {
          if (tagName === 'plaintext') return limit;
          const close = findHtmlRawTextClose(text, index, tagName, limit);
          if (close === undefined) return limit;
          index = close;
        }
        continue;
      }
    }

    if (text[index] === '&') {
      const end = findXmlEntityReferenceEnd(text, index, limit);
      if (end !== undefined) {
        if (!addToken(tokens, index, end, 'html-entity')) return index;
        index = end;
        continue;
      }
    }
    index += 1;
  }
  return limit;
}

function findHtmlDeclarationEnd(text: string, start: number, limit: number): number | undefined {
  let quote: string | undefined;
  for (let index = start + 2; index < limit; index += 1) {
    const character = text[index]!;
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
    } else if (character === '"' || character === '\'') {
      quote = character;
    } else if (character === '>') {
      return index + 1;
    }
  }
  return undefined;
}

function findHtmlTagEnd(text: string, start: number, limit: number): number | undefined {
  let quote: string | undefined;
  for (let index = start + 1; index < limit; index += 1) {
    const character = text[index]!;
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
    } else if (character === '"' || character === '\'') {
      quote = character;
    } else if (character === '<') {
      return undefined;
    } else if (character === '>') {
      return index;
    }
  }
  return undefined;
}

function findHtmlTagNameEnd(text: string, start: number, limit: number): number {
  let index = start;
  while (index < limit && isHtmlTagNamePart(text[index]!)) index += 1;
  return index;
}

function findHtmlRawTextClose(text: string, start: number, tagName: string, limit: number): number | undefined {
  for (let index = start; index + tagName.length + 2 < limit; index += 1) {
    if (text[index] !== '<' || text[index + 1] !== '/' || !matchesHtmlNameAt(text, index + 2, tagName)) continue;
    const boundary = text[index + 2 + tagName.length];
    if (boundary === '>' || boundary === '/' || isHtmlWhitespace(boundary ?? '')) return index;
  }
  return undefined;
}

function matchesHtmlNameAt(text: string, start: number, name: string): boolean {
  for (let offset = 0; offset < name.length; offset += 1) {
    const actual = text.charCodeAt(start + offset);
    const expected = name.charCodeAt(offset);
    if (actual !== expected && !(actual >= 65 && actual <= 90 && actual + 32 === expected)) return false;
  }
  return true;
}

function isHtmlRawTextElement(tagName: string): boolean {
  return tagName === 'script' || tagName === 'style' || tagName === 'noscript' || tagName === 'textarea' || tagName === 'title' ||
    tagName === 'xmp' || tagName === 'iframe' || tagName === 'noembed' || tagName === 'noframes' || tagName === 'plaintext';
}

function isHtmlTagNameStart(character: string): boolean {
  return (character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z');
}

function isHtmlTagNamePart(character: string): boolean {
  return isHtmlTagNameStart(character) || isDigit(character) || character === '-' || character === ':' || character === '_' || character === '.';
}

function isHtmlWhitespace(character: string): boolean {
  return character === ' ' || character === '\t' || character === '\n' || character === '\r' || character === '\f';
}

function scanXml(text: string, limit: number, tokens: TextSyntaxToken[]): number {
  let index = 0;
  while (index < limit) {
    if (text[index] === '<') {
      if (text.startsWith('<!--', index)) {
        const close = findXmlSequenceEnd(text, '-->', index + 4, limit);
        if (close === undefined) return limit;
        if (!addToken(tokens, index, close + 3, 'xml-comment')) return index;
        index = close + 3;
        continue;
      }
      if (text.startsWith('<![CDATA[', index)) {
        const close = findXmlSequenceEnd(text, ']]>', index + 9, limit);
        if (close === undefined) return limit;
        if (!addToken(tokens, index, close + 3, 'xml-cdata')) return index;
        index = close + 3;
        continue;
      }
      if (text.startsWith('<?', index)) {
        const close = findXmlSequenceEnd(text, '?>', index + 2, limit);
        if (close === undefined) return limit;
        if (!addToken(tokens, index, close + 2, 'xml-declaration')) return index;
        index = close + 2;
        continue;
      }
      if (text.startsWith('<!', index)) {
        const end = findXmlDeclarationEnd(text, index, limit);
        if (end === undefined) return limit;
        if (!addToken(tokens, index, end, 'xml-declaration')) return index;
        index = end;
        continue;
      }

      const nameStart = index + (text[index + 1] === '/' ? 2 : 1);
      if (nameStart < limit && isXmlNameStart(text[nameStart]!)) {
        const tagEnd = findXmlTagEnd(text, index, limit);
        if (tagEnd === undefined) return limit;
        const stoppedAt = scanXmlTag(text, index, tagEnd, tokens);
        if (stoppedAt !== undefined) return stoppedAt;
        index = tagEnd + 1;
        continue;
      }
    }

    if (text[index] === '&') {
      const end = findXmlEntityReferenceEnd(text, index, limit);
      if (end !== undefined) {
        if (!addToken(tokens, index, end, 'xml-entity')) return index;
        index = end;
        continue;
      }
    }
    index += 1;
  }
  return limit;
}

function findXmlTagEnd(text: string, start: number, limit: number): number | undefined {
  let quote: string | undefined;
  for (let index = start + 1; index < limit; index += 1) {
    const character = text[index]!;
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
    } else if (character === '"' || character === '\'') {
      quote = character;
    } else if (character === '<') {
      return undefined;
    } else if (character === '>') {
      return index;
    }
  }
  return undefined;
}

function scanXmlTag(text: string, start: number, tagEnd: number, tokens: TextSyntaxToken[]): number | undefined {
  let index = start + (text[start + 1] === '/' ? 2 : 1);
  if (!addToken(tokens, start, index, 'xml-operator')) return start;
  const tagNameEnd = scanXmlName(text, index, tagEnd);
  if (tagNameEnd === index) return undefined;
  if (!addToken(tokens, index, tagNameEnd, 'xml-tag')) return index;
  index = tagNameEnd;

  while (index < tagEnd) {
    if (isWhitespace(text[index]!)) { index += 1; continue; }
    if (text[index] === '/' && index + 1 === tagEnd) {
      if (!addToken(tokens, index, tagEnd + 1, 'xml-operator')) return index;
      return undefined;
    }
    if (text[index] === '=') {
      if (!addToken(tokens, index, index + 1, 'xml-operator')) return index;
      index += 1;
      continue;
    }

    const attributeEnd = scanXmlName(text, index, tagEnd);
    if (attributeEnd === index) { index += 1; continue; }
    if (!addToken(tokens, index, attributeEnd, 'xml-attribute')) return index;
    index = attributeEnd;
    while (index < tagEnd && isWhitespace(text[index]!)) index += 1;
    if (text[index] !== '=') continue;
    if (!addToken(tokens, index, index + 1, 'xml-operator')) return index;
    index += 1;
    while (index < tagEnd && isWhitespace(text[index]!)) index += 1;
    if (text[index] !== '"' && text[index] !== '\'') continue;
    const quote = text[index]!;
    let valueEnd = index + 1;
    while (valueEnd < tagEnd && text[valueEnd] !== quote) valueEnd += 1;
    if (valueEnd < tagEnd && !addToken(tokens, index, valueEnd + 1, 'xml-string')) return index;
    index = valueEnd + 1;
  }

  if (!addToken(tokens, tagEnd, tagEnd + 1, 'xml-operator')) return tagEnd;
  return undefined;
}

function findXmlDeclarationEnd(text: string, start: number, limit: number): number | undefined {
  let quote: string | undefined;
  let internalSubsetDepth = 0;
  for (let index = start + 2; index < limit; index += 1) {
    const character = text[index]!;
    if (quote === undefined && text.startsWith('<!--', index)) {
      const close = findXmlSequenceEnd(text, '-->', index + 4, limit);
      if (close === undefined) return undefined;
      index = close + 2;
    } else if (quote === undefined && text.startsWith('<?', index)) {
      const close = findXmlSequenceEnd(text, '?>', index + 2, limit);
      if (close === undefined) return undefined;
      index = close + 1;
    } else if (quote !== undefined) {
      if (character === quote) quote = undefined;
    } else if (character === '"' || character === '\'') {
      quote = character;
    } else if (character === '[') {
      internalSubsetDepth += 1;
    } else if (character === ']' && internalSubsetDepth > 0) {
      internalSubsetDepth -= 1;
    } else if (character === '>' && internalSubsetDepth === 0) {
      return index + 1;
    }
  }
  return undefined;
}

function findXmlSequenceEnd(text: string, sequence: string, start: number, limit: number): number | undefined {
  for (let index = start; index + sequence.length <= limit; index += 1) {
    if (text.startsWith(sequence, index)) return index;
  }
  return undefined;
}

function findXmlEntityReferenceEnd(text: string, start: number, limit: number): number | undefined {
  let index = start + 1;
  if (text[index] === '#') {
    index += 1;
    const hexadecimal = text[index] === 'x' || text[index] === 'X';
    if (hexadecimal) index += 1;
    const digitStart = index;
    while (index < limit && (hexadecimal ? isHexDigit(text[index]!) : isDigit(text[index]!))) index += 1;
    if (index === digitStart) return undefined;
  } else {
    if (index >= limit || !isXmlNameStart(text[index]!)) return undefined;
    index = scanXmlName(text, index, Math.min(limit, start + MAX_XML_ENTITY_CODE_UNITS));
  }
  return index < limit && text[index] === ';' && index + 1 - start <= MAX_XML_ENTITY_CODE_UNITS ? index + 1 : undefined;
}

function findXmlNameEnd(text: string, start: number, limit: number): number {
  let index = start;
  while (index < limit && isXmlNamePart(text[index]!)) index += 1;
  return index;
}

function scanXmlName(text: string, start: number, limit: number): number {
  return start < limit && isXmlNameStart(text[start]!) ? findXmlNameEnd(text, start, limit) : start;
}

function isXmlNameStart(character: string): boolean {
  // shortcut: XML names are ASCII-oriented, upgrade when Unicode-name files need precise coloring.
  return character === '_' || character === ':' ||
    (character >= 'A' && character <= 'Z') || (character >= 'a' && character <= 'z');
}

function isXmlNamePart(character: string): boolean {
  return isXmlNameStart(character) || character === '-' || character === '.' || isDigit(character);
}

function scanTomlString(text: string, start: number, limit: number): number {
  const quote = text[start]!;
  const multiline = start + 2 < limit && text[start + 1] === quote && text[start + 2] === quote;
  const delimiterLength = multiline ? 3 : 1;
  let index = start + delimiterLength;
  while (index < limit) {
    if (quote === '"' && text[index] === '\\') {
      if (index + 1 < limit && text[index + 1] === '\r' && index + 2 < limit && text[index + 2] === '\n') index += 3;
      else index += index + 1 < limit ? 2 : 1;
      continue;
    }
    if (text[index] === quote) {
      if (multiline) {
        let quoteEnd = index + 1;
        while (quoteEnd < limit && text[quoteEnd] === quote) quoteEnd += 1;
        if (quoteEnd - index >= 3) return quoteEnd;
        index = quoteEnd;
        continue;
      } else {
        return index + 1;
      }
    }
    if (!multiline && (text[index] === '\n' || text[index] === '\r')) return index;
    index += 1;
  }
  return limit;
}

function scanTomlScalar(text: string, start: number, limit: number): number {
  const spaceDateTime = tomlSpaceDateTimePrefixPattern.exec(text.slice(start, limit));
  if (spaceDateTime?.[0]) {
    const end = start + spaceDateTime[0].length;
    if (end === limit || isWhitespace(text[end]!) || isTomlScalarDelimiter(text[end]!)) return end;
  }
  let index = start;
  while (index < limit && !isWhitespace(text[index]!) && !isTomlScalarDelimiter(text[index]!)) index += 1;
  return index;
}

function isTomlKeyAssignment(text: string, end: number, limit: number): boolean {
  let index = end;
  while (index < limit && (text[index] === ' ' || text[index] === '\t')) index += 1;
  if (text[index] === '=') return true;
  if (text[index] !== '.') return false;

  const keyLimit = Math.min(limit, index + MAX_TOML_DOTTED_KEY_LOOKAHEAD_CODE_UNITS);
  while (index < keyLimit && text[index] === '.') {
    index += 1;
    while (index < keyLimit && (text[index] === ' ' || text[index] === '\t')) index += 1;
    const segmentStart = index;
    if (text[index] === '"' || text[index] === '\'') index = scanTomlString(text, index, keyLimit);
    else while (index < keyLimit && isTomlBareKeyCharacter(text[index]!)) index += 1;
    if (index === segmentStart || index >= keyLimit) return false;
    while (index < keyLimit && (text[index] === ' ' || text[index] === '\t')) index += 1;
    if (text[index] === '=') return true;
    if (text[index] !== '.') return false;
  }
  return false;
}

function isTomlBareKeyCharacter(character: string): boolean {
  return (character >= 'A' && character <= 'Z') || (character >= 'a' && character <= 'z') ||
    isDigit(character) || character === '_' || character === '-';
}

function isTomlScalarDelimiter(character: string): boolean {
  return '#,[]{}='.includes(character);
}

function scanYaml(text: string, limit: number, tokens: TextSyntaxToken[]): number {
  let index = 0;
  let nodePositionExpected = true;
  let mappingColonExpected = false;
  const flowStack: Array<{ readonly kind: 'sequence' } | { readonly kind: 'mapping'; expectsKey: boolean }> = [];

  while (index < limit) {
    const character = text[index]!;
    if (character === '\n' || character === '\r') {
      index += character === '\r' && index + 1 < limit && text[index + 1] === '\n' ? 2 : 1;
      nodePositionExpected = true;
      mappingColonExpected = false;
      continue;
    }
    if (character === ' ' || character === '\t') { index += 1; continue; }
    const currentFlow = flowStack.at(-1);
    const flowMapKeyExpected = currentFlow?.kind === 'mapping' && currentFlow.expectsKey;
    const flowSequencePairKeyExpected = currentFlow?.kind === 'sequence' && nodePositionExpected;
    const canStartImplicitKey = flowMapKeyExpected || flowSequencePairKeyExpected ||
      (flowStack.length === 0 && nodePositionExpected);

    const documentMarkerEnd = scanYamlDocumentMarker(text, index, limit);
    if (documentMarkerEnd > index) {
      if (!addToken(tokens, index, documentMarkerEnd, 'yaml-document')) return index;
      index = documentMarkerEnd;
      nodePositionExpected = true;
      mappingColonExpected = false;
      continue;
    }

    if (isYamlDirective(text, index, limit)) {
      const directiveEnd = scanLineEnd(text, index, limit);
      const commentStart = scanYamlTrailingComment(text, index, directiveEnd);
      const tokenEnd = commentStart >= 0 ? commentStart : directiveEnd;
      if (!addToken(tokens, index, tokenEnd, 'yaml-directive')) return index;
      if (commentStart >= 0 && !addToken(tokens, commentStart, directiveEnd, 'yaml-comment')) return commentStart;
      index = directiveEnd;
      nodePositionExpected = true;
      mappingColonExpected = false;
      continue;
    }

    if (character === '#' && (index === 0 || isWhitespace(text[index - 1]!))) {
      const end = scanLineEnd(text, index, limit);
      if (!addToken(tokens, index, end, 'yaml-comment')) return index;
      index = end;
      continue;
    }

    if (character === '"' || character === '\'') {
      const end = scanYamlQuotedScalar(text, index, limit);
      const keyColon = canStartImplicitKey
        ? findYamlKeyColon(text, index, limit, flowMapKeyExpected, true, flowSequencePairKeyExpected)
        : -1;
      const isKey = canStartImplicitKey && keyColon >= end;
      if (!addToken(tokens, index, end, isKey ? 'yaml-key' : 'yaml-string')) return index;
      index = end;
      nodePositionExpected = false;
      mappingColonExpected = isKey;
      continue;
    }

    if (nodePositionExpected && character === '&' && index + 1 < limit && !isYamlPropertyDelimiter(text[index + 1]!)) {
      const end = scanYamlPropertyName(text, index, limit);
      if (!addToken(tokens, index, end, 'yaml-anchor')) return index;
      index = end;
      continue;
    }

    if (nodePositionExpected && character === '*' && index + 1 < limit && !isYamlPropertyDelimiter(text[index + 1]!)) {
      const end = scanYamlPropertyName(text, index, limit);
      if (!addToken(tokens, index, end, 'yaml-alias')) return index;
      index = end;
      nodePositionExpected = false;
      mappingColonExpected = false;
      continue;
    }

    if (nodePositionExpected && character === '!') {
      const end = scanYamlTag(text, index, limit);
      if (!addToken(tokens, index, end, 'yaml-tag')) return index;
      index = end;
      continue;
    }

    if (nodePositionExpected && (character === '|' || character === '>')) {
      const blockScan = scanYamlBlockScalar(text, index, limit, tokens);
      if (blockScan) {
        if (blockScan.stoppedAt !== undefined) return blockScan.stoppedAt;
        index = blockScan.nextIndex;
        nodePositionExpected = true;
        mappingColonExpected = false;
        continue;
      }
    }

    if (character === ':' && (mappingColonExpected || isYamlSeparatedColon(text, index, limit) || flowMapKeyExpected)) {
      if (!addToken(tokens, index, index + 1, 'yaml-operator')) return index;
      index += 1;
      const currentFlow = flowStack.at(-1);
      if (currentFlow?.kind === 'mapping') currentFlow.expectsKey = false;
      nodePositionExpected = true;
      mappingColonExpected = false;
      continue;
    }

    if ((character === '-' || character === '?') && flowStack.length === 0 && nodePositionExpected &&
        isYamlBlockIndicator(text, index, limit)) {
      if (!addToken(tokens, index, index + 1, 'yaml-operator')) return index;
      index += 1;
      nodePositionExpected = true;
      mappingColonExpected = false;
      continue;
    }

    if ((character === '[' || character === '{') && (flowStack.length > 0 || nodePositionExpected)) {
      if (!addToken(tokens, index, index + 1, 'yaml-operator')) return index;
      flowStack.push(character === '{' ? { kind: 'mapping', expectsKey: true } : { kind: 'sequence' });
      index += 1;
      nodePositionExpected = true;
      mappingColonExpected = false;
      continue;
    }

    if ((character === ']' || character === '}') &&
        ((character === ']' && flowStack.at(-1)?.kind === 'sequence') ||
          (character === '}' && flowStack.at(-1)?.kind === 'mapping'))) {
      if (!addToken(tokens, index, index + 1, 'yaml-operator')) return index;
      flowStack.pop();
      index += 1;
      nodePositionExpected = false;
      mappingColonExpected = false;
      continue;
    }

    if (character === ',' && flowStack.length > 0) {
      if (!addToken(tokens, index, index + 1, 'yaml-operator')) return index;
      const currentFlow = flowStack.at(-1);
      if (currentFlow?.kind === 'mapping') currentFlow.expectsKey = true;
      index += 1;
      nodePositionExpected = true;
      mappingColonExpected = false;
      continue;
    }

    const keyColon = canStartImplicitKey
      ? findYamlKeyColon(text, index, limit, flowMapKeyExpected, false, flowSequencePairKeyExpected)
      : -1;
    if (keyColon > index) {
      if (!addToken(tokens, index, keyColon, 'yaml-key')) return index;
      index = keyColon;
      nodePositionExpected = false;
      mappingColonExpected = true;
      continue;
    }

    const scalarEnd = scanYamlPlainScalar(text, index, limit, flowStack.length > 0, flowMapKeyExpected);
    if (scalarEnd <= index) {
      index += 1;
      nodePositionExpected = false;
      mappingColonExpected = false;
      continue;
    }
    const scalar = text.slice(index, scalarEnd);
    const kind = yamlNulls.has(scalar) || yamlBooleans.has(scalar) ? 'yaml-literal'
      : yamlIntegerPattern.test(scalar) || yamlOctalPattern.test(scalar) || yamlHexPattern.test(scalar) ||
          yamlFloatPattern.test(scalar) || yamlInfinityPattern.test(scalar) || yamlNanPattern.test(scalar)
        ? 'yaml-number' : 'yaml-string';
    if (!addToken(tokens, index, scalarEnd, kind)) return index;
    index = scalarEnd;
    nodePositionExpected = false;
    mappingColonExpected = false;
  }
  return limit;
}

function scanYamlQuotedScalar(text: string, start: number, limit: number): number {
  const quote = text[start]!;
  let index = start + 1;
  while (index < limit) {
    if (quote === '"' && text[index] === '\\') {
      index += index + 1 < limit ? 2 : 1;
      continue;
    }
    if (text[index] === quote) {
      if (quote === '\'' && index + 1 < limit && text[index + 1] === '\'') { index += 2; continue; }
      return index + 1;
    }
    index += 1;
  }
  return limit;
}

function findYamlKeyColon(
  text: string,
  start: number,
  limit: number,
  flowMapKeyExpected: boolean,
  quotedKey: boolean,
  flowSequencePairKeyExpected = false
): number {
  const keyLimit = Math.min(limit, start + MAX_YAML_KEY_LOOKAHEAD_CODE_UNITS);
  let index = start;
  while (index < keyLimit) {
    const character = text[index]!;
    if (character === '\n' || character === '\r') return -1;
    if (quotedKey && index === start && (character === '"' || character === '\'')) {
      const end = scanYamlQuotedScalar(text, index, keyLimit);
      if (end >= keyLimit) return -1;
      index = end;
      continue;
    }
    if (character === '#' && (index === start || isWhitespace(text[index - 1]!))) return -1;
    if ((flowMapKeyExpected || flowSequencePairKeyExpected) && ',]}'.includes(character)) return -1;
    if (character === ':' && (isYamlSeparatedColon(text, index, limit) || flowMapKeyExpected ||
        (flowSequencePairKeyExpected && quotedKey))) return index;
    index += 1;
  }
  return -1;
}

function scanYamlPlainScalar(text: string, start: number, limit: number, inFlowCollection: boolean, flowMapKeyExpected: boolean): number {
  let index = start;
  let contentEnd = start;
  while (index < limit) {
    const character = text[index]!;
    if (character === '\n' || character === '\r' || (inFlowCollection && '[]{},'.includes(character))) break;
    if (character === '#' && index > start && isWhitespace(text[index - 1]!)) break;
    if (character === ':' && (isYamlSeparatedColon(text, index, limit) || flowMapKeyExpected)) break;
    if (!isWhitespace(character)) contentEnd = index + 1;
    index += 1;
  }
  return contentEnd;
}

function scanYamlPropertyName(text: string, start: number, limit: number): number {
  let index = start + 1;
  while (index < limit && !isYamlPropertyDelimiter(text[index]!) &&
      !(text[index] === ':' && isYamlSeparatedColon(text, index, limit))) index += 1;
  return index;
}

function scanYamlTag(text: string, start: number, limit: number): number {
  if (text[start + 1] === '<') {
    let index = start + 2;
    while (index < limit && text[index] !== '>' && !isWhitespace(text[index]!)) index += 1;
    return index < limit && text[index] === '>' ? index + 1 : index;
  }
  let index = start + 1;
  while (index < limit && !isWhitespace(text[index]!) && !',]}'.includes(text[index]!)) index += 1;
  return index;
}

function isYamlPropertyDelimiter(character: string): boolean {
  return isWhitespace(character) || ',[]{}'.includes(character);
}

function isYamlSeparatedColon(text: string, index: number, limit: number): boolean {
  const next = index + 1 < limit ? text[index + 1] : undefined;
  return next === undefined || isWhitespace(next) || ',]}'.includes(next);
}

function isYamlBlockIndicator(text: string, index: number, limit: number): boolean {
  const next = index + 1 < limit ? text[index + 1] : undefined;
  return next === undefined || isWhitespace(next);
}

function isYamlLinePrefix(text: string, index: number): boolean {
  return index === 0 || text[index - 1] === '\n' || text[index - 1] === '\r';
}

function scanYamlDocumentMarker(text: string, index: number, limit: number): number {
  if ((text[index] !== '-' && text[index] !== '.') || !isYamlLinePrefix(text, index) || index + 3 > limit) return index;
  const marker = text.slice(index, index + 3);
  if (marker !== '---' && marker !== '...') return index;
  const following = index + 3 < limit ? text[index + 3] : undefined;
  return following === undefined || isWhitespace(following) ? index + 3 : index;
}

function isYamlDirective(text: string, index: number, limit: number): boolean {
  if (text[index] !== '%') return false;
  const directive = text.startsWith('%YAML', index) ? '%YAML' : text.startsWith('%TAG', index) ? '%TAG' : undefined;
  if (!directive || !isYamlLinePrefix(text, index)) return false;
  const following = index + directive.length < limit ? text[index + directive.length] : undefined;
  return following === undefined || isWhitespace(following);
}

function scanYamlTrailingComment(text: string, start: number, end: number): number {
  for (let index = start; index < end; index += 1) {
    if (text[index] === '#' && index > start && isWhitespace(text[index - 1]!)) return index;
  }
  return -1;
}

function scanYamlBlockScalar(
  text: string,
  start: number,
  limit: number,
  tokens: TextSyntaxToken[]
): { readonly nextIndex: number; readonly stoppedAt?: number } | undefined {
  const lineEnd = scanLineEnd(text, start, limit);
  let headerEnd = start + 1;
  let explicitIndent: number | undefined;
  let chompingSeen = false;
  while (headerEnd < lineEnd) {
    const character = text[headerEnd]!;
    if ((character === '+' || character === '-') && !chompingSeen) {
      chompingSeen = true;
      headerEnd += 1;
      continue;
    }
    if (character >= '1' && character <= '9' && explicitIndent === undefined) {
      explicitIndent = Number(character);
      headerEnd += 1;
      continue;
    }
    break;
  }

  let commentStart = headerEnd;
  while (commentStart < lineEnd && (text[commentStart] === ' ' || text[commentStart] === '\t')) commentStart += 1;
  if (commentStart < lineEnd && text[commentStart] !== '#') return undefined;
  if (commentStart === headerEnd && commentStart < lineEnd) return undefined;

  if (!addToken(tokens, start, headerEnd, 'yaml-operator')) return { nextIndex: start, stoppedAt: start };
  if (commentStart < lineEnd && !addToken(tokens, commentStart, lineEnd, 'yaml-comment')) {
    return { nextIndex: commentStart, stoppedAt: commentStart };
  }

  const parentIndent = yamlBlockScalarParentIndent(text, start);
  let requiredIndent = explicitIndent === undefined ? undefined : parentIndent + explicitIndent;
  let cursor = nextLineAfter(text, lineEnd, limit);
  while (cursor < limit) {
    const contentEnd = scanLineEnd(text, cursor, limit);
    let indentation = 0;
    while (cursor + indentation < contentEnd && text[cursor + indentation] === ' ') indentation += 1;
    const blank = cursor + indentation === contentEnd;
    if (blank) {
      if (contentEnd > cursor && !addToken(tokens, cursor, contentEnd, 'yaml-string')) {
        return { nextIndex: cursor, stoppedAt: cursor };
      }
      cursor = nextLineAfter(text, contentEnd, limit);
      continue;
    }
    if (requiredIndent === undefined) {
      if (indentation <= parentIndent) return { nextIndex: cursor };
      requiredIndent = indentation;
    }
    if (indentation < requiredIndent) return { nextIndex: cursor };
    if (!addToken(tokens, cursor, contentEnd, 'yaml-string')) return { nextIndex: cursor, stoppedAt: cursor };
    cursor = nextLineAfter(text, contentEnd, limit);
  }
  return { nextIndex: limit };
}

function yamlLineIndent(text: string, index: number): number {
  const lineStart = yamlLineStart(text, index);
  let indentation = 0;
  while (lineStart + indentation < index && text[lineStart + indentation] === ' ') indentation += 1;
  return indentation;
}

function yamlBlockScalarParentIndent(text: string, index: number): number {
  const lineStart = yamlLineStart(text, index);
  const lineIndent = yamlLineIndent(text, index);
  let compactMappingKey = lineStart + lineIndent;
  while (text[compactMappingKey] === '-' && isWhitespace(text[compactMappingKey + 1] ?? '')) {
    compactMappingKey += 2;
    while (compactMappingKey < index && isWhitespace(text[compactMappingKey]!)) compactMappingKey += 1;
  }

  if (compactMappingKey === lineStart + lineIndent || compactMappingKey >= index) return lineIndent;
  const keyColon = findYamlKeyColon(text, compactMappingKey, index, false, false);
  return keyColon > compactMappingKey ? compactMappingKey - lineStart : lineIndent;
}

function yamlLineStart(text: string, index: number): number {
  let lineStart = index;
  while (lineStart > 0 && text[lineStart - 1] !== '\n' && text[lineStart - 1] !== '\r') lineStart -= 1;
  return lineStart;
}

function nextLineAfter(text: string, lineEnd: number, limit: number): number {
  if (lineEnd >= limit) return limit;
  if (text[lineEnd] === '\r' && lineEnd + 1 < limit && text[lineEnd + 1] === '\n') return lineEnd + 2;
  return lineEnd + 1;
}

type MarkdownFenceMarker = '`' | '~';

interface MarkdownLookaheadBudget {
  remainingSteps: number;
}

interface MarkdownFenceOpening {
  readonly marker: MarkdownFenceMarker;
  readonly length: number;
  readonly markerStart: number;
  readonly markerEnd: number;
  readonly infoStart: number;
  readonly infoEnd: number;
}

interface MarkdownBlockMarker {
  readonly markerStart: number;
  readonly markerEnd: number;
  readonly contentStart: number;
}

function scanMarkdown(text: string, limit: number, tokens: TextSyntaxToken[]): number {
  let index = 0;
  let fence: { readonly marker: MarkdownFenceMarker; readonly length: number } | undefined;
  const lookaheadBudget: MarkdownLookaheadBudget = { remainingSteps: MAX_MARKDOWN_INLINE_LOOKAHEAD_STEPS };

  while (index < limit) {
    const lineStart = index;
    const lineEnd = scanLineEnd(text, lineStart, limit);
    const nextLine = nextLineAfter(text, lineEnd, limit);

    if (fence) {
      const closing = scanMarkdownFenceClosing(text, lineStart, lineEnd, fence);
      if (closing) {
        if (!addToken(tokens, closing.start, closing.end, 'markdown-code-fence')) return closing.start;
        fence = undefined;
      } else if (!addToken(tokens, lineStart, nextLine, 'markdown-code')) {
        return lineStart;
      }
      index = nextLine;
      continue;
    }

    const opening = scanMarkdownFenceOpening(text, lineStart, lineEnd);
    if (opening) {
      if (!addToken(tokens, opening.markerStart, opening.markerEnd, 'markdown-code-fence')) return opening.markerStart;
      if (opening.infoEnd > opening.infoStart && !addToken(tokens, opening.infoStart, opening.infoEnd, 'markdown-code-info')) {
        return opening.infoStart;
      }
      fence = { marker: opening.marker, length: opening.length };
      index = nextLine;
      continue;
    }

    if (isMarkdownThematicBreak(text, lineStart, lineEnd)) {
      if (!addToken(tokens, lineStart, lineEnd, 'markdown-rule')) return lineStart;
      index = nextLine;
      continue;
    }

    let inlineStart = lineStart;
    const heading = scanMarkdownHeading(text, lineStart, lineEnd);
    if (heading) {
      if (!addToken(tokens, heading.markerStart, heading.markerEnd, 'markdown-heading')) return heading.markerStart;
      inlineStart = heading.contentStart;
    } else {
      const quote = scanMarkdownQuote(text, lineStart, lineEnd);
      if (quote) {
        if (!addToken(tokens, quote.markerStart, quote.markerEnd, 'markdown-quote')) return quote.markerStart;
        inlineStart = quote.contentStart;
      } else {
        const list = scanMarkdownListMarker(text, lineStart, lineEnd);
        if (list) {
          if (!addToken(tokens, list.markerStart, list.markerEnd, 'markdown-list')) return list.markerStart;
          inlineStart = list.contentStart;
        }
      }
    }

    const stoppedAt = scanMarkdownInline(text, inlineStart, lineEnd, tokens, lookaheadBudget);
    if (stoppedAt !== undefined) return stoppedAt;
    index = nextLine;
  }

  return limit;
}

function scanMarkdownInline(
  text: string,
  start: number,
  end: number,
  tokens: TextSyntaxToken[],
  lookaheadBudget: MarkdownLookaheadBudget
): number | undefined {
  let index = start;
  while (index < end) {
    if (lookaheadBudget.remainingSteps <= 0) return index;
    const character = text[index]!;
    if (character === '\\' && index + 1 < end) { index += 2; continue; }

    if (character === '<' && text.startsWith('<!--', index)) {
      const commentLimit = Math.min(end, index + MAX_MARKDOWN_INLINE_LOOKAHEAD_CODE_UNITS);
      const close = findMarkdownCommentEnd(text, index + 4, commentLimit, lookaheadBudget);
      if (close >= 0) {
        const tokenEnd = close + 3;
        if (!addToken(tokens, index, tokenEnd, 'markdown-comment')) return index;
        index = tokenEnd;
        continue;
      }
    }

    if (character === '`') {
      const runEnd = scanMarkdownRun(text, index, end, '`');
      const runLength = runEnd - index;
      const closeEnd = findMarkdownCodeSpanEnd(text, runEnd, end, runLength, lookaheadBudget);
      if (closeEnd !== undefined) {
        if (!addToken(tokens, index, closeEnd, 'markdown-code')) return index;
        index = closeEnd;
        continue;
      }
      index = runEnd;
      continue;
    }

    const linkStart = character === '!' && text[index + 1] === '[' ? index : character === '[' ? index : -1;
    if (linkStart >= 0) {
      const linkEnd = findMarkdownInlineLinkEnd(text, linkStart, end, lookaheadBudget);
      if (linkEnd !== undefined) {
        if (!addToken(tokens, linkStart, linkEnd, 'markdown-link')) return linkStart;
        index = linkEnd;
        continue;
      }
    }

    if (character === '*' || character === '_') {
      const runEnd = scanMarkdownRun(text, index, end, character);
      const delimiterLength = runEnd - index;
      if (delimiterLength <= 2 && isMarkdownEmphasisStart(text, index, end, character, delimiterLength)) {
        const closeEnd = findMarkdownEmphasisEnd(text, index, runEnd, end, character, delimiterLength, lookaheadBudget);
        if (closeEnd !== undefined) {
          const stoppedAt = addMarkdownEmphasisTokens(text, index, closeEnd, tokens, lookaheadBudget);
          if (stoppedAt !== undefined) return stoppedAt;
          index = closeEnd;
          continue;
        }
      }
      index = runEnd;
      continue;
    }

    index += 1;
  }
  return undefined;
}

function scanMarkdownFenceOpening(text: string, start: number, end: number): MarkdownFenceOpening | undefined {
  let markerStart = start;
  let indentation = 0;
  while (markerStart < end && text[markerStart] === ' ' && indentation <= 3) {
    markerStart += 1;
    indentation += 1;
  }
  if (indentation > 3 || markerStart >= end) return undefined;

  const marker = text[markerStart];
  if (marker !== '`' && marker !== '~') return undefined;
  const markerEnd = scanMarkdownRun(text, markerStart, end, marker);
  const length = markerEnd - markerStart;
  if (length < 3) return undefined;
  if (marker === '`' && text.slice(markerEnd, end).includes('`')) return undefined;

  let infoStart = markerEnd;
  while (infoStart < end && isMarkdownSpace(text[infoStart]!)) infoStart += 1;
  let infoEnd = end;
  while (infoEnd > infoStart && isMarkdownSpace(text[infoEnd - 1]!)) infoEnd -= 1;
  return { marker, length, markerStart, markerEnd, infoStart, infoEnd };
}

function scanMarkdownFenceClosing(
  text: string,
  start: number,
  end: number,
  fence: { readonly marker: MarkdownFenceMarker; readonly length: number }
): { readonly start: number; readonly end: number } | undefined {
  let markerStart = start;
  let indentation = 0;
  while (markerStart < end && text[markerStart] === ' ' && indentation <= 3) {
    markerStart += 1;
    indentation += 1;
  }
  if (indentation > 3 || text[markerStart] !== fence.marker) return undefined;

  const markerEnd = scanMarkdownRun(text, markerStart, end, fence.marker);
  if (markerEnd - markerStart < fence.length) return undefined;
  for (let index = markerEnd; index < end; index += 1) if (!isMarkdownSpace(text[index]!)) return undefined;
  return { start: markerStart, end: markerEnd };
}

function scanMarkdownHeading(
  text: string,
  start: number,
  end: number
): MarkdownBlockMarker | undefined {
  const indentation = markdownIndent(text, start, end);
  if (indentation > 3) return undefined;
  const markerStart = start + indentation;
  if (text[markerStart] !== '#') return undefined;
  const markerEnd = scanMarkdownRun(text, markerStart, end, '#');
  if (markerEnd - markerStart > 6 || (markerEnd < end && !isMarkdownSpace(text[markerEnd]!))) return undefined;
  let contentStart = markerEnd;
  while (contentStart < end && isMarkdownSpace(text[contentStart]!)) contentStart += 1;
  return { markerStart, markerEnd, contentStart };
}

function scanMarkdownQuote(
  text: string,
  start: number,
  end: number
): MarkdownBlockMarker | undefined {
  const indentation = markdownIndent(text, start, end);
  if (indentation > 3) return undefined;
  const markerStart = start + indentation;
  if (text[markerStart] !== '>') return undefined;
  let contentStart = markerStart + 1;
  if (contentStart < end && isMarkdownSpace(text[contentStart]!)) contentStart += 1;
  return { markerStart, markerEnd: markerStart + 1, contentStart };
}

function scanMarkdownListMarker(
  text: string,
  start: number,
  end: number
): MarkdownBlockMarker | undefined {
  const indentation = markdownIndent(text, start, end);
  if (indentation > 3) return undefined;
  const markerStart = start + indentation;
  if (markerStart >= end) return undefined;
  let markerEnd = markerStart;
  const first = text[markerStart]!;
  if (first === '-' || first === '+' || first === '*') {
    markerEnd += 1;
  } else if (isDigit(first)) {
    while (markerEnd < end && isDigit(text[markerEnd]!) && markerEnd - markerStart < 9) markerEnd += 1;
    if (markerEnd - markerStart > 9 || (text[markerEnd] !== '.' && text[markerEnd] !== ')')) return undefined;
    markerEnd += 1;
  } else {
    return undefined;
  }

  if (markerEnd < end && !isMarkdownSpace(text[markerEnd]!)) return undefined;
  let contentStart = markerEnd;
  while (contentStart < end && isMarkdownSpace(text[contentStart]!)) contentStart += 1;
  return { markerStart, markerEnd, contentStart };
}

function isMarkdownThematicBreak(text: string, start: number, end: number): boolean {
  const indentation = markdownIndent(text, start, end);
  if (indentation > 3) return false;
  const markerStart = start + indentation;
  const marker = text[markerStart];
  if (marker !== '-' && marker !== '*' && marker !== '_') return false;
  let count = 0;
  for (let index = markerStart; index < end; index += 1) {
    if (text[index] === marker) count += 1;
    else if (!isMarkdownSpace(text[index]!)) return false;
  }
  return count >= 3;
}

function markdownIndent(text: string, start: number, end: number): number {
  let indentation = 0;
  while (start + indentation < end && text[start + indentation] === ' ' && indentation < 4) indentation += 1;
  return indentation;
}

function findMarkdownCommentEnd(
  text: string,
  start: number,
  end: number,
  lookaheadBudget: MarkdownLookaheadBudget
): number {
  for (let index = start; index + 3 <= end; index += 1) {
    if (!spendMarkdownLookahead(lookaheadBudget, 3)) return -1;
    if (text[index] === '-' && text[index + 1] === '-' && text[index + 2] === '>') return index;
  }
  return -1;
}

function findMarkdownCodeSpanEnd(
  text: string,
  start: number,
  end: number,
  runLength: number,
  lookaheadBudget: MarkdownLookaheadBudget
): number | undefined {
  const limit = Math.min(end, start + MAX_MARKDOWN_INLINE_LOOKAHEAD_CODE_UNITS);
  let index = start;
  while (index < limit) {
    if (text[index] !== '`') {
      if (!spendMarkdownLookahead(lookaheadBudget)) return undefined;
      index += 1;
      continue;
    }
    const runEnd = scanMarkdownRunWithinBudget(text, index, limit, '`', lookaheadBudget);
    if (runEnd === undefined) return undefined;
    if (runEnd - index === runLength) return runEnd;
    index = runEnd;
  }
  return undefined;
}

function findMarkdownInlineLinkEnd(
  text: string,
  start: number,
  end: number,
  lookaheadBudget: MarkdownLookaheadBudget
): number | undefined {
  const limit = Math.min(end, start + MAX_MARKDOWN_INLINE_LOOKAHEAD_CODE_UNITS);
  const bracketStart = start + (text[start] === '!' ? 1 : 0);
  if (text[bracketStart] !== '[') return undefined;
  let bracketDepth = 0;
  let closeBracket = -1;
  for (let index = bracketStart + 1; index < limit; index += 1) {
    if (!spendMarkdownLookahead(lookaheadBudget)) return undefined;
    if (text[index] === '\\' && index + 1 < limit) {
      if (!spendMarkdownLookahead(lookaheadBudget)) return undefined;
      index += 1;
      continue;
    }
    if (text[index] === '[') bracketDepth += 1;
    else if (text[index] === ']') {
      if (bracketDepth === 0) { closeBracket = index; break; }
      bracketDepth -= 1;
    }
  }
  if (closeBracket < 0 || text[closeBracket + 1] !== '(') return undefined;

  let parenthesisDepth = 1;
  for (let index = closeBracket + 2; index < limit; index += 1) {
    if (!spendMarkdownLookahead(lookaheadBudget)) return undefined;
    if (text[index] === '\\' && index + 1 < limit) {
      if (!spendMarkdownLookahead(lookaheadBudget)) return undefined;
      index += 1;
      continue;
    }
    if (text[index] === '(') parenthesisDepth += 1;
    else if (text[index] === ')') {
      parenthesisDepth -= 1;
      if (parenthesisDepth === 0) return index + 1;
    }
  }
  return undefined;
}

function isMarkdownEmphasisStart(text: string, start: number, end: number, delimiter: '*' | '_', length: number): boolean {
  const contentStart = start + length;
  if (contentStart >= end || isWhitespace(text[contentStart]!)) return false;
  if (delimiter === '_' && isMarkdownWordCharacter(text[start - 1])) return false;
  return length > 0;
}

function findMarkdownEmphasisEnd(
  text: string,
  start: number,
  contentStart: number,
  end: number,
  delimiter: '*' | '_',
  length: number,
  lookaheadBudget: MarkdownLookaheadBudget
): number | undefined {
  const limit = Math.min(end, start + MAX_MARKDOWN_INLINE_LOOKAHEAD_CODE_UNITS);
  let index = contentStart;
  while (index < limit) {
    if (text[index] === '\\' && index + 1 < limit) {
      if (!spendMarkdownLookahead(lookaheadBudget, 2)) return undefined;
      index += 2;
      continue;
    }
    if (text[index] === '`') {
      const codeStart = index;
      const codeRunEnd = scanMarkdownRunWithinBudget(text, codeStart, limit, '`', lookaheadBudget);
      if (codeRunEnd === undefined) return undefined;
      const codeEnd = findMarkdownCodeSpanEnd(text, codeRunEnd, limit, codeRunEnd - codeStart, lookaheadBudget);
      index = codeEnd ?? codeRunEnd;
      continue;
    }
    if (text[index] === '<' && text.startsWith('<!--', index)) {
      const commentLimit = Math.min(limit, index + MAX_MARKDOWN_INLINE_LOOKAHEAD_CODE_UNITS);
      const commentEnd = findMarkdownCommentEnd(text, index + 4, commentLimit, lookaheadBudget);
      if (commentEnd >= 0) {
        index = commentEnd + 3;
        continue;
      }
    }
    const linkStart = text[index] === '!' && text[index + 1] === '[' ? index : text[index] === '[' ? index : -1;
    if (linkStart >= 0) {
      const linkEnd = findMarkdownInlineLinkEnd(text, linkStart, limit, lookaheadBudget);
      if (linkEnd !== undefined) {
        index = linkEnd;
        continue;
      }
    }
    if (text[index] !== delimiter) {
      if (!spendMarkdownLookahead(lookaheadBudget)) return undefined;
      index += 1;
      continue;
    }
    const runEnd = scanMarkdownRunWithinBudget(text, index, limit, delimiter, lookaheadBudget);
    if (runEnd === undefined) return undefined;
    if (runEnd - index === length && index > contentStart && !isWhitespace(text[index - 1]!)) {
      if (delimiter !== '_' || !isMarkdownWordCharacter(text[runEnd])) return runEnd;
    }
    index = runEnd;
  }
  return undefined;
}

function addMarkdownEmphasisTokens(
  text: string,
  start: number,
  end: number,
  tokens: TextSyntaxToken[],
  lookaheadBudget: MarkdownLookaheadBudget
): number | undefined {
  let segmentStart = start;
  let index = start;
  while (index < end) {
    if (lookaheadBudget.remainingSteps <= 0) return index;
    if (text[index] === '<' && text.startsWith('<!--', index)) {
      const commentLimit = Math.min(end, index + MAX_MARKDOWN_INLINE_LOOKAHEAD_CODE_UNITS);
      const commentEnd = findMarkdownCommentEnd(text, index + 4, commentLimit, lookaheadBudget);
      if (commentEnd >= 0) {
        const tokenEnd = commentEnd + 3;
        if (!addToken(tokens, segmentStart, index, 'markdown-emphasis')) return segmentStart;
        if (!addToken(tokens, index, tokenEnd, 'markdown-comment')) return index;
        segmentStart = tokenEnd;
        index = tokenEnd;
        continue;
      }
      if (lookaheadBudget.remainingSteps <= 0) return index;
    }
    const linkStart = text[index] === '!' && text[index + 1] === '[' ? index : text[index] === '[' ? index : -1;
    if (linkStart >= 0) {
      const linkEnd = findMarkdownInlineLinkEnd(text, linkStart, end, lookaheadBudget);
      if (linkEnd !== undefined) {
        if (!addToken(tokens, segmentStart, linkStart, 'markdown-emphasis')) return segmentStart;
        if (!addToken(tokens, linkStart, linkEnd, 'markdown-link')) return linkStart;
        segmentStart = linkEnd;
        index = linkEnd;
        continue;
      }
      if (lookaheadBudget.remainingSteps <= 0) return index;
    }
    if (text[index] !== '`') {
      lookaheadBudget.remainingSteps -= 1;
      index += 1;
      continue;
    }

    const codeStart = index;
    const codeRunEnd = scanMarkdownRunWithinBudget(text, codeStart, end, '`', lookaheadBudget);
    if (codeRunEnd === undefined) {
      if (!addToken(tokens, segmentStart, codeStart, 'markdown-emphasis')) return segmentStart;
      return codeStart;
    }
    const codeEnd = findMarkdownCodeSpanEnd(text, codeRunEnd, end, codeRunEnd - codeStart, lookaheadBudget);
    if (codeEnd === undefined) {
      if (!addToken(tokens, segmentStart, codeStart, 'markdown-emphasis')) return segmentStart;
      if (lookaheadBudget.remainingSteps <= 0) return codeStart;
      index = codeRunEnd;
      continue;
    }

    if (!addToken(tokens, segmentStart, codeStart, 'markdown-emphasis')) return segmentStart;
    if (!addToken(tokens, codeStart, codeEnd, 'markdown-code')) return codeStart;
    segmentStart = codeEnd;
    index = codeEnd;
  }

  if (!addToken(tokens, segmentStart, end, 'markdown-emphasis')) return segmentStart;
  return undefined;
}

function scanMarkdownRun(text: string, start: number, end: number, character: string): number {
  let index = start;
  while (index < end && text[index] === character) index += 1;
  return index;
}

function scanMarkdownRunWithinBudget(
  text: string,
  start: number,
  end: number,
  character: string,
  lookaheadBudget: MarkdownLookaheadBudget
): number | undefined {
  let index = start;
  while (index < end && text[index] === character) {
    if (!spendMarkdownLookahead(lookaheadBudget)) return undefined;
    index += 1;
  }
  return index;
}

function spendMarkdownLookahead(lookaheadBudget: MarkdownLookaheadBudget, steps = 1): boolean {
  if (steps > lookaheadBudget.remainingSteps) {
    lookaheadBudget.remainingSteps = 0;
    return false;
  }
  lookaheadBudget.remainingSteps -= steps;
  return true;
}

function isMarkdownWordCharacter(character: string | undefined): boolean {
  return character !== undefined && (isDigit(character) || character === '_' ||
    (character >= 'A' && character <= 'Z') || (character >= 'a' && character <= 'z'));
}

function isMarkdownSpace(character: string): boolean { return character === ' ' || character === '\t'; }

function scanJson(text: string, limit: number, tokens: TextSyntaxToken[]): number {
  let index = 0;
  while (index < limit) {
    const character = text[index]!;
    if (isWhitespace(character)) { index += 1; continue; }

    if (character === '"') {
      const start = index;
      index += 1;
      while (index < limit) {
        if (text[index] === '\\' && index + 1 < limit) { index += 2; continue; }
        if (text[index] === '"') { index += 1; break; }
        index += 1;
      }
      let next = index;
      while (next < limit && isWhitespace(text[next]!)) next += 1;
      const kind = text[next] === ':' ? 'json-key' : 'json-string';
      if (!addToken(tokens, start, index, kind)) return start;
      continue;
    }

    if (character === '-' || isDigit(character)) {
      const end = scanJsonNumber(text, index, limit);
      if (end > index && isJsonBoundary(text[end])) {
        if (!addToken(tokens, index, end, 'json-number')) return index;
        index = end;
        continue;
      }
    }

    const literal = jsonLiteralAt(text, index, limit);
    if (literal) {
      if (!addToken(tokens, index, index + literal.length, 'json-literal')) return index;
      index += literal.length;
      continue;
    }

    if ('{}[]:,'.includes(character)) {
      if (!addToken(tokens, index, index + 1, 'json-punctuation')) return index;
    }
    index += 1;
  }
  return limit;
}

function scanShellVariable(text: string, start: number, limit: number): number {
  let index = start + 1;
  if (text[index] === '{') {
    index += 1;
    while (index < limit) {
      if (text[index] === '}') return index + 1;
      if (text[index] === '$') return start + 1;
      index += 1;
    }
    return start + 1;
  }
  if (isShellNameStart(text[index] ?? '') || isDigit(text[index] ?? '')) {
    index += 1;
    while (index < limit && isShellNamePart(text[index]!)) index += 1;
    return index;
  }
  if ('?@*!$#-'.includes(text[index] ?? '\0')) return index + 1;
  return index;
}

function scanJsonNumber(text: string, start: number, limit: number): number {
  let index = start;
  if (text[index] === '-') index += 1;
  if (text[index] === '0') index += 1;
  else {
    if (!isDigitOneToNine(text[index] ?? '')) return start;
    while (index < limit && isDigit(text[index]!)) index += 1;
  }
  if (text[index] === '.') {
    index += 1;
    if (!isDigit(text[index] ?? '')) return start;
    while (index < limit && isDigit(text[index]!)) index += 1;
  }
  if (text[index] === 'e' || text[index] === 'E') {
    index += 1;
    if (text[index] === '+' || text[index] === '-') index += 1;
    if (!isDigit(text[index] ?? '')) return start;
    while (index < limit && isDigit(text[index]!)) index += 1;
  }
  return index;
}

function jsonLiteralAt(text: string, index: number, limit: number): string | undefined {
  for (const literal of ['false', 'null', 'true']) {
    const end = index + literal.length;
    if (end <= limit && text.startsWith(literal, index) && isJsonBoundary(text[end])) return literal;
  }
  return undefined;
}

function scanOperator(text: string, index: number, limit: number): number {
  const first = text[index]!;
  const second = text[index + 1];
  if (index + 1 < limit && ((first === '&' && second === '&') || (first === '|' && second === '|') ||
      (first === '>' && second === '>') || (first === '<' && second === '<'))) return index + 2;
  return index + 1;
}

function addToken(tokens: TextSyntaxToken[], start: number, end: number, kind: TextSyntaxTokenKind): boolean {
  if (end <= start) return true;
  if (tokens.length >= MAX_TEXT_SYNTAX_PREVIEW_TOKENS) return false;
  tokens.push(Object.freeze({ start, end, kind }));
  return true;
}

function isShellAssignment(word: string): boolean {
  const equal = word.indexOf('=');
  if (equal <= 0) return false;
  if (!isShellNameStart(word[0]!)) return false;
  for (let index = 1; index < equal; index += 1) if (!isShellNamePart(word[index]!)) return false;
  return true;
}

function isShellNameStart(character: string): boolean { return /[A-Za-z_]/.test(character); }
function isShellNamePart(character: string): boolean { return /[A-Za-z0-9_]/.test(character); }
function isShellOperator(character: string): boolean { return ';&|<>()'.includes(character); }
function isQuote(character: string): boolean { return character === '\'' || character === '"'; }
function isWhitespace(character: string): boolean { return character === ' ' || character === '\t' || character === '\n' || character === '\r'; }
function isDigit(character: string): boolean { return character >= '0' && character <= '9'; }
function isDigitOneToNine(character: string): boolean { return character >= '1' && character <= '9'; }
function isJsonBoundary(character: string | undefined): boolean { return character === undefined || isWhitespace(character) || ',}]'.includes(character); }
function isHighSurrogate(codeUnit: number): boolean { return codeUnit >= 0xd800 && codeUnit <= 0xdbff; }
