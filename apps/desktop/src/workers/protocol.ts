import type { AppError } from '../../../../packages/domain/src/errors.ts';
import type { LocalTerminalLaunch, TerminalSize } from '../../../../packages/domain/src/local-terminal.ts';
import { isLocalTerminalLaunch, isTerminalSize } from '../../../../packages/domain/src/local-terminal.ts';
import { isWslDistributionName, MAX_WSL_DISTRIBUTIONS } from '../../../../packages/domain/src/wsl-distributions.ts';
import type { WslDistribution } from '../../../../packages/domain/src/wsl-distributions.ts';
import type { LocalTerminalEvent } from '../../../../packages/application/src/local-terminals.ts';

export const WORKER_PROTOCOL_VERSION = 1;

export type TerminalWorkerRequest =
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'open'; readonly sessionId: string; readonly launch: LocalTerminalLaunch; readonly size: TerminalSize }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'wsl.list' }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'wsl.cancel' }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'write'; readonly sessionId: string; readonly data: string }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'resize'; readonly sessionId: string; readonly size: TerminalSize }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'ack'; readonly sessionId: string; readonly sequence: number }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'close'; readonly sessionId: string }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'shutdown' };

export type TerminalWorkerReply =
  | { readonly version: 1; readonly type: 'reply'; readonly requestId: string; readonly ok: true; readonly result:
      { readonly pid?: number } | { readonly distributions: readonly WslDistribution[] } }
  | { readonly version: 1; readonly type: 'reply'; readonly requestId: string; readonly ok: false; readonly errorCode: 'INVALID_REQUEST' | 'UNAVAILABLE' | 'BUSY' | 'OUTPUT_LIMIT' };

export type TerminalWorkerMessage =
  | TerminalWorkerReply
  | { readonly version: 1; readonly type: 'started'; readonly sessionId: string; readonly pid: number }
  | { readonly version: 1; readonly type: 'event'; readonly event: LocalTerminalEvent };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ERROR_CODES = ['INVALID_REQUEST', 'UNAVAILABLE', 'BUSY', 'OUTPUT_LIMIT'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function isError(value: unknown): value is AppError {
  if (!isRecord(value) || !exactKeys(value, ['code', 'target', 'retryable'])) return false;
  return ERROR_CODES.includes(value.code as string) && value.target === 'terminal' && typeof value.retryable === 'boolean';
}

export function parseTerminalWorkerRequest(value: unknown): TerminalWorkerRequest | undefined {
  if (!isRecord(value) || value.version !== WORKER_PROTOCOL_VERSION || value.type !== 'request' || !isUuid(value.requestId) || typeof value.command !== 'string') return undefined;
  if (value.command === 'open' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'sessionId', 'launch', 'size']) &&
      isUuid(value.sessionId) && isLocalTerminalLaunch(value.launch) && isTerminalSize(value.size)) return value as unknown as TerminalWorkerRequest;
  if (value.command === 'wsl.list' && exactKeys(value, ['version', 'type', 'requestId', 'command'])) return value as unknown as TerminalWorkerRequest;
  if (value.command === 'wsl.cancel' && exactKeys(value, ['version', 'type', 'requestId', 'command'])) return value as unknown as TerminalWorkerRequest;
  if (value.command === 'write' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'sessionId', 'data']) &&
      isUuid(value.sessionId) && typeof value.data === 'string' && value.data.length <= 16_384) return value as unknown as TerminalWorkerRequest;
  if (value.command === 'resize' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'sessionId', 'size']) &&
      isUuid(value.sessionId) && isTerminalSize(value.size)) return value as unknown as TerminalWorkerRequest;
  if (value.command === 'ack' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'sessionId', 'sequence']) &&
      isUuid(value.sessionId) && Number.isSafeInteger(value.sequence) && (value.sequence as number) > 0) return value as unknown as TerminalWorkerRequest;
  if (value.command === 'close' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'sessionId']) && isUuid(value.sessionId)) return value as unknown as TerminalWorkerRequest;
  if (value.command === 'shutdown' && exactKeys(value, ['version', 'type', 'requestId', 'command'])) return value as unknown as TerminalWorkerRequest;
  return undefined;
}

export function parseTerminalWorkerMessage(value: unknown): TerminalWorkerMessage | undefined {
  if (!isRecord(value) || value.version !== WORKER_PROTOCOL_VERSION) return undefined;
  if (value.type === 'started' && exactKeys(value, ['version', 'type', 'sessionId', 'pid']) &&
      isUuid(value.sessionId) && Number.isSafeInteger(value.pid) && (value.pid as number) > 0) {
    return value as unknown as TerminalWorkerMessage;
  }
  if (value.type === 'reply') {
    if (!isUuid(value.requestId) || typeof value.ok !== 'boolean') return undefined;
    if (value.ok && exactKeys(value, ['version', 'type', 'requestId', 'ok', 'result']) && isRecord(value.result) &&
        (exactKeys(value.result, []) || (exactKeys(value.result, ['pid']) && Number.isSafeInteger(value.result.pid) && (value.result.pid as number) > 0) ||
          isWslDistributionResult(value.result))) {
      return value as unknown as TerminalWorkerMessage;
    }
    if (value.ok === false && exactKeys(value, ['version', 'type', 'requestId', 'ok', 'errorCode']) && ERROR_CODES.includes(value.errorCode as string)) {
      return value as unknown as TerminalWorkerMessage;
    }
  }
  if (value.type === 'event' && exactKeys(value, ['version', 'type', 'event']) && isRecord(value.event)) {
    const event = value.event;
    if (!isUuid(event.sessionId)) return undefined;
    if (event.kind === 'data' && exactKeys(event, ['kind', 'sessionId', 'sequence', 'data']) &&
        Number.isSafeInteger(event.sequence) && (event.sequence as number) > 0 && typeof event.data === 'string' && event.data.length <= 16_384) {
      return value as unknown as TerminalWorkerMessage;
    }
    if (event.kind === 'exit' && exactKeys(event, ['kind', 'sessionId', 'exitCode']) && Number.isSafeInteger(event.exitCode)) {
      return value as unknown as TerminalWorkerMessage;
    }
    if (event.kind === 'failure' && exactKeys(event, ['kind', 'sessionId', 'error']) && isError(event.error)) {
      return value as unknown as TerminalWorkerMessage;
    }
  }
  return undefined;
}

function isWslDistributionResult(value: Record<string, unknown>): boolean {
  if (!exactKeys(value, ['distributions']) || !Array.isArray(value.distributions) || value.distributions.length > MAX_WSL_DISTRIBUTIONS) return false;
  const seen = new Set<string>();
  for (const distribution of value.distributions) {
    if (!isRecord(distribution) || !exactKeys(distribution, ['name']) || !isWslDistributionName(distribution.name)) return false;
    const key = distribution.name.toLocaleLowerCase('en-US');
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}
