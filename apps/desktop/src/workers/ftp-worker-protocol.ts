import { isCanonicalFtpEndpoint, isFtpCommandArgument, isFtpDirectoryListing, isFtpFileName, isFtpRemotePath,
  isFtpTransferConflictPolicy, isFtpTransferProgress, isFtpTransferResult } from '../../../../packages/domain/src/ftp.ts';
import type { FtpEndpoint } from '../../../../packages/domain/src/ftp.ts';
import type { FtpTransferConflictPolicy, FtpTransferProgress, FtpTransferResult } from '../../../../packages/domain/src/ftp.ts';
import type { RemoteDirectoryListing } from '../../../../packages/domain/src/remote-files.ts';
import type { FtpFilesProviderErrorCode, FtpCredentials } from '../../../../packages/application/src/ftp-files.ts';

export const FTP_WORKER_PROTOCOL_VERSION = 1;
export const MAX_FTP_USERNAME_LENGTH = 512;
export const MAX_FTP_PASSWORD_LENGTH = 65_536;

export type FtpWorkerRequest =
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'open'; readonly sessionId: string;
      readonly endpoint: FtpEndpoint; readonly credentials: FtpCredentials }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'files.list'; readonly sessionId: string; readonly path: string }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'files.upload'; readonly sessionId: string;
      readonly operationId: string; readonly localPath: string; readonly remoteDirectory: string; readonly fileName: string;
      readonly conflictPolicy: FtpTransferConflictPolicy }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'files.download'; readonly sessionId: string;
      readonly operationId: string; readonly remotePath: string; readonly localPath: string; readonly conflictPolicy: FtpTransferConflictPolicy }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'files.cancel'; readonly sessionId: string; readonly operationId: string }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'close'; readonly sessionId: string }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'shutdown' };

export type FtpWorkerErrorCode = FtpFilesProviderErrorCode | 'INVALID_REQUEST';

export type FtpWorkerMessage =
  | { readonly version: 1; readonly type: 'progress'; readonly requestId: string; readonly progress: FtpTransferProgress }
  | { readonly version: 1; readonly type: 'reply'; readonly requestId: string; readonly ok: true; readonly result: Record<string, never> | RemoteDirectoryListing | FtpTransferResult }
  | { readonly version: 1; readonly type: 'reply'; readonly requestId: string; readonly ok: false; readonly errorCode: FtpWorkerErrorCode;
      readonly sessionUsable?: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ERROR_CODES: readonly FtpWorkerErrorCode[] = ['INVALID_REQUEST', 'UNAVAILABLE', 'CANCELLED', 'TIMEOUT', 'BUSY', 'OUTPUT_LIMIT',
  'AUTHENTICATION_FAILED', 'CONFLICT', 'NOT_FOUND', 'FORBIDDEN', 'NOT_SUPPORTED'];

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function isCredentials(value: unknown): value is FtpCredentials {
  return record(value) && exactKeys(value, ['username', 'password']) && typeof value.username === 'string' && value.username.length > 0 &&
    value.username.length <= MAX_FTP_USERNAME_LENGTH && value.username.trim() === value.username && isFtpCommandArgument(value.username) &&
    typeof value.password === 'string' && value.password.length <= MAX_FTP_PASSWORD_LENGTH && isFtpCommandArgument(value.password);
}

export function parseFtpWorkerInput(value: unknown): FtpWorkerRequest | undefined {
  if (!record(value) || value.version !== FTP_WORKER_PROTOCOL_VERSION || value.type !== 'request' || typeof value.requestId !== 'string' || !UUID.test(value.requestId) ||
      typeof value.command !== 'string') return undefined;
  if (value.command === 'open' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'sessionId', 'endpoint', 'credentials']) &&
      typeof value.sessionId === 'string' && UUID.test(value.sessionId) && isCanonicalFtpEndpoint(value.endpoint) && isCredentials(value.credentials)) {
    return value as unknown as FtpWorkerRequest;
  }
  if (value.command === 'files.list' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'sessionId', 'path']) &&
      typeof value.sessionId === 'string' && UUID.test(value.sessionId) && isFtpRemotePath(value.path)) return value as unknown as FtpWorkerRequest;
  if (value.command === 'files.upload' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'sessionId', 'operationId', 'localPath',
    'remoteDirectory', 'fileName', 'conflictPolicy']) && typeof value.sessionId === 'string' && UUID.test(value.sessionId) &&
      typeof value.operationId === 'string' && UUID.test(value.operationId) && typeof value.localPath === 'string' && value.localPath.length > 0 &&
      value.localPath.length <= 32_768 && isFtpCommandArgument(value.localPath) && isFtpRemotePath(value.remoteDirectory) &&
      isFtpFileName(value.fileName) && isFtpTransferConflictPolicy(value.conflictPolicy)) return value as unknown as FtpWorkerRequest;
  if (value.command === 'files.download' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'sessionId', 'operationId', 'remotePath',
    'localPath', 'conflictPolicy']) && typeof value.sessionId === 'string' && UUID.test(value.sessionId) && typeof value.operationId === 'string' &&
      UUID.test(value.operationId) && isFtpRemotePath(value.remotePath) && typeof value.localPath === 'string' && value.localPath.length > 0 &&
      value.localPath.length <= 32_768 && isFtpCommandArgument(value.localPath) && isFtpTransferConflictPolicy(value.conflictPolicy)) {
    return value as unknown as FtpWorkerRequest;
  }
  if (value.command === 'files.cancel' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'sessionId', 'operationId']) &&
      typeof value.sessionId === 'string' && UUID.test(value.sessionId) && typeof value.operationId === 'string' && UUID.test(value.operationId)) {
    return value as unknown as FtpWorkerRequest;
  }
  if (value.command === 'close' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'sessionId']) &&
      typeof value.sessionId === 'string' && UUID.test(value.sessionId)) return value as unknown as FtpWorkerRequest;
  if (value.command === 'shutdown' && exactKeys(value, ['version', 'type', 'requestId', 'command'])) return value as unknown as FtpWorkerRequest;
  return undefined;
}

export function parseFtpWorkerMessage(value: unknown): FtpWorkerMessage | undefined {
  if (!record(value) || value.version !== FTP_WORKER_PROTOCOL_VERSION || (value.type !== 'reply' && value.type !== 'progress') || typeof value.requestId !== 'string' ||
      !UUID.test(value.requestId)) return undefined;
  if (value.type === 'progress' && exactKeys(value, ['version', 'type', 'requestId', 'progress']) && isFtpTransferProgress(value.progress)) {
    return value as unknown as FtpWorkerMessage;
  }
  if (value.type !== 'reply' || typeof value.ok !== 'boolean') return undefined;
  if (value.ok && exactKeys(value, ['version', 'type', 'requestId', 'ok', 'result']) && record(value.result) &&
      (exactKeys(value.result, []) || isFtpDirectoryListing(value.result) || isFtpTransferResult(value.result))) return value as unknown as FtpWorkerMessage;
  const hasSessionUsable = Object.hasOwn(value, 'sessionUsable');
  const validErrorReplyKeys = exactKeys(value, ['version', 'type', 'requestId', 'ok', 'errorCode']) ||
    exactKeys(value, ['version', 'type', 'requestId', 'ok', 'errorCode', 'sessionUsable']);
  if (!value.ok && validErrorReplyKeys && (!hasSessionUsable || typeof value.sessionUsable === 'boolean') &&
      ERROR_CODES.includes(value.errorCode as FtpWorkerErrorCode)) {
    return value as unknown as FtpWorkerMessage;
  }
  return undefined;
}

export function isFtpEndpoint(value: unknown): value is FtpEndpoint {
  return isCanonicalFtpEndpoint(value);
}
