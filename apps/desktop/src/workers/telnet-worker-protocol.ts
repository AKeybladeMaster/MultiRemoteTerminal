import { canonicalizeRemoteEndpoint } from '../../../../packages/domain/src/remote-endpoint.ts';
import type { RemoteEndpoint } from '../../../../packages/domain/src/remote-endpoint.ts';
import { isTerminalSize } from '../../../../packages/domain/src/local-terminal.ts';
import type { TerminalSize } from '../../../../packages/domain/src/local-terminal.ts';
import type { LocalTerminalEvent } from '../../../../packages/application/src/local-terminals.ts';
import { isTerminalEvent } from '../../../../packages/contracts/src/commands.ts';

export const TELNET_WORKER_PROTOCOL_VERSION = 1;
export const MAX_TELNET_INPUT_CHARS = 16_384;

export type TelnetWorkerRequest =
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'open'; readonly sessionId: string; readonly endpoint: RemoteEndpoint; readonly size: TerminalSize }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'write'; readonly sessionId: string; readonly data: string }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'resize'; readonly sessionId: string; readonly size: TerminalSize }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'ack'; readonly sessionId: string; readonly sequence: number }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'close'; readonly sessionId: string }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'shutdown' };

export type TelnetWorkerErrorCode = 'INVALID_REQUEST' | 'UNAVAILABLE' | 'CANCELLED' | 'BUSY' | 'TIMEOUT' | 'OUTPUT_LIMIT';

export type TelnetWorkerMessage =
  | { readonly version: 1; readonly type: 'reply'; readonly requestId: string; readonly ok: true; readonly result: Record<string, never> }
  | { readonly version: 1; readonly type: 'reply'; readonly requestId: string; readonly ok: false; readonly errorCode: TelnetWorkerErrorCode }
  | { readonly version: 1; readonly type: 'event'; readonly event: LocalTerminalEvent };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ERROR_CODES: readonly TelnetWorkerErrorCode[] = ['INVALID_REQUEST', 'UNAVAILABLE', 'CANCELLED', 'BUSY', 'TIMEOUT', 'OUTPUT_LIMIT'];

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function isCanonicalEndpoint(value: unknown): value is RemoteEndpoint {
  const endpoint = canonicalizeRemoteEndpoint(value);
  return endpoint !== undefined && record(value) && endpoint.host === value.host && endpoint.port === value.port;
}

export function parseTelnetWorkerInput(value: unknown): TelnetWorkerRequest | undefined {
  if (!record(value) || value.version !== TELNET_WORKER_PROTOCOL_VERSION || value.type !== 'request' || !isUuid(value.requestId) || typeof value.command !== 'string') return undefined;
  if (value.command === 'open' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'sessionId', 'endpoint', 'size']) &&
      isUuid(value.sessionId) && isCanonicalEndpoint(value.endpoint) && isTerminalSize(value.size)) return value as unknown as TelnetWorkerRequest;
  if (value.command === 'write' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'sessionId', 'data']) &&
      isUuid(value.sessionId) && typeof value.data === 'string' && value.data.length <= MAX_TELNET_INPUT_CHARS) {
    return value as unknown as TelnetWorkerRequest;
  }
  if (value.command === 'resize' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'sessionId', 'size']) &&
      isUuid(value.sessionId) && isTerminalSize(value.size)) return value as unknown as TelnetWorkerRequest;
  if (value.command === 'ack' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'sessionId', 'sequence']) &&
      isUuid(value.sessionId) && Number.isSafeInteger(value.sequence) && (value.sequence as number) > 0) return value as unknown as TelnetWorkerRequest;
  if (value.command === 'close' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'sessionId']) && isUuid(value.sessionId)) {
    return value as unknown as TelnetWorkerRequest;
  }
  if (value.command === 'shutdown' && exactKeys(value, ['version', 'type', 'requestId', 'command'])) return value as unknown as TelnetWorkerRequest;
  return undefined;
}

export function parseTelnetWorkerMessage(value: unknown): TelnetWorkerMessage | undefined {
  if (!record(value) || value.version !== TELNET_WORKER_PROTOCOL_VERSION || typeof value.type !== 'string') return undefined;
  if (value.type === 'reply' && isUuid(value.requestId) && typeof value.ok === 'boolean') {
    if (value.ok && exactKeys(value, ['version', 'type', 'requestId', 'ok', 'result']) && record(value.result) && exactKeys(value.result, [])) {
      return value as unknown as TelnetWorkerMessage;
    }
    if (!value.ok && exactKeys(value, ['version', 'type', 'requestId', 'ok', 'errorCode']) && ERROR_CODES.includes(value.errorCode as TelnetWorkerErrorCode)) {
      return value as unknown as TelnetWorkerMessage;
    }
  }
  if (value.type === 'event' && exactKeys(value, ['version', 'type', 'event']) && isTerminalEvent(value.event)) {
    return value as unknown as TelnetWorkerMessage;
  }
  return undefined;
}
