import { useCallback, useEffect, useRef, useState } from 'react';
import { remoteParentPath } from '../../../../packages/domain/src/remote-files.ts';
import type { RemoteDirectoryListing, RemoteFileEntry } from '../../../../packages/domain/src/remote-files.ts';
import type { FileTransferProgress } from '../../../../packages/domain/src/file-transfer.ts';
import type { RemoteFileDropContext, RemoteFileDropEvent, RemoteFileDropHandle } from '../../../../packages/contracts/src/commands.ts';
import { RemoteTextEditorDialog } from './RemoteTextEditorDialog.tsx';
import { VirtualizedList } from './VirtualizedList.tsx';

interface RemoteFilesPaneProps {
  readonly sessionId: string;
  readonly active: boolean;
  readonly transport: 'sftp' | 'ftp';
  readonly hidden?: boolean;
  readonly onReconnect?: () => void;
}

const FILE_SIZE_FORMATTER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const REMOTE_FILE_LIST_VIRTUALIZATION_THRESHOLD = 50;
const REMOTE_FILE_ROW_HEIGHT = 38;

interface ActiveFileTransfer extends Pick<FileTransferProgress, 'operationId' | 'direction' | 'fileName' | 'bytesTransferred' | 'totalBytes'> {
  readonly phase: 'preparing' | 'transferring' | 'committing';
  readonly cancelling: boolean;
  readonly uploadSource?: 'picker' | 'drop';
}

function describeError(code: string, transport: 'sftp' | 'ftp'): string {
  if (code === 'NOT_SUPPORTED') return 'This SSH server did not open an SFTP subsystem. Check that SFTP is enabled on the server.';
  if (code === 'TIMEOUT') return transport === 'ftp'
    ? 'The FTP connection timed out. Reconnect and enter your credentials again.'
    : 'The remote file request timed out. Refresh to try a new SFTP channel.';
  if (code === 'BUSY') return 'A remote file request is still in progress. Try again shortly.';
  if (code === 'NOT_FOUND') return transport === 'ftp' ? 'This FTP connection is no longer active.'
    : transport === 'sftp' ? 'This SFTP connection is no longer active.' : 'This SSH connection is no longer active.';
  if (code === 'CONFLICT') return 'The selected file or destination changed during transfer. Review it and try again.';
  if (code === 'FORBIDDEN') return 'The local file or remote destination denied access.';
  if (code === 'OUTPUT_LIMIT') return 'The remote directory exceeds the configured listing limit.';
  return transport === 'ftp'
    ? 'The FTP connection is no longer available. Reconnect and check the server path and permissions.'
    : transport === 'sftp' ? 'The SFTP connection is no longer available. Reconnect and check the server path and permissions.'
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

export function RemoteFilesPane({ sessionId, active, transport, hidden = false, onReconnect }: RemoteFilesPaneProps) {
  const [listing, setListing] = useState<RemoteDirectoryListing>();
  const [error, setError] = useState<string>();
  const [errorCode, setErrorCode] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [requestedPath, setRequestedPath] = useState<string>();
  const requestGeneration = useRef(0);
  const started = useRef(false);
  const pathRow = useRef<HTMLDivElement>(null);
  const activeTransferId = useRef<string | undefined>(undefined);
  const [transfer, setTransfer] = useState<ActiveFileTransfer>();
  const [transferNotice, setTransferNotice] = useState<string>();
  const [editorPath, setEditorPath] = useState<string>();
  const [editorBusy, setEditorBusy] = useState(false);
  const editorTrigger = useRef<HTMLButtonElement>(null);
  const dropQueueRunning = useRef(false);
  const pendingDropHandles = useRef<(RemoteFileDropContext & { readonly tokens: readonly string[] }) | undefined>(undefined);
  const [dropActive, setDropActive] = useState(false);

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
    const subscribe = transport === 'ftp'
      ? window.multiRemoteTerminal.onFtpTransferProgress
      : window.multiRemoteTerminal.onSshTransferProgress;
    return subscribe(progress => {
      if (progress.sessionId !== sessionId || activeTransferId.current !== progress.operationId) return;
      setTransfer({
        operationId: progress.operationId,
        direction: progress.direction,
        fileName: progress.fileName,
        bytesTransferred: progress.bytesTransferred,
        totalBytes: progress.totalBytes,
        phase: progress.phase,
        cancelling: false
      });
    });
  }, [sessionId, transport]);

  useEffect(() => () => {
    const operationId = activeTransferId.current;
    if (operationId) {
      const cancel = transport === 'ftp' ? window.multiRemoteTerminal.cancelFtpTransfer : window.multiRemoteTerminal.cancelSshTransfer;
      void cancel(sessionId, operationId);
    }
    const pending = pendingDropHandles.current;
    pendingDropHandles.current = undefined;
    if (pending?.tokens.length) void window.multiRemoteTerminal.discardRemoteFileDropHandles(pending, pending.tokens);
  }, [sessionId, transport]);

  const transferFile = useCallback(async (direction: 'upload' | 'download', remotePath: string, droppedFile?: RemoteFileDropHandle): Promise<boolean> => {
    if (activeTransferId.current) return false;
    const operationId = globalThis.crypto.randomUUID();
    activeTransferId.current = operationId;
    setTransferNotice(undefined);
    setTransfer({ operationId, direction, fileName: direction === 'download' ? remotePath.slice(remotePath.lastIndexOf('/') + 1) : droppedFile?.fileName ?? 'Choose a local file',
      bytesTransferred: 0, totalBytes: null, phase: 'preparing', cancelling: false,
      ...(direction === 'upload' ? { uploadSource: droppedFile ? 'drop' as const : 'picker' as const } : {}) });
    const reply = direction === 'upload'
      ? transport === 'ftp'
        ? droppedFile
          ? await window.multiRemoteTerminal.uploadDroppedFtpFile(sessionId, operationId, remotePath, droppedFile.token)
          : await window.multiRemoteTerminal.uploadFtpFile(sessionId, operationId, remotePath)
        : droppedFile
          ? await window.multiRemoteTerminal.uploadDroppedSshFile(sessionId, operationId, remotePath, droppedFile.token)
          : await window.multiRemoteTerminal.uploadSshFile(sessionId, operationId, remotePath)
      : transport === 'ftp'
        ? await window.multiRemoteTerminal.downloadFtpFile(sessionId, operationId, remotePath)
        : await window.multiRemoteTerminal.downloadSshFile(sessionId, operationId, remotePath);
    if (activeTransferId.current !== operationId) return false;
    activeTransferId.current = undefined;
    setTransfer(undefined);
    if (!reply.ok) {
      if (reply.error.code === 'CANCELLED') {
        setTransferNotice(direction === 'upload'
          ? 'Upload cancelled. The server may retain a partial file if cleanup was interrupted.'
          : 'Download cancelled.');
        void load(direction === 'upload' ? remotePath : listing?.path ?? '.');
      } else if (reply.error.code === 'NOT_SUPPORTED') {
        setTransferNotice(transport === 'ftp'
          ? 'This FTP server does not support safe unique-name uploads. No existing remote file was replaced.'
          : 'This SSH server does not provide SFTP file transfers.');
      } else {
        setTransferNotice(reply.error.code === 'NOT_FOUND' && direction === 'upload'
          ? droppedFile ? 'The dropped local file is no longer available. Drop it again.' : 'The selected local file is no longer available. Choose it again.'
          : reply.error.code === 'NOT_FOUND' && transport === 'sftp'
            ? 'The remote file is no longer available. Refresh the folder and try again.'
            : reply.error.code === 'UNAVAILABLE' && transport === 'ftp' && direction === 'upload'
              ? 'FTP upload failed. Reconnect and check whether a partial remote file remains before removing it.'
            : reply.error.code === 'CONFLICT' ? 'The selected file or destination changed during transfer. Review it and try again.'
              : reply.error.code === 'FORBIDDEN' ? 'The local file or remote destination denied access.'
                : 'The file transfer failed. Check the connection and server permissions.');
      }
      return false;
    }
    setTransferNotice(reply.result.state === 'skipped' ? `Skipped ${reply.result.fileName}.`
      : `${direction === 'upload' ? 'Uploaded' : 'Downloaded'} ${reply.result.fileName} (${formatFileSize(reply.result.bytesTransferred)}).`);
    if (direction === 'upload') await load(remotePath);
    return true;
  }, [listing?.path, load, sessionId, transport]);

  useEffect(() => window.multiRemoteTerminal.onRemoteFilesDropped((event: RemoteFileDropEvent) => {
    if (!active || event.sessionId !== sessionId || event.transport !== transport || event.remoteDirectory !== listing?.path) return false;
    if (!event.ok) {
      setTransferNotice(event.error.code === 'OUTPUT_LIMIT'
        ? 'Drop up to 16 files at a time.'
        : event.error.code === 'FORBIDDEN' ? 'That file cannot be uploaded from this location.'
          : event.error.code === 'NOT_FOUND' ? 'A dropped file is no longer available. Drop the files again.'
            : 'The dropped files could not be prepared for upload.');
      return true;
    }
    if (activeTransferId.current || dropQueueRunning.current || editorBusy || loading) {
      setTransferNotice('Finish the current file operation before dropping more files.');
      void window.multiRemoteTerminal.discardRemoteFileDropHandles(event, event.result.map(file => file.token));
      return true;
    }
    dropQueueRunning.current = true;
    pendingDropHandles.current = { sessionId, transport, remoteDirectory: event.remoteDirectory, tokens: event.result.map(file => file.token) };
    setTransferNotice(`${event.result.length} ${event.result.length === 1 ? 'file' : 'files'} queued for upload.`);
    void (async () => {
      let consumedCount = 0;
      try {
        for (let index = 0; index < event.result.length; index++) {
          const succeeded = await transferFile('upload', event.remoteDirectory, event.result[index]);
          if (!succeeded) {
            if (index + 1 < event.result.length) setTransferNotice(`Upload stopped. ${event.result.length - index - 1} dropped ${event.result.length - index === 2 ? 'file was' : 'files were'} not uploaded.`);
            break;
          }
          consumedCount = index + 1;
          pendingDropHandles.current = { sessionId, transport, remoteDirectory: event.remoteDirectory,
            tokens: event.result.slice(consumedCount).map(file => file.token) };
        }
      } finally {
        const unconsumed = event.result.slice(consumedCount).map(file => file.token);
        if (unconsumed.length) void window.multiRemoteTerminal.discardRemoteFileDropHandles(event, unconsumed);
        pendingDropHandles.current = undefined;
        dropQueueRunning.current = false;
      }
    })();
    return true;
  }), [active, editorBusy, listing?.path, loading, sessionId, transferFile, transport]);

  const cancelTransfer = useCallback(async () => {
    const current = transfer;
    if (!current || current.phase !== 'transferring' || current.cancelling) return;
    setTransfer({ ...current, cancelling: true });
    const cancel = transport === 'ftp' ? window.multiRemoteTerminal.cancelFtpTransfer : window.multiRemoteTerminal.cancelSshTransfer;
    const reply = await cancel(sessionId, current.operationId);
    if (!reply.ok && reply.error.code !== 'NOT_FOUND') {
      setTransferNotice(reply.error.code === 'CONFLICT' ? 'The transfer is finishing and can no longer be cancelled.' : 'The transfer could not be cancelled.');
    }
  }, [sessionId, transfer, transport]);

  const closeEditor = useCallback(() => {
    setEditorPath(undefined);
    requestAnimationFrame(() => editorTrigger.current?.focus());
  }, []);

  const refreshAfterEdit = useCallback(() => { void load(listing?.path ?? '.'); }, [listing?.path, load]);

  const parentPath = listing ? remoteParentPath(listing.path) : undefined;
  const displayedPath = requestedPath ?? listing?.path ?? 'Remote directory';
  const renderRemoteFileEntry = (entry: RemoteFileEntry) => <li key={entry.path}>
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
          {entry.kind === 'file' && <>
            {transport === 'sftp' && <button type="button" className="remote-file-download"
              aria-label={`Edit ${entry.name}`} disabled={loading || Boolean(transfer) || editorBusy} onClick={event => {
                editorTrigger.current = event.currentTarget;
                setTransferNotice(undefined);
                setEditorPath(entry.path);
              }}>Edit</button>}
            <button type="button" className="remote-file-download" aria-label={`Download ${entry.name}`}
              disabled={loading || Boolean(transfer) || editorBusy} onClick={() => void transferFile('download', entry.path)}>Download</button>
          </>}</span>
      </div>}
  </li>;
  const dropEnabled = active && Boolean(listing && !loading && !error && !transfer && !editorBusy);
  return <aside className={`remote-file-panel${dropActive ? ' is-file-drop-active' : ''}`} hidden={hidden}
    aria-label="Remote file browser" aria-busy={loading} data-testid="remote-file-browser"
    data-mrt-remote-file-drop-target={dropEnabled ? 'true' : undefined} data-mrt-remote-file-session-id={dropEnabled ? sessionId : undefined}
    data-mrt-remote-file-transport={dropEnabled ? transport : undefined} data-mrt-remote-file-directory={dropEnabled ? listing?.path : undefined}
    onDragEnter={event => { if (dropEnabled && event.dataTransfer.types.includes('Files')) setDropActive(true); }}
    onDragOver={event => {
      if (!dropEnabled || !event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      setDropActive(true);
    }}
    onDragLeave={event => {
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
      setDropActive(false);
    }}
    onDrop={event => { event.preventDefault(); setDropActive(false); }}>
    <div className="remote-file-heading">
      <h2>{transport === 'ftp' ? 'FTP files' : transport === 'sftp' ? 'SFTP files' : 'Remote files'}</h2>
      <div className="remote-file-heading-actions">
        <button type="button" className="remote-file-upload" disabled={loading || !listing || Boolean(transfer)}
          onClick={() => void transferFile('upload', listing?.path ?? '.')}>Upload file</button>
        <button type="button" className="remote-file-refresh" aria-label="Refresh remote folder" title="Refresh remote folder"
          disabled={loading} onClick={() => void load(requestedPath ?? listing?.path ?? '.')}>↻</button>
      </div>
    </div>
    <div ref={pathRow} className="remote-file-path-row" tabIndex={-1} aria-live="polite" aria-atomic="true">
      <button type="button" className="remote-file-up" aria-label="Open parent folder"
        disabled={loading || !listing || parentPath === listing.path} onClick={() => { if (parentPath) void load(parentPath, true); }}>↑</button>
      <code className="remote-file-path" translate="no" title={displayedPath}>{displayedPath}</code>
    </div>
    {transport === 'ftp' && <p className="remote-file-status">FTP may assign a unique name to each upload; the server-selected name appears when it finishes.</p>}
    <p className={`remote-file-drop-hint${dropActive ? ' is-active' : ''}`} role={dropActive ? 'status' : undefined}>
      {dropActive ? `Drop up to 16 files to upload to ${displayedPath}.` : 'Drop up to 16 files here to upload, or choose Upload file.'}
    </p>
    {loading && <p className="remote-file-status" role="status">Reading remote directory…</p>}
    {error && <p className="remote-file-error" role="alert">{error}</p>}
    {error && transport !== 'sftp' && errorCode !== 'BUSY' && onReconnect && <button type="button" className="remote-file-reconnect"
      disabled={loading} onClick={onReconnect}>Reconnect to file server</button>}
    {error && transport === 'sftp' && errorCode !== 'BUSY' && onReconnect && <button type="button" className="remote-file-reconnect"
      disabled={loading} onClick={onReconnect}>Reconnect to SFTP server</button>}
    {transfer && <div className="remote-file-transfer" role="status" aria-live="polite">
      <div className="remote-file-transfer-label"><span>{transfer.phase === 'preparing'
        ? transfer.uploadSource === 'drop' ? `Preparing upload of ${transfer.fileName}`
          : `Choose ${transfer.direction === 'upload' ? 'a local file to upload' : `a local destination for ${transfer.fileName}`}`
        : transfer.phase === 'committing' ? `Finishing ${transfer.direction} of ${transfer.fileName}`
          : `${transfer.direction === 'upload' ? 'Uploading' : 'Downloading'} ${transfer.fileName}`}</span>
        {transfer.phase === 'transferring' && <button type="button" disabled={transfer.cancelling} onClick={() => void cancelTransfer()}>
          {transfer.cancelling ? 'Cancelling…' : 'Cancel'}</button>}
      </div>
      {(transfer.phase === 'transferring' || transfer.phase === 'committing') && <>
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
    {!loading && !error && listing && listing.entries.length > 0 && <VirtualizedList
      items={listing.entries}
      label={`Items in ${listing.path}`}
      className="remote-file-list"
      rowHeight={REMOTE_FILE_ROW_HEIGHT}
      threshold={REMOTE_FILE_LIST_VIRTUALIZATION_THRESHOLD}
      ariaSetSize={listing.truncated ? -1 : listing.entries.length}
      renderItem={entry => renderRemoteFileEntry(entry)}
      isItemFocusable={entry => !loading && (entry.kind === 'directory' ||
        (entry.kind === 'file' && !transfer && !editorBusy))}
      renderNonVirtualizedRows={() => listing.entries.map(renderRemoteFileEntry)} />}
    {!loading && !error && listing?.truncated && <p className="remote-file-status remote-file-limit" role="status">Showing the first 500 items.</p>}
    <RemoteTextEditorDialog open={transport === 'sftp' && editorPath !== undefined} sessionId={sessionId} remotePath={editorPath}
      onClose={closeEditor} onSaved={refreshAfterEdit} onActivityChange={setEditorBusy} />
  </aside>;
}
