import { isCanonicalFtpEndpoint, isFtpCommandArgument, isFtpDirectoryListing, isFtpRemotePath } from '../../../../packages/domain/src/ftp.ts';
import type { FtpEndpoint } from '../../../../packages/domain/src/ftp.ts';
import type { RemoteDirectoryListing } from '../../../../packages/domain/src/remote-files.ts';
import type { FtpFilesProviderErrorCode, FtpCredentials } from '../../../../packages/application/src/ftp-files.ts';

export const FTP_WORKER_PROTOCOL_VERSION = 1;
export const MAX_FTP_USERNAME_LENGTH = 512;
export const MAX_FTP_PASSWORD_LENGTH = 65_536;

export type FtpWorkerRequest =
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'open'; readonly sessionId: string;
      readonly endpoint: FtpEndpoint; readonly credentials: FtpCredentials }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'files.list'; readonly sessionId: string; readonly path: string }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'files.cancel'; readonly sessionId: string; readonly operationId: string }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'close'; readonly sessionId: string }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'shutdown' };

export type FtpWorkerErrorCode = FtpFilesProviderErrorCode | 'INVALID_REQUEST';

export type FtpWorkerMessage =
  | { readonly version: 1; readonly type: 'reply'; readonly requestId: string; readonly ok: true; readonly result: Record<string, never> | RemoteDirectoryListing }
  | { readonly version: 1; readonly type: 'reply'; readonly requestId: string; readonly ok: false; readonly errorCode: FtpWorkerErrorCode };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ERROR_CODES: readonly FtpWorkerErrorCode[] = ['INVALID_REQUEST', 'UNAVAILABLE', 'CANCELLED', 'TIMEOUT', 'BUSY', 'OUTPUT_LIMIT', 'AUTHENTICATION_FAILED'];

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
  if (!record(value) || value.version !== FTP_WORKER_PROTOCOL_VERSION || value.type !== 'reply' || typeof value.requestId !== 'string' ||
      !UUID.test(value.requestId) || typeof value.ok !== 'boolean') return undefined;
  if (value.ok && exactKeys(value, ['version', 'type', 'requestId', 'ok', 'result']) && record(value.result) &&
      (exactKeys(value.result, []) || isFtpDirectoryListing(value.result))) return value as unknown as FtpWorkerMessage;
  if (!value.ok && exactKeys(value, ['version', 'type', 'requestId', 'ok', 'errorCode']) && ERROR_CODES.includes(value.errorCode as FtpWorkerErrorCode)) {
    return value as unknown as FtpWorkerMessage;
  }
  return undefined;
}

export function isFtpEndpoint(value: unknown): value is FtpEndpoint {
  return isCanonicalFtpEndpoint(value);
}
