import type { LocalTerminalEvent } from '../../../../packages/application/src/local-terminals.ts';
import type { SerialTerminalProviderErrorCode } from '../../../../packages/application/src/serial-terminals.ts';
import { isTerminalSize } from '../../../../packages/domain/src/local-terminal.ts';
import { MAX_SERIAL_INPUT_CHARS, normalizeSerialConfiguration, normalizeSerialPortList } from '../../../../packages/domain/src/serial.ts';
import type { SerialConfiguration, SerialPortInfo } from '../../../../packages/domain/src/serial.ts';

export const SERIAL_WORKER_PROTOCOL_VERSION = 1;

export type SerialWorkerRequest =
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'list' }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'open'; readonly sessionId: string; readonly configuration: SerialConfiguration }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'write'; readonly sessionId: string; readonly data: string }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'resize'; readonly sessionId: string; readonly size: { readonly columns: number; readonly rows: number } }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'ack'; readonly sessionId: string; readonly sequence: number }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'close'; readonly sessionId: string }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'shutdown' };

export type SerialWorkerErrorCode = SerialTerminalProviderErrorCode;

export type SerialWorkerMessage =
  | { readonly version: 1; readonly type: 'reply'; readonly requestId: string; readonly ok: true; readonly result: Record<string, never> }
  | { readonly version: 1; readonly type: 'reply'; readonly requestId: string; readonly ok: true; readonly result: { readonly ports: readonly SerialPortInfo[] } }
  | { readonly version: 1; readonly type: 'reply'; readonly requestId: string; readonly ok: false; readonly errorCode: SerialWorkerErrorCode }
  | { readonly version: 1; readonly type: 'event'; readonly event: LocalTerminalEvent };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ERROR_CODES = ['UNAVAILABLE', 'CANCELLED', 'TIMEOUT', 'BUSY', 'OUTPUT_LIMIT'] as const;
const APP_ERROR_CODES = ['INVALID_REQUEST', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'BUSY', 'CANCELLED', 'TIMEOUT', 'UNAVAILABLE',
  'AUTHENTICATION_FAILED', 'HOST_KEY_REJECTED', 'HOST_KEY_CHANGED', 'NOT_SUPPORTED', 'OUTPUT_LIMIT'] as const;

export function parseSerialWorkerInput(value: unknown): SerialWorkerRequest | undefined {
  if (!isPlainRecord(value) || value.version !== SERIAL_WORKER_PROTOCOL_VERSION || value.type !== 'request' || !isUuid(value.requestId) || typeof value.command !== 'string') return undefined;
  if (value.command === 'list' || value.command === 'shutdown') {
    if (!hasExactKeys(value, ['version', 'type', 'requestId', 'command'])) return undefined;
    return value as unknown as SerialWorkerRequest;
  }
  if (value.command === 'open' && hasExactKeys(value, ['version', 'type', 'requestId', 'command', 'sessionId', 'configuration']) &&
      isUuid(value.sessionId) && normalizeSerialConfiguration(value.configuration)) return value as unknown as SerialWorkerRequest;
  if (value.command === 'write' && hasExactKeys(value, ['version', 'type', 'requestId', 'command', 'sessionId', 'data']) &&
      isUuid(value.sessionId) && typeof value.data === 'string' && value.data.length > 0 && value.data.length <= MAX_SERIAL_INPUT_CHARS) return value as unknown as SerialWorkerRequest;
  if (value.command === 'resize' && hasExactKeys(value, ['version', 'type', 'requestId', 'command', 'sessionId', 'size']) &&
      isUuid(value.sessionId) && isTerminalSize(value.size)) return value as unknown as SerialWorkerRequest;
  if (value.command === 'ack' && hasExactKeys(value, ['version', 'type', 'requestId', 'command', 'sessionId', 'sequence']) &&
      isUuid(value.sessionId) && Number.isSafeInteger(value.sequence) && (value.sequence as number) > 0) return value as unknown as SerialWorkerRequest;
  if (value.command === 'close' && hasExactKeys(value, ['version', 'type', 'requestId', 'command', 'sessionId']) && isUuid(value.sessionId)) {
    return value as unknown as SerialWorkerRequest;
  }
  return undefined;
}

export function parseSerialWorkerMessage(value: unknown): SerialWorkerMessage | undefined {
  if (!isPlainRecord(value) || value.version !== SERIAL_WORKER_PROTOCOL_VERSION || typeof value.type !== 'string') return undefined;
  if (value.type === 'reply' && isUuid(value.requestId) && typeof value.ok === 'boolean') {
    if (value.ok && hasExactKeys(value, ['version', 'type', 'requestId', 'ok', 'result']) && isPlainRecord(value.result)) {
      if (hasExactKeys(value.result, [])) return value as unknown as SerialWorkerMessage;
      const ports = normalizeSerialPortList(value.result.ports);
      if (hasExactKeys(value.result, ['ports']) && ports) return { version: 1, type: 'reply', requestId: value.requestId, ok: true, result: { ports } };
    }
    if (!value.ok && hasExactKeys(value, ['version', 'type', 'requestId', 'ok', 'errorCode']) && ERROR_CODES.includes(value.errorCode as SerialWorkerErrorCode)) {
      return value as unknown as SerialWorkerMessage;
    }
  }
  if (value.type === 'event' && hasExactKeys(value, ['version', 'type', 'event']) && isLocalTerminalEvent(value.event)) {
    return value as unknown as SerialWorkerMessage;
  }
  return undefined;
}

function isLocalTerminalEvent(value: unknown): value is LocalTerminalEvent {
  if (!isPlainRecord(value) || !isUuid(value.sessionId) || typeof value.kind !== 'string') return false;
  if (value.kind === 'data') return hasExactKeys(value, ['kind', 'sessionId', 'sequence', 'data']) && Number.isSafeInteger(value.sequence) &&
    (value.sequence as number) > 0 && typeof value.data === 'string' && value.data.length <= 16_384;
  if (value.kind === 'exit') return hasExactKeys(value, ['kind', 'sessionId', 'exitCode']) && Number.isInteger(value.exitCode);
  if (value.kind === 'failure' && hasExactKeys(value, ['kind', 'sessionId', 'error']) && isPlainRecord(value.error)) {
    return hasExactKeys(value.error, ['code', 'target', 'retryable']) && APP_ERROR_CODES.includes(value.error.code as typeof APP_ERROR_CODES[number]) &&
      value.error.target === 'terminal' && typeof value.error.retryable === 'boolean';
  }
  return false;
}

function isUuid(value: unknown): value is string { return typeof value === 'string' && UUID.test(value); }

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
