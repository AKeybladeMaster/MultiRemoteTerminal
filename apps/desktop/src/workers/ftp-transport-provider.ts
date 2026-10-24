import { FtpFilesProviderError } from '../../../../packages/application/src/ftp-files.ts';
import type { FtpCredentials, FtpFilesProvider } from '../../../../packages/application/src/ftp-files.ts';
import type { CancellationSignal } from '../../../../packages/application/src/cancellation.ts';
import { isCanonicalFtpEndpoint, isFtpCommandArgument, isFtpDirectoryListing, isFtpFileName, isFtpRemotePath } from '../../../../packages/domain/src/ftp.ts';
import type { FtpEndpoint } from '../../../../packages/domain/src/ftp.ts';
import { MAX_REMOTE_DIRECTORY_ENTRIES, remoteChildPath } from '../../../../packages/domain/src/remote-files.ts';
import type { RemoteDirectoryListing, RemoteFileEntry } from '../../../../packages/domain/src/remote-files.ts';

export interface FtpLibraryFileInfo {
  readonly name: unknown;
  readonly type: unknown;
  readonly size: unknown;
  readonly modifiedAt?: unknown;
}

export interface FtpLibraryClient {
  readonly ftp: { verbose: boolean; log(message: string): void };
  access(options: { readonly host: string; readonly port: number; readonly user: string; readonly password: string; readonly secure: boolean }): Promise<unknown>;
  list(path?: string): Promise<FtpLibraryFileInfo[]>;
  close(): void;
}

export type FtpLibraryClientFactory = (timeoutMs: number, options: { readonly allowSeparateTransferHost: false; readonly maxListingBytes: number }) => FtpLibraryClient;
export type FtpAuthenticationErrorCheck = (error: unknown) => boolean;

interface FtpSession {
  readonly client: FtpLibraryClient;
  busy: boolean;
  cancelled: boolean;
}

const SERVER_PROGRESS_TIMEOUT_MS = 30_000;
const MAX_LISTING_BYTES = 2 * 1024 * 1024;

export function createFtpTransportProvider(createClient: FtpLibraryClientFactory, isAuthenticationError: FtpAuthenticationErrorCheck,
  fileTypes: { readonly directory: number; readonly file: number; readonly symbolicLink: number }): FtpFilesProvider {
  const sessions = new Map<string, FtpSession>();

  async function open(sessionId: string, endpoint: FtpEndpoint, credentials: FtpCredentials): Promise<void> {
    if (!isCanonicalFtpEndpoint(endpoint) || typeof credentials.username !== 'string' || credentials.username.length === 0 ||
        credentials.username.length > 512 || !isFtpCommandArgument(credentials.username) || typeof credentials.password !== 'string' ||
        credentials.password.length > 65_536 || !isFtpCommandArgument(credentials.password)) {
      throw new FtpFilesProviderError('INVALID_REQUEST');
    }
    if (sessions.has(sessionId)) throw new FtpFilesProviderError('BUSY');
    const client = createClient(SERVER_PROGRESS_TIMEOUT_MS, { allowSeparateTransferHost: false, maxListingBytes: MAX_LISTING_BYTES });
    client.ftp.verbose = false;
    client.ftp.log = () => {};
    const session = { client, busy: true, cancelled: false };
    sessions.set(sessionId, session);
    try {
      await client.access({ host: endpoint.host, port: endpoint.port, user: credentials.username, password: credentials.password, secure: endpoint.secure });
      if (session.cancelled || sessions.get(sessionId) !== session) throw new FtpFilesProviderError('CANCELLED');
      session.busy = false;
    } catch (error) {
      client.close();
      if (sessions.get(sessionId) === session) sessions.delete(sessionId);
      if (session.cancelled) throw new FtpFilesProviderError('CANCELLED');
      if (isAuthenticationError(error)) throw new FtpFilesProviderError('AUTHENTICATION_FAILED');
      throw new FtpFilesProviderError('UNAVAILABLE');
    }
  }

  async function listDirectory(sessionId: string, path: string, cancellation?: CancellationSignal): Promise<RemoteDirectoryListing> {
    const session = sessions.get(sessionId);
    if (!session) throw new FtpFilesProviderError('UNAVAILABLE');
    if (!isFtpRemotePath(path)) throw new FtpFilesProviderError('INVALID_REQUEST');
    if (cancellation?.aborted) throw new FtpFilesProviderError('CANCELLED');
    if (session.busy || session.cancelled) throw new FtpFilesProviderError('BUSY');
    session.busy = true;
    let aborted = false;
    const abort = () => {
      aborted = true;
      sessions.delete(sessionId);
      session.client.close();
    };
    cancellation?.addEventListener('abort', abort, { once: true });
    if (cancellation?.aborted) abort();
    try {
      const listing = await session.client.list(path);
      if (aborted || cancellation?.aborted) throw new FtpFilesProviderError('CANCELLED');
      const entries: RemoteFileEntry[] = [];
      let truncated = false;
      for (const item of listing) {
        if (!isFtpFileName(item.name)) continue;
        const childPath = remoteChildPath(path, item.name);
        if (!childPath) continue;
        if (entries.length >= MAX_REMOTE_DIRECTORY_ENTRIES) { truncated = true; break; }
        const kind = item.type === fileTypes.directory ? 'directory'
          : item.type === fileTypes.symbolicLink ? 'symlink'
            : item.type === fileTypes.file ? 'file' : 'other';
        const size = Number.isSafeInteger(item.size) && (item.size as number) >= 0 ? item.size as number : 0;
        const modifiedAt = item.modifiedAt instanceof Date && Number.isSafeInteger(item.modifiedAt.getTime()) && item.modifiedAt.getTime() >= 0
          ? Math.floor(item.modifiedAt.getTime() / 1_000) : null;
        entries.push({ name: item.name, path: childPath, kind, size, modifiedAt });
      }
      const result = { path, entries, truncated };
      if (!isFtpDirectoryListing(result)) throw new FtpFilesProviderError('UNAVAILABLE');
      return result;
    } catch (error) {
      if (aborted || cancellation?.aborted) throw new FtpFilesProviderError('CANCELLED');
      if (error instanceof FtpFilesProviderError) throw error;
      if (sessions.get(sessionId) === session) {
        session.client.close();
        sessions.delete(sessionId);
      }
      throw new FtpFilesProviderError('UNAVAILABLE');
    } finally {
      cancellation?.removeEventListener('abort', abort);
      session.busy = false;
    }
  }

  async function close(sessionId: string): Promise<void> {
    const session = sessions.get(sessionId);
    if (!session) return;
    session.cancelled = true;
    sessions.delete(sessionId);
    session.client.close();
  }

  async function shutdown(): Promise<void> {
    const current = [...sessions.values()];
    sessions.clear();
    for (const session of current) { session.cancelled = true; session.client.close(); }
  }

  return Object.freeze({ open, listDirectory, close, shutdown });
}
