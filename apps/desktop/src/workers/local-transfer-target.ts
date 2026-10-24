import { randomUUID } from 'node:crypto';
import type { BigIntStats, Stats } from 'node:fs';
import { link, lstat, open, rename, rm, unlink } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { finished } from 'node:stream/promises';
import type { WriteStream } from 'node:fs';
import type { FileTransferConflictPolicy } from '../../../../packages/domain/src/file-transfer.ts';

const MAX_TRANSFER_PATH_CHARS = 32_768;
const MAX_COPY_NAME_CHARS = 240;
const MAX_COPY_NAME_ATTEMPTS = 9_999;

export type LocalTransferTargetErrorCode = 'INVALID_REQUEST' | 'CONFLICT' | 'CANCELLED' | 'UNAVAILABLE' | 'NOT_FOUND' | 'FORBIDDEN';

export function isAbsoluteNormalizedLocalPath(path: unknown): path is string {
  if (typeof path !== 'string' || path.length === 0 || path.length > MAX_TRANSFER_PATH_CHARS || path.includes('\0') || !isAbsolute(path)) return false;
  try { return resolve(path) === path; }
  catch { return false; }
}

export class LocalTransferTargetError extends Error {
  readonly code: LocalTransferTargetErrorCode;
  constructor(code: LocalTransferTargetErrorCode) {
    super('Local file transfer target failed');
    this.name = 'LocalTransferTargetError';
    this.code = code;
  }
}

export function mapLocalTransferTargetError(error: unknown): LocalTransferTargetError {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  if (code === 'EACCES' || code === 'EPERM') return new LocalTransferTargetError('FORBIDDEN');
  if (code === 'ENOENT') return new LocalTransferTargetError('NOT_FOUND');
  if (code === 'EISDIR' || code === 'ENOTDIR') return new LocalTransferTargetError('INVALID_REQUEST');
  return new LocalTransferTargetError('UNAVAILABLE');
}

export interface LocalTransferTarget {
  readonly state: 'ready' | 'skipped';
  readonly fileName: string;
  readonly stream?: WriteStream;
  complete(beginCommit: () => boolean): Promise<{ readonly fileName: string; readonly bytes: number; readonly state: 'completed' | 'skipped' }>;
  cleanup(): Promise<void>;
}

interface FileIdentity {
  readonly dev: string;
  readonly ino: string;
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
}

function identity(stats: Stats | BigIntStats): FileIdentity {
  return { dev: String(stats.dev), ino: String(stats.ino), size: Number(stats.size), mtimeMs: Number(stats.mtimeMs), ctimeMs: Number(stats.ctimeMs) };
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

async function inspect(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try { return await lstat(path); }
  catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return undefined;
    throw mapLocalTransferTargetError(error);
  }
}

function copyName(name: string, ordinal: number): string {
  const extension = extname(name);
  const suffix = ` (${ordinal})`;
  const stem = name.slice(0, name.length - extension.length);
  const available = Math.max(1, MAX_COPY_NAME_CHARS - suffix.length - extension.length);
  return `${stem.slice(0, available)}${suffix}${extension}`;
}

async function nextAvailablePath(selectedPath: string, initialName: string): Promise<{ path: string; fileName: string }> {
  const parent = dirname(selectedPath);
  for (let ordinal = 1; ordinal <= MAX_COPY_NAME_ATTEMPTS; ordinal++) {
    const fileName = copyName(initialName, ordinal);
    const path = join(parent, fileName);
    if (!await inspect(path)) return { path, fileName };
  }
  throw new LocalTransferTargetError('CONFLICT');
}

/** Creates a sibling temp file and commits it without replacing an unapproved local file. */
export async function prepareLocalTransferTarget(selectedPath: string, policy: FileTransferConflictPolicy): Promise<LocalTransferTarget> {
  if (typeof selectedPath !== 'string' || selectedPath.length === 0 || selectedPath.length > MAX_TRANSFER_PATH_CHARS ||
      selectedPath.includes('\0') || !isAbsolute(selectedPath) || resolve(selectedPath) !== selectedPath ||
      !['overwrite', 'rename', 'skip'].includes(policy)) throw new LocalTransferTargetError('INVALID_REQUEST');
  const originalName = basename(selectedPath);
  if (!originalName || originalName === '.' || originalName === '..') throw new LocalTransferTargetError('INVALID_REQUEST');

  let finalPath = selectedPath;
  let finalName = originalName;
  let originalIdentity: FileIdentity | undefined;
  const initial = await inspect(selectedPath);
  if (initial) {
    if (policy === 'skip') {
      return { state: 'skipped', fileName: finalName, async complete() { throw new LocalTransferTargetError('INVALID_REQUEST'); }, async cleanup() {} };
    }
    if (policy === 'overwrite') {
      if (!initial.isFile() || initial.isSymbolicLink()) throw new LocalTransferTargetError('CONFLICT');
      originalIdentity = identity(initial);
    } else {
      ({ path: finalPath, fileName: finalName } = await nextAvailablePath(selectedPath, originalName));
    }
  }

  const temporaryPath = join(dirname(finalPath), `.mrt-${randomUUID()}.partial`);
  let stream: WriteStream;
  try {
    const handle = await open(temporaryPath, 'wx');
    stream = handle.createWriteStream({ autoClose: true });
  } catch (error) { throw mapLocalTransferTargetError(error); }

  let completed = false;
  let cleaned = false;
  return {
    state: 'ready', fileName: finalName, stream,
    async complete(beginCommit) {
      if (completed || cleaned) throw new LocalTransferTargetError('INVALID_REQUEST');
      try {
        await finished(stream);
        const temporaryStats = await lstat(temporaryPath);
        if (!temporaryStats.isFile() || temporaryStats.isSymbolicLink() || !Number.isSafeInteger(temporaryStats.size)) {
          throw new LocalTransferTargetError('UNAVAILABLE');
        }
        if (originalIdentity) {
          const current = await inspect(finalPath);
          if (!current || !current.isFile() || current.isSymbolicLink() || !sameIdentity(originalIdentity, identity(current))) {
            throw new LocalTransferTargetError('CONFLICT');
          }
          if (!beginCommit()) throw new LocalTransferTargetError('CANCELLED');
          await rename(temporaryPath, finalPath);
        } else {
          if (!beginCommit()) throw new LocalTransferTargetError('CANCELLED');
          try {
            await link(temporaryPath, finalPath);
            await unlink(temporaryPath);
          } catch (error) {
            if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') {
              if (policy === 'skip') {
                await unlink(temporaryPath);
                completed = true;
                return { fileName: finalName, bytes: 0, state: 'skipped' };
              }
              if (policy !== 'rename') throw new LocalTransferTargetError('CONFLICT');
              const alternate = await nextAvailablePath(selectedPath, originalName);
              finalPath = alternate.path;
              finalName = alternate.fileName;
              for (let attempt = 0; attempt < MAX_COPY_NAME_ATTEMPTS; attempt++) {
                try {
                  await link(temporaryPath, finalPath);
                  await unlink(temporaryPath);
                  break;
                } catch (renameError) {
                  if (typeof renameError !== 'object' || renameError === null || !('code' in renameError) || renameError.code !== 'EEXIST') throw renameError;
                  const next = await nextAvailablePath(selectedPath, originalName);
                  finalPath = next.path;
                  finalName = next.fileName;
                  if (attempt === MAX_COPY_NAME_ATTEMPTS - 1) throw new LocalTransferTargetError('CONFLICT');
                }
              }
            } else {
              throw error;
            }
          }
        }
        completed = true;
        return { fileName: finalName, bytes: temporaryStats.size, state: 'completed' };
      } catch (error) {
        if (error instanceof LocalTransferTargetError) throw error;
        throw mapLocalTransferTargetError(error);
      }
    },
    async cleanup() {
      if (completed || cleaned) return;
      cleaned = true;
      stream.destroy();
      await finished(stream).catch(() => undefined);
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  };
}
