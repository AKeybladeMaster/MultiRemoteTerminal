export const MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS = 64_000;
export const MAX_TEXT_SYNTAX_PREVIEW_TOKENS = 4_096;
const MAX_POWERSHELL_NAME_SCAN_CODE_UNITS = 256;
const MAX_SQL_DOLLAR_TAG_CODE_UNITS = 63;
const MAX_TOML_DOTTED_KEY_LOOKAHEAD_CODE_UNITS = 512;
const MAX_YAML_KEY_LOOKAHEAD_CODE_UNITS = 1_024;

export const TEXT_SYNTAX_PROFILES = ['auto', 'plain', 'shell', 'powershell', 'python', 'javascript', 'sql', 'toml', 'yaml', 'json'] as const;
export type TextSyntaxProfile = typeof TEXT_SYNTAX_PROFILES[number];
export type ResolvedTextSyntaxProfile = Exclude<TextSyntaxProfile, 'auto'>;

export type TextSyntaxTokenKind =
  | 'shell-command' | 'shell-keyword' | 'shell-option' | 'shell-string' | 'shell-variable' | 'shell-comment' | 'shell-operator' | 'shell-path'
  | 'powershell-command' | 'powershell-keyword' | 'powershell-parameter' | 'powershell-string' | 'powershell-variable'
  | 'powershell-comment' | 'powershell-operator' | 'powershell-number' | 'powershell-type'
  | 'python-builtin' | 'python-keyword' | 'python-string' | 'python-comment' | 'python-number' | 'python-operator'
  | 'python-function' | 'python-type'
  | 'javascript-builtin' | 'javascript-keyword' | 'javascript-string' | 'javascript-comment' | 'javascript-number'
  | 'javascript-operator' | 'javascript-function' | 'javascript-type'
  | 'sql-function' | 'sql-keyword' | 'sql-literal' | 'sql-string' | 'sql-comment' | 'sql-number' | 'sql-operator'
  | 'sql-parameter' | 'sql-type' | 'sql-identifier'
  | 'toml-key' | 'toml-string' | 'toml-number' | 'toml-literal' | 'toml-datetime' | 'toml-comment' | 'toml-operator'
  | 'yaml-key' | 'yaml-string' | 'yaml-number' | 'yaml-literal' | 'yaml-comment' | 'yaml-operator'
  | 'yaml-anchor' | 'yaml-alias' | 'yaml-tag' | 'yaml-document' | 'yaml-directive'
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

const shellKeywords = new Set(['case', 'do', 'done', 'elif', 'else', 'esac', 'fi', 'for', 'function', 'if', 'in', 'select', 'then', 'until', 'while']);
const commandContinuingKeywords = new Set(['case', 'do', 'elif', 'else', 'for', 'function', 'if', 'in', 'select', 'then', 'until', 'while']);
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
  if (/\.(?:sql|pgsql|psql)$/.test(name)) return 'sql';
  if (/\.toml$/.test(name)) return 'toml';
  if (/\.(?:yaml|yml)$/.test(name)) return 'yaml';
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

  let limit = Math.min(text.length, MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS);
  if (limit < text.length && isHighSurrogate(text.charCodeAt(limit - 1))) limit -= 1;
  const tokens: TextSyntaxToken[] = [];
  const scannedThrough = profile === 'shell' ? scanShell(text, limit, tokens)
    : profile === 'powershell' ? scanPowerShell(text, limit, tokens)
      : profile === 'python' ? scanPython(text, limit, tokens)
        : profile === 'javascript' ? scanJavaScript(text, limit, tokens)
          : profile === 'sql' ? scanSql(text, limit, tokens)
            : profile === 'toml' ? scanToml(text, limit, tokens)
              : profile === 'yaml' ? scanYaml(text, limit, tokens)
                : scanJson(text, limit, tokens);
  return Object.freeze({ tokens: Object.freeze(tokens), highlightedThrough: scannedThrough, isTruncated: scannedThrough < text.length });
}

function scanShell(text: string, limit: number, tokens: TextSyntaxToken[]): number {
  let index = 0;
  let commandExpected = true;
  while (index < limit) {
    const character = text[index]!;
    if (character === '\n' || character === '\r') {
      index += character === '\r' && text[index + 1] === '\n' ? 2 : 1;
      commandExpected = true;
      continue;
    }
    if (isWhitespace(character)) { index += 1; continue; }

    if (character === '#' && (index === 0 || isWhitespace(text[index - 1]!))) {
      const start = index;
      index = scanLineEnd(text, index, limit);
      if (!addToken(tokens, start, index, 'shell-comment')) return start;
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
      if (!addToken(tokens, start, index, 'shell-string')) return start;
      if (commandExpected) commandExpected = false;
      continue;
    }

    if (character === '$') {
      const end = scanShellVariable(text, index, limit);
      if (end > index + 1) {
        if (!addToken(tokens, index, end, 'shell-variable')) return index;
        index = end;
        continue;
      }
    }

    if (isShellOperator(character)) {
      const start = index;
      index = scanOperator(text, index, limit);
      if (!addToken(tokens, start, index, 'shell-operator')) return start;
      const operator = text.slice(start, index);
      if (operator === ';' || operator === '|' || operator === '||' || operator === '&' || operator === '&&' || operator === '(') commandExpected = true;
      continue;
    }

    const start = index;
    while (index < limit && !isWhitespace(text[index]!) && !isShellOperator(text[index]!) && !isQuote(text[index]!) && text[index] !== '$') index += 1;
    if (index === start) { index += 1; continue; }
    const word = text.slice(start, index);
    if (shellKeywords.has(word)) {
      if (!addToken(tokens, start, index, 'shell-keyword')) return start;
      commandExpected = commandContinuingKeywords.has(word);
    } else if (commandExpected) {
      if (!isShellAssignment(word) && !addToken(tokens, start, index, 'shell-command')) return start;
      if (!isShellAssignment(word)) commandExpected = false;
    } else if (word.startsWith('-') && word.length > 1) {
      if (!addToken(tokens, start, index, 'shell-option')) return start;
    } else if (word.includes('/') || word.startsWith('~')) {
      if (!addToken(tokens, start, index, 'shell-path')) return start;
    } else if (isShellAssignment(word)) {
      const assignment = word.indexOf('=');
      if (!addToken(tokens, start, start + assignment, 'shell-variable')) return start;
      commandExpected = true;
    }
  }
  return limit;
}

function scanPowerShell(text: string, limit: number, tokens: TextSyntaxToken[]): number {
  let index = 0;
  let commandExpected = true;
  let previousTokenIsBareWord = false;
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
      }
      if (!addToken(tokens, start, end, 'powershell-comment')) return start;
      if (character === '<' && /[\r\n]/u.test(text.slice(start, end))) commandExpected = true;
      previousTokenIsBareWord = false;
      index = end;
      continue;
    }

    const hereStringEnd = scanPowerShellHereString(text, index, limit);
    if (hereStringEnd !== undefined) {
      if (!addToken(tokens, index, hereStringEnd, 'powershell-string')) return index;
      index = hereStringEnd;
      commandExpected = false;
      previousTokenIsBareWord = false;
      continue;
    }

    if (character === '\'' || character === '"') {
      const end = scanPowerShellQuotedString(text, index, limit);
      if (!addToken(tokens, index, end, 'powershell-string')) return index;
      index = end;
      commandExpected = false;
      previousTokenIsBareWord = false;
      continue;
    }

    if (character === '$') {
      const end = scanPowerShellVariable(text, index, limit);
      if (end > index + 1 && !addToken(tokens, index, end, 'powershell-variable')) return index;
      index = Math.max(end, index + 1);
      commandExpected = false;
      previousTokenIsBareWord = false;
      continue;
    }

    if (isDigit(character)) {
      const end = scanPowerShellNumber(text, index, limit);
      if (!addToken(tokens, index, end, 'powershell-number')) return index;
      index = end;
      commandExpected = false;
      previousTokenIsBareWord = false;
      continue;
    }

    if (character === '[') {
      const end = scanPowerShellType(text, index, limit);
      if (end !== undefined) {
        if (!addToken(tokens, index, end, 'powershell-type')) return index;
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
      if (!addToken(tokens, index, end, kind)) return index;
      index = end;
      commandExpected = false;
      previousTokenIsBareWord = kind === 'powershell-parameter';
      continue;
    }

    const operatorEnd = scanPowerShellSymbolOperator(text, index, limit);
    if (operatorEnd > index) {
      const operator = text.slice(index, operatorEnd);
      if (!addToken(tokens, index, operatorEnd, 'powershell-operator')) return index;
      index = operatorEnd;
      commandExpected = isPowerShellCommandBoundary(operator);
      previousTokenIsBareWord = false;
      continue;
    }

    if (isPowerShellNameStart(character)) {
      const end = scanPowerShellWord(text, index, limit);
      const word = text.slice(index, end);
      const normalized = word.toLowerCase();
      if (powershellKeywords.has(normalized)) {
        if (!addToken(tokens, index, end, 'powershell-keyword')) return index;
        commandExpected = powershellCommandDeclarationKeywords.has(normalized);
      } else if (commandExpected) {
        if (!addToken(tokens, index, end, 'powershell-command')) return index;
        commandExpected = false;
      }
      previousTokenIsBareWord = true;
      index = end;
      continue;
    }

    index += 1;
  }
  return limit;
}

function scanPowerShellHereString(text: string, start: number, limit: number): number | undefined {
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
    if (lineEnd - lineStart === closingMark.length && text.startsWith(closingMark, lineStart)) return lineEnd;
    if (lineEnd >= limit) return limit;
    lineStart = lineEnd + (text[lineEnd] === '\r' && lineEnd + 1 < limit && text[lineEnd + 1] === '\n' ? 2 : 1);
  }
  return limit;
}

function scanPowerShellQuotedString(text: string, start: number, limit: number): number {
  const quote = text[start]!;
  let index = start + 1;
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
      break;
    }
    index += 1;
  }
  return index;
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
  return operator === '|' || operator === ';' || operator === '&' || operator === '=' || operator === '+=' ||
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
      const keyColon = findYamlKeyColon(text, index, limit, flowMapKeyExpected, true);
      const isKey = keyColon >= end;
      if (!addToken(tokens, index, end, isKey ? 'yaml-key' : 'yaml-string')) return index;
      index = end;
      nodePositionExpected = false;
      mappingColonExpected = isKey;
      continue;
    }

    if (nodePositionExpected && character === '&' && index + 1 < limit && !isYamlPropertyDelimiter(text[index + 1]!)) {
      const end = scanYamlAnchor(text, index, limit);
      if (!addToken(tokens, index, end, 'yaml-anchor')) return index;
      index = end;
      continue;
    }

    if (nodePositionExpected && character === '*' && index + 1 < limit && !isYamlPropertyDelimiter(text[index + 1]!)) {
      const end = scanYamlProperty(text, index, limit);
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

    if ((character === '-' || character === '?') && flowStack.length === 0 && isYamlBlockIndicator(text, index, limit)) {
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

    const keyColon = nodePositionExpected || flowMapKeyExpected
      ? findYamlKeyColon(text, index, limit, flowMapKeyExpected, false)
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

function findYamlKeyColon(text: string, start: number, limit: number, flowMapKeyExpected: boolean, quotedKey: boolean): number {
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
    if (flowMapKeyExpected && ',]}'.includes(character)) return -1;
    if (character === ':' && (isYamlSeparatedColon(text, index, limit) || flowMapKeyExpected)) return index;
    index += 1;
  }
  return -1;
}

function scanYamlPlainScalar(text: string, start: number, limit: number, inFlowCollection: boolean, flowMapKeyExpected: boolean): number {
  let index = start;
  while (index < limit) {
    const character = text[index]!;
    if (isWhitespace(character) || (inFlowCollection && '[]{},'.includes(character))) break;
    if (character === ':' && (isYamlSeparatedColon(text, index, limit) || flowMapKeyExpected)) break;
    index += 1;
  }
  return index;
}

function scanYamlAnchor(text: string, start: number, limit: number): number {
  let index = start + 1;
  while (index < limit && !isYamlPropertyDelimiter(text[index]!) &&
      !(text[index] === ':' && isYamlSeparatedColon(text, index, limit))) index += 1;
  return index;
}

function scanYamlProperty(text: string, start: number, limit: number): number {
  let index = start + 1;
  while (index < limit && !isYamlPropertyDelimiter(text[index]!)) index += 1;
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
  let lineStart = index;
  while (lineStart > 0 && text[lineStart - 1] !== '\n' && text[lineStart - 1] !== '\r') lineStart -= 1;
  return lineStart === index;
}

function scanYamlDocumentMarker(text: string, index: number, limit: number): number {
  if (!isYamlLinePrefix(text, index) || index + 3 > limit) return index;
  const marker = text.slice(index, index + 3);
  if (marker !== '---' && marker !== '...') return index;
  const following = index + 3 < limit ? text[index + 3] : undefined;
  return following === undefined || isWhitespace(following) ? index + 3 : index;
}

function isYamlDirective(text: string, index: number, limit: number): boolean {
  if (!isYamlLinePrefix(text, index)) return false;
  const directive = text.startsWith('%YAML', index) ? '%YAML' : text.startsWith('%TAG', index) ? '%TAG' : undefined;
  if (!directive) return false;
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

  const parentIndent = yamlLineIndent(text, start);
  let requiredIndent = explicitIndent === undefined ? undefined : parentIndent + explicitIndent;
  let cursor = yamlNextLine(text, lineEnd, limit);
  while (cursor < limit) {
    const contentEnd = scanLineEnd(text, cursor, limit);
    let indentation = 0;
    while (cursor + indentation < contentEnd && text[cursor + indentation] === ' ') indentation += 1;
    const blank = cursor + indentation === contentEnd;
    if (blank) {
      if (contentEnd > cursor && !addToken(tokens, cursor, contentEnd, 'yaml-string')) {
        return { nextIndex: cursor, stoppedAt: cursor };
      }
      cursor = yamlNextLine(text, contentEnd, limit);
      continue;
    }
    if (requiredIndent === undefined) {
      if (indentation <= parentIndent) return { nextIndex: cursor };
      requiredIndent = indentation;
    }
    if (indentation < requiredIndent) return { nextIndex: cursor };
    if (!addToken(tokens, cursor, contentEnd, 'yaml-string')) return { nextIndex: cursor, stoppedAt: cursor };
    cursor = yamlNextLine(text, contentEnd, limit);
  }
  return { nextIndex: limit };
}

function yamlLineIndent(text: string, index: number): number {
  let lineStart = index;
  while (lineStart > 0 && text[lineStart - 1] !== '\n' && text[lineStart - 1] !== '\r') lineStart -= 1;
  let indentation = 0;
  while (lineStart + indentation < index && text[lineStart + indentation] === ' ') indentation += 1;
  return indentation;
}

function yamlNextLine(text: string, lineEnd: number, limit: number): number {
  if (lineEnd >= limit) return limit;
  if (text[lineEnd] === '\r' && lineEnd + 1 < limit && text[lineEnd + 1] === '\n') return lineEnd + 2;
  return lineEnd + 1;
}

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
