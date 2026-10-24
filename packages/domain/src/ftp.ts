import { canonicalizeRemoteEndpoint } from './remote-endpoint.ts';
import type { RemoteEndpoint } from './remote-endpoint.ts';
import { isRemoteDirectoryListing, isRemotePath, MAX_REMOTE_FILE_NAME_CHARS } from './remote-files.ts';
import type { RemoteDirectoryListing } from './remote-files.ts';
import { isFileTransferConflictPolicy, isFileTransferProgress, isFileTransferResult } from './file-transfer.ts';
import type { FileTransferConflictPolicy, FileTransferDirection, FileTransferProgress, FileTransferResult } from './file-transfer.ts';

export interface FtpEndpoint extends RemoteEndpoint {
  /** True for explicit FTPS. False means FTP sends control and credentials without encryption. */
  readonly secure: boolean;
}

export type FtpTransferConflictPolicy = FileTransferConflictPolicy;
export type FtpTransferDirection = FileTransferDirection;
export type FtpTransferProgress = FileTransferProgress;
export type FtpTransferResult = FileTransferResult;

export function isFtpTransferConflictPolicy(value: unknown): value is FtpTransferConflictPolicy {
  return isFileTransferConflictPolicy(value);
}

export function isFtpTransferProgress(value: unknown): value is FtpTransferProgress {
  return isFileTransferProgress(value, isFtpFileName);
}

export function isFtpTransferResult(value: unknown): value is FtpTransferResult {
  return isFileTransferResult(value, isFtpFileName);
}

export function canonicalizeFtpEndpoint(value: unknown): FtpEndpoint | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 3 || !Object.hasOwn(input, 'host') || !Object.hasOwn(input, 'port') || !Object.hasOwn(input, 'secure') ||
      typeof input.secure !== 'boolean') return undefined;
  const endpoint = canonicalizeRemoteEndpoint({ host: input.host, port: input.port });
  return endpoint ? { ...endpoint, secure: input.secure } : undefined;
}

export function isCanonicalFtpEndpoint(value: unknown): value is FtpEndpoint {
  const endpoint = canonicalizeFtpEndpoint(value);
  if (!endpoint || typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return Object.keys(input).length === 3 && input.host === endpoint.host && input.port === endpoint.port && input.secure === endpoint.secure;
}

const FTP_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;

/** FTP commands are line-oriented; never allow control bytes into command arguments. */
export function isFtpCommandArgument(value: unknown): value is string {
  return typeof value === 'string' && !FTP_CONTROL_CHARACTERS.test(value);
}

export function isFtpRemotePath(value: unknown): value is string {
  return isRemotePath(value) && isFtpCommandArgument(value);
}

export function isFtpFileName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_REMOTE_FILE_NAME_CHARS &&
    value !== '.' && value !== '..' && !value.includes('/') && isFtpCommandArgument(value);
}

export function isFtpDirectoryListing(value: unknown): value is RemoteDirectoryListing {
  return isRemoteDirectoryListing(value) && isFtpRemotePath(value.path) &&
    value.entries.every(entry => isFtpFileName(entry.name) && isFtpRemotePath(entry.path));
}
