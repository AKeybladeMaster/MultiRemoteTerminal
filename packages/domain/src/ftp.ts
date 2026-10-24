import { canonicalizeRemoteEndpoint } from './remote-endpoint.ts';
import type { RemoteEndpoint } from './remote-endpoint.ts';
import { isRemoteDirectoryListing, isRemotePath, MAX_REMOTE_FILE_NAME_CHARS } from './remote-files.ts';
import type { RemoteDirectoryListing } from './remote-files.ts';

export interface FtpEndpoint extends RemoteEndpoint {
  /** True for explicit FTPS. False means FTP sends control and credentials without encryption. */
  readonly secure: boolean;
}

export type FtpTransferConflictPolicy = 'overwrite' | 'rename' | 'skip';
export type FtpTransferDirection = 'upload' | 'download';

export interface FtpTransferProgress {
  readonly sessionId: string;
  readonly operationId: string;
  readonly direction: FtpTransferDirection;
  readonly phase: 'transferring' | 'committing';
  readonly fileName: string;
  readonly bytesTransferred: number;
  readonly totalBytes: number | null;
}

export interface FtpTransferResult {
  readonly direction: FtpTransferDirection;
  readonly fileName: string;
  readonly bytesTransferred: number;
  readonly state: 'completed' | 'skipped';
}

const FTP_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isFtpTransferConflictPolicy(value: unknown): value is FtpTransferConflictPolicy {
  return value === 'overwrite' || value === 'rename' || value === 'skip';
}

export function isFtpTransferProgress(value: unknown): value is FtpTransferProgress {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return Object.keys(input).length === 7 && Object.hasOwn(input, 'sessionId') && Object.hasOwn(input, 'operationId') &&
    Object.hasOwn(input, 'direction') && Object.hasOwn(input, 'phase') && Object.hasOwn(input, 'fileName') && Object.hasOwn(input, 'bytesTransferred') &&
    Object.hasOwn(input, 'totalBytes') && typeof input.sessionId === 'string' && FTP_UUID.test(input.sessionId) &&
    typeof input.operationId === 'string' && FTP_UUID.test(input.operationId) &&
    (input.direction === 'upload' || input.direction === 'download') && (input.phase === 'transferring' || input.phase === 'committing') && isFtpFileName(input.fileName) &&
    Number.isSafeInteger(input.bytesTransferred) && (input.bytesTransferred as number) >= 0 &&
    (input.totalBytes === null || (Number.isSafeInteger(input.totalBytes) && (input.totalBytes as number) >= 0));
}

export function isFtpTransferResult(value: unknown): value is FtpTransferResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return Object.keys(input).length === 4 && Object.hasOwn(input, 'direction') && Object.hasOwn(input, 'fileName') &&
    Object.hasOwn(input, 'bytesTransferred') && Object.hasOwn(input, 'state') &&
    (input.direction === 'upload' || input.direction === 'download') && isFtpFileName(input.fileName) &&
    Number.isSafeInteger(input.bytesTransferred) && (input.bytesTransferred as number) >= 0 &&
    (input.state === 'completed' || input.state === 'skipped');
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
