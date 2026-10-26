import { useEffect, useId, useRef, useState } from 'react';
import type { ErrorCode } from '../../../../packages/domain/src/errors.ts';
import type { TftpRootSelection, TftpServerStatus } from '../../../../packages/domain/src/tftp.ts';
import { isTftpPort } from '../../../../packages/domain/src/tftp.ts';

function failureMessage(code: ErrorCode): string {
  if (code === 'CANCELLED') return '';
  if (code === 'BUSY') return 'The TFTP server is already starting or stopping. Wait for that operation to finish.';
  if (code === 'FORBIDDEN') return 'Use the folder or server button to confirm this action.';
  if (code === 'NOT_FOUND') return 'Choose the folder again before starting the server.';
  if (code === 'NOT_SUPPORTED') return 'The local TFTP server is disabled in Workbench settings. Enable it before choosing a folder or starting the server.';
  if (code === 'INVALID_REQUEST') return 'Choose a folder and enter a port from 0 to 65535.';
  if (code === 'TIMEOUT') return 'The TFTP server did not respond. Try again.';
  return `The TFTP server could not complete the request (${code}). Try again.`;
}

export function TftpServerDialog({ open, enabled, onStatusChange, onClose }: {
  readonly open: boolean;
  readonly enabled: boolean;
  readonly onStatusChange: (status: TftpServerStatus) => void;
  readonly onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const chooseButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const portHintId = useId();
  const [selection, setSelection] = useState<TftpRootSelection>();
  const [port, setPort] = useState('69');
  const [status, setStatus] = useState<TftpServerStatus>({ state: 'stopped' });
  const [busy, setBusy] = useState<'choose' | 'start' | 'stop'>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      requestAnimationFrame(() => {
        if (enabled) chooseButtonRef.current?.focus();
        else dialog.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
      });
    } else if (!open && dialog.open) dialog.close();
  }, [enabled, open]);

  useEffect(() => {
    let active = true;
    const unsubscribe = window.multiRemoteTerminal.onTftpServerStatus(next => {
      if (!active) return;
      setStatus(next);
      onStatusChange(next);
      if (next.state === 'running') setSelection(undefined);
    });
    void window.multiRemoteTerminal.getTftpServerStatus().then(reply => {
      if (!active) return;
      if (reply.ok) {
        setStatus(reply.result);
        onStatusChange(reply.result);
        if (reply.result.state === 'running') setSelection(undefined);
      } else setError(`Could not read TFTP server status (${reply.error.code}).`);
    }).catch(() => { if (active) setError('Could not read TFTP server status.'); });
    return () => { active = false; unsubscribe(); };
  }, [onStatusChange]);

  async function chooseFolder(): Promise<void> {
    if (!enabled || busy) return;
    setBusy('choose');
    setError(undefined);
    try {
      const reply = await window.multiRemoteTerminal.chooseTftpRoot();
      if (!reply.ok) {
        const message = failureMessage(reply.error.code);
        if (message) setError(message);
        return;
      }
      setSelection(reply.result);
    } catch { setError('The folder picker could not be opened. Try again.'); }
    finally { setBusy(undefined); }
  }

  async function startServer(): Promise<void> {
    const portNumber = Number(port);
    if (!enabled || !selection || busy) return;
    if (!port.trim() || !isTftpPort(portNumber)) {
      setError('Enter a whole-number port from 0 to 65535.');
      return;
    }
    setBusy('start');
    setError(undefined);
    try {
      const reply = await window.multiRemoteTerminal.startTftpServer(selection.selectionId, portNumber);
      if (!reply.ok) {
        const message = failureMessage(reply.error.code);
        if (message) setError(message);
        return;
      }
      setStatus(reply.result);
      onStatusChange(reply.result);
      setSelection(undefined);
    } catch { setError('The TFTP server could not start. Check the folder and port, then try again.'); }
    finally { setBusy(undefined); }
  }

  async function stopServer(): Promise<void> {
    if (busy || status.state !== 'running') return;
    setBusy('stop');
    setError(undefined);
    try {
      const reply = await window.multiRemoteTerminal.stopTftpServer();
      if (!reply.ok) {
        const message = failureMessage(reply.error.code);
        if (message) setError(message);
        return;
      }
      const stoppedStatus = { state: 'stopped' } as const;
      setStatus(stoppedStatus);
      onStatusChange(stoppedStatus);
      setSelection(undefined);
    } catch { setError('The TFTP server could not stop. Try again.'); }
    finally { setBusy(undefined); }
  }

  function requestClose(): void {
    if (busy) return;
    onClose();
  }

  const validPort = port.trim().length > 0 && isTftpPort(Number(port));
  const isRunning = status.state === 'running';

  return <dialog ref={dialogRef} className="tftp-server-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); requestClose(); }}>
    <header className="tftp-server-header">
      <div><p className="dialog-eyebrow">Local service</p><h2 id={titleId}>Local TFTP server</h2></div>
      <button className="tunnel-close" type="button" aria-label="Close local TFTP server" disabled={Boolean(busy)} onClick={requestClose}>×</button>
    </header>
    <p className="tftp-server-description" id={descriptionId}>Share top-level files from a folder on this computer.</p>
    {!enabled && <p className="tftp-server-hint" role="note">Starting a local TFTP server is disabled in Workbench settings. An existing server can still be stopped here.</p>}
    <div className="tftp-server-body">
      <div className="tftp-server-folder-row">
        <span className="tftp-server-label">Folder</span>
        <span className="tftp-server-folder" aria-label="Selected folder" aria-live="polite">{isRunning ? status.folderName : selection?.folderName ?? 'No folder selected'}</span>
        <button ref={chooseButtonRef} type="button" data-mrt-tftp-server-action-trigger="choose-root" disabled={!enabled || Boolean(busy) || isRunning}
          onClick={() => void chooseFolder()}>{busy === 'choose' ? 'Choosing…' : 'Browse…'}</button>
      </div>
      <form data-mrt-tftp-selection-id={selection?.selectionId ?? ''} onSubmit={event => { event.preventDefault(); void startServer(); }}>
        <label htmlFor="tftp-server-port">UDP port</label>
        <input id="tftp-server-port" name="port" type="number" inputMode="numeric" autoComplete="off" min={0} max={65_535} step={1}
          value={port} disabled={!enabled || Boolean(busy) || isRunning} aria-describedby={portHintId}
          onChange={event => { setPort(event.target.value); setError(undefined); }} />
        <span id={portHintId} className="tftp-server-hint">Use 69, or 0 to let Windows choose an available port.</span>
        <span className="tftp-server-label">Bind address</span>
        <div className="tftp-server-address"><code translate="no">127.0.0.1</code><span>Local computer only</span></div>
        <p className="tftp-server-hint">Reads top-level regular files in octet mode. Files over 16 MiB are refused.</p>
        <div className="tftp-server-warning" role="note">
          <strong>Unauthenticated, read-only sharing.</strong> Any local process that can reach this address can download top-level files in the selected folder. Do not select a folder containing secrets.
        </div>
        <p className="tftp-server-status" role="status" aria-live="polite">
          {busy === 'choose' ? 'Waiting for folder selection…' : busy === 'start' ? 'Starting server…' : busy === 'stop' ? 'Stopping server…'
            : isRunning ? `Running at ${status.address}:${status.port}.` : 'Stopped.'}
        </p>
        {error && <p className="dialog-error" role="alert">{error}</p>}
        <footer className="ssh-connect-actions tftp-server-actions">
          <button type="button" disabled={Boolean(busy)} onClick={requestClose}>Close</button>
          {isRunning
            ? <button type="button" className="ssh-primary" disabled={Boolean(busy)} onClick={() => void stopServer()}>{busy === 'stop' ? 'Stopping…' : 'Stop server'}</button>
            : <button type="submit" className="ssh-primary" data-mrt-tftp-server-action-trigger="start"
              disabled={!enabled || !selection || !validPort || Boolean(busy)}>{busy === 'start' ? 'Starting…' : 'Start server'}</button>}
        </footer>
      </form>
    </div>
  </dialog>;
}
