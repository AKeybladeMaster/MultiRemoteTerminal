import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, open, rename, rm, unlink } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { MAX_REMOTE_TEXT_FILE_BYTES, isRemoteTextRevision, remoteTextByteLength } from '../../../../packages/domain/src/remote-text-file.ts';
import type { LocalTextFilePayload, LocalTextFileProviderErrorCode } from '../../../../packages/application/src/local-text-editor.ts';
import { isAbsoluteNormalizedLocalPath } from './local-transfer-target.ts';

const MAX_PATH_CHARS = 32_768;
const READ_CHUNK_BYTES = 64 * 1024;

export class LocalTextFileOperationError extends Error {
  readonly code: LocalTextFileProviderErrorCode;
  constructor(code: LocalTextFileProviderErrorCode) {
    super('Local text file operation failed');
    this.name = 'LocalTextFileOperationError';
    this.code = code;
  }
}

interface FileIdentity {
  readonly device: string;
  readonly inode: string;
  readonly size: string;
  readonly mtime: string;
  readonly ctime: string;
}

interface LoadedFile extends LocalTextFilePayload {
  readonly identity: FileIdentity;
  readonly mode: number;
}

function identity(stats: BigIntStats): FileIdentity {
  return { device: String(stats.dev), inode: String(stats.ino), size: String(stats.size), mtime: String(stats.mtimeNs), ctime: String(stats.ctimeNs) };
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.device === right.device && left.inode === right.inode && left.size === right.size && left.mtime === right.mtime && left.ctime === right.ctime;
}

function sameFileObject(left: FileIdentity, right: FileIdentity): boolean {
  return left.device === right.device && left.inode === right.inode && left.size === right.size && left.mtime === right.mtime;
}

function revision(data: Uint8Array): string { return createHash('sha256').update(data).digest('hex'); }

async function restoreBackupWithoutReplacing(backupPath: string, originalPath: string): Promise<void> {
  await link(backupPath, originalPath);
  await unlink(backupPath);
}

function mapError(error: unknown): LocalTextFileOperationError {
  if (error instanceof LocalTextFileOperationError) return error;
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  if (code === 'EACCES' || code === 'EPERM') return new LocalTextFileOperationError('FORBIDDEN');
  if (code === 'EEXIST') return new LocalTextFileOperationError('CONFLICT');
  if (code === 'ENOENT') return new LocalTextFileOperationError('NOT_FOUND');
  if (code === 'EISDIR' || code === 'ENOTDIR') return new LocalTextFileOperationError('INVALID_REQUEST');
  return new LocalTextFileOperationError('UNAVAILABLE');
}

function validatePath(path: string): void {
  if (typeof path !== 'string' || path.length > MAX_PATH_CHARS || !isAbsoluteNormalizedLocalPath(path)) {
    throw new LocalTextFileOperationError('INVALID_REQUEST');
  }
}

async function readAtMost(handle: FileHandle): Promise<Buffer> {
  const bytes = Buffer.allocUnsafe(MAX_REMOTE_TEXT_FILE_BYTES + 1);
  let total = 0;
  while (total < bytes.byteLength) {
    const amount = Math.min(READ_CHUNK_BYTES, bytes.byteLength - total);
    const result = await handle.read(bytes, total, amount, total);
    if (result.bytesRead === 0) break;
    total += result.bytesRead;
  }
  if (total > MAX_REMOTE_TEXT_FILE_BYTES) throw new LocalTextFileOperationError('OUTPUT_LIMIT');
  return bytes.subarray(0, total);
}

async function readFile(path: string): Promise<LoadedFile> {
  validatePath(path);
  let handle: FileHandle | undefined;
  try {
    const before = await lstat(path, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink()) throw new LocalTextFileOperationError('NOT_SUPPORTED');
    if (before.size > BigInt(MAX_REMOTE_TEXT_FILE_BYTES)) throw new LocalTextFileOperationError('OUTPUT_LIMIT');
    handle = await open(path, 'r');
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || !sameIdentity(identity(before), identity(opened))) throw new LocalTextFileOperationError('CONFLICT');
    const data = await readAtMost(handle);
    const after = await lstat(path, { bigint: true });
    if (!sameIdentity(identity(opened), identity(after))) throw new LocalTextFileOperationError('CONFLICT');
    let content: string;
    try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data); }
    catch { throw new LocalTextFileOperationError('NOT_SUPPORTED'); }
    const bytes = remoteTextByteLength(content);
    if (bytes === undefined) throw new LocalTextFileOperationError('NOT_SUPPORTED');
    return { fileName: basename(path), content, revision: revision(data), bytes, identity: identity(opened), mode: Number(opened.mode & 0o777n) };
  } catch (error) { throw mapError(error); }
  finally { await handle?.close().catch(() => undefined); }
}

export async function readLocalTextFile(path: string): Promise<LocalTextFilePayload> {
  const loaded = await readFile(path);
  return { fileName: loaded.fileName, content: loaded.content, revision: loaded.revision, bytes: loaded.bytes };
}

export async function saveLocalTextFile(path: string, content: string, expectedRevision: string): Promise<{ readonly revision: string; readonly bytesSaved: number }> {
  validatePath(path);
  const bytes = typeof content === 'string' ? remoteTextByteLength(content) : undefined;
  if (bytes === undefined || !isRemoteTextRevision(expectedRevision)) throw new LocalTextFileOperationError('INVALID_REQUEST');
  const data = Buffer.from(content, 'utf8');
  const initial = await readFile(path);
  if (initial.revision !== expectedRevision) throw new LocalTextFileOperationError('CONFLICT');

  const temporaryPath = join(dirname(path), `.mrt-${randomUUID()}.partial`);
  const backupPath = join(dirname(path), `.mrt-${randomUUID()}.backup`);
  let committed = false;
  let backedUp = false;
  try {
    const temporary = await open(temporaryPath, 'wx', initial.mode);
    try { await temporary.writeFile(data); await temporary.sync(); }
    finally { await temporary.close(); }

    const current = await readFile(path);
    if (current.revision !== expectedRevision || !sameIdentity(current.identity, initial.identity)) throw new LocalTextFileOperationError('CONFLICT');
    await rename(path, backupPath);
    backedUp = true;
    const moved = await readFile(backupPath);
    if (moved.revision !== expectedRevision || !sameFileObject(moved.identity, initial.identity)) {
      await restoreBackupWithoutReplacing(backupPath, path);
      backedUp = false;
      throw new LocalTextFileOperationError('CONFLICT');
    }
    await link(temporaryPath, path);
    committed = true;
    backedUp = false;
    await unlink(temporaryPath).catch(() => undefined);
    await rm(backupPath, { force: true }).catch(() => undefined);
    return { revision: revision(data), bytesSaved: bytes };
  } catch (error) {
    if (backedUp && !committed) {
      try { await restoreBackupWithoutReplacing(backupPath, path); backedUp = false; }
      catch { /* Keep the backup for manual recovery if rollback cannot restore the selected file. */ }
    }
    throw mapError(error);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}
