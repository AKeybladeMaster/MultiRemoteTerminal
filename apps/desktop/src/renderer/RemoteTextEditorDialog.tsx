import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { RemoteTextFile } from '../../../../packages/domain/src/remote-text-file.ts';
import { MAX_REMOTE_TEXT_FILE_BYTES, remoteTextByteLength } from '../../../../packages/domain/src/remote-text-file.ts';
import type { FileTransferProgress } from '../../../../packages/domain/src/file-transfer.ts';
import { TextEditorContent } from './TextEditorContent.tsx';
import { fileLineEnding, hasMixedLineEndings, lineEndingLabel, textareaContent } from './text-editor-format.ts';
import { textEditorErrorMessage } from './text-editor-errors.ts';

interface RemoteTextEditorDialogProps {
  readonly open: boolean;
  readonly sessionId: string;
  readonly remotePath: string | undefined;
  readonly onClose: () => void;
  readonly onSaved: () => void;
  readonly onActivityChange: (busy: boolean) => void;
}

type Operation = { readonly id: string; readonly kind: 'loading' | 'saving' };
type CloseIntent = 'close' | 'reload';

export function RemoteTextEditorDialog({ open, sessionId, remotePath, onClose, onSaved, onActivityChange }: RemoteTextEditorDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const operationRef = useRef<Operation | undefined>(undefined);
  const phaseRef = useRef<'preparing' | FileTransferProgress['phase'] | undefined>(undefined);
  const loadRef = useRef<(discardDraft?: boolean) => Promise<void>>(async () => {});
  const titleId = useId();
  const contentId = useId();
  const [file, setFile] = useState<RemoteTextFile>();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<Operation['kind']>();
  const [phase, setPhase] = useState<'preparing' | FileTransferProgress['phase']>();
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string>();
  const [closeIntent, setCloseIntent] = useState<CloseIntent>();

  const lineEnding = file ? fileLineEnding(file.content) : '\n';
  const dirty = file !== undefined && draft !== textareaContent(file.content);
  const bytes = remoteTextByteLength(draft.replace(/\n/g, lineEnding));
  const committing = busy === 'saving' && phase === 'committing';

  useEffect(() => { onActivityChange(busy !== undefined); }, [busy, onActivityChange]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const cancelOperation = useCallback((operation: Operation) => {
    if (operationRef.current?.id !== operation.id) return;
    if (phaseRef.current === 'committing') return;
    setCancelling(true);
    void window.multiRemoteTerminal.cancelSshTransfer(sessionId, operation.id);
  }, [sessionId]);

  const load = useCallback(async (discardDraft = false) => {
    if (!remotePath || operationRef.current) return;
    if (!discardDraft && dirty) {
      setCloseIntent('reload');
      return;
    }
    const operation = { id: globalThis.crypto.randomUUID(), kind: 'loading' as const };
    operationRef.current = operation;
    setBusy('loading');
    setPhase('preparing');
    phaseRef.current = 'preparing';
    setCancelling(false);
    setError(undefined);
    setFile(undefined);
    setDraft('');
    const reply = await window.multiRemoteTerminal.readSshTextFile(sessionId, operation.id, remotePath);
    if (operationRef.current?.id !== operation.id) return;
    operationRef.current = undefined;
    setBusy(undefined);
    setPhase(undefined);
    phaseRef.current = undefined;
    setCancelling(false);
    if (!reply.ok) {
      setError(textEditorErrorMessage(reply.error.code, 'remote'));
      return;
    }
    setFile(reply.result);
    setDraft(textareaContent(reply.result.content));
    requestAnimationFrame(() => dialogRef.current?.querySelector('textarea')?.focus());
  }, [dirty, remotePath, sessionId]);

  useEffect(() => { loadRef.current = load; }, [load]);

  useEffect(() => {
    if (!open || !remotePath) return;
    setCloseIntent(undefined);
    void loadRef.current(true);
    return () => {
      const operation = operationRef.current;
      const operationPhase = phaseRef.current;
      if (operation) {
        operationRef.current = undefined;
        if (operationPhase !== 'committing') void window.multiRemoteTerminal.cancelSshTransfer(sessionId, operation.id);
      }
      phaseRef.current = undefined;
      setBusy(undefined);
      setPhase(undefined);
      setCancelling(false);
    };
  }, [open, remotePath, sessionId]);

  useEffect(() => window.multiRemoteTerminal.onSshTransferProgress((progress: FileTransferProgress) => {
    if (progress.sessionId !== sessionId || operationRef.current?.id !== progress.operationId) return;
    setPhase(progress.phase);
    phaseRef.current = progress.phase;
  }), [sessionId]);

  const save = useCallback(async () => {
    if (!file || !remotePath || operationRef.current || closeIntent || !dirty || bytes === undefined) return;
    const operation = { id: globalThis.crypto.randomUUID(), kind: 'saving' as const };
    operationRef.current = operation;
    setBusy('saving');
    setPhase('preparing');
    phaseRef.current = 'preparing';
    setCancelling(false);
    setError(undefined);
    const content = draft.replace(/\n/g, lineEnding);
    const reply = await window.multiRemoteTerminal.saveSshTextFile(sessionId, operation.id, remotePath, content, file.revision);
    if (operationRef.current?.id !== operation.id) return;
    operationRef.current = undefined;
    setBusy(undefined);
    setPhase(undefined);
    phaseRef.current = undefined;
    setCancelling(false);
    if (!reply.ok) {
      setError(textEditorErrorMessage(reply.error.code, 'remote'));
      return;
    }
    setFile({ path: remotePath, content, revision: reply.result.revision, bytes: reply.result.bytesSaved });
    setDraft(textareaContent(content));
    setCloseIntent(undefined);
    onSaved();
  }, [bytes, closeIntent, dirty, draft, file, lineEnding, onSaved, remotePath, sessionId]);

  const requestClose = useCallback(() => {
    if (operationRef.current || busy !== undefined || phaseRef.current === 'committing') return;
    if (dirty) setCloseIntent('close');
    else onClose();
  }, [busy, dirty, onClose]);

  function resolveCloseIntent(discard: boolean): void {
    if (operationRef.current || busy !== undefined || phaseRef.current === 'committing') return;
    const intent = closeIntent;
    setCloseIntent(undefined);
    if (!discard || !intent) return;
    if (intent === 'close') onClose();
    else void load(true);
  }

  return <dialog ref={dialogRef} className="remote-text-editor-dialog" aria-labelledby={titleId}
    data-testid="remote-text-editor" onCancel={event => { event.preventDefault(); requestClose(); }}>
    <header className="remote-text-editor-header">
      <div>
        <p className="dialog-eyebrow">SFTP text editor</p>
        <h2 id={titleId}>{remotePath?.slice(remotePath.lastIndexOf('/') + 1) ?? 'Remote file'}</h2>
      </div>
      <code className="remote-text-editor-path" title={remotePath} translate="no">{remotePath}</code>
    </header>
    <p className="remote-text-editor-state" role="status" aria-live="polite">
      {busy === 'loading' ? cancelling ? 'Cancelling read…' : phase === 'transferring' ? 'Reading file…' : 'Opening file…'
        : busy === 'saving' ? phase === 'committing' ? 'Finishing save…' : cancelling ? 'Cancelling save…' : 'Saving…'
          : dirty ? 'Unsaved changes' : file ? 'Saved' : 'Select a text file to edit.'}
    </p>
    {error && <p className="dialog-error" role="alert">{error}</p>}
    {closeIntent && <div className="remote-text-editor-confirm" role="alert">
      <span>{closeIntent === 'reload' ? 'Discard your draft and reload the remote file?' : 'Discard your unsaved changes?'}</span>
      <button type="button" onClick={() => resolveCloseIntent(false)}>Keep editing</button>
      <button type="button" className="remote-text-editor-discard" disabled={busy !== undefined || committing}
        onClick={() => resolveCloseIntent(true)}>
        {closeIntent === 'reload' ? 'Discard and reload' : 'Discard and close'}
      </button>
    </div>}
    <TextEditorContent key={`${sessionId}:${remotePath ?? ''}`} contentId={contentId} fileName={remotePath?.slice(remotePath.lastIndexOf('/') + 1) ?? ''}
      value={draft} disabled={!file || busy !== undefined} describedBy={`${contentId}-hint`}
      onChange={value => { setDraft(value); setError(undefined); setCloseIntent(undefined); }} />
    <p id={`${contentId}-hint`} className="remote-text-editor-hint">
      {bytes === undefined ? 'This file contains unsupported characters or exceeds 512 KB.' : `${bytes.toLocaleString()} of ${MAX_REMOTE_TEXT_FILE_BYTES.toLocaleString()} bytes · UTF-8`}
    </p>
    {file && hasMixedLineEndings(file.content) && <p className="remote-text-editor-hint" role="note">
      Mixed line endings will be normalized to {lineEndingLabel(lineEnding)} when you save.
    </p>}
    <footer className="remote-text-editor-actions">
      {busy && phase !== 'committing' && <button type="button" disabled={cancelling} onClick={() => operationRef.current && cancelOperation(operationRef.current)}>
        {cancelling ? 'Cancelling…' : 'Cancel request'}</button>}
      <button type="button" disabled={busy !== undefined || committing} onClick={requestClose}>Close</button>
      <button type="button" disabled={!remotePath || busy !== undefined || closeIntent !== undefined} onClick={() => void load()}>
        Reload</button>
      <button type="button" className="ssh-primary" disabled={!dirty || busy !== undefined || bytes === undefined || closeIntent !== undefined}
        onClick={() => void save()}>{busy === 'saving' ? phase === 'committing' ? 'Finishing…' : 'Saving…' : 'Save changes'}</button>
    </footer>
  </dialog>;
}
