import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { highlightTextSyntax, resolveTextSyntaxProfile } from '../../../../packages/domain/src/text-syntax.ts';
import type { TextSyntaxProfile } from '../../../../packages/domain/src/text-syntax.ts';

interface TextEditorContentProps {
  readonly contentId: string;
  readonly fileName: string;
  readonly value: string;
  readonly disabled: boolean;
  readonly describedBy: string;
  readonly onChange: (value: string) => void;
}

export function TextEditorContent({ contentId, fileName, value, disabled, describedBy, onChange }: TextEditorContentProps) {
  const profileId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLPreElement>(null);
  const [profile, setProfile] = useState<TextSyntaxProfile>('auto');
  const resolvedProfile = resolveTextSyntaxProfile(profile, fileName);
  const preview = useMemo(() => highlightTextSyntax(value, resolvedProfile), [resolvedProfile, value]);

  useLayoutEffect(() => { syncScroll(); }, [value]);

  function syncScroll(): void {
    const input = inputRef.current;
    const code = previewRef.current;
    if (!input || !code) return;
    code.scrollTop = input.scrollTop;
    code.scrollLeft = input.scrollLeft;
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
        <option value="sql">SQL (PostgreSQL style)</option>
        <option value="toml">TOML</option>
        <option value="yaml">YAML</option>
        <option value="json">JSON</option>
      </select>
      <p id={`${profileId}-hint`} className="remote-text-editor-hint">
        Auto detects .md/.markdown, .sql/.pgsql/.psql, .toml, .yaml/.yml, .ps1/.psm1/.psd1/.pssc, .py/.pyw/.pyi, .js/.jsx/.mjs/.cjs/.ts/.tsx/.mts/.cts, .sh/.bash/.zsh/.ksh and .json. Colors are visual hints; the file is not validated or executed.
      </p>
    </div>
    <label className="remote-text-editor-label" htmlFor={contentId}>File contents</label>
    <div className="text-editor-code-surface">
      <pre ref={previewRef} className="text-editor-code-preview" aria-hidden="true" data-testid="text-editor-code-preview">
        <code>{renderPreview(value, preview.tokens)}</code>
      </pre>
      <textarea ref={inputRef} id={contentId} className="remote-text-editor-content" value={value} spellCheck={false}
        disabled={disabled} aria-describedby={`${describedBy} ${profileId}-hint`}
        onChange={event => onChange(event.currentTarget.value)} onScroll={syncScroll} />
    </div>
    {preview.isTruncated && resolvedProfile !== 'plain' && <p className="remote-text-editor-hint" role="note">
      Syntax coloring is limited to 64,000 UTF-16 code units or 4,096 colored tokens, whichever comes first; the full file remains editable.
      {resolvedProfile === 'markdown' && ' Markdown coloring also has a work limit for unusually complex input.'}
    </p>}
  </>;
}

function renderPreview(value: string, tokens: readonly { readonly start: number; readonly end: number; readonly kind: string }[]): React.ReactNode {
  const content: React.ReactNode[] = [];
  let cursor = 0;
  for (const [index, token] of tokens.entries()) {
    if (token.start < cursor || token.end > value.length) continue;
    if (token.start > cursor) content.push(value.slice(cursor, token.start));
    content.push(<span key={`${token.start}-${index}`} className={`text-syntax-token text-syntax-token--${token.kind}`} data-token-kind={token.kind}>
      {value.slice(token.start, token.end)}
    </span>);
    cursor = token.end;
  }
  if (cursor < value.length) content.push(value.slice(cursor));
  return content;
}
