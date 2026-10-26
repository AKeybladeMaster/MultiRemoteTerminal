export const MAX_TEXT_SYNTAX_PREVIEW_CODE_UNITS = 64_000;
export const MAX_TEXT_SYNTAX_PREVIEW_TOKENS = 4_096;

export const TEXT_SYNTAX_PROFILES = ['auto', 'plain', 'shell', 'json'] as const;
export type TextSyntaxProfile = typeof TEXT_SYNTAX_PROFILES[number];
export type ResolvedTextSyntaxProfile = Exclude<TextSyntaxProfile, 'auto'>;

export type TextSyntaxTokenKind =
  | 'shell-command' | 'shell-keyword' | 'shell-option' | 'shell-string' | 'shell-variable' | 'shell-comment' | 'shell-operator' | 'shell-path'
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

export function resolveTextSyntaxProfile(profile: TextSyntaxProfile, fileName: string): ResolvedTextSyntaxProfile {
  if (profile !== 'auto') return profile;
  const name = fileName.toLowerCase();
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
  const scannedThrough = profile === 'shell'
    ? scanShell(text, limit, tokens)
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
