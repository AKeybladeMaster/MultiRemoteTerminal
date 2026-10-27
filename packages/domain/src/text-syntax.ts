export const MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS = 64_000;
export const MAX_TEXT_SYNTAX_PREVIEW_TOKENS = 4_096;
const MAX_POWERSHELL_NAME_SCAN_CODE_UNITS = 256;

export const TEXT_SYNTAX_PROFILES = ['auto', 'plain', 'shell', 'powershell', 'json'] as const;
export type TextSyntaxProfile = typeof TEXT_SYNTAX_PROFILES[number];
export type ResolvedTextSyntaxProfile = Exclude<TextSyntaxProfile, 'auto'>;

export type TextSyntaxTokenKind =
  | 'shell-command' | 'shell-keyword' | 'shell-option' | 'shell-string' | 'shell-variable' | 'shell-comment' | 'shell-operator' | 'shell-path'
  | 'powershell-command' | 'powershell-keyword' | 'powershell-parameter' | 'powershell-string' | 'powershell-variable'
  | 'powershell-comment' | 'powershell-operator' | 'powershell-number' | 'powershell-type'
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

export function resolveTextSyntaxProfile(profile: TextSyntaxProfile, fileName: string): ResolvedTextSyntaxProfile {
  if (profile !== 'auto') return profile;
  const name = fileName.toLowerCase();
  if (/\.(?:ps1|psm1|psd1|pssc)$/.test(name)) return 'powershell';
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
      while (index < limit && text[index] !== '\n' && text[index] !== '\r') index += 1;
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
  while (index < limit) {
    const character = text[index]!;
    if (isWhitespace(character)) {
      if (character === '\n' || character === '\r') commandExpected = true;
      index += 1;
      continue;
    }

    if (character === '#' || (character === '<' && text[index + 1] === '#')) {
      const start = index;
      let end = limit;
      if (character === '#') {
        end = scanLineEnd(text, index, limit);
      } else {
        const close = findTextWithinLimit(text, '#>', index + 2, limit);
        if (close >= 0) end = close + 2;
      }
      if (!addToken(tokens, start, end, 'powershell-comment')) return start;
      index = end;
      continue;
    }

    const hereStringEnd = scanPowerShellHereString(text, index, limit);
    if (hereStringEnd !== undefined) {
      if (!addToken(tokens, index, hereStringEnd, 'powershell-string')) return index;
      index = hereStringEnd;
      commandExpected = false;
      continue;
    }

    if (character === '\'' || character === '"') {
      const end = scanPowerShellQuotedString(text, index, limit);
      if (!addToken(tokens, index, end, 'powershell-string')) return index;
      index = end;
      commandExpected = false;
      continue;
    }

    if (character === '$') {
      const end = scanPowerShellVariable(text, index, limit);
      if (end > index + 1 && !addToken(tokens, index, end, 'powershell-variable')) return index;
      index = Math.max(end, index + 1);
      commandExpected = false;
      continue;
    }

    if (isDigit(character)) {
      const end = scanPowerShellNumber(text, index, limit);
      if (!addToken(tokens, index, end, 'powershell-number')) return index;
      index = end;
      commandExpected = false;
      continue;
    }

    if (character === '[') {
      const end = scanPowerShellType(text, index, limit);
      if (end !== undefined) {
        if (!addToken(tokens, index, end, 'powershell-type')) return index;
        index = end;
        commandExpected = false;
        continue;
      }
    }

    if (character === '-' && isPowerShellNameStart(text[index + 1] ?? '')) {
      const end = scanPowerShellWord(text, index + 1, limit);
      const operator = `-${text.slice(index + 1, end).toLowerCase()}`;
      const kind = powershellWordOperators.has(operator) ? 'powershell-operator' : 'powershell-parameter';
      if (!addToken(tokens, index, end, kind)) return index;
      index = end;
      commandExpected = false;
      continue;
    }

    const operatorEnd = scanPowerShellSymbolOperator(text, index, limit);
    if (operatorEnd > index) {
      const operator = text.slice(index, operatorEnd);
      if (!addToken(tokens, index, operatorEnd, 'powershell-operator')) return index;
      index = operatorEnd;
      commandExpected = isPowerShellCommandBoundary(operator);
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
      index = end;
      continue;
    }

    index += 1;
  }
  return limit;
}

function scanPowerShellHereString(text: string, start: number, limit: number): number | undefined {
  if (text[start] !== '@' || (text[start + 1] !== '\'' && text[start + 1] !== '"')) return undefined;
  const quote = text[start + 1]!;
  let lineStart = start + 2;
  if (text[lineStart] === '\r' && text[lineStart + 1] === '\n') lineStart += 2;
  else if (text[lineStart] === '\n' || text[lineStart] === '\r') lineStart += 1;
  else return undefined;

  const closingMark = `${quote}@`;
  while (lineStart < limit) {
    const lineEnd = scanLineEnd(text, lineStart, limit);
    if (lineEnd - lineStart === closingMark.length && text.startsWith(closingMark, lineStart)) return lineEnd;
    if (lineEnd >= limit) return limit;
    lineStart = lineEnd + (text[lineEnd] === '\r' && text[lineEnd + 1] === '\n' ? 2 : 1);
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
      if (quote === '\'' && text[index + 1] === '\'') {
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
  if (text[index] === '{') {
    const scanLimit = Math.min(limit, index + MAX_POWERSHELL_NAME_SCAN_CODE_UNITS);
    while (index < scanLimit && text[index] !== '}' && text[index] !== '\n' && text[index] !== '\r') index += 1;
    return text[index] === '}' ? index + 1 : start + 1;
  }
  if ('?^!'.includes(text[index] ?? '\0')) return index + 1;
  if (!isPowerShellNameStart(text[index] ?? '')) return start + 1;

  index = scanPowerShellVariableName(text, index, limit);
  while (text[index] === ':' && isPowerShellNameStart(text[index + 1] ?? '')) {
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
  if (text[index] === '0' && (text[index + 1] === 'x' || text[index + 1] === 'X')) {
    index += 2;
    while (index < limit && (isDigit(text[index]!) || /[A-Fa-f_]/u.test(text[index]!))) index += 1;
    return index;
  }
  while (index < limit && (isDigit(text[index]!) || text[index] === '_')) index += 1;
  if (text[index] === '.' && text[index + 1] !== '.' && isDigit(text[index + 1] ?? '')) {
    index += 1;
    while (index < limit && (isDigit(text[index]!) || text[index] === '_')) index += 1;
  }
  if ((text[index] === 'e' || text[index] === 'E') &&
      (isDigit(text[index + 1] ?? '') || ((text[index + 1] === '+' || text[index + 1] === '-') && isDigit(text[index + 2] ?? '')))) {
    index += 1;
    if (text[index] === '+' || text[index] === '-') index += 1;
    while (index < limit && isDigit(text[index]!)) index += 1;
  }
  while (index < limit && /[A-Za-z]/u.test(text[index]!)) index += 1;
  return index;
}

function scanPowerShellType(text: string, start: number, limit: number): number | undefined {
  let index = start + 1;
  if (!isPowerShellNameStart(text[index] ?? '')) return undefined;
  while (index < limit && index - start <= MAX_POWERSHELL_NAME_SCAN_CODE_UNITS &&
      (isPowerShellNamePart(text[index]!) || text[index] === '.' || text[index] === '+')) index += 1;
  if (text[index] === '[' && text[index + 1] === ']' && text[index + 2] === ']') return index + 3;
  return text[index] === ']' ? index + 1 : undefined;
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

function findTextWithinLimit(text: string, target: string, start: number, limit: number): number {
  for (let index = start; index + target.length <= limit; index += 1) {
    if (text.startsWith(target, index)) return index;
  }
  return -1;
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
