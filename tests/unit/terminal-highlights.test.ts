import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTerminalHighlightMatcher,
  MAX_TERMINAL_HIGHLIGHT_MATCHES_PER_LINE,
  MAX_TERMINAL_HIGHLIGHT_PATTERN_CODE_POINTS,
  normalizeTerminalHighlightRules
} from '../../packages/domain/src/terminal-highlights.ts';

test('terminal highlight rules validate and return Unicode-safe text ranges', () => {
  const rules = normalizeTerminalHighlightRules([
    { pattern: '\\b(?:git|ssh)\\b', color: 'cyan' },
    { pattern: '😄', color: 'magenta' }
  ]);
  assert.ok(rules);
  const text = 'git status, ssh host; 你好 😄';
  const matches = createTerminalHighlightMatcher(rules).findMatches(text);
  assert.deepEqual(matches.map(match => ({ text: text.slice(match.start, match.end), color: match.color })), [
    { text: 'git', color: 'cyan' },
    { text: 'ssh', color: 'cyan' },
    { text: '😄', color: 'magenta' }
  ]);
});

test('terminal highlight rules reject malformed, unbounded, and unsupported patterns', () => {
  assert.equal(normalizeTerminalHighlightRules([{ pattern: '(?<=x)y', color: 'red' }]), undefined);
  assert.equal(normalizeTerminalHighlightRules([{ pattern: '(a)\\1', color: 'red' }]), undefined);
  assert.equal(normalizeTerminalHighlightRules([{ pattern: 'x'.repeat(MAX_TERMINAL_HIGHLIGHT_PATTERN_CODE_POINTS + 1), color: 'red' }]), undefined);
  assert.equal(normalizeTerminalHighlightRules([{ pattern: 'x', color: 'orange' }]), undefined);
  assert.equal(normalizeTerminalHighlightRules([{ pattern: 'x', color: 'red', command: 'whoami' }]), undefined);
  assert.equal(normalizeTerminalHighlightRules(Array.from({ length: 9 }, () => ({ pattern: 'x', color: 'red' }))), undefined);
});

test('terminal highlight matching handles nested quantifiers with bounded results and ignores empty ranges', () => {
  const rules = normalizeTerminalHighlightRules([
    { pattern: '(a+)+!', color: 'yellow' },
    { pattern: '^', color: 'blue' }
  ]);
  assert.ok(rules);
  const text = `${'a'.repeat(1_500)}!`;
  const matcher = createTerminalHighlightMatcher(rules);
  const matches = matcher.findMatches(text, 1);
  assert.equal(matches.length, 1);
  assert.equal(text.slice(matches[0]!.start, matches[0]!.end), text);
  assert.equal(matcher.findMatches('short', MAX_TERMINAL_HIGHLIGHT_MATCHES_PER_LINE).length, 0);
  assert.equal(matcher.findMatches('x'.repeat(2_049)).length, 0);
});
