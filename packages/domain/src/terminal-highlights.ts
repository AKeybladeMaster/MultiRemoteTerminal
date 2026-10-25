import { RE2JS } from 're2js';

export const MAX_TERMINAL_HIGHLIGHT_RULES = 8;
export const MAX_TERMINAL_HIGHLIGHT_PATTERN_CODE_POINTS = 128;
export const MAX_TERMINAL_HIGHLIGHT_PROGRAM_SIZE = 512;
export const MAX_TERMINAL_HIGHLIGHT_LINE_CODE_UNITS = 2_048;
export const MAX_TERMINAL_HIGHLIGHT_MATCHES_PER_LINE = 24;
export const MAX_TERMINAL_HIGHLIGHT_MATCHES_PER_REFRESH = 96;

export const TERMINAL_HIGHLIGHT_COLORS = ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan'] as const;
export type TerminalHighlightColor = typeof TERMINAL_HIGHLIGHT_COLORS[number];

export interface TerminalHighlightRule {
  readonly pattern: string;
  readonly color: TerminalHighlightColor;
}

export interface TerminalHighlightMatch {
  readonly start: number;
  readonly end: number;
  readonly color: TerminalHighlightColor;
  readonly ruleIndex: number;
}

export interface TerminalHighlightMatcher {
  findMatches(text: string, limit?: number): readonly TerminalHighlightMatch[];
}

export function normalizeTerminalHighlightRules(value: unknown): readonly TerminalHighlightRule[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_TERMINAL_HIGHLIGHT_RULES) return undefined;
  const rules: TerminalHighlightRule[] = [];
  for (const candidate of value as readonly unknown[]) {
    if (!isRecord(candidate) || Object.keys(candidate).length !== 2 ||
        !Object.hasOwn(candidate, 'pattern') || !Object.hasOwn(candidate, 'color') ||
        typeof candidate.pattern !== 'string' || typeof candidate.color !== 'string') return undefined;
    const pattern = candidate.pattern;
    if (pattern.length === 0 || pattern.length > MAX_TERMINAL_HIGHLIGHT_PATTERN_CODE_POINTS * 2 ||
        Array.from(pattern).length > MAX_TERMINAL_HIGHLIGHT_PATTERN_CODE_POINTS || /\p{Cc}/u.test(pattern) ||
        !isTerminalHighlightColor(candidate.color)) return undefined;

    try {
      const compiled = RE2JS.compile(pattern);
      if (compiled.programSize() > MAX_TERMINAL_HIGHLIGHT_PROGRAM_SIZE || compiled.groupCount() > 16) return undefined;
    } catch {
      return undefined;
    }
    rules.push(Object.freeze({ pattern, color: candidate.color }));
  }
  return Object.freeze(rules);
}

export function createTerminalHighlightMatcher(value: readonly TerminalHighlightRule[]): TerminalHighlightMatcher {
  const rules = normalizeTerminalHighlightRules(value) ?? Object.freeze([]);
  const compiled = rules.map(rule => RE2JS.compile(rule.pattern));
  return Object.freeze({
    findMatches(text: string, limit = MAX_TERMINAL_HIGHLIGHT_MATCHES_PER_LINE): readonly TerminalHighlightMatch[] {
      if (typeof text !== 'string' || text.length > MAX_TERMINAL_HIGHLIGHT_LINE_CODE_UNITS ||
          !Number.isInteger(limit) || limit <= 0) return Object.freeze([]);
      const matches: TerminalHighlightMatch[] = [];
      const maximum = Math.min(limit, MAX_TERMINAL_HIGHLIGHT_MATCHES_PER_LINE, MAX_TERMINAL_HIGHLIGHT_MATCHES_PER_REFRESH);
      for (let ruleIndex = 0; ruleIndex < rules.length && matches.length < maximum; ruleIndex += 1) {
        const matcher = compiled[ruleIndex]!.matcher(text);
        let searchFrom = 0;
        while (searchFrom <= text.length && matches.length < maximum && matcher.find(searchFrom)) {
          const start = matcher.start();
          const end = matcher.end();
          if (start < 0 || end <= start || end > text.length) {
            searchFrom = Math.max(start + 1, searchFrom + 1);
            continue;
          }
          matches.push(Object.freeze({ start, end, color: rules[ruleIndex]!.color, ruleIndex }));
          searchFrom = end;
        }
      }
      return Object.freeze(matches);
    }
  });
}

function isTerminalHighlightColor(value: string): value is TerminalHighlightColor {
  return (TERMINAL_HIGHLIGHT_COLORS as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
