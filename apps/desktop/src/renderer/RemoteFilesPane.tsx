import { useCallback, useEffect, useRef, useState } from 'react';
import { remoteParentPath } from '../../../../packages/domain/src/remote-files.ts';
import type { RemoteDirectoryListing, RemoteFileEntry } from '../../../../packages/domain/src/remote-files.ts';

interface RemoteFilesPaneProps {
  readonly sessionId: string;
  readonly active: boolean;
  readonly transport: 'sftp' | 'ftp';
  readonly onReconnect?: () => void;
}

const FILE_SIZE_FORMATTER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

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

  const parentPath = listing ? remoteParentPath(listing.path) : undefined;
  const displayedPath = requestedPath ?? listing?.path ?? 'Remote directory';
  return <aside className="remote-file-panel" aria-label="Remote file browser" aria-busy={loading} data-testid="remote-file-browser">
    <div className="remote-file-heading">
      <h2>{transport === 'ftp' ? 'FTP files' : 'Remote files'}</h2>
      <button type="button" className="remote-file-refresh" aria-label="Refresh remote folder" title="Refresh remote folder"
        disabled={loading} onClick={() => void load(requestedPath ?? listing?.path ?? '.')}>↻</button>
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
            <span className="remote-file-meta">{entry.kind === 'file' ? formatFileSize(entry.size) : kindLabel(entry)}</span>
          </div>}
      </li>)}
    </ul>}
    {!loading && !error && listing?.truncated && <p className="remote-file-status remote-file-limit" role="status">Showing the first 500 items.</p>}
  </aside>;
}
