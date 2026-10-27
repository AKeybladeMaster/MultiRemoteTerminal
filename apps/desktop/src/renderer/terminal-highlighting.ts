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
  readonly wrappedMarkers: IMarker[];
  readonly decorations: Disposable[];
}

export interface TerminalShellInputAnchorRef {
  current: TerminalShellInputAnchor | undefined;
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
  return lastCharacter === '$' || lastCharacter === '#' || lastCharacter === '%' || lastCharacter === '>' ||
    lastCharacter === '❯' || lastCharacter === '➜';
}

export function clearTerminalShellInputAnchor(anchorRef: TerminalShellInputAnchorRef): void {
  const anchor = anchorRef.current;
  anchorRef.current = undefined;
  if (!anchor) return;
  clearTerminalShellInputDecorations(anchor);
  if (!anchor.marker.isDisposed) anchor.marker.dispose();
}

function clearTerminalShellInputDecorations(anchor: TerminalShellInputAnchor): void {
  while (anchor.decorations.length > 0) anchor.decorations.pop()?.dispose();
  while (anchor.wrappedMarkers.length > 0) {
    const marker = anchor.wrappedMarkers.pop();
    if (marker && !marker.isDisposed) marker.dispose();
  }
}

export function isShellInputAnchorActive(terminal: Terminal, anchor: TerminalShellInputAnchor, cursorLine: number): boolean {
  const buffer = terminal.buffer.active;
  if (buffer.type !== 'normal' || anchor.marker.isDisposed) return false;
  const wrappedRowCount = cursorLine - anchor.marker.line;
  if (wrappedRowCount < 0 || wrappedRowCount >= MAX_TERMINAL_HIGHLIGHT_ROWS) return false;
  for (let lineNumber = anchor.marker.line + 1; lineNumber <= cursorLine; lineNumber += 1) {
    if (!buffer.getLine(lineNumber)?.isWrapped) return false;
  }
  return true;
}

export function extractBoundedTerminalHighlightLine(
  columnCount: number,
  readCell: (column: number) => TerminalHighlightCellValue | undefined,
  trimTrailingSpaces = true
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

  const textLength = trimTrailingSpaces ? trimmedTextLength : fullText.length;
  if (textLength === 0) return undefined;
  return { text: fullText.slice(0, textLength), cellSpans };
}

function extractBoundedTerminalBufferLine(terminal: Terminal, lineNumber: number, columnCount = terminal.cols,
  trimTrailingSpaces = true): BoundedTerminalHighlightLine | undefined {
  const buffer = terminal.buffer.active;
  const line = buffer.getLine(lineNumber);
  if (!line) return undefined;
  const cellScratch = buffer.getNullCell();
  return extractBoundedTerminalHighlightLine(Math.min(line.length, columnCount), column => {
    const cell = line.getCell(column, cellScratch);
    return cell ? { text: cell.getChars(), width: cell.getWidth() } : undefined;
  }, trimTrailingSpaces);
}

interface TerminalShellInputRow {
  readonly lineNumber: number;
  readonly commandStart: number;
  readonly commandEnd: number;
  readonly inputTextStart: number;
  readonly cellSpans: readonly TerminalHighlightCellSpan[];
}

interface TerminalShellInput {
  readonly text: string;
  readonly rows: readonly TerminalShellInputRow[];
}

function extractTerminalShellInput(terminal: Terminal, anchor: TerminalShellInputAnchor, cursorLine: number): TerminalShellInput | undefined {
  const buffer = terminal.buffer.active;
  if (!isShellInputAnchorActive(terminal, anchor, cursorLine)) {
    return undefined;
  }
  let text = '';
  const rows: TerminalShellInputRow[] = [];
  for (let lineNumber = anchor.marker.line; lineNumber <= cursorLine; lineNumber += 1) {
    const columnCount = lineNumber === cursorLine ? Math.min(terminal.cols, buffer.cursorX + 1) : terminal.cols;
    const extracted = extractBoundedTerminalBufferLine(terminal, lineNumber, columnCount, false);
    if (!extracted) return undefined;
    const inputStartColumn = lineNumber === anchor.marker.line ? anchor.startColumn : 0;
    const inputStartSpan = extracted.cellSpans.find(span => span.column >= inputStartColumn && span.column < columnCount);
    const inputTextStart = inputStartSpan?.start ?? extracted.text.length;
    const lineText = extracted.text.slice(inputTextStart);
    if (text.length + lineText.length > MAX_TERMINAL_HIGHLIGHT_LINE_CODE_UNITS) return undefined;
    rows.push({ lineNumber, commandStart: text.length, commandEnd: text.length + lineText.length, inputTextStart, cellSpans: extracted.cellSpans });
    text += lineText;
  }
  return { text, rows };
}

export function attachTerminalHighlights(
  terminal: Terminal,
  options: TerminalHighlightOptions
): Disposable {
  const rules = normalizeTerminalHighlightRules(options.keywordRules);
  const matcher = options.keywordHighlightingEnabled && rules?.length ? createTerminalHighlightMatcher(rules) : undefined;
  if (!matcher && !options.shellSyntaxEnabled) return { dispose() {} };
  const keywordDecorations: Disposable[] = [];
  const keywordMarkers: Disposable[] = [];
  let frame: number | undefined;
  let disposed = false;

  function clearDecorations() {
    while (keywordDecorations.length > 0) keywordDecorations.pop()?.dispose();
    while (keywordMarkers.length > 0) keywordMarkers.pop()?.dispose();
    const inputAnchor = options.getShellInputAnchor();
    if (inputAnchor) clearTerminalShellInputDecorations(inputAnchor);
  }

  function refresh() {
    frame = undefined;
    if (disposed) return;
    clearDecorations();
    const buffer = terminal.buffer.active;
    if (buffer.type !== 'normal') return;

    const cursorLine = buffer.baseY + buffer.cursorY;
    if (matcher) {
      const scanCount = Math.min(terminal.rows, MAX_TERMINAL_HIGHLIGHT_ROWS);
      const firstLine = buffer.viewportY + Math.max(0, terminal.rows - scanCount);
      const lastLineExclusive = Math.min(buffer.length, buffer.viewportY + terminal.rows);
      let remainingMatches = MAX_TERMINAL_HIGHLIGHT_MATCHES_PER_REFRESH;

      for (let lineNumber = firstLine; lineNumber < lastLineExclusive && remainingMatches > 0; lineNumber += 1) {
        const extracted = extractBoundedTerminalBufferLine(terminal, lineNumber);
        if (!extracted) continue;
        const { text, cellSpans } = extracted;
        const matches = matcher.findMatches(text, Math.min(remainingMatches, MAX_TERMINAL_HIGHLIGHT_MATCHES_PER_LINE));
        if (matches.length === 0) continue;
        const marker = terminal.registerMarker(lineNumber - cursorLine);
        if (!marker || marker.isDisposed) continue;
        keywordMarkers.push(marker);

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
          if (decoration) keywordDecorations.push(decoration);
          remainingMatches -= 1;
          if (remainingMatches <= 0) break;
        }
      }
    }

    if (options.shellSyntaxEnabled) {
      const inputAnchor = options.getShellInputAnchor();
      if (!inputAnchor || inputAnchor.marker.isDisposed) return;
      const input = extractTerminalShellInput(terminal, inputAnchor, cursorLine);
      if (!input || input.text.length === 0) return;
      const tokens = highlightTextSyntax(input.text, 'shell').tokens.slice(0, MAX_TERMINAL_SHELL_SYNTAX_DECORATIONS);
      const inputMarkers = new Map<number, IMarker>([[inputAnchor.marker.line, inputAnchor.marker]]);
      let remainingDecorations = MAX_TERMINAL_SHELL_SYNTAX_DECORATIONS;
      for (const token of tokens) {
        const paletteKey = shellSyntaxPaletteKeys[token.kind];
        if (!paletteKey) continue;
        for (const row of input.rows) {
          if (remainingDecorations <= 0) break;
          const commandStart = Math.max(token.start, row.commandStart);
          const commandEnd = Math.min(token.end, row.commandEnd);
          if (commandStart >= commandEnd) continue;
          const rowTokenStart = row.inputTextStart + commandStart - row.commandStart;
          const rowTokenEnd = row.inputTextStart + commandEnd - row.commandStart;
          const firstSpan = row.cellSpans.find(span => span.start <= rowTokenStart && rowTokenStart < span.end);
          const lastSpan = row.cellSpans.find(span => span.start < rowTokenEnd && rowTokenEnd <= span.end);
          if (!firstSpan || !lastSpan) continue;
          const width = lastSpan.column + lastSpan.width - firstSpan.column;
          if (width <= 0) continue;
          let marker = inputMarkers.get(row.lineNumber);
          if (!marker) {
            marker = terminal.registerMarker(row.lineNumber - cursorLine);
            if (marker && !marker.isDisposed) {
              inputMarkers.set(row.lineNumber, marker);
              inputAnchor.wrappedMarkers.push(marker);
            }
          }
          if (!marker || marker.isDisposed) continue;
          const decoration = terminal.registerDecoration({ marker, anchor: 'left', x: firstSpan.column, width,
            foregroundColor: terminalThemes[options.theme][paletteKey], layer: 'top' });
          if (decoration) {
            inputAnchor.decorations.push(decoration);
          }
          remainingDecorations -= 1;
        }
        if (remainingDecorations <= 0) break;
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
