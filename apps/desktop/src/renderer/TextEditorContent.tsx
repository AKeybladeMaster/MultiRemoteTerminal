import { useDeferredValue, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { highlightTextSyntax, resolveTextSyntaxProfile } from '../../../../packages/domain/src/text-syntax.ts';
import type { TextSyntaxProfile } from '../../../../packages/domain/src/text-syntax.ts';

interface TextEditorContentProps {
  readonly contentId: string;
  readonly fileName: string;
  readonly value: string;
  readonly disabled: boolean;
  readonly autoSaveEnabled: boolean;
  readonly describedBy: string;
  readonly onAutoSaveChange: (enabled: boolean) => void;
  readonly onChange: (value: string) => void;
}

interface PreviewViewport {
  readonly firstLine: number;
  readonly afterLastLine: number;
  readonly lineHeight: number;
  readonly width: number;
}

interface LineIndex {
  readonly lineCount: number;
  readonly checkpoints: readonly number[];
}

const LINE_INDEX_CHECKPOINT_INTERVAL = 128;

export function TextEditorContent({ contentId, fileName, value, disabled, autoSaveEnabled, describedBy, onAutoSaveChange, onChange }: TextEditorContentProps) {
  const profileId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLPreElement>(null);
  const syncScrollRef = useRef<() => void>(() => {});
  const [profile, setProfile] = useState<TextSyntaxProfile>('auto');
  const [viewport, setViewport] = useState<PreviewViewport>({ firstLine: 0, afterLastLine: 32, lineHeight: 20, width: 0 });
  const resolvedProfile = resolveTextSyntaxProfile(profile, fileName);
  const deferredValue = useDeferredValue(value);
  const lineIndex = useMemo(() => indexLines(value), [value]);
  const lineCount = lineIndex.lineCount;
  const preview = useMemo(() => deferredValue === value ? highlightTextSyntax(value, resolvedProfile) : undefined,
    [deferredValue, resolvedProfile, value]);
  const previewWindow = useMemo(() => {
    const start = offsetForLine(value, viewport.firstLine, lineIndex);
    const end = offsetForLine(value, Math.min(lineCount, viewport.afterLastLine), lineIndex);
    const tokens = preview?.tokens.flatMap(token => {
      const tokenStart = Math.max(token.start, start);
      const tokenEnd = Math.min(token.end, end);
      return tokenEnd > tokenStart ? [{ start: tokenStart - start, end: tokenEnd - start, kind: token.kind }] : [];
    });
    return { start, end, value: value.slice(start, end), tokens: tokens ?? [] };
  }, [lineCount, lineIndex, preview?.tokens, value, viewport.afterLastLine, viewport.firstLine]);

  syncScrollRef.current = syncScroll;
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const observer = new ResizeObserver(() => syncScrollRef.current());
    observer.observe(input);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => { syncScroll(); }, [value]);

  function syncScroll(): void {
    const input = inputRef.current;
    const code = previewRef.current;
    if (!input || !code) return;
    code.scrollTop = input.scrollTop;
    code.scrollLeft = input.scrollLeft;
    const lineHeight = Number.parseFloat(window.getComputedStyle(input).lineHeight) || 20;
    const firstLine = Math.max(0, Math.floor(input.scrollTop / lineHeight) - 8);
    const afterLastLine = Math.min(lineCount, Math.ceil((input.scrollTop + input.clientHeight) / lineHeight) + 8);
    const width = Math.max(input.clientWidth, input.scrollWidth);
    setViewport(current => current.firstLine === firstLine && current.afterLastLine === afterLastLine
      && current.lineHeight === lineHeight && current.width === width
      ? current : { firstLine, afterLastLine, lineHeight, width });
  }

  return <>
    <div className="text-editor-syntax-controls">
      <label htmlFor={profileId}>Syntax profile</label>
      <select id={profileId} value={profile} disabled={disabled} onChange={event => setProfile(event.currentTarget.value as TextSyntaxProfile)}>
        <option value="auto">Auto detect</option>
        <option value="plain">Plain text</option>
        <option value="markdown">Markdown</option>
        <option value="shell">Shell script</option>
        <option value="powershell">PowerShell</option>
        <option value="python">Python</option>
        <option value="javascript">JavaScript / TypeScript</option>
        <option value="c-family">C / C++ / Java / C#</option>
        <option value="css">CSS</option>
        <option value="sql">SQL (PostgreSQL style)</option>
        <option value="toml">TOML</option>
        <option value="yaml">YAML</option>
        <option value="ini">INI configuration</option>
        <option value="xml">XML</option>
        <option value="html">HTML</option>
        <option value="dotenv">Environment file</option>
        <option value="properties">Java properties</option>
        <option value="json">JSON</option>
      </select>
      <label className="text-editor-autosave">
        <input type="checkbox" checked={autoSaveEnabled} disabled={disabled}
          onChange={event => onAutoSaveChange(event.currentTarget.checked)} />
        Save automatically after 1 second of inactivity
      </label>
      <p id={`${profileId}-hint`} className="remote-text-editor-hint">
        Auto detects .md/.markdown, .css, .c/.h/.cc/.cpp/.cxx/.hh/.hpp/.hxx/.java/.cs, .sql/.pgsql/.psql, .toml, .yaml/.yml, .ini/.cfg, .xml/.xsd/.xsl/.xslt/.svg, .html/.htm,
        .env/.env.* and *.env, .properties, .ps1/.psm1/.psd1/.pssc, .py/.pyw/.pyi, .js/.jsx/.mjs/.cjs/.ts/.tsx/.mts/.cts,
        .sh/.bash/.zsh/.ksh and .json. Colors are visual hints; content is not rendered, validated or executed.
      </p>
    </div>
    <label className="remote-text-editor-label" htmlFor={contentId}>File contents</label>
    <div className="text-editor-code-surface">
      <pre ref={previewRef} className="text-editor-code-preview" aria-hidden="true" data-testid="text-editor-code-preview">
        <code style={{ display: 'block', position: 'relative', height: `${lineCount * viewport.lineHeight}px`, width: `${viewport.width}px` }}>
          <span style={{ display: 'none' }}>{value.slice(0, previewWindow.start)}</span>
          <span style={{ position: 'absolute', left: 0, top: `${viewport.firstLine * viewport.lineHeight}px` }}>
            {renderPreview(previewWindow.value, previewWindow.tokens)}
          </span>
          <span style={{ display: 'none' }}>{value.slice(previewWindow.end)}</span>
        </code>
      </pre>
      <textarea ref={inputRef} id={contentId} className="remote-text-editor-content" value={value} spellCheck={false}
        disabled={disabled} aria-describedby={`${describedBy} ${profileId}-hint`}
        onChange={event => onChange(event.currentTarget.value)} onScroll={syncScroll} />
    </div>
    {preview?.isTruncated && resolvedProfile !== 'plain' && <p className="remote-text-editor-hint" role="note">
      Syntax coloring is limited to 64,000 UTF-16 code units or 4,096 colored tokens, whichever comes first; the full file remains editable.
      {resolvedProfile === 'markdown' && ' Markdown coloring also has a work limit for unusually complex input.'}
    </p>}
  </>;
}

function renderPreview(value: string, tokens: readonly { readonly start: number; readonly end: number; readonly kind: string }[]): React.ReactNode {
  const content: React.ReactNode[] = [];
  let cursor = 0;
  let lastEnd = 0;
  let group: { start: number; end: number; kind: string; index: number } | undefined;
  const flush = () => {
    if (!group) return;
    content.push(<span key={`${group.start}-${group.index}`} className={`text-syntax-token text-syntax-token--${group.kind}`} data-token-kind={group.kind}>
      {value.slice(group.start, group.end)}
    </span>);
    cursor = group.end;
    group = undefined;
  };
  for (const [index, token] of tokens.entries()) {
    if (token.start < lastEnd || token.end > value.length) continue;
    const gap = value.slice(lastEnd, token.start);
    // Newline-only gaps carry no visible color, so same-kind tokens share one DOM span.
    if (group && group.kind === token.kind && /^[\r\n]*$/.test(gap)) {
      group.end = token.end;
      lastEnd = token.end;
      continue;
    }
    flush();
    if (token.start > cursor) content.push(value.slice(cursor, token.start));
    group = { start: token.start, end: token.end, kind: token.kind, index };
    lastEnd = token.end;
  }
  flush();
  if (cursor < value.length) content.push(value.slice(cursor));
  return content;
}

function indexLines(value: string): LineIndex {
  const checkpoints = [0];
  let line = 0;
  for (let index = 0; index < value.length; index++) {
    if (value.charCodeAt(index) !== 10) continue;
    line++;
    if (line % LINE_INDEX_CHECKPOINT_INTERVAL === 0) checkpoints.push(index + 1);
  }
  return { lineCount: line + 1, checkpoints };
}

function offsetForLine(value: string, line: number, lineIndex: LineIndex): number {
  if (line <= 0) return 0;
  if (line >= lineIndex.lineCount) return value.length;
  const checkpointIndex = Math.floor(line / LINE_INDEX_CHECKPOINT_INTERVAL);
  let currentLine = checkpointIndex * LINE_INDEX_CHECKPOINT_INTERVAL;
  let offset = lineIndex.checkpoints[checkpointIndex] ?? 0;
  while (currentLine < line) {
    const newline = value.indexOf('\n', offset);
    if (newline === -1) return value.length;
    offset = newline + 1;
    currentLine++;
  }
  return offset;
}
