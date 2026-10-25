import type { Terminal } from '@xterm/xterm';
import {
  createTerminalHighlightMatcher,
  MAX_TERMINAL_HIGHLIGHT_MATCHES_PER_REFRESH,
  normalizeTerminalHighlightRules
} from '../../../../packages/domain/src/terminal-highlights.ts';
import type { TerminalHighlightRule, TerminalHighlightColor } from '../../../../packages/domain/src/terminal-highlights.ts';
import { terminalThemes } from './terminal-theme.ts';
import type { TerminalTheme } from './terminal-theme.ts';

const MAX_TERMINAL_HIGHLIGHT_ROWS = 128;

interface Disposable {
  dispose(): void;
}

export function attachTerminalHighlights(
  terminal: Terminal,
  enabled: boolean,
  inputRules: readonly TerminalHighlightRule[],
  theme: TerminalTheme
): Disposable {
  const rules = normalizeTerminalHighlightRules(inputRules);
  if (!enabled || !rules?.length) return { dispose() {} };

  const matcher = createTerminalHighlightMatcher(rules);
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

    const scanCount = Math.min(terminal.rows, MAX_TERMINAL_HIGHLIGHT_ROWS);
    const firstLine = buffer.viewportY + Math.max(0, terminal.rows - scanCount);
    const lastLineExclusive = Math.min(buffer.length, buffer.viewportY + terminal.rows);
    const cursorLine = buffer.baseY + buffer.cursorY;
    let remainingMatches = MAX_TERMINAL_HIGHLIGHT_MATCHES_PER_REFRESH;
    const cellScratch = buffer.getNullCell();

    for (let lineNumber = firstLine; lineNumber < lastLineExclusive && remainingMatches > 0; lineNumber += 1) {
      const line = buffer.getLine(lineNumber);
      if (!line) continue;
      const text = line.translateToString(true, 0, terminal.cols);
      if (!text) continue;
      const cellSpans: { readonly start: number; readonly end: number; readonly column: number; readonly width: number }[] = [];
      let fullText = '';
      for (let column = 0; column < Math.min(line.length, terminal.cols); column += 1) {
        const cell = line.getCell(column, cellScratch);
        if (!cell) break;
        const width = cell.getWidth();
        if (width <= 0) continue;
        const chars = cell.getChars() || ' ';
        const start = fullText.length;
        fullText += chars;
        cellSpans.push({ start, end: fullText.length, column, width });
      }

      const matches = matcher.findMatches(text, remainingMatches);
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
        const foregroundColor = terminalHighlightForeground(theme, match.color);
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

  function scheduleRefresh() {
    if (!disposed && frame === undefined) frame = requestAnimationFrame(refresh);
  }

  const parsed = terminal.onWriteParsed(scheduleRefresh);
  const scrolled = terminal.onScroll(scheduleRefresh);
  const bufferChanged = terminal.buffer.onBufferChange(scheduleRefresh);
  scheduleRefresh();

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      if (frame !== undefined) cancelAnimationFrame(frame);
      parsed.dispose();
      scrolled.dispose();
      bufferChanged.dispose();
      clearDecorations();
    }
  };
}

function terminalHighlightForeground(theme: TerminalTheme, color: TerminalHighlightColor): string {
  return terminalThemes[theme][color];
}
