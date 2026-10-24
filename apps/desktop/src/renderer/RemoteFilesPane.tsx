import { useCallback, useEffect, useRef, useState } from 'react';
import { remoteParentPath } from '../../../../packages/domain/src/remote-files.ts';
import type { RemoteDirectoryListing, RemoteFileEntry } from '../../../../packages/domain/src/remote-files.ts';
import type { FtpTransferProgress } from '../../../../packages/domain/src/ftp.ts';

interface RemoteFilesPaneProps {
  readonly sessionId: string;
  readonly active: boolean;
  readonly transport: 'sftp' | 'ftp';
  readonly onReconnect?: () => void;
}

const FILE_SIZE_FORMATTER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

interface ActiveFtpTransfer extends Pick<FtpTransferProgress, 'operationId' | 'direction' | 'fileName' | 'bytesTransferred' | 'totalBytes'> {
  readonly phase: 'preparing' | 'transferring';
  readonly cancelling: boolean;
}

function describeError(code: string, transport: 'sftp' | 'ftp'): string {
  if (code === 'NOT_SUPPORTED') return 'This SSH server did not open an SFTP subsystem. Check that SFTP is enabled on the server.';
  if (code === 'TIMEOUT') return transport === 'ftp'
    ? 'The FTP connection timed out. Reconnect and enter your credentials again.'
    : 'The remote file request timed out. Refresh to try a new SFTP channel.';
  if (code === 'BUSY') return 'A remote file request is still in progress. Try again shortly.';
  if (code === 'NOT_FOUND') return transport === 'ftp' ? 'This FTP connection is no longer active.' : 'This SSH connection is no longer active.';
  if (code === 'OUTPUT_LIMIT') return 'The remote directory exceeds the configured listing limit.';
  return transport === 'ftp'
    ? 'The FTP connection is no longer available. Reconnect and check the server path and permissions.'
    : 'The remote directory could not be read. Check the server path and permissions.';
}

function formatFileSize(size: number): string {
  if (size < 1_024) return `${FILE_SIZE_FORMATTER.format(size)} B`;
  if (size < 1_048_576) return `${FILE_SIZE_FORMATTER.format(size / 1_024)} KB`;
  if (size < 1_073_741_824) return `${FILE_SIZE_FORMATTER.format(size / 1_048_576)} MB`;
  return `${FILE_SIZE_FORMATTER.format(size / 1_073_741_824)} GB`;
}

function kindLabel(entry: RemoteFileEntry): string {
  if (entry.kind === 'directory') return 'Folder';
  if (entry.kind === 'symlink') return 'Symbolic link';
  if (entry.kind === 'file') return 'File';
  return 'Other item';
}

export function RemoteFilesPane({ sessionId, active, transport, onReconnect }: RemoteFilesPaneProps) {
  const [listing, setListing] = useState<RemoteDirectoryListing>();
  const [error, setError] = useState<string>();
  const [errorCode, setErrorCode] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [requestedPath, setRequestedPath] = useState<string>();
  const requestGeneration = useRef(0);
  const started = useRef(false);
  const pathRow = useRef<HTMLDivElement>(null);
  const activeTransferId = useRef<string | undefined>(undefined);
  const [transfer, setTransfer] = useState<ActiveFtpTransfer>();
  const [transferNotice, setTransferNotice] = useState<string>();

  const load = useCallback(async (path: string, restoreFocus = false) => {
    const generation = ++requestGeneration.current;
    setLoading(true);
    setError(undefined);
    setErrorCode(undefined);
    setRequestedPath(path);
    const reply = transport === 'ftp'
      ? await window.multiRemoteTerminal.listFtpDirectory(sessionId, path)
      : await window.multiRemoteTerminal.listSshDirectory(sessionId, path);
    if (requestGeneration.current !== generation) return;
    setLoading(false);
    if (!reply.ok) {
      setError(describeError(reply.error.code, transport));
      setErrorCode(reply.error.code);
      if (restoreFocus) requestAnimationFrame(() => pathRow.current?.focus());
      return;
    }
    setListing(reply.result);
    setRequestedPath(undefined);
    if (restoreFocus) requestAnimationFrame(() => pathRow.current?.focus());
  }, [sessionId, transport]);

  useEffect(() => {
    if (active && !started.current) {
      started.current = true;
      void load('.');
    }
  }, [active, load]);

  useEffect(() => {
    if (transport !== 'ftp') return;
    return window.multiRemoteTerminal.onFtpTransferProgress(progress => {
      if (progress.sessionId !== sessionId || activeTransferId.current !== progress.operationId) return;
      setTransfer({
        operationId: progress.operationId,
        direction: progress.direction,
        fileName: progress.fileName,
        bytesTransferred: progress.bytesTransferred,
        totalBytes: progress.totalBytes,
        phase: 'transferring',
        cancelling: false
      });
    });
  }, [sessionId, transport]);

  useEffect(() => () => {
    const operationId = activeTransferId.current;
    if (operationId) void window.multiRemoteTerminal.cancelFtpTransfer(sessionId, operationId);
  }, [sessionId]);

  const transferFile = useCallback(async (direction: 'upload' | 'download', remotePath: string) => {
    if (transport !== 'ftp' || activeTransferId.current) return;
    const operationId = globalThis.crypto.randomUUID();
    activeTransferId.current = operationId;
    setTransferNotice(undefined);
    setTransfer({ operationId, direction, fileName: direction === 'download' ? remotePath.slice(remotePath.lastIndexOf('/') + 1) : 'Choose a local file',
      bytesTransferred: 0, totalBytes: null, phase: 'preparing', cancelling: false });
    const reply = direction === 'upload'
      ? await window.multiRemoteTerminal.uploadFtpFile(sessionId, operationId, remotePath)
      : await window.multiRemoteTerminal.downloadFtpFile(sessionId, operationId, remotePath);
    if (activeTransferId.current !== operationId) return;
    activeTransferId.current = undefined;
    setTransfer(undefined);
    if (!reply.ok) {
      setTransferNotice(reply.error.code === 'CANCELLED' ? 'Transfer cancelled.'
        : reply.error.code === 'CONFLICT' ? 'The destination changed during transfer. Choose a new name or try again.'
          : 'The file transfer failed. Check the connection and server permissions.');
      return;
    }
    setTransferNotice(reply.result.state === 'skipped' ? `Skipped ${reply.result.fileName}.`
      : `${direction === 'upload' ? 'Uploaded' : 'Downloaded'} ${reply.result.fileName} (${formatFileSize(reply.result.bytesTransferred)}).`);
    if (direction === 'upload') void load(remotePath);
  }, [load, sessionId, transport]);

  const cancelTransfer = useCallback(async () => {
    const current = transfer;
    if (!current || current.phase !== 'transferring' || current.cancelling) return;
    setTransfer({ ...current, cancelling: true });
    const reply = await window.multiRemoteTerminal.cancelFtpTransfer(sessionId, current.operationId);
    if (!reply.ok && reply.error.code !== 'NOT_FOUND') {
      setTransferNotice('The transfer could not be cancelled.');
    }
  }, [sessionId, transfer]);

  const parentPath = listing ? remoteParentPath(listing.path) : undefined;
  const displayedPath = requestedPath ?? listing?.path ?? 'Remote directory';
  return <aside className="remote-file-panel" aria-label="Remote file browser" aria-busy={loading} data-testid="remote-file-browser">
    <div className="remote-file-heading">
      <h2>{transport === 'ftp' ? 'FTP files' : 'Remote files'}</h2>
      <div className="remote-file-heading-actions">
        {transport === 'ftp' && <button type="button" className="remote-file-upload" disabled={loading || !listing || Boolean(transfer)}
          onClick={() => void transferFile('upload', listing?.path ?? '.')}>Upload file</button>}
        <button type="button" className="remote-file-refresh" aria-label="Refresh remote folder" title="Refresh remote folder"
          disabled={loading} onClick={() => void load(requestedPath ?? listing?.path ?? '.')}>↻</button>
      </div>
    </div>
    <div ref={pathRow} className="remote-file-path-row" tabIndex={-1} aria-live="polite" aria-atomic="true">
      <button type="button" className="remote-file-up" aria-label="Open parent folder"
        disabled={loading || !listing || parentPath === listing.path} onClick={() => { if (parentPath) void load(parentPath, true); }}>↑</button>
      <code className="remote-file-path" translate="no" title={displayedPath}>{displayedPath}</code>
    </div>
    {loading && <p className="remote-file-status" role="status">Reading remote directory…</p>}
    {error && <p className="remote-file-error" role="alert">{error}</p>}
    {error && transport === 'ftp' && errorCode !== 'BUSY' && onReconnect && <button type="button" className="remote-file-reconnect"
      disabled={loading} onClick={onReconnect}>Reconnect to file server</button>}
    {transfer && <div className="remote-file-transfer" role="status" aria-live="polite">
      <div className="remote-file-transfer-label"><span>{transfer.phase === 'preparing' ? 'Preparing' : transfer.direction === 'upload' ? 'Uploading' : 'Downloading'} {transfer.fileName}</span>
        {transfer.phase === 'transferring' && <button type="button" disabled={transfer.cancelling} onClick={() => void cancelTransfer()}>
          {transfer.cancelling ? 'Cancelling…' : 'Cancel'}</button>}
      </div>
      {transfer.phase === 'transferring' && <>
        {transfer.totalBytes !== null && transfer.totalBytes > 0
          ? <progress aria-label={`${transfer.direction === 'upload' ? 'Upload' : 'Download'} progress`} max={transfer.totalBytes}
            value={Math.min(transfer.bytesTransferred, transfer.totalBytes)} />
          : <progress aria-label={`${transfer.direction === 'upload' ? 'Upload' : 'Download'} progress`} />}
        <span className="remote-file-transfer-count">{formatFileSize(transfer.bytesTransferred)}{transfer.totalBytes === null ? ' transferred' : ` of ${formatFileSize(transfer.totalBytes)}`}</span>
      </>}
    </div>}
    {transferNotice && <p className="remote-file-status" role="status">{transferNotice}</p>}
    {!loading && !error && listing?.entries.length === 0 && <p className="remote-file-status" role="status">This folder is empty.</p>}
    {!loading && !error && listing && listing.entries.length > 0 && <p className="remote-file-status" role="status">
      {listing.entries.length} {listing.entries.length === 1 ? 'item' : 'items'} in this folder.
    </p>}
    {!loading && !error && listing && listing.entries.length > 0 && <ul className="remote-file-list" aria-label={`Items in ${listing.path}`}>
      {listing.entries.map(entry => <li key={entry.path}>
        {entry.kind === 'directory'
          ? <button className="remote-file-row remote-file-folder" type="button" disabled={loading} aria-label={`Open folder ${entry.name}`}
            onClick={() => void load(entry.path, true)}>
            <span className="remote-file-name"><span className="remote-file-icon folder" aria-hidden="true">▰</span>
              <span className="remote-file-label" translate="no" title={entry.name}>{entry.name}</span></span>
            <span className="remote-file-meta">Folder</span>
          </button>
          : <div className={`remote-file-row remote-file-static ${entry.kind === 'symlink' ? 'is-link' : ''}`}>
            <span className="remote-file-name"><span className={`remote-file-icon ${entry.kind}`} aria-hidden="true">{entry.kind === 'symlink' ? '↗' : '·'}</span>
              <span className="remote-file-label" translate="no" title={entry.name}>{entry.name}</span></span>
            <span className="remote-file-file-actions"><span className="remote-file-meta">{entry.kind === 'file' ? formatFileSize(entry.size) : kindLabel(entry)}</span>
              {transport === 'ftp' && entry.kind === 'file' && <button type="button" className="remote-file-download" aria-label={`Download ${entry.name}`}
                disabled={loading || Boolean(transfer)} onClick={() => void transferFile('download', entry.path)}>Download</button>}</span>
          </div>}
      </li>)}
    </ul>}
    {!loading && !error && listing?.truncated && <p className="remote-file-status remote-file-limit" role="status">Showing the first 500 items.</p>}
  </aside>;
}
