import { isLocalTextFileSaveResult } from '../../../../packages/domain/src/local-text-file.ts';
import { remoteTextByteLength, isRemoteTextRevision } from '../../../../packages/domain/src/remote-text-file.ts';
import type { LocalTextFilePayload, LocalTextFileProviderErrorCode } from '../../../../packages/application/src/local-text-editor.ts';
import type { LocalTextFileSaveResult } from '../../../../packages/domain/src/local-text-file.ts';
import { isAbsoluteNormalizedLocalPath } from './local-transfer-target.ts';

export const LOCAL_TEXT_WORKER_PROTOCOL_VERSION = 1;

export type LocalTextWorkerRequest =
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'read'; readonly path: string }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'save'; readonly path: string; readonly content: string; readonly expectedRevision: string };

export type LocalTextWorkerMessage =
  | { readonly version: 1; readonly type: 'reply'; readonly requestId: string; readonly ok: true; readonly result: LocalTextFilePayload | LocalTextFileSaveResult }
  | { readonly version: 1; readonly type: 'reply'; readonly requestId: string; readonly ok: false; readonly errorCode: LocalTextFileProviderErrorCode };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ERROR_CODES: readonly LocalTextFileProviderErrorCode[] = ['INVALID_REQUEST', 'UNAVAILABLE', 'TIMEOUT', 'BUSY', 'NOT_FOUND', 'CONFLICT',
  'FORBIDDEN', 'NOT_SUPPORTED', 'OUTPUT_LIMIT', 'CANCELLED'];

export function parseLocalTextWorkerInput(value: unknown): LocalTextWorkerRequest | undefined {
  if (!isRecord(value) || value.version !== LOCAL_TEXT_WORKER_PROTOCOL_VERSION || value.type !== 'request' || !isUuid(value.requestId) ||
      typeof value.command !== 'string') return undefined;
  if (value.command === 'read' && hasExactKeys(value, ['version', 'type', 'requestId', 'command', 'path']) && isPath(value.path)) {
    return value as unknown as LocalTextWorkerRequest;
  }
  if (value.command === 'save' && hasExactKeys(value, ['version', 'type', 'requestId', 'command', 'path', 'content', 'expectedRevision']) &&
      isPath(value.path) && typeof value.content === 'string' && remoteTextByteLength(value.content) !== undefined && isRemoteTextRevision(value.expectedRevision)) {
    return value as unknown as LocalTextWorkerRequest;
  }
  return undefined;
}

export function parseLocalTextWorkerMessage(value: unknown): LocalTextWorkerMessage | undefined {
  if (!isRecord(value) || value.version !== LOCAL_TEXT_WORKER_PROTOCOL_VERSION || value.type !== 'reply' || !isUuid(value.requestId) ||
      typeof value.ok !== 'boolean') return undefined;
  if (!value.ok && hasExactKeys(value, ['version', 'type', 'requestId', 'ok', 'errorCode']) && ERROR_CODES.includes(value.errorCode as LocalTextFileProviderErrorCode)) {
    return value as unknown as LocalTextWorkerMessage;
  }
  if (value.ok && hasExactKeys(value, ['version', 'type', 'requestId', 'ok', 'result']) && isRecord(value.result)) {
    if (isPayload(value.result)) return value as unknown as LocalTextWorkerMessage;
    if (isLocalTextFileSaveResult(value.result)) return value as unknown as LocalTextWorkerMessage;
  }
  return undefined;
}

function isPayload(value: Record<string, unknown>): value is Record<keyof LocalTextFilePayload, unknown> {
  if (!hasExactKeys(value, ['fileName', 'content', 'revision', 'bytes']) || typeof value.fileName !== 'string' || value.fileName.length === 0 ||
      value.fileName.length > 255 || /[\\/\0\r\n]/u.test(value.fileName) || typeof value.content !== 'string' || !isRemoteTextRevision(value.revision)) return false;
  const bytes = remoteTextByteLength(value.content);
  return bytes !== undefined && value.bytes === bytes;
}

function isPath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 32_768 && isAbsoluteNormalizedLocalPath(value);
}

function isUuid(value: unknown): value is string { return typeof value === 'string' && UUID.test(value); }

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
