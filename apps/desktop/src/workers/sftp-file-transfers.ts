import { randomUUID } from 'node:crypto';
import { lstat, open as openFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { basename, extname, posix } from 'node:path';
import { Transform } from 'node:stream';
import type { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { SFTPWrapper, Stats as SftpStats } from 'ssh2';
import type { CancellationSignal } from '../../../../packages/application/src/cancellation.ts';
import { SshTerminalProviderError } from '../../../../packages/application/src/ssh-terminals.ts';
import type { FileTransferConflictPolicy, FileTransferProgress, FileTransferResult } from '../../../../packages/domain/src/file-transfer.ts';
import { isFileTransferConflictPolicy } from '../../../../packages/domain/src/file-transfer.ts';
import { isRemoteFileName, isRemotePath, MAX_REMOTE_FILE_NAME_CHARS, remoteChildPath } from '../../../../packages/domain/src/remote-files.ts';
import { isAbsoluteNormalizedLocalPath, LocalTransferTargetError, mapLocalTransferTargetError, prepareLocalTransferTarget } from './local-transfer-target.ts';

const SFTP_OPERATION_TIMEOUT_MS = 10_000;
const TRANSFER_IDLE_TIMEOUT_MS = 30_000;
const PROGRESS_INTERVAL_MS = 100;
const MAX_COPY_NAME_ATTEMPTS = 9_999;
const TRANSFER_OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SftpFileTransfers {
  upload(sessionId: string, operationId: string, channel: SFTPWrapper, localPath: string, remoteDirectory: string, fileName: string,
    conflictPolicy: FileTransferConflictPolicy, cancellation?: CancellationSignal,
    onProgress?: (progress: FileTransferProgress) => void): Promise<FileTransferResult>;
  download(sessionId: string, operationId: string, channel: SFTPWrapper, remotePath: string, localPath: string,
    conflictPolicy: FileTransferConflictPolicy, cancellation?: CancellationSignal,
    onProgress?: (progress: FileTransferProgress) => void): Promise<FileTransferResult>;
}

interface RemoteIdentity {
  readonly mode: number;
  readonly uid: number;
  readonly gid: number;
  readonly size: number;
  readonly mtime: number;
}

function identity(stats: SftpStats): RemoteIdentity {
  return { mode: stats.mode, uid: stats.uid, gid: stats.gid, size: stats.size, mtime: stats.mtime };
}

function sameIdentity(left: RemoteIdentity, right: RemoteIdentity): boolean {
  return left.mode === right.mode && left.uid === right.uid && left.gid === right.gid && left.size === right.size && left.mtime === right.mtime;
}

function sftpErrorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
}

function mappedSftpError(error: unknown): SshTerminalProviderError {
  const code = sftpErrorCode(error);
  if (code === 2 || code === '2' || code === 'ENOENT') return new SshTerminalProviderError('NOT_FOUND');
  if (code === 3 || code === '3' || code === 'EACCES' || code === 'EPERM') return new SshTerminalProviderError('FORBIDDEN');
  if (code === 11 || code === '11' || code === 'EEXIST') return new SshTerminalProviderError('CONFLICT');
  return new SshTerminalProviderError('UNAVAILABLE');
}

function mappedRenameError(error: unknown): SshTerminalProviderError {
  const code = sftpErrorCode(error);
  // SFTP v3 has a generic failure status for rename collisions on conforming servers.
  if (code === 4 || code === '4') return new SshTerminalProviderError('CONFLICT');
  return mappedSftpError(error);
}

function localFileError(error: unknown): SshTerminalProviderError {
  const code = sftpErrorCode(error);
  if (code === 'ENOENT') return new SshTerminalProviderError('NOT_FOUND');
  if (code === 'EACCES' || code === 'EPERM') return new SshTerminalProviderError('FORBIDDEN');
  if (code === 'EISDIR' || code === 'ENOTDIR') return new SshTerminalProviderError('INVALID_REQUEST');
  return new SshTerminalProviderError('UNAVAILABLE');
}

function validLocalPath(path: string): boolean {
  return isAbsoluteNormalizedLocalPath(path);
}

function copyName(name: string, ordinal: number): string | undefined {
  const extension = extname(name);
  const suffix = ` (${ordinal})`;
  const stem = name.slice(0, name.length - extension.length);
  const available = MAX_REMOTE_FILE_NAME_CHARS - suffix.length - extension.length;
  if (available < 1) return undefined;
  return `${stem.slice(0, available)}${suffix}${extension}`;
}

function transferResult(direction: FileTransferResult['direction'], fileName: string, bytesTransferred: number,
  state: FileTransferResult['state'] = 'completed'): FileTransferResult {
  return { direction, fileName, bytesTransferred, state };
}

function report(onProgress: ((progress: FileTransferProgress) => void) | undefined, sessionId: string, operationId: string,
  direction: FileTransferProgress['direction'], phase: FileTransferProgress['phase'], fileName: string,
  bytesTransferred: number, totalBytes: number | null): void {
  try { onProgress?.({ sessionId, operationId, direction, phase, fileName, bytesTransferred, totalBytes }); }
  catch { /* Renderer progress observers cannot interrupt worker-owned file cleanup. */ }
}

function sftpCall<T>(channel: SFTPWrapper, call: (callback: (error: Error | null | undefined, result: T) => void) => void): Promise<T> {
  return new Promise((resolveCall, rejectCall) => {
    let settled = false;
    const finish = (error?: Error | null, result?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      channel.removeListener('close', onClose);
      if (error) rejectCall(error);
      else resolveCall(result as T);
    };
    const onClose = () => finish(new SshTerminalProviderError('UNAVAILABLE'));
    const timer = setTimeout(() => {
      finish(new SshTerminalProviderError('TIMEOUT'));
      try { (channel as SFTPWrapper & { end?: () => void }).end?.(); } catch { /* Session teardown owns final cleanup. */ }
    }, SFTP_OPERATION_TIMEOUT_MS);
    channel.once('close', onClose);
    try { call((error, result) => finish(error, result)); }
    catch { finish(new SshTerminalProviderError('UNAVAILABLE')); }
  });
}

async function remoteLstat(channel: SFTPWrapper, path: string): Promise<SftpStats | undefined> {
  try { return await sftpCall<SftpStats>(channel, callback => channel.lstat(path, callback)); }
  catch (error) {
    const code = sftpErrorCode(error);
    if (code === 2 || code === '2' || code === 'ENOENT') return undefined;
    throw error instanceof SshTerminalProviderError ? error : mappedSftpError(error);
  }
}

async function remoteRealpath(channel: SFTPWrapper, path: string): Promise<string> {
  try {
    const resolved = await sftpCall<string>(channel, callback => channel.realpath(path, callback));
    if (!isRemotePath(resolved) || !resolved.startsWith('/')) throw new SshTerminalProviderError('INVALID_REQUEST');
    return resolved;
  } catch (error) {
    throw error instanceof SshTerminalProviderError ? error : mappedSftpError(error);
  }
}

/** Requires canonical resolution to preserve the normalized path, rejecting symlinked ancestors. */
async function assertRemotePathComponents(channel: SFTPWrapper, path: string, finalKind: 'directory' | 'file'): Promise<SftpStats> {
  const expected = path.startsWith('/') ? posix.normalize(path) : posix.resolve(await remoteRealpath(channel, '.'), path);
  const actual = await remoteRealpath(channel, path);
  if (actual !== expected) throw new SshTerminalProviderError('INVALID_REQUEST');
  const stats = await remoteLstat(channel, path);
  if (!stats) throw new SshTerminalProviderError('NOT_FOUND');
  if (stats.isSymbolicLink() || (finalKind === 'directory' ? !stats.isDirectory() : !stats.isFile())) {
    throw new SshTerminalProviderError('INVALID_REQUEST');
  }
  return stats;
}

async function unlinkRemote(channel: SFTPWrapper, path: string): Promise<void> {
  try { await sftpCall<void>(channel, callback => channel.unlink(path, callback)); }
  catch (error) {
    const code = sftpErrorCode(error);
    if (code === 2 || code === '2' || code === 'ENOENT') return;
    throw error instanceof SshTerminalProviderError ? error : mappedSftpError(error);
  }
}

async function renameRemote(channel: SFTPWrapper, source: string, destination: string): Promise<void> {
  try { await sftpCall<void>(channel, callback => channel.rename(source, destination, callback)); }
  catch (error) { throw error instanceof SshTerminalProviderError ? error : mappedRenameError(error); }
}

async function findAvailableName(channel: SFTPWrapper, directory: string, originalName: string): Promise<{ readonly name: string; readonly path: string }> {
  for (let ordinal = 1; ordinal <= MAX_COPY_NAME_ATTEMPTS; ordinal++) {
    const name = copyName(originalName, ordinal);
    if (!name || !isRemoteFileName(name)) break;
    const path = remoteChildPath(directory, name);
    if (path && !await remoteLstat(channel, path)) return { name, path };
  }
  throw new SshTerminalProviderError('CONFLICT');
}

async function renameUniqueRemote(channel: SFTPWrapper, temporaryPath: string, directory: string, originalName: string): Promise<{ readonly path: string; readonly fileName: string }> {
  for (let attempt = 0; attempt < MAX_COPY_NAME_ATTEMPTS; attempt++) {
    const next = await findAvailableName(channel, directory, originalName);
    try {
      await renameRemote(channel, temporaryPath, next.path);
      return { path: next.path, fileName: next.name };
    } catch (error) {
      if (!(error instanceof SshTerminalProviderError) || error.code !== 'CONFLICT') throw error;
      if (!await remoteLstat(channel, next.path)) throw new SshTerminalProviderError('UNAVAILABLE');
    }
  }
  throw new SshTerminalProviderError('CONFLICT');
}

async function runStreamTransfer(sessionId: string, operationId: string, direction: FileTransferProgress['direction'], fileName: string,
  totalBytes: number | null, source: Readable, destination: Writable, cancellation?: CancellationSignal,
  onProgress?: (progress: FileTransferProgress) => void): Promise<number> {
  if (cancellation?.aborted) throw new SshTerminalProviderError('CANCELLED');
  const abortController = new AbortController();
  let abortCode: 'CANCELLED' | 'TIMEOUT' | undefined;
  let transferred = 0;
  let lastProgressAt = 0;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const emitProgress = (force = false) => {
    const now = Date.now();
    if (force || now - lastProgressAt >= PROGRESS_INTERVAL_MS) {
      report(onProgress, sessionId, operationId, direction, 'transferring', fileName, transferred, totalBytes);
      lastProgressAt = now;
    }
  };
  const abort = (code: 'CANCELLED' | 'TIMEOUT') => {
    if (abortController.signal.aborted) return;
    abortCode = code;
    abortController.abort();
  };
  const resetIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => abort('TIMEOUT'), TRANSFER_IDLE_TIMEOUT_MS);
  };
  const meter = new Transform({
    transform(chunk: Buffer | string, encoding, callback) {
      const bytes = typeof chunk === 'string' ? Buffer.byteLength(chunk, encoding) : chunk.byteLength;
      if (!Number.isSafeInteger(transferred + bytes)) { callback(new SshTerminalProviderError('OUTPUT_LIMIT')); return; }
      transferred += bytes;
      resetIdleTimer();
      emitProgress();
      callback(null, chunk);
    }
  });
  const cancel = () => abort('CANCELLED');
  cancellation?.addEventListener('abort', cancel, { once: true });
  emitProgress(true);
  resetIdleTimer();
  try {
    await pipeline(source, meter, destination, { signal: abortController.signal });
    emitProgress(true);
    return transferred;
  } catch (error) {
    if (abortCode === 'CANCELLED' || cancellation?.aborted) throw new SshTerminalProviderError('CANCELLED');
    if (abortCode === 'TIMEOUT') throw new SshTerminalProviderError('TIMEOUT');
    if (error instanceof SshTerminalProviderError) throw error;
    const code = sftpErrorCode(error);
    if (code === 'EACCES' || code === 'EPERM') throw new SshTerminalProviderError('FORBIDDEN');
    throw mappedSftpError(error);
  } finally {
    clearTimeout(idleTimer);
    cancellation?.removeEventListener('abort', cancel);
  }
}

async function remoteCommit(channel: SFTPWrapper, temporaryPath: string, finalPath: string, originalName: string, expected: SftpStats | undefined,
  conflictPolicy: FileTransferConflictPolicy, beginCommit: () => boolean): Promise<{ readonly path: string; readonly fileName: string; readonly skipped: boolean }> {
  await assertRemotePathComponents(channel, posix.dirname(finalPath), 'directory');
  if (!beginCommit()) throw new SshTerminalProviderError('CANCELLED');
  const parent = posix.dirname(finalPath);
  const requestedName = posix.basename(finalPath);
  let current = await remoteLstat(channel, finalPath);

  if (expected) {
    if (!current || !sameIdentity(identity(expected), identity(current)) || current.isSymbolicLink() || !current.isFile()) {
      throw new SshTerminalProviderError('CONFLICT');
    }
    const backupPath = remoteChildPath(parent, `.mrt-${randomUUID()}.backup`);
    if (!backupPath) throw new SshTerminalProviderError('CONFLICT');
    await renameRemote(channel, finalPath, backupPath);
    const moved = await remoteLstat(channel, backupPath);
    if (!moved || !sameIdentity(identity(expected), identity(moved))) {
      try { if (!await remoteLstat(channel, finalPath)) await renameRemote(channel, backupPath, finalPath); } catch { /* Keep unexpected remote data intact for recovery. */ }
      throw new SshTerminalProviderError('CONFLICT');
    }
    try { await renameRemote(channel, temporaryPath, finalPath); }
    catch (error) {
      try { if (!await remoteLstat(channel, finalPath)) await renameRemote(channel, backupPath, finalPath); }
      catch { throw new SshTerminalProviderError('UNAVAILABLE'); }
      throw error;
    }
    await unlinkRemote(channel, backupPath).catch(() => undefined);
    return { path: finalPath, fileName: requestedName, skipped: false };
  }

  current = await remoteLstat(channel, finalPath);
  if (current) {
    if (current.isSymbolicLink() || !current.isFile()) throw new SshTerminalProviderError('CONFLICT');
    if (conflictPolicy === 'skip') return { path: finalPath, fileName: requestedName, skipped: true };
    if (conflictPolicy === 'rename') {
      const next = await renameUniqueRemote(channel, temporaryPath, parent, originalName);
      return { ...next, skipped: false };
    } else {
      return remoteCommit(channel, temporaryPath, finalPath, originalName, current, conflictPolicy, () => true);
    }
  }

  try {
    await renameRemote(channel, temporaryPath, finalPath);
  } catch (error) {
    if (error instanceof SshTerminalProviderError && error.code === 'CONFLICT' && (conflictPolicy === 'skip' || conflictPolicy === 'rename')) {
      const collided = await remoteLstat(channel, finalPath);
      if (!collided) throw new SshTerminalProviderError('UNAVAILABLE');
      if (conflictPolicy === 'skip') return { path: finalPath, fileName: posix.basename(finalPath), skipped: true };
      const next = await renameUniqueRemote(channel, temporaryPath, parent, originalName);
      return { ...next, skipped: false };
    }
    throw error;
  }
  return { path: finalPath, fileName: posix.basename(finalPath), skipped: false };
}

export function createSftpFileTransfers(): SftpFileTransfers {
  async function upload(sessionId: string, operationId: string, channel: SFTPWrapper, localPath: string, remoteDirectory: string,
    fileName: string, conflictPolicy: FileTransferConflictPolicy, cancellation?: CancellationSignal,
    onProgress?: (progress: FileTransferProgress) => void): Promise<FileTransferResult> {
    if (!TRANSFER_OPERATION_ID.test(operationId) || !validLocalPath(localPath) || basename(localPath) !== fileName ||
        !isRemotePath(remoteDirectory) || !isRemoteFileName(fileName) || !isFileTransferConflictPolicy(conflictPolicy)) {
      throw new SshTerminalProviderError('INVALID_REQUEST');
    }
    if (cancellation?.aborted) throw new SshTerminalProviderError('CANCELLED');
    let sourceFile: FileHandle | undefined;
    let source: Readable | undefined;
    let destination: Writable | undefined;
    let temporaryPath: string | undefined;
    let temporaryOwned = false;
    let committing = false;
    let bytesTransferred = 0;
    let totalBytes: number | null = null;
    const wasCancelled = () => !committing && cancellation?.aborted === true;
    const beginCommit = () => {
      if (wasCancelled()) return false;
      committing = true;
      report(onProgress, sessionId, operationId, 'upload', 'committing', fileName, bytesTransferred, totalBytes);
      return true;
    };
    try {
      let sourceStats: Stats;
      try {
        const selected = await lstat(localPath);
        if (!selected.isFile() || selected.isSymbolicLink() || !Number.isSafeInteger(selected.size)) throw new SshTerminalProviderError('INVALID_REQUEST');
        sourceFile = await openFile(localPath, 'r');
        sourceStats = await sourceFile.stat();
        totalBytes = sourceStats.size;
        const currentPath = await lstat(localPath);
        if (!sourceStats.isFile() || !currentPath.isFile() || currentPath.isSymbolicLink() || sourceStats.dev !== currentPath.dev ||
            sourceStats.ino !== currentPath.ino || sourceStats.size !== currentPath.size || !Number.isSafeInteger(sourceStats.size)) {
          throw new SshTerminalProviderError('CONFLICT');
        }
      } catch (error) {
        if (error instanceof SshTerminalProviderError) throw error;
        throw localFileError(error);
      }
      if (wasCancelled()) throw new SshTerminalProviderError('CANCELLED');

      await assertRemotePathComponents(channel, remoteDirectory, 'directory');
      const requestedPath = remoteChildPath(remoteDirectory, fileName);
      if (!requestedPath) throw new SshTerminalProviderError('INVALID_REQUEST');
      let finalPath = requestedPath;
      const existing = await remoteLstat(channel, requestedPath);
      if (existing) {
        if (existing.isSymbolicLink() || !existing.isFile()) throw new SshTerminalProviderError('CONFLICT');
        if (conflictPolicy === 'skip') return transferResult('upload', fileName, 0, 'skipped');
        if (conflictPolicy === 'rename') finalPath = (await findAvailableName(channel, remoteDirectory, fileName)).path;
      }
      temporaryPath = remoteChildPath(remoteDirectory, `.mrt-${randomUUID()}.partial`);
      if (!temporaryPath) throw new SshTerminalProviderError('INVALID_REQUEST');
      await assertRemotePathComponents(channel, remoteDirectory, 'directory');
      source = sourceFile.createReadStream({ autoClose: false });
      destination = channel.createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 });
      destination.once('open', () => { temporaryOwned = true; });
      bytesTransferred = await runStreamTransfer(sessionId, operationId, 'upload', posix.basename(finalPath), sourceStats.size, source, destination,
        cancellation, onProgress);
      const finalStats = await sourceFile.stat();
      let currentPath: Stats;
      try { currentPath = await lstat(localPath); }
      catch (error) { throw localFileError(error); }
      if (bytesTransferred !== sourceStats.size || !sameLocalVersion(sourceStats, finalStats) || currentPath.isSymbolicLink() ||
          sourceStats.dev !== currentPath.dev || sourceStats.ino !== currentPath.ino) throw new SshTerminalProviderError('CONFLICT');
      if (wasCancelled()) throw new SshTerminalProviderError('CANCELLED');

      const currentTarget = await remoteLstat(channel, finalPath);
      const expected = conflictPolicy === 'overwrite' && existing ? existing : currentTarget && conflictPolicy === 'overwrite' ? currentTarget : undefined;
      const commit = await remoteCommit(channel, temporaryPath, finalPath, fileName, expected, conflictPolicy, beginCommit);
      if (commit.skipped) {
        if (temporaryOwned) await unlinkRemote(channel, temporaryPath).catch(() => undefined);
        temporaryPath = undefined;
        temporaryOwned = false;
        return transferResult('upload', commit.fileName, 0, 'skipped');
      }
      temporaryPath = undefined;
      temporaryOwned = false;
      return transferResult('upload', commit.fileName, bytesTransferred);
    } catch (error) {
      if (temporaryOwned && temporaryPath) await unlinkRemote(channel, temporaryPath).catch(() => undefined);
      if (wasCancelled()) throw new SshTerminalProviderError('CANCELLED');
      if (error instanceof SshTerminalProviderError) throw error;
      if (error instanceof LocalTransferTargetError) throw new SshTerminalProviderError(error.code);
      throw mappedSftpError(error);
    } finally {
      source?.destroy();
      destination?.destroy();
      await sourceFile?.close().catch(() => undefined);
    }
  }

  async function download(sessionId: string, operationId: string, channel: SFTPWrapper, remotePath: string, localPath: string,
    conflictPolicy: FileTransferConflictPolicy, cancellation?: CancellationSignal,
    onProgress?: (progress: FileTransferProgress) => void): Promise<FileTransferResult> {
    if (!TRANSFER_OPERATION_ID.test(operationId) || !isRemotePath(remotePath) || !validLocalPath(localPath) ||
        !isFileTransferConflictPolicy(conflictPolicy)) throw new SshTerminalProviderError('INVALID_REQUEST');
    if (cancellation?.aborted) throw new SshTerminalProviderError('CANCELLED');
    const fileName = posix.basename(remotePath);
    if (!isRemoteFileName(fileName) || remotePath === '.' || remotePath === '/') throw new SshTerminalProviderError('INVALID_REQUEST');
    let target: Awaited<ReturnType<typeof prepareLocalTransferTarget>> | undefined;
    let source: Readable | undefined;
    let committing = false;
    let bytesTransferred = 0;
    const wasCancelled = () => !committing && cancellation?.aborted === true;
    const beginCommit = () => {
      if (wasCancelled()) return false;
      committing = true;
      return true;
    };
    try {
      const remoteStats = await assertRemotePathComponents(channel, remotePath, 'file');
      const totalBytes = Number.isSafeInteger(remoteStats.size) && remoteStats.size >= 0 ? remoteStats.size : null;
      try { target = await prepareLocalTransferTarget(localPath, conflictPolicy); }
      catch (error) {
        if (error instanceof LocalTransferTargetError) throw new SshTerminalProviderError(error.code);
        throw new SshTerminalProviderError(mapLocalTransferTargetError(error).code);
      }
      if (wasCancelled()) throw new SshTerminalProviderError('CANCELLED');
      if (target.state === 'skipped') return transferResult('download', target.fileName, 0, 'skipped');
      if (!target.stream) throw new SshTerminalProviderError('UNAVAILABLE');
      const beforeRead = await assertRemotePathComponents(channel, remotePath, 'file');
      if (!sameIdentity(identity(remoteStats), identity(beforeRead))) throw new SshTerminalProviderError('CONFLICT');
      source = channel.createReadStream(remotePath, { flags: 'r' });
      bytesTransferred = await runStreamTransfer(sessionId, operationId, 'download', target.fileName, totalBytes, source, target.stream,
        cancellation, onProgress);
      if (wasCancelled()) throw new SshTerminalProviderError('CANCELLED');
      const afterRead = await assertRemotePathComponents(channel, remotePath, 'file');
      if (!sameIdentity(identity(remoteStats), identity(afterRead)) || (totalBytes !== null && bytesTransferred !== totalBytes)) {
        throw new SshTerminalProviderError('CONFLICT');
      }
      const result = await target.complete(() => {
        report(onProgress, sessionId, operationId, 'download', 'committing', target!.fileName, bytesTransferred, totalBytes);
        return beginCommit();
      });
      return transferResult('download', result.fileName, result.bytes, result.state);
    } catch (error) {
      await target?.cleanup().catch(() => undefined);
      if (wasCancelled()) throw new SshTerminalProviderError('CANCELLED');
      if (error instanceof SshTerminalProviderError) throw error;
      if (error instanceof LocalTransferTargetError) throw new SshTerminalProviderError(error.code);
      throw mappedSftpError(error);
    } finally {
      source?.destroy();
    }
  }

  return Object.freeze({ upload, download });
}

function sameLocalVersion(before: Stats, after: Stats): boolean {
  return before.dev === after.dev && before.ino === after.ino && before.size === after.size &&
    before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs;
}
