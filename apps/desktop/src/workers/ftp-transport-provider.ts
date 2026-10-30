import { lstat, open as openFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { ReadStream, Stats } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { FtpFilesProviderError } from '../../../../packages/application/src/ftp-files.ts';
import type { FtpCredentials, FtpFilesProvider } from '../../../../packages/application/src/ftp-files.ts';
import type { CancellationSignal } from '../../../../packages/application/src/cancellation.ts';
import { isCanonicalFtpEndpoint, isFtpCommandArgument, isFtpDirectoryListing, isFtpFileName, isFtpRemotePath,
  isFtpTransferConflictPolicy } from '../../../../packages/domain/src/ftp.ts';
import type { FtpEndpoint } from '../../../../packages/domain/src/ftp.ts';
import type { FtpTransferConflictPolicy, FtpTransferDirection, FtpTransferProgress, FtpTransferResult } from '../../../../packages/domain/src/ftp.ts';
import { MAX_REMOTE_DIRECTORY_ENTRIES, MAX_REMOTE_FILE_NAME_CHARS, remoteChildPath, remoteParentPath } from '../../../../packages/domain/src/remote-files.ts';
import type { RemoteDirectoryListing, RemoteFileEntry } from '../../../../packages/domain/src/remote-files.ts';
import { LocalTransferTargetError, mapLocalTransferTargetError, prepareLocalTransferTarget } from './local-transfer-target.ts';

export interface FtpLibraryFileInfo {
  readonly name: unknown;
  readonly type: unknown;
  readonly size: unknown;
  readonly modifiedAt?: unknown;
}

export interface FtpLibraryClient {
  readonly ftp: { verbose: boolean; log(message: string): void };
  readonly closed?: boolean;
  access(options: { readonly host: string; readonly port: number; readonly user: string; readonly password: string; readonly secure: boolean }): Promise<unknown>;
  pwd(): Promise<string>;
  cd(path: string): Promise<unknown>;
  list(path?: string): Promise<FtpLibraryFileInfo[]>;
  rename(source: string, destination: string): Promise<unknown>;
  uploadFrom(source: Readable | string, remotePath: string): Promise<unknown>;
  uploadUniqueFrom(source: Readable, remotePath: string, onUniquePath: (remotePath: string) => void): Promise<string>;
  downloadTo(destination: Writable | string, remotePath: string, startAt?: number): Promise<unknown>;
  trackProgress(handler?: (info: { readonly name: string; readonly type: string; readonly bytes: number }) => void): void;
  close(): void;
}

export type FtpLibraryClientFactory = (timeoutMs: number, options: { readonly allowSeparateTransferHost: false; readonly maxListingBytes: number }) => FtpLibraryClient;
export type FtpAuthenticationErrorCheck = (error: unknown) => boolean;

interface FtpSession {
  readonly client: FtpLibraryClient;
  busy: boolean;
  cancelled: boolean;
  activeStream: Readable | Writable | undefined;
}

const SERVER_PROGRESS_TIMEOUT_MS = 30_000;
const MAX_LISTING_BYTES = 2 * 1024 * 1024;
const TRANSFER_OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_COPY_NAME_ATTEMPTS = 9_999;

function isAbsoluteNormalizedPath(path: string): boolean {
  return path.length > 0 && path.length <= 32_768 && !path.includes('\0') && isFtpCommandArgument(path) && isAbsolute(path) && resolve(path) === path;
}

function copyName(name: string, ordinal: number): string | undefined {
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot) : '';
  const stem = extension ? name.slice(0, -extension.length) : name;
  const suffix = ` (${ordinal})`;
  const available = MAX_REMOTE_FILE_NAME_CHARS - suffix.length - extension.length;
  if (available < 1) return undefined;
  return `${stem.slice(0, available)}${suffix}${extension}`;
}

function completed(direction: FtpTransferDirection, fileName: string, bytesTransferred: number, state: 'completed' | 'skipped' = 'completed'): FtpTransferResult {
  return { direction, fileName, bytesTransferred, state };
}

function localFileError(error: unknown): FtpFilesProviderError {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  if (code === 'ENOENT') return new FtpFilesProviderError('NOT_FOUND', true);
  if (code === 'EACCES' || code === 'EPERM') return new FtpFilesProviderError('FORBIDDEN', true);
  if (code === 'EISDIR' || code === 'ENOTDIR') return new FtpFilesProviderError('INVALID_REQUEST', true);
  return new FtpFilesProviderError('UNAVAILABLE', true);
}

function sameSourceVersion(before: Stats, after: Stats): boolean {
  return before.dev === after.dev && before.ino === after.ino && before.size === after.size &&
    before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs;
}

function mapLocalTargetError(error: unknown): never {
  if (error instanceof LocalTransferTargetError) throw new FtpFilesProviderError(error.code, true);
  if (error instanceof Error) throw new FtpFilesProviderError(mapLocalTransferTargetError(error).code, true);
  throw error;
}

function uniqueStoreName(remotePath: string, remoteDirectory: string): string | undefined {
  if (!isFtpRemotePath(remotePath)) return undefined;
  const returnedName = remotePath.slice(remotePath.lastIndexOf('/') + 1);
  if (!isFtpFileName(returnedName)) return undefined;
  const resolvedPath = remotePath.includes('/') ? remotePath : remoteChildPath(remoteDirectory, returnedName);
  if (!resolvedPath || remoteParentPath(resolvedPath) !== remoteDirectory) return undefined;
  return returnedName;
}

function isFtpCommandUnsupported(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  return error.code === 500 || error.code === 501 || error.code === 502 || error.code === 504;
}

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
    const session: FtpSession = { client, busy: true, cancelled: false, activeStream: undefined };
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

  async function uploadFile(sessionId: string, operationId: string, localPath: string, remoteDirectory: string, fileName: string,
    conflictPolicy: FtpTransferConflictPolicy, cancellation?: CancellationSignal,
    onProgress?: (progress: FtpTransferProgress) => void): Promise<FtpTransferResult> {
    const session = sessions.get(sessionId);
    if (!session) throw new FtpFilesProviderError('UNAVAILABLE');
    if (!TRANSFER_OPERATION_ID.test(operationId) || !isAbsoluteNormalizedPath(localPath) || !isFtpRemotePath(remoteDirectory) ||
        !isFtpFileName(fileName) || basename(localPath) !== fileName || !isFtpTransferConflictPolicy(conflictPolicy)) {
      throw new FtpFilesProviderError('INVALID_REQUEST');
    }
    if (cancellation?.aborted) throw new FtpFilesProviderError('CANCELLED');
    if (session.busy || session.cancelled) throw new FtpFilesProviderError('BUSY');
    session.busy = true;
    let temporaryRemotePath: string | undefined;
    let sourceFile: Awaited<ReturnType<typeof openFile>> | undefined;
    let upload: ReadStream | undefined;
    let cancelled = false;
    let committing = false;
    let ftpOperationPending = false;
    const wasCancelled = () => !committing && (cancelled || cancellation?.aborted === true);
    const beginCommit = () => {
      if (wasCancelled()) return false;
      committing = true;
      return true;
    };
    const abort = () => {
      if (committing) return;
      cancelled = true;
      if (upload) {
        // Stop reading locally; FTP paths cannot prove which remote object a DELE would remove.
        upload.push(null);
        return;
      }
      if (ftpOperationPending) {
        session.client.close();
        sessions.delete(sessionId);
      }
    };
    const runFtpOperation = async <T>(operation: () => Promise<T>): Promise<T> => {
      ftpOperationPending = true;
      try { return await operation(); }
      finally { ftpOperationPending = false; }
    };
    cancellation?.addEventListener('abort', abort, { once: true });
    if (cancellation?.aborted) abort();
    try {
      let sourceStats: Stats;
      try {
        const selectedStats = await lstat(localPath);
        if (!selectedStats.isFile() || selectedStats.isSymbolicLink() || !Number.isSafeInteger(selectedStats.size)) {
          throw new FtpFilesProviderError('INVALID_REQUEST');
        }
        if (wasCancelled()) throw new FtpFilesProviderError('CANCELLED', session.client.closed !== true);
        sourceFile = await openFile(localPath, 'r');
        sourceStats = await sourceFile.stat();
        const currentPathStats = await lstat(localPath);
        if (!sourceStats.isFile() || !currentPathStats.isFile() || currentPathStats.isSymbolicLink() ||
            sourceStats.dev !== currentPathStats.dev || sourceStats.ino !== currentPathStats.ino || sourceStats.size !== currentPathStats.size ||
            !Number.isSafeInteger(sourceStats.size)) throw new FtpFilesProviderError('INVALID_REQUEST');
      } catch (error) {
        if (error instanceof FtpFilesProviderError) throw error;
        throw localFileError(error);
      }
      if (wasCancelled()) throw new FtpFilesProviderError('CANCELLED', session.client.closed !== true);

      const listed = await runFtpOperation(() => session.client.list(remoteDirectory));
      if (wasCancelled()) throw new FtpFilesProviderError('CANCELLED', session.client.closed !== true);
      const remoteNames = new Set<string>();
      let existing: FtpLibraryFileInfo | undefined;
      for (const entry of listed) {
        if (typeof entry.name !== 'string') continue;
        remoteNames.add(entry.name);
        if (entry.name === fileName) existing = entry;
      }
      let targetName = fileName;
      if (existing) {
        if (conflictPolicy === 'skip') return completed('upload', targetName, 0, 'skipped');
        if (conflictPolicy === 'overwrite' && existing.type !== fileTypes.file) throw new FtpFilesProviderError('CONFLICT');
        if (conflictPolicy === 'rename') {
          let renamed: string | undefined;
          for (let ordinal = 1; ordinal <= MAX_COPY_NAME_ATTEMPTS; ordinal++) {
            const candidate = copyName(fileName, ordinal);
            if (candidate && isFtpFileName(candidate) && !remoteNames.has(candidate)) { renamed = candidate; break; }
          }
          if (!renamed) throw new FtpFilesProviderError('CONFLICT');
          targetName = renamed;
        }
      }
      const remoteTargetPath = remoteChildPath(remoteDirectory, targetName);
      if (!remoteTargetPath || !isFtpRemotePath(remoteTargetPath)) throw new FtpFilesProviderError('INVALID_REQUEST');
      const overwriteExisting = conflictPolicy === 'overwrite' && existing !== undefined;
      if (overwriteExisting) {
        for (let attempt = 0; attempt < 4; attempt++) {
          const tempName = `.mrt-${randomUUID()}-${attempt}.partial`;
          const tempPath = remoteChildPath(remoteDirectory, tempName);
          if (tempPath && isFtpRemotePath(tempPath) && !remoteNames.has(tempName)) { temporaryRemotePath = tempPath; break; }
        }
        if (!temporaryRemotePath) throw new FtpFilesProviderError('CONFLICT');
      }
      upload = sourceFile.createReadStream({ autoClose: false });
      session.activeStream = upload;
      onProgress?.({ sessionId, operationId, direction: 'upload', phase: 'transferring', fileName: targetName, bytesTransferred: 0, totalBytes: sourceStats.size });
      session.client.trackProgress(info => {
        if (info.type !== 'upload' || !Number.isSafeInteger(info.bytes) || info.bytes < 0) return;
        onProgress?.({ sessionId, operationId, direction: 'upload', phase: 'transferring', fileName: targetName, bytesTransferred: info.bytes,
          totalBytes: sourceStats.size });
      });
      if (wasCancelled()) throw new FtpFilesProviderError('CANCELLED', session.client.closed !== true);
      let uniqueRemotePath: string | undefined;
      try {
        if (overwriteExisting) await runFtpOperation(() => session.client.uploadFrom(upload!, temporaryRemotePath!));
        else uniqueRemotePath = await runFtpOperation(() => session.client.uploadUniqueFrom(upload!, remoteTargetPath, path => {
          if (uniqueStoreName(path, remoteDirectory)) temporaryRemotePath = path;
        }));
      } catch (error) {
        if (!overwriteExisting && isFtpCommandUnsupported(error)) throw new FtpFilesProviderError('NOT_SUPPORTED', true);
        throw error;
      }
      if (wasCancelled()) throw new FtpFilesProviderError('CANCELLED', session.client.closed !== true);
      if (uniqueRemotePath) {
        const actualName = uniqueStoreName(uniqueRemotePath, remoteDirectory);
        if (!actualName) throw new FtpFilesProviderError('UNAVAILABLE', true);
        temporaryRemotePath = uniqueRemotePath;
      }
      const finalSourceStats = await sourceFile.stat();
      if (upload.bytesRead !== sourceStats.size || !sameSourceVersion(sourceStats, finalSourceStats)) {
        throw new FtpFilesProviderError('CONFLICT');
      }

      if (uniqueRemotePath) {
        const actualName = uniqueStoreName(uniqueRemotePath, remoteDirectory)!;
        if (actualName !== targetName && (conflictPolicy === 'skip' || conflictPolicy === 'overwrite')) {
          const latest = await session.client.list(remoteDirectory);
          if (wasCancelled()) throw new FtpFilesProviderError('CANCELLED', session.client.closed !== true);
          const requestedTargetAppeared = latest.some(entry => entry.name === targetName);
          if (requestedTargetAppeared) {
            throw new FtpFilesProviderError('CONFLICT');
          }
        }
        temporaryRemotePath = undefined;
        return completed('upload', actualName, sourceStats.size);
      }

      const latest = await session.client.list(remoteDirectory);
      if (wasCancelled()) throw new FtpFilesProviderError('CANCELLED', session.client.closed !== true);
      const currentTarget = latest.find(entry => entry.name === targetName);
      if (currentTarget && !(conflictPolicy === 'overwrite' && existing && targetName === fileName)) {
        if (conflictPolicy === 'skip') throw new FtpFilesProviderError('CONFLICT');
        if (conflictPolicy === 'rename') {
          const latestNames = new Set(latest.map(entry => entry.name));
          let renamed: string | undefined;
          for (let ordinal = 1; ordinal <= MAX_COPY_NAME_ATTEMPTS; ordinal++) {
            const candidate = copyName(fileName, ordinal);
            if (candidate && isFtpFileName(candidate) && !latestNames.has(candidate)) { renamed = candidate; break; }
          }
          if (!renamed) throw new FtpFilesProviderError('CONFLICT');
          targetName = renamed;
        } else {
          throw new FtpFilesProviderError('CONFLICT');
        }
      }
      const finalPath = remoteChildPath(remoteDirectory, targetName);
      if (!finalPath || !isFtpRemotePath(finalPath)) throw new FtpFilesProviderError('INVALID_REQUEST');
      if (currentTarget && conflictPolicy === 'overwrite') {
        if (currentTarget.type !== fileTypes.file) throw new FtpFilesProviderError('CONFLICT');
        const backupName = `.mrt-${randomUUID()}.backup`;
        const backupPath = remoteChildPath(remoteDirectory, backupName);
        if (!backupPath || !isFtpRemotePath(backupPath)) throw new FtpFilesProviderError('CONFLICT');
        onProgress?.({ sessionId, operationId, direction: 'upload', phase: 'committing', fileName: targetName,
          bytesTransferred: sourceStats.size, totalBytes: sourceStats.size });
        if (!beginCommit()) throw new FtpFilesProviderError('CANCELLED', session.client.closed !== true);
        await session.client.rename(finalPath, backupPath);
        try {
          await session.client.rename(temporaryRemotePath!, finalPath);
          temporaryRemotePath = undefined;
        } catch {
          try { await session.client.rename(backupPath, finalPath); }
          catch {
            session.client.close();
            sessions.delete(sessionId);
            throw new FtpFilesProviderError('UNAVAILABLE');
          }
          throw new FtpFilesProviderError('CONFLICT');
        }
        // Preserve the previous file; FTP exposes no object identity for a safe cleanup command.
      } else if (overwriteExisting) {
        throw new FtpFilesProviderError('CONFLICT');
      } else {
        if (!beginCommit()) throw new FtpFilesProviderError('CANCELLED', session.client.closed !== true);
        await session.client.rename(temporaryRemotePath!, finalPath);
        temporaryRemotePath = undefined;
      }
      return completed('upload', targetName, sourceStats.size);
    } catch (error) {
      if (wasCancelled()) {
        const sessionUsable = session.client.closed !== true;
        if (!sessionUsable) sessions.delete(sessionId);
        throw new FtpFilesProviderError('CANCELLED', sessionUsable);
      }
      if (error instanceof FtpFilesProviderError) throw error;
      session.client.close();
      sessions.delete(sessionId);
      throw new FtpFilesProviderError('UNAVAILABLE');
    } finally {
      cancellation?.removeEventListener('abort', abort);
      session.client.trackProgress();
      session.activeStream = undefined;
      await sourceFile?.close().catch(() => undefined);
      session.busy = false;
    }
  }

  async function downloadFile(sessionId: string, operationId: string, remotePath: string, localPath: string,
    conflictPolicy: FtpTransferConflictPolicy, cancellation?: CancellationSignal,
    onProgress?: (progress: FtpTransferProgress) => void): Promise<FtpTransferResult> {
    const session = sessions.get(sessionId);
    if (!session) throw new FtpFilesProviderError('UNAVAILABLE');
    if (!TRANSFER_OPERATION_ID.test(operationId) || !isFtpRemotePath(remotePath) || !isAbsoluteNormalizedPath(localPath) ||
        !isFtpTransferConflictPolicy(conflictPolicy)) throw new FtpFilesProviderError('INVALID_REQUEST');
    if (cancellation?.aborted) throw new FtpFilesProviderError('CANCELLED');
    if (session.busy || session.cancelled) throw new FtpFilesProviderError('BUSY');
    session.busy = true;
    let target: Awaited<ReturnType<typeof prepareLocalTransferTarget>> | undefined;
    let cancelled = false;
    let committing = false;
    let ftpOperationPending = false;
    const wasCancelled = () => !committing && (cancelled || cancellation?.aborted === true);
    const beginCommit = () => {
      if (wasCancelled()) return false;
      committing = true;
      return true;
    };
    let download: Writable | undefined;
    let lastBytesTransferred = 0;
    const abort = () => {
      if (committing) return;
      cancelled = true;
      download?.destroy(new Error('FTP transfer cancelled'));
      if (ftpOperationPending || download) {
        session.client.close();
        sessions.delete(sessionId);
      }
    };
    const runFtpOperation = async <T>(operation: () => Promise<T>): Promise<T> => {
      ftpOperationPending = true;
      try { return await operation(); }
      finally { ftpOperationPending = false; }
    };
    cancellation?.addEventListener('abort', abort, { once: true });
    if (cancellation?.aborted) abort();
    const fileName = remotePath.slice(remotePath.lastIndexOf('/') + 1);
    try {
      if (!isFtpFileName(fileName) || remoteParentPath(remotePath) === remotePath) throw new FtpFilesProviderError('INVALID_REQUEST');
      const parent = remoteParentPath(remotePath);
      const listing = await runFtpOperation(() => session.client.list(parent));
      if (wasCancelled()) throw new FtpFilesProviderError('CANCELLED', session.client.closed !== true);
      const entry = listing.find(item => item.name === fileName);
      if (!entry || entry.type !== fileTypes.file) throw new FtpFilesProviderError('INVALID_REQUEST');
      const totalBytes = Number.isSafeInteger(entry.size) && (entry.size as number) > 0 ? entry.size as number : null;
      try { target = await prepareLocalTransferTarget(localPath, conflictPolicy); }
      catch (error) { mapLocalTargetError(error); }
      if (wasCancelled()) throw new FtpFilesProviderError('CANCELLED', session.client.closed !== true);
      if (!target || target.state === 'skipped') return completed('download', target?.fileName ?? basename(localPath), 0, 'skipped');
      if (!target.stream) throw new FtpFilesProviderError('UNAVAILABLE');
      download = target.stream;
      session.activeStream = download;
      session.client.trackProgress(info => {
        if (info.type !== 'download' || !Number.isSafeInteger(info.bytes) || info.bytes < 0) return;
        lastBytesTransferred = info.bytes;
        onProgress?.({ sessionId, operationId, direction: 'download', phase: 'transferring', fileName: target?.fileName ?? fileName,
          bytesTransferred: info.bytes, totalBytes });
      });
      onProgress?.({ sessionId, operationId, direction: 'download', phase: 'transferring', fileName: target.fileName, bytesTransferred: 0, totalBytes });
      if (wasCancelled()) throw new FtpFilesProviderError('CANCELLED', session.client.closed !== true);
      await runFtpOperation(() => session.client.downloadTo(download!, remotePath));
      if (wasCancelled()) throw new FtpFilesProviderError('CANCELLED', session.client.closed !== true);
      const result = await target.complete(() => {
        onProgress?.({ sessionId, operationId, direction: 'download', phase: 'committing', fileName: target!.fileName,
          bytesTransferred: download && 'bytesWritten' in download ? Number(download.bytesWritten) : lastBytesTransferred, totalBytes });
        return beginCommit();
      });
      return completed('download', result.fileName, result.bytes, result.state);
    } catch (error) {
      await target?.cleanup().catch(() => undefined);
      if (wasCancelled()) {
        const sessionUsable = session.client.closed !== true;
        if (!sessionUsable) sessions.delete(sessionId);
        throw new FtpFilesProviderError('CANCELLED', sessionUsable);
      }
      if (error instanceof FtpFilesProviderError) throw error;
      if (error instanceof LocalTransferTargetError) throw new FtpFilesProviderError(error.code, true);
      session.client.close();
      sessions.delete(sessionId);
      throw new FtpFilesProviderError('UNAVAILABLE');
    } finally {
      cancellation?.removeEventListener('abort', abort);
      session.client.trackProgress();
      session.activeStream = undefined;
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

  return Object.freeze({ open, listDirectory, uploadFile, downloadFile, close, shutdown });
}
