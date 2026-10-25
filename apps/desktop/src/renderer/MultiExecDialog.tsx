import { useEffect, useRef, useState } from 'react';
import type { ReactElement, Ref } from 'react';
import { MAX_MULTI_EXEC_LINE_CHARS, MAX_MULTI_EXEC_TARGETS, normalizeMultiExecRequest } from '../../../../packages/domain/src/multi-exec.ts';
import type { MultiExecRequest } from '../../../../packages/domain/src/multi-exec.ts';
import type { AppError } from '../../../../packages/domain/src/errors.ts';
import type { MultiExecTargetResult } from '../../../../packages/application/src/multi-exec.ts';

export interface MultiExecDisplayTarget {
  readonly sessionId: string;
  readonly title: string;
}

export interface MultiExecView {
  readonly phase: 'review' | 'sending' | 'finished';
  readonly line: string;
  readonly targets: readonly MultiExecDisplayTarget[];
  readonly targetResults: readonly MultiExecTargetResult[];
  readonly cancelled?: boolean;
  readonly cancelRequested?: boolean;
  readonly error?: AppError;
}

export interface MultiExecDialogProps {
  readonly dialogRef: Ref<HTMLElement>;
  readonly targets: readonly MultiExecDisplayTarget[];
  readonly view: MultiExecView | undefined;
  readonly blockedReason: string | undefined;
  readonly onClose: () => void;
  readonly onReview: (request: MultiExecRequest) => void;
  readonly onConfirm: (approved: boolean) => void;
  readonly onCancel: () => void;
}

function targetStatusText(result: MultiExecTargetResult | undefined): string {
  if (!result) return 'Waiting';
  if (result.status === 'queued') return 'Waiting';
  if (result.status === 'sending') return 'Sending';
  if (result.status === 'sent') return 'Input sent';
  if (result.status === 'uncertain') return `Delivery uncertain (${result.error?.code ?? 'UNAVAILABLE'})`;
  if (result.status === 'failed') return `Not sent (${result.error?.code ?? 'UNAVAILABLE'})`;
  return 'Not sent';
}

export function MultiExecDialog({ dialogRef, targets, view, blockedReason, onClose, onReview, onConfirm, onCancel }: MultiExecDialogProps): ReactElement {
  const [line, setLine] = useState('');
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [validationMessage, setValidationMessage] = useState<string>();
  const lineInput = useRef<HTMLInputElement>(null);
  const reviewSendButton = useRef<HTMLButtonElement>(null);
  const runStatus = useRef<HTMLParagraphElement>(null);
  const isSending = view?.phase === 'sending';

  useEffect(() => {
    if (view?.phase === 'review') requestAnimationFrame(() => reviewSendButton.current?.focus());
    else if (view?.phase === 'sending' || view?.phase === 'finished') requestAnimationFrame(() => runStatus.current?.focus());
    else if (!view) requestAnimationFrame(() => lineInput.current?.focus());
  }, [view?.phase]);

  function toggleTarget(sessionId: string): void {
    setSelectedIds(current => {
      const next = new Set(current);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
    setValidationMessage(undefined);
  }

  function review(): void {
    const request = normalizeMultiExecRequest({ line, targetSessionIds: [...selectedIds] });
    if (!request) {
      setValidationMessage(selectedIds.size < 2
        ? 'Select at least two running terminals.'
        : selectedIds.size > MAX_MULTI_EXEC_TARGETS
          ? `Select no more than ${MAX_MULTI_EXEC_TARGETS} terminals at once.`
          : 'Enter one non-empty line without line breaks, control characters, or directional formatting marks.');
      return;
    }
    setValidationMessage(undefined);
    onReview(request);
  }

  const resultByTarget = new Map((view?.targetResults ?? []).map(result => [result.targetSessionId, result]));
  const sentCount = view?.targetResults.filter(result => result.status === 'sent').length ?? 0;
  const uncertainCount = view?.targetResults.filter(result => result.status === 'uncertain').length ?? 0;
  const failedCount = view?.targetResults.filter(result => result.status === 'failed').length ?? 0;
  const notSentCount = view?.targetResults.filter(result => result.status === 'not-sent').length ?? 0;

  return <div className="ssh-backdrop tunnel-backdrop multi-exec-backdrop" onMouseDown={event => {
    if (event.target === event.currentTarget && !isSending) onClose();
  }}>
    <section ref={dialogRef} className="tunnel-manager multi-exec-dialog" role="dialog" aria-modal="true"
      aria-labelledby="multi-exec-heading" aria-describedby="multi-exec-description">
      <header className="tunnel-manager-header">
        <div><p className="dialog-eyebrow">Terminal fanout</p><h2 id="multi-exec-heading">Send to terminals</h2></div>
        <button className="tunnel-close" type="button" aria-label="Close MultiExec" onClick={onClose} disabled={isSending}>&times;</button>
      </header>
      <p id="multi-exec-description" className="tunnel-manager-description">
        Send one line to two or more running local, SSH or Telnet terminals. Each terminal reports its input result separately.
      </p>

      {!view && <div className="multi-exec-body">
        <label className="multi-exec-line-label" htmlFor="multi-exec-line">One-line input</label>
        <input ref={lineInput} id="multi-exec-line" name="line" type="text" autoComplete="off" spellCheck={false}
          maxLength={MAX_MULTI_EXEC_LINE_CHARS} value={line} onChange={event => { setLine(event.target.value); setValidationMessage(undefined); }}
          aria-describedby="multi-exec-line-help" />
        <p id="multi-exec-line-help" className="multi-exec-help">Enter is appended when the line is sent. Keep passwords, tokens and private data out of the command.</p>
        <fieldset className="multi-exec-target-fieldset">
          <legend>Running terminal targets <span>{selectedIds.size} selected</span></legend>
          {targets.length === 0
            ? <p className="multi-exec-empty">Open at least two running local, SSH or Telnet terminals.</p>
            : <ul className="multi-exec-target-list" aria-label="Select terminal targets">{targets.map(target => <li key={target.sessionId}>
              <label className={`multi-exec-target-row${selectedIds.has(target.sessionId) ? ' selected' : ''}`}>
                <input type="checkbox" checked={selectedIds.has(target.sessionId)} onChange={() => toggleTarget(target.sessionId)} />
                <span><strong>{target.title}</strong><small>Running terminal</small></span>
              </label>
            </li>)}</ul>}
        </fieldset>
        {blockedReason && <p className="multi-exec-feedback error" role="status">{blockedReason}</p>}
        {validationMessage && <p className="multi-exec-feedback error" role="alert">{validationMessage}</p>}
        <footer className="multi-exec-footer">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="ssh-primary" onClick={review}
            disabled={Boolean(blockedReason) || targets.length < 2 || selectedIds.size > MAX_MULTI_EXEC_TARGETS}>Review send</button>
        </footer>
      </div>}

      {view?.phase === 'review' && <div className="multi-exec-body">
        <p className="multi-exec-caution"><strong>Commands run immediately.</strong> Verify the exact line and every destination before sending. The app does not retry or collect command output.</p>
        <div className="multi-exec-preview">
          <span>Exact line <small>Enter will be appended</small></span>
          <pre><code translate="no">{view.line}</code></pre>
        </div>
        <fieldset className="multi-exec-target-fieldset">
          <legend>Destinations <span>{view.targets.length} selected</span></legend>
          <ul className="multi-exec-target-list multi-exec-review-list" aria-label="Reviewed terminal destinations">
            {view.targets.map(target => <li key={target.sessionId}><span className="multi-exec-destination">{target.title}</span></li>)}
          </ul>
        </fieldset>
        {view.error && <p className="multi-exec-feedback error" role="alert">The send could not start ({view.error.code}).</p>}
        <footer className="multi-exec-footer">
          <button type="button" onClick={() => onConfirm(false)}>Back to selection</button>
          <button ref={reviewSendButton} type="button" className="ssh-primary" onClick={() => onConfirm(true)}>
            Send line to {view.targets.length} terminals
          </button>
        </footer>
      </div>}

      {(view?.phase === 'sending' || view?.phase === 'finished') && <div className="multi-exec-body">
        <div className="multi-exec-preview">
          <span>Sent line <small>Enter appended</small></span>
          <pre><code translate="no">{view.line}</code></pre>
        </div>
        {view.phase === 'sending' && <p ref={runStatus} className="multi-exec-feedback" role="status" aria-live="polite" tabIndex={-1}>
          {view.cancelRequested ? 'Stopping queued sends. Writes already in progress must settle first.'
            : 'Sending to selected terminals. Stop queued sends; a write already in progress must settle first.'}
        </p>}
        {view.phase === 'finished' && <p ref={runStatus} className={`multi-exec-feedback${uncertainCount || failedCount ? ' error' : ''}`} role="status" aria-live="polite" tabIndex={-1}>
          {view.error ? `The send could not start (${view.error.code}).`
            : view.cancelled ? `Stopped. ${sentCount} sent, ${uncertainCount} uncertain, ${failedCount} failed, ${notSentCount} not sent.`
              : `Finished. ${sentCount} sent, ${uncertainCount} uncertain, ${failedCount} failed.`}
        </p>}
        <ul className="multi-exec-result-list" aria-label="Per-terminal send results" aria-live="polite">
          {view.targets.map(target => {
            const result = resultByTarget.get(target.sessionId);
            return <li key={target.sessionId} className={`multi-exec-result-row ${result?.status ?? 'queued'}`}>
              <span className="multi-exec-result-target">{target.title}</span>
              <span className="multi-exec-result-status">{targetStatusText(result)}</span>
            </li>;
          })}
        </ul>
        <footer className="multi-exec-footer">
          {view.phase === 'sending'
            ? <button type="button" className="multi-exec-stop" onClick={onCancel} disabled={view.cancelRequested}>Stop queued sends</button>
            : <button type="button" className="ssh-primary" onClick={onClose}>Done</button>}
        </footer>
      </div>}
    </section>
  </div>;
}
