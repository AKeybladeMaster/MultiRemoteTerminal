import type { IMarker, Terminal } from '@xterm/xterm';
import {
  createTerminalHighlightMatcher,
  MAX_TERMINAL_HIGHLIGHT_LINE_CODE_UNITS,
  MAX_TERMINAL_HIGHLIGHT_MATCHES_PER_LINE,
  MAX_TERMINAL_HIGHLIGHT_MATCHES_PER_REFRESH,
  normalizeTerminalHighlightRules
} from '../../../../packages/domain/src/terminal-highlights.ts';
import type { TerminalHighlightRule, TerminalHighlightColor } from '../../../../packages/domain/src/terminal-highlights.ts';
import { highlightTextSyntax } from '../../../../packages/domain/src/text-syntax.ts';
import type { TextSyntaxTokenKind } from '../../../../packages/domain/src/text-syntax.ts';
import { terminalThemes } from './terminal-theme.ts';
import type { TerminalTheme } from './terminal-theme.ts';

const MAX_TERMINAL_HIGHLIGHT_ROWS = 128;
const MAX_TERMINAL_SHELL_SYNTAX_DECORATIONS = 64;

const shellSyntaxPaletteKeys: Readonly<Partial<Record<TextSyntaxTokenKind, keyof typeof terminalThemes.dark>>> = Object.freeze({
  'shell-command': 'cyan', 'shell-keyword': 'magenta', 'shell-option': 'yellow', 'shell-string': 'brightGreen',
  'shell-variable': 'brightBlue', 'shell-comment': 'brightBlack', 'shell-operator': 'brightRed', 'shell-path': 'blue'
});

interface Disposable {
  dispose(): void;
}

export interface TerminalHighlightCellValue {
  readonly text: string;
  readonly width: number;
}

export interface TerminalHighlightCellSpan {
  readonly start: number;
  readonly end: number;
  readonly column: number;
  readonly width: number;
}

export interface BoundedTerminalHighlightLine {
  readonly text: string;
  readonly cellSpans: readonly TerminalHighlightCellSpan[];
}

export interface TerminalShellInputAnchor {
  readonly marker: IMarker;
  readonly startColumn: number;
}

export interface TerminalHighlightOptions {
  readonly keywordHighlightingEnabled: boolean;
  readonly keywordRules: readonly TerminalHighlightRule[];
  readonly shellSyntaxEnabled: boolean;
  readonly getShellInputAnchor: () => TerminalShellInputAnchor | undefined;
  readonly theme: TerminalTheme;
}

export function isShellPromptAtCursor(promptText: string): boolean {
  const trimmed = promptText.trimEnd();
  const lastCharacter = trimmed.at(-1);
  return lastCharacter === '$' || lastCharacter === '#' || lastCharacter === '%' || lastCharacter === '>';
}

export function extractBoundedTerminalHighlightLine(
  columnCount: number,
  readCell: (column: number) => TerminalHighlightCellValue | undefined
): BoundedTerminalHighlightLine | undefined {
  if (!Number.isSafeInteger(columnCount) || columnCount <= 0) return undefined;
  const cellSpans: TerminalHighlightCellSpan[] = [];
  let fullText = '';
  let trimmedTextLength = 0;
  const scanLimit = Math.min(columnCount, MAX_TERMINAL_HIGHLIGHT_LINE_CODE_UNITS + 1);

  for (let column = 0; column < scanLimit; column += 1) {
    const cell = readCell(column);
    if (!cell) break;
    if (!Number.isSafeInteger(cell.width) || cell.width < 0 || typeof cell.text !== 'string') return undefined;
    if (cell.width === 0) continue;
    const chars = cell.text || ' ';
    if (chars.length > MAX_TERMINAL_HIGHLIGHT_LINE_CODE_UNITS - fullText.length) return undefined;
    const start = fullText.length;
    fullText += chars;
    if (chars !== ' ') trimmedTextLength = fullText.length;
    cellSpans.push({ start, end: fullText.length, column, width: cell.width });
  }

  if (trimmedTextLength === 0) return undefined;
  return { text: fullText.slice(0, trimmedTextLength), cellSpans };
}

export function attachTerminalHighlights(
  terminal: Terminal,
  options: TerminalHighlightOptions
): Disposable {
  const rules = normalizeTerminalHighlightRules(options.keywordRules);
  const matcher = options.keywordHighlightingEnabled && rules?.length ? createTerminalHighlightMatcher(rules) : undefined;
  if (!matcher && !options.shellSyntaxEnabled) return { dispose() {} };
  const decorations: Disposable[] = [];
  const markers: Disposable[] = [];
  let frame: number | undefined;
  let disposed = false;

  function clearDecorations() {
    while (decorations.length > 0) decorations.pop()?.dispose();
    while (markers.length > 0) markers.pop()?.dispose();
  }

  function refresh() {
    frame = undefined;
    if (disposed) return;
    clearDecorations();
    const buffer = terminal.buffer.active;
    if (buffer.type !== 'normal') return;

    const cursorLine = buffer.baseY + buffer.cursorY;
    const cellScratch = buffer.getNullCell();

    if (matcher) {
      const scanCount = Math.min(terminal.rows, MAX_TERMINAL_HIGHLIGHT_ROWS);
      const firstLine = buffer.viewportY + Math.max(0, terminal.rows - scanCount);
      const lastLineExclusive = Math.min(buffer.length, buffer.viewportY + terminal.rows);
      let remainingMatches = MAX_TERMINAL_HIGHLIGHT_MATCHES_PER_REFRESH;

      for (let lineNumber = firstLine; lineNumber < lastLineExclusive && remainingMatches > 0; lineNumber += 1) {
        const line = buffer.getLine(lineNumber);
        if (!line) continue;
        const extracted = extractBoundedTerminalHighlightLine(Math.min(line.length, terminal.cols), column => {
          const cell = line.getCell(column, cellScratch);
          return cell ? { text: cell.getChars(), width: cell.getWidth() } : undefined;
        });
        if (!extracted) continue;
        const { text, cellSpans } = extracted;
        const matches = matcher.findMatches(text, Math.min(remainingMatches, MAX_TERMINAL_HIGHLIGHT_MATCHES_PER_LINE));
        if (matches.length === 0) continue;
        const marker = terminal.registerMarker(lineNumber - cursorLine);
        if (!marker || marker.isDisposed) continue;
        markers.push(marker);

        for (const match of matches) {
          const firstSpan = cellSpans.find(span => match.start >= span.start && match.start < span.end);
          const lastSpan = cellSpans.find(span => match.end - 1 >= span.start && match.end - 1 < span.end);
          if (!firstSpan || !lastSpan) continue;
          const width = lastSpan.column + lastSpan.width - firstSpan.column;
          if (width <= 0) continue;
          const foregroundColor = terminalHighlightForeground(options.theme, match.color);
          const decoration = terminal.registerDecoration({
            marker,
            anchor: 'left',
            x: firstSpan.column,
            width,
            foregroundColor,
            layer: 'top'
          });
          if (decoration) decorations.push(decoration);
          remainingMatches -= 1;
          if (remainingMatches <= 0) break;
        }
      }
    }

    if (options.shellSyntaxEnabled) {
      const inputAnchor = options.getShellInputAnchor();
      if (!inputAnchor || inputAnchor.marker.isDisposed || inputAnchor.marker.line !== cursorLine) return;
      const line = buffer.getLine(cursorLine);
      if (!line) return;
      const extracted = extractBoundedTerminalHighlightLine(Math.min(line.length, terminal.cols), column => {
        const cell = line.getCell(column, cellScratch);
        return cell ? { text: cell.getChars(), width: cell.getWidth() } : undefined;
      });
      if (!extracted) return;
      const startSpan = extracted.cellSpans.find(span => span.column >= inputAnchor.startColumn);
      if (!startSpan) return;
      const command = extracted.text.slice(startSpan.start);
      const tokens = highlightTextSyntax(command, 'shell').tokens.slice(0, MAX_TERMINAL_SHELL_SYNTAX_DECORATIONS);
      for (const token of tokens) {
        const firstSpan = extracted.cellSpans.find(span => span.start <= startSpan.start + token.start &&
          startSpan.start + token.start < span.end);
        const tokenEnd = startSpan.start + token.end;
        const lastSpan = extracted.cellSpans.find(span => span.start < tokenEnd && tokenEnd <= span.end);
        const paletteKey = shellSyntaxPaletteKeys[token.kind];
        if (!firstSpan || !lastSpan || !paletteKey) continue;
        const width = lastSpan.column + lastSpan.width - firstSpan.column;
        if (width <= 0) continue;
        const decoration = terminal.registerDecoration({ marker: inputAnchor.marker, anchor: 'left', x: firstSpan.column, width,
          foregroundColor: terminalThemes[options.theme][paletteKey], layer: 'top' });
        if (decoration) decorations.push(decoration);
      }
    }
  }

  function scheduleRefresh() {
    if (!disposed && frame === undefined) frame = requestAnimationFrame(refresh);
  }

  const parsed = terminal.onWriteParsed(scheduleRefresh);
  const scrolled = terminal.onScroll(scheduleRefresh);
  const resized = terminal.onResize(scheduleRefresh);
  const bufferChanged = terminal.buffer.onBufferChange(scheduleRefresh);
  scheduleRefresh();

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      if (frame !== undefined) cancelAnimationFrame(frame);
      parsed.dispose();
      scrolled.dispose();
      resized.dispose();
      bufferChanged.dispose();
      clearDecorations();
    }
  };
}

function terminalHighlightForeground(theme: TerminalTheme, color: TerminalHighlightColor): string {
  return terminalThemes[theme][color];
}
