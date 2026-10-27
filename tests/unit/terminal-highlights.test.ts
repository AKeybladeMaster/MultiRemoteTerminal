import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTerminalHighlightMatcher,
  MAX_TERMINAL_HIGHLIGHT_MATCHES_PER_LINE,
  MAX_TERMINAL_HIGHLIGHT_PATTERN_CODE_POINTS,
  normalizeTerminalHighlightRules
} from '../../packages/domain/src/terminal-highlights.ts';
import { clearTerminalShellInputAnchor, extractBoundedTerminalHighlightLine, getTerminalPromptSyntaxProfile,
  isPowerShellContinuationPromptAtCursor, isShellContinuationPromptAtCursor, isShellInputAnchorActive,
  readTerminalPowerShellContinuationState } from '../../apps/desktop/src/renderer/terminal-highlighting.ts';
import type { TerminalShellInputAnchor } from '../../apps/desktop/src/renderer/terminal-highlighting.ts';
import type { Terminal } from '@xterm/xterm';

function createPowerShellInputHarness(
  prompt: string,
  input: string,
  sameRowRemainder = '',
  wrappedRowRemainder = '',
  cursorColumn = prompt.length + input.length
): {
  readonly terminal: Terminal;
  readonly anchor: TerminalShellInputAnchor;
} {
  const createLine = (text: string, isWrapped: boolean) => {
    const cells = Array.from(text);
    return {
      isWrapped,
      length: 80,
      getCell(column: number) {
        const character = cells[column] ?? '';
        return { getChars: () => character, getWidth: () => 1, getCode: () => character.codePointAt(0) ?? 0 };
      }
    };
  };
  const lines = [createLine(`${prompt}${input}${sameRowRemainder}`, false)];
  if (wrappedRowRemainder.length > 0) lines.push(createLine(wrappedRowRemainder, true));
  const terminal = {
    cols: 80,
    buffer: {
      active: {
        type: 'normal', baseY: 0, cursorY: 0, cursorX: cursorColumn,
        getLine: (lineNumber: number) => lines[lineNumber],
        getNullCell: () => ({})
      }
    }
  } as unknown as Terminal;
  const anchor = {
    marker: { line: 0, isDisposed: false }, startColumn: prompt.length, wrappedMarkers: [], decorations: [], profile: 'powershell'
  } as unknown as TerminalShellInputAnchor;
  return { terminal, anchor };
}

test('shell prompt detection accepts common shell and zsh-style endings and rejects password prompts', () => {
  for (const prompt of ['user@host:~/work$ ', 'root@host#', 'user@host% ', 'project ❯ ', 'build ➜ ']) {
    assert.equal(getTerminalPromptSyntaxProfile(prompt), 'shell', prompt);
  }
  for (const prompt of ['Password: ', 'Verification code: ', 'ordinary output']) {
    assert.equal(getTerminalPromptSyntaxProfile(prompt), undefined, prompt);
  }
});

test('terminal prompt detection selects PowerShell only for its common PS path prompt form', () => {
  for (const prompt of ['PS C:\\work> ', 'ps C:\\Users\\tester> ']) {
    assert.equal(getTerminalPromptSyntaxProfile(prompt), 'powershell', prompt);
  }
  for (const prompt of ['user@host:~/work$ ', 'root@host#', 'user@host% ', 'project ❯ ']) {
    assert.equal(getTerminalPromptSyntaxProfile(prompt), 'shell', prompt);
  }
  for (const prompt of ['PS> ', 'PS > ', 'Password: ', 'Verification code: ', 'ordinary output']) {
    assert.equal(getTerminalPromptSyntaxProfile(prompt), undefined, prompt);
  }
  assert.equal(getTerminalPromptSyntaxProfile('>> '), undefined, 'PowerShell continuation prompts are not treated as Shell prompts');
});

test('shell continuation prompt detection accepts secondary prompts ending in greater-than only', () => {
  for (const prompt of ['> ', 'quote> ', 'dquote> ']) assert.equal(isShellContinuationPromptAtCursor(prompt), true, prompt);
  for (const prompt of ['user@host$ ', 'user@host% ', 'ordinary output']) {
    assert.equal(isShellContinuationPromptAtCursor(prompt), false, prompt);
  }
});

test('PowerShell continuation prompt detection accepts only the exact secondary prompt', () => {
  for (const prompt of ['>>', '>> ']) assert.equal(isPowerShellContinuationPromptAtCursor(prompt), true, prompt);
  for (const prompt of ['> ', 'PS C:\\work>> ', 'custom>> ', ' >> ']) {
    assert.equal(isPowerShellContinuationPromptAtCursor(prompt), false, prompt);
  }
});

test('shell input anchor cleanup releases its marker and clears state', () => {
  const createMarker = () => {
    let disposeCount = 0;
    const marker = {
      isDisposed: false,
      dispose() {
        disposeCount += 1;
        this.isDisposed = true;
      },
      disposeCount: () => disposeCount
    };
    return marker;
  };
  const marker = createMarker();
  const wrappedMarker = createMarker();
  let decorationDisposeCount = 0;
  const anchorRef = { current: { marker: marker as unknown as TerminalShellInputAnchor['marker'], startColumn: 4, profile: 'shell' as const,
    wrappedMarkers: [wrappedMarker as unknown as TerminalShellInputAnchor['marker']],
    decorations: [{ dispose: () => { decorationDisposeCount += 1; } }] } };

  clearTerminalShellInputAnchor(anchorRef);
  assert.equal(anchorRef.current, undefined);
  assert.equal(marker.disposeCount(), 1);
  assert.equal(wrappedMarker.disposeCount(), 1);
  assert.equal(decorationDisposeCount, 1);

  clearTerminalShellInputAnchor(anchorRef);
  assert.equal(marker.disposeCount(), 1);
  assert.equal(wrappedMarker.disposeCount(), 1);
  assert.equal(decorationDisposeCount, 1);
});

test('wrapped shell input recovers within bounds and rejects a broken wrapped chain', () => {
  const anchor = { marker: { line: 0, isDisposed: false }, startColumn: 0, wrappedMarkers: [], decorations: [] };
  let reads = 0;
  const terminal = { buffer: { active: { type: 'normal', getLine: (line: number) => {
    reads += 1;
    return { isWrapped: line > 0 };
  } } } } as unknown as Terminal;

  assert.equal(isShellInputAnchorActive(terminal, anchor as unknown as TerminalShellInputAnchor, 128), true);
  assert.equal(reads, 1, 'overflow validation should inspect only the cursor row');

  reads = 0;
  assert.equal(isShellInputAnchorActive(terminal, anchor as unknown as TerminalShellInputAnchor, 127), true);
  assert.equal(reads, 127, 'returning within bounds should revalidate every intervening row');

  const brokenTerminal = { buffer: { active: { type: 'normal', getLine: (line: number) => ({ isWrapped: line > 0 && line !== 64 }) } } } as unknown as Terminal;
  assert.equal(isShellInputAnchorActive(brokenTerminal, anchor as unknown as TerminalShellInputAnchor, 127), false);
});

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
  assert.equal(createTerminalHighlightMatcher([{ pattern: 'x', color: 'red' }]).findMatches('x'.repeat(100), 96).length,
    MAX_TERMINAL_HIGHLIGHT_MATCHES_PER_LINE);
});

test('terminal highlighting bounds cell extraction before copying oversized cell text', () => {
  let reads = 0;
  const extracted = extractBoundedTerminalHighlightLine(80, column => {
    reads += 1;
    return { text: column === 0 ? 'x'.repeat(10_000) : 'x', width: 1 };
  });
  assert.equal(extracted, undefined);
  assert.equal(reads, 1);

  const ordinary = extractBoundedTerminalHighlightLine(4, column => ({
    text: ['A', '😀', ' ', ' '][column] ?? '', width: column === 1 ? 2 : 1
  }));
  assert.deepEqual(ordinary, { text: 'A😀', cellSpans: [
    { start: 0, end: 1, column: 0, width: 1 }, { start: 1, end: 3, column: 1, width: 2 },
    { start: 3, end: 4, column: 2, width: 1 }, { start: 4, end: 5, column: 3, width: 1 }
  ] });
});

test('bounded shell-input extraction preserves wrapped-row spaces when requested', () => {
  const cells = ['i', 'f', ' ', ' '];
  const readCell = (column: number) => ({ text: cells[column] ?? '', width: 1 });

  assert.equal(extractBoundedTerminalHighlightLine(4, readCell)?.text, 'if');
  assert.equal(extractBoundedTerminalHighlightLine(4, readCell, false)?.text, 'if  ');
});

test('PowerShell continuation state is withheld when the caret is before remaining input', () => {
  const prompt = 'PS C:\\work> ';
  const command = 'Get-Item `';
  const { terminal, anchor } = createPowerShellInputHarness(prompt, command, 'x');

  assert.equal(readTerminalPowerShellContinuationState(terminal, anchor), undefined,
    'a character after the caret means the input does not end at the visible backtick');
});

test('PowerShell continuation state is withheld when the remaining input is in a wrapped row', () => {
  const prompt = 'PS C:\\work> ';
  const command = 'Get-Item `';
  const { terminal, anchor } = createPowerShellInputHarness(prompt, command, '', 'x');

  assert.equal(readTerminalPowerShellContinuationState(terminal, anchor), undefined,
    'a wrapped continuation row after the caret is still part of the same input');
});

test('PowerShell continuation state fails closed for an ambiguous xterm wrap-pending cursor cell', () => {
  const prompt = 'PS C:\\work> ';
  const input = `${'x'.repeat(80 - prompt.length - 1)}\``;
  const { terminal, anchor } = createPowerShellInputHarness(prompt, input, '', '', 79);

  assert.equal(prompt.length + input.length, 80, 'the final character occupies the terminal right margin');
  assert.equal(readTerminalPowerShellContinuationState(terminal, anchor), undefined,
    'the xterm buffer API cannot distinguish an after-character cursor from a caret before that occupied cell');
});

test('PowerShell continuation state remains available when the caret is at the input end', () => {
  const prompt = 'PS C:\\work> ';
  const command = 'Get-Item `';
  const { terminal, anchor } = createPowerShellInputHarness(prompt, command);

  assert.deepEqual(readTerminalPowerShellContinuationState(terminal, anchor), {
    commandExpected: false,
    previousTokenIsBareWord: false
  });
});
