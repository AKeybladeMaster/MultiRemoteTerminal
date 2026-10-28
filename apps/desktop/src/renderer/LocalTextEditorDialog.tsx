import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { LocalTextFile } from '../../../../packages/domain/src/local-text-file.ts';
import { MAX_REMOTE_TEXT_FILE_BYTES, remoteTextByteLength } from '../../../../packages/domain/src/remote-text-file.ts';
import { TextEditorContent } from './TextEditorContent.tsx';
import { fileLineEnding, hasMixedLineEndings, lineEndingLabel, textareaContent } from './text-editor-format.ts';
import { textEditorErrorMessage } from './text-editor-errors.ts';

interface LocalTextEditorDialogProps {
  readonly open: boolean;
  readonly file: LocalTextFile | undefined;
  readonly onClose: () => void;
}

type CloseIntent = 'close' | 'reload';

export function LocalTextEditorDialog({ open, file: initialFile, onClose }: LocalTextEditorDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const contentId = useId();
  const [file, setFile] = useState<LocalTextFile>();
  const [draft, setDraft] = useState('');
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(false);
  const [busy, setBusy] = useState<'loading' | 'saving'>();
  const [error, setError] = useState<string>();
  const [closeIntent, setCloseIntent] = useState<CloseIntent>();
  const lineEnding = file ? fileLineEnding(file.content) : '\n';
  const dirty = file !== undefined && draft !== textareaContent(file.content);
  const bytes = remoteTextByteLength(draft.replace(/\n/g, lineEnding));

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open || !initialFile) return;
    setFile(initialFile);
    setDraft(textareaContent(initialFile.content));
    setAutoSaveEnabled(false);
    setBusy(undefined);
    setError(undefined);
    setCloseIntent(undefined);
    requestAnimationFrame(() => dialogRef.current?.querySelector('textarea')?.focus());
  }, [open, initialFile]);

  const reload = useCallback(async (discardDraft = false) => {
    if (!file || busy) return;
    if (!discardDraft && dirty) {
      setCloseIntent('reload');
      return;
    }
    setBusy('loading');
    setError(undefined);
    const reply = await window.multiRemoteTerminal.reloadLocalTextFile(file.selectionId);
    setBusy(undefined);
    if (!reply.ok) {
      setError(textEditorErrorMessage(reply.error.code, 'local'));
      return;
    }
    setFile(reply.result);
    setDraft(textareaContent(reply.result.content));
    setCloseIntent(undefined);
  }, [busy, dirty, file]);

  const save = useCallback(async () => {
    if (!file || busy || closeIntent || !dirty || bytes === undefined) return;
    const content = draft.replace(/\n/g, lineEnding);
    setBusy('saving');
    setError(undefined);
    const reply = await window.multiRemoteTerminal.saveLocalTextFile(file.selectionId, content, file.revision);
    setBusy(undefined);
    if (!reply.ok) {
      setError(textEditorErrorMessage(reply.error.code, 'local'));
      return;
    }
    setFile({ ...file, content, revision: reply.result.revision, bytes: reply.result.bytesSaved });
    setDraft(textareaContent(content));
    setCloseIntent(undefined);
  }, [busy, bytes, closeIntent, dirty, draft, file, lineEnding]);

  useEffect(() => {
    if (!open || !autoSaveEnabled || !dirty || busy !== undefined || closeIntent || bytes === undefined || error) return;
    const timeout = window.setTimeout(() => { void save(); }, 1_000);
    return () => window.clearTimeout(timeout);
  }, [autoSaveEnabled, busy, bytes, closeIntent, dirty, error, open, save]);

  const requestClose = useCallback(() => {
    if (busy) return;
    if (dirty) setCloseIntent('close');
    else onClose();
  }, [busy, dirty, onClose]);

  function resolveCloseIntent(discard: boolean): void {
    const intent = closeIntent;
    setCloseIntent(undefined);
    if (!discard || !intent) return;
    if (intent === 'close') onClose();
    else void reload(true);
  }

  return <dialog ref={dialogRef} className="remote-text-editor-dialog" aria-labelledby={titleId}
    data-testid="local-text-editor" onCancel={event => { event.preventDefault(); requestClose(); }}>
    <header className="remote-text-editor-header">
      <div>
        <p className="dialog-eyebrow">Local text editor</p>
        <h2 id={titleId}>{file?.fileName ?? 'Local file'}</h2>
      </div>
    </header>
    <p className="remote-text-editor-state" role="status" aria-live="polite">
      {busy === 'loading' ? 'Reloading file…' : busy === 'saving' ? 'Saving…' : dirty ? 'Unsaved changes' : file ? 'Saved' : 'Select a text file to edit.'}
    </p>
    {error && <p className="dialog-error" role="alert">{error}</p>}
    {closeIntent && <div className="remote-text-editor-confirm" role="alert">
      <span>{closeIntent === 'reload' ? 'Discard your draft and reload the local file?' : 'Discard your unsaved changes?'}</span>
      <button type="button" onClick={() => resolveCloseIntent(false)}>Keep editing</button>
      <button type="button" className="remote-text-editor-discard" disabled={busy !== undefined}
        onClick={() => resolveCloseIntent(true)}>{closeIntent === 'reload' ? 'Discard and reload' : 'Discard and close'}</button>
    </div>}
    <TextEditorContent key={file?.selectionId ?? 'empty'} contentId={contentId} fileName={file?.fileName ?? ''} value={draft}
      autoSaveEnabled={autoSaveEnabled} onAutoSaveChange={setAutoSaveEnabled}
      disabled={!file || busy !== undefined} describedBy={`${contentId}-hint`}
      onChange={value => { setDraft(value); setError(undefined); setCloseIntent(undefined); }} />
    <p id={`${contentId}-hint`} className="remote-text-editor-hint">
      {bytes === undefined ? 'This file contains unsupported characters or exceeds 512 KB.' : `${bytes.toLocaleString()} of ${MAX_REMOTE_TEXT_FILE_BYTES.toLocaleString()} bytes · UTF-8`}
    </p>
    {file && hasMixedLineEndings(file.content) && <p className="remote-text-editor-hint" role="note">
      Mixed line endings will be normalized to {lineEndingLabel(lineEnding)} when you save.
    </p>}
    <footer className="remote-text-editor-actions">
      <button type="button" disabled={busy !== undefined} onClick={requestClose}>Close</button>
      <button type="button" disabled={!file || busy !== undefined || closeIntent !== undefined} onClick={() => void reload()}>Reload</button>
      <button type="button" className="ssh-primary" disabled={!dirty || busy !== undefined || bytes === undefined || closeIntent !== undefined}
        onClick={() => void save()}>{busy === 'saving' ? 'Saving…' : 'Save changes'}</button>
    </footer>
  </dialog>;
}
