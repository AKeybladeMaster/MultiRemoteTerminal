import { isAbsolute } from 'node:path';
import { isTftpPort } from '../../../../packages/domain/src/tftp.ts';

export const TFTP_SERVER_WORKER_PROTOCOL_VERSION = 1;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type TftpServerWorkerErrorCode = 'INVALID_REQUEST' | 'UNAVAILABLE' | 'BUSY' | 'FORBIDDEN' | 'NOT_FOUND' | 'OUTPUT_LIMIT';

export type TftpServerWorkerRequest =
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'start'; readonly rootDirectory: string; readonly port: number }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'stop' | 'shutdown' };

export type TftpServerWorkerMessage =
  | { readonly version: 1; readonly type: 'reply'; readonly requestId: string; readonly ok: true; readonly result: Record<string, never> | { readonly port: number } }
  | { readonly version: 1; readonly type: 'reply'; readonly requestId: string; readonly ok: false; readonly errorCode: TftpServerWorkerErrorCode }
  | { readonly version: 1; readonly type: 'state'; readonly state: 'stopped' };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

export function parseTftpServerWorkerInput(value: unknown): TftpServerWorkerRequest | undefined {
  if (!record(value) || value.version !== TFTP_SERVER_WORKER_PROTOCOL_VERSION || value.type !== 'request' ||
      typeof value.requestId !== 'string' || !UUID.test(value.requestId) || typeof value.command !== 'string') return undefined;
  if (value.command === 'start' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'rootDirectory', 'port']) &&
      typeof value.rootDirectory === 'string' && value.rootDirectory.length > 0 && value.rootDirectory.length <= 32_768 &&
      isAbsolute(value.rootDirectory) && isTftpPort(value.port)) return value as unknown as TftpServerWorkerRequest;
  if ((value.command === 'stop' || value.command === 'shutdown') && exactKeys(value, ['version', 'type', 'requestId', 'command'])) {
    return value as unknown as TftpServerWorkerRequest;
  }
  return undefined;
}

export function parseTftpServerWorkerMessage(value: unknown): TftpServerWorkerMessage | undefined {
  if (!record(value) || value.version !== TFTP_SERVER_WORKER_PROTOCOL_VERSION) return undefined;
  if (value.type === 'state' && exactKeys(value, ['version', 'type', 'state']) && value.state === 'stopped') {
    return value as unknown as TftpServerWorkerMessage;
  }
  if (value.type !== 'reply' || typeof value.requestId !== 'string' || !UUID.test(value.requestId) || typeof value.ok !== 'boolean') return undefined;
  if (value.ok && exactKeys(value, ['version', 'type', 'requestId', 'ok', 'result']) && record(value.result) &&
      (exactKeys(value.result, []) || (exactKeys(value.result, ['port']) && Number.isSafeInteger(value.result.port) &&
        (value.result.port as number) > 0 && (value.result.port as number) <= 65_535))) {
    return value as unknown as TftpServerWorkerMessage;
  }
  const errors: readonly TftpServerWorkerErrorCode[] = ['INVALID_REQUEST', 'UNAVAILABLE', 'BUSY', 'FORBIDDEN', 'NOT_FOUND', 'OUTPUT_LIMIT'];
  if (!value.ok && exactKeys(value, ['version', 'type', 'requestId', 'ok', 'errorCode']) && errors.includes(value.errorCode as TftpServerWorkerErrorCode)) {
    return value as unknown as TftpServerWorkerMessage;
  }
  return undefined;
}
