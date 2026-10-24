import { failure } from '../../domain/src/errors.ts';
import type { ErrorCode, Outcome } from '../../domain/src/errors.ts';
import type { CredentialPrompt, CredentialPromptCancellation } from './credential-prompt.ts';
import { createCancellationSource } from './cancellation.ts';
import type { CancellationSignal, CancellationSource } from './cancellation.ts';
import { canonicalizeFtpEndpoint, isFtpCommandArgument, isFtpDirectoryListing, isFtpFileName, isFtpRemotePath,
  isFtpTransferConflictPolicy, isFtpTransferProgress, isFtpTransferResult } from '../../domain/src/ftp.ts';
import type { FtpEndpoint } from '../../domain/src/ftp.ts';
import type { FtpTransferConflictPolicy, FtpTransferProgress, FtpTransferResult } from '../../domain/src/ftp.ts';
import type { RemoteDirectoryListing } from '../../domain/src/remote-files.ts';

export interface FtpCredentials {
  readonly username: string;
  readonly password: string;
}

export type FtpFilesProviderErrorCode = 'INVALID_REQUEST' | 'UNAVAILABLE' | 'CANCELLED' | 'TIMEOUT' | 'BUSY' | 'OUTPUT_LIMIT' | 'AUTHENTICATION_FAILED' | 'CONFLICT';

export class FtpFilesProviderError extends Error {
  readonly code: FtpFilesProviderErrorCode;

  constructor(code: FtpFilesProviderErrorCode) {
    super('FTP file operation failed');
    this.name = 'FtpFilesProviderError';
    this.code = code;
  }
}

export interface FtpFilesProvider {
  open(sessionId: string, endpoint: FtpEndpoint, credentials: FtpCredentials, cancellation?: CancellationSignal): Promise<void>;
  listDirectory(sessionId: string, path: string, cancellation?: CancellationSignal): Promise<RemoteDirectoryListing>;
  uploadFile(sessionId: string, operationId: string, localPath: string, remoteDirectory: string, fileName: string,
    conflictPolicy: FtpTransferConflictPolicy, cancellation?: CancellationSignal,
    onProgress?: (progress: FtpTransferProgress) => void): Promise<FtpTransferResult>;
  downloadFile(sessionId: string, operationId: string, remotePath: string, localPath: string,
    conflictPolicy: FtpTransferConflictPolicy, cancellation?: CancellationSignal,
    onProgress?: (progress: FtpTransferProgress) => void): Promise<FtpTransferResult>;
  close(sessionId: string): Promise<void>;
  shutdown(): Promise<void>;
}

export interface FtpFilesSession {
  readonly sessionId: string;
  readonly endpoint: FtpEndpoint;
  readonly state: 'running';
}

export interface FtpFilesController {
  open(sessionId: string, host: string, port: number, secure: boolean, cancellation?: CredentialPromptCancellation): Promise<Outcome<FtpFilesSession>>;
  listDirectory(sessionId: string, path: string, cancellation?: CancellationSignal): Promise<Outcome<RemoteDirectoryListing>>;
  uploadFile(sessionId: string, operationId: string, localPath: string, remoteDirectory: string, fileName: string,
    conflictPolicy: FtpTransferConflictPolicy, cancellation?: CancellationSignal,
    onProgress?: (progress: FtpTransferProgress) => void): Promise<Outcome<FtpTransferResult>>;
  downloadFile(sessionId: string, operationId: string, remotePath: string, localPath: string,
    conflictPolicy: FtpTransferConflictPolicy, cancellation?: CancellationSignal,
    onProgress?: (progress: FtpTransferProgress) => void): Promise<Outcome<FtpTransferResult>>;
  cancelTransfer(sessionId: string, operationId: string): Promise<Outcome<Record<string, never>>>;
  close(sessionId: string): Promise<Outcome<Record<string, never>>>;
  closeAll(): Promise<void>;
  dispose(): Promise<void>;
}

interface OpenFtpSession {
  readonly sessionId: string;
  readonly endpoint: FtpEndpoint;
}

interface ActiveFtpTransfer {
  readonly sessionId: string;
  readonly cancellation: CancellationSource;
  readonly settled: Promise<void>;
  readonly settle: () => void;
}

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_USERNAME_LENGTH = 512;
const MAX_PASSWORD_LENGTH = 65_536;
const EMPTY_RESULT: Record<string, never> = Object.freeze({});

export function createFtpFilesController(provider: FtpFilesProvider, credentialPrompt: CredentialPrompt): FtpFilesController {
  const sessions = new Map<string, OpenFtpSession>();
  const transfers = new Map<string, ActiveFtpTransfer>();
  const openingOperations = new Set<CancellationSource>();
  let shutdownPromise: Promise<void> | undefined;
  let disposed = false;

  async function open(sessionId: string, host: string, port: number, secure: boolean,
    cancellation?: CredentialPromptCancellation): Promise<Outcome<FtpFilesSession>> {
    if (disposed) return failure('CANCELLED');
    if (shutdownPromise) return failure('BUSY');
    if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId) || typeof secure !== 'boolean') return failure('INVALID_REQUEST');
    const endpoint = canonicalizeFtpEndpoint({ host, port, secure });
    if (!endpoint) return failure('INVALID_REQUEST');
    if (sessions.has(sessionId)) return failure('CONFLICT');
    if (cancellation?.aborted) return failure('CANCELLED');

    const operationCancellation = createCancellationSource();
    const cancelForCaller = () => operationCancellation.abort();
    openingOperations.add(operationCancellation);
    cancellation?.addEventListener('abort', cancelForCaller, { once: true });
    try {
      if (cancellation?.aborted) operationCancellation.abort();
      let prompted;
      try { prompted = await credentialPrompt.prompt('ftp-account', operationCancellation); }
      catch { return operationCancellation.aborted ? failure('CANCELLED') : failure('UNAVAILABLE'); }
      if (operationCancellation.aborted || cancellation?.aborted || prompted.kind === 'cancelled') return failure('CANCELLED');
      if (prompted.kind === 'timeout') return failure('TIMEOUT');
      if (prompted.kind !== 'provided') return failure('UNAVAILABLE');
      if (typeof prompted.username !== 'string' || typeof prompted.secret !== 'string' || prompted.username.length === 0 ||
          prompted.username.length > MAX_USERNAME_LENGTH || prompted.username.trim() !== prompted.username || prompted.username.includes('\0') ||
          !isFtpCommandArgument(prompted.username) || prompted.secret.length > MAX_PASSWORD_LENGTH || !isFtpCommandArgument(prompted.secret)) {
        return failure('INVALID_REQUEST');
      }
      if (operationCancellation.aborted || cancellation?.aborted || disposed || shutdownPromise) return failure('CANCELLED');

      const credentials: FtpCredentials = { username: prompted.username, password: prompted.secret };
      const session: OpenFtpSession = { sessionId, endpoint };
      sessions.set(sessionId, session);
      try {
        await provider.open(sessionId, endpoint, credentials, operationCancellation);
        if (disposed || shutdownPromise || operationCancellation.aborted || sessions.get(sessionId) !== session) {
          await provider.close(sessionId).catch(() => undefined);
          sessions.delete(sessionId);
          return failure('CANCELLED');
        }
        return { ok: true, result: { sessionId, endpoint, state: 'running' } };
      } catch (error) {
        sessions.delete(sessionId);
        const code: ErrorCode = error instanceof FtpFilesProviderError ? error.code : 'UNAVAILABLE';
        return failure(code, 'terminal');
      } finally {
        (credentials as { username: string; password: string }).username = '';
        (credentials as { username: string; password: string }).password = '';
      }
    } finally {
      openingOperations.delete(operationCancellation);
      cancellation?.removeEventListener('abort', cancelForCaller);
    }
  }

  async function listDirectory(sessionId: string, path: string, cancellation?: CancellationSignal): Promise<Outcome<RemoteDirectoryListing>> {
    if (!sessions.has(sessionId)) return failure('NOT_FOUND', 'terminal');
    if (!isFtpRemotePath(path)) return failure('INVALID_REQUEST');
    if (cancellation?.aborted) return failure('CANCELLED');
    try {
      const listing = await provider.listDirectory(sessionId, path, cancellation);
      if (!isFtpDirectoryListing(listing)) return failure('UNAVAILABLE');
      return { ok: true, result: listing };
    } catch (error) {
      const code: ErrorCode = error instanceof FtpFilesProviderError ? error.code : 'UNAVAILABLE';
      if ((code === 'CANCELLED' || code === 'TIMEOUT' || code === 'UNAVAILABLE') && sessions.delete(sessionId)) {
        await provider.close(sessionId).catch(() => undefined);
      }
      return failure(code, 'terminal');
    }
  }

  async function close(sessionId: string): Promise<Outcome<Record<string, never>>> {
    if (!sessions.delete(sessionId)) return failure('NOT_FOUND', 'terminal');
    const closingTransfers = [...transfers.values()].filter(transfer => transfer.sessionId === sessionId);
    for (const transfer of closingTransfers) transfer.cancellation.abort();
    await Promise.all(closingTransfers.map(transfer => transfer.settled));
    try {
      await provider.close(sessionId);
      return { ok: true, result: EMPTY_RESULT };
    } catch (error) {
      const code: ErrorCode = error instanceof FtpFilesProviderError ? error.code : 'UNAVAILABLE';
      return failure(code, 'terminal');
    }
  }

  async function transferFile(sessionId: string, operationId: string, args: {
    readonly direction: 'upload'; readonly localPath: string; readonly remoteDirectory: string; readonly fileName: string;
    readonly conflictPolicy: FtpTransferConflictPolicy;
  } | {
    readonly direction: 'download'; readonly remotePath: string; readonly localPath: string;
    readonly conflictPolicy: FtpTransferConflictPolicy;
  }, cancellation?: CancellationSignal, onProgress?: (progress: FtpTransferProgress) => void): Promise<Outcome<FtpTransferResult>> {
    if (!sessions.has(sessionId)) return failure('NOT_FOUND', 'terminal');
    if (!SESSION_ID.test(operationId) || transfers.has(operationId)) return failure('INVALID_REQUEST');
    if (cancellation?.aborted) return failure('CANCELLED');
    if (!isFtpTransferConflictPolicy(args.conflictPolicy) || typeof args.localPath !== 'string' || args.localPath.length === 0 ||
        args.localPath.length > 32_768 || !isFtpCommandArgument(args.localPath)) return failure('INVALID_REQUEST');
    if (args.direction === 'upload' && (!isFtpRemotePath(args.remoteDirectory) || !isFtpFileName(args.fileName))) return failure('INVALID_REQUEST');
    if (args.direction === 'download' && !isFtpRemotePath(args.remotePath)) return failure('INVALID_REQUEST');
    if (disposed || shutdownPromise) return failure('CANCELLED');

    const operationCancellation = createCancellationSource();
    let transferSettle!: () => void;
    const settled = new Promise<void>(resolveSettled => { transferSettle = resolveSettled; });
    const transfer: ActiveFtpTransfer = {
      sessionId, cancellation: operationCancellation, settled,
      settle: () => transferSettle()
    };
    transfers.set(operationId, transfer);
    const cancelForCaller = () => operationCancellation.abort();
    cancellation?.addEventListener('abort', cancelForCaller, { once: true });
    try {
      const progress = (event: FtpTransferProgress) => {
        if (transfers.get(operationId) !== transfer || event.operationId !== operationId || event.sessionId !== sessionId || !isFtpTransferProgress(event)) return;
        try { onProgress?.(event); } catch { /* A UI progress listener cannot interrupt the transfer owner. */ }
      };
      const result = args.direction === 'upload'
        ? await provider.uploadFile(sessionId, operationId, args.localPath, args.remoteDirectory, args.fileName, args.conflictPolicy,
          operationCancellation, progress)
        : await provider.downloadFile(sessionId, operationId, args.remotePath, args.localPath, args.conflictPolicy, operationCancellation, progress);
      if (!isFtpTransferResult(result) || result.direction !== args.direction) return failure('UNAVAILABLE', 'terminal');
      return { ok: true, result };
    } catch (error) {
      const code: ErrorCode = error instanceof FtpFilesProviderError ? error.code : 'UNAVAILABLE';
      if (code !== 'CANCELLED' && code !== 'CONFLICT' && sessions.delete(sessionId)) await provider.close(sessionId).catch(() => undefined);
      return failure(code, 'terminal');
    } finally {
      cancellation?.removeEventListener('abort', cancelForCaller);
      if (transfers.get(operationId) === transfer) transfers.delete(operationId);
      transfer.settle();
    }
  }

  async function uploadFile(sessionId: string, operationId: string, localPath: string, remoteDirectory: string, fileName: string,
    conflictPolicy: FtpTransferConflictPolicy, cancellation?: CancellationSignal,
    onProgress?: (progress: FtpTransferProgress) => void): Promise<Outcome<FtpTransferResult>> {
    return transferFile(sessionId, operationId, { direction: 'upload', localPath, remoteDirectory, fileName, conflictPolicy }, cancellation, onProgress);
  }

  async function downloadFile(sessionId: string, operationId: string, remotePath: string, localPath: string,
    conflictPolicy: FtpTransferConflictPolicy, cancellation?: CancellationSignal,
    onProgress?: (progress: FtpTransferProgress) => void): Promise<Outcome<FtpTransferResult>> {
    return transferFile(sessionId, operationId, { direction: 'download', remotePath, localPath, conflictPolicy }, cancellation, onProgress);
  }

  async function cancelTransfer(sessionId: string, operationId: string): Promise<Outcome<Record<string, never>>> {
    const transfer = transfers.get(operationId);
    if (!transfer || transfer.sessionId !== sessionId) return failure('NOT_FOUND', 'terminal');
    transfer.cancellation.abort();
    await transfer.settled;
    return { ok: true, result: EMPTY_RESULT };
  }

  async function closeAll(): Promise<void> {
    if (shutdownPromise) return shutdownPromise;
    for (const operation of openingOperations) operation.abort();
    const activeTransfers = [...transfers.values()];
    for (const transfer of activeTransfers) transfer.cancellation.abort();
    await Promise.all(activeTransfers.map(transfer => transfer.settled));
    sessions.clear();
    const closing = provider.shutdown();
    shutdownPromise = closing;
    try { await closing; }
    finally { if (shutdownPromise === closing) shutdownPromise = undefined; }
  }

  return Object.freeze({
    open,
    listDirectory,
    uploadFile,
    downloadFile,
    cancelTransfer,
    close,
    closeAll,
    async dispose() {
      disposed = true;
      await closeAll().catch(() => undefined);
    }
  });
}
