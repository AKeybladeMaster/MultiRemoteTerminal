import type { Outcome } from '../../domain/src/errors.ts';
import { failure } from '../../domain/src/errors.ts';
import type { WorkbenchSnapshot } from '../../application/src/workbench.ts';

export const CONTRACT_VERSION = 1;
export const COMMAND_CHANNEL = 'mrt:command:v1';
export const APP_URL = 'mrt://app/index.html';

export function isAppDocument(value: string): boolean {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.href === APP_URL;
  } catch { return false; }
}

export interface DescribeRequest {
  readonly command: 'app.describe';
  readonly requestId: string;
  readonly contractVersion: 1;
  readonly payload: Readonly<Record<string, never>>;
}

export type DescribeReply = Outcome<WorkbenchSnapshot> & { readonly requestId: string };

export interface DesktopBridge {
  describe(): Promise<DescribeReply>;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requestIdOf(value: unknown): string {
  return record(value) && typeof value.requestId === 'string' && UUID.test(value.requestId) ? value.requestId : '';
}

export function parseRequest(value: unknown): Outcome<DescribeRequest> {
  if (!record(value) || !exactKeys(value, ['command', 'requestId', 'contractVersion', 'payload']) ||
      requestIdOf(value) === '' || value.contractVersion !== CONTRACT_VERSION ||
      !record(value.payload) || Object.keys(value.payload).length !== 0) return failure('INVALID_REQUEST');
  if (value.command !== 'app.describe') return failure('UNKNOWN_COMMAND');
  return { ok: true, result: value as unknown as DescribeRequest };
}

// Treat even the transport reply as unknown; never widen the bridge with raw IPC.
export function isDescribeReply(value: unknown, requestId: string): value is DescribeReply {
  if (!record(value) || value.requestId !== requestId || typeof value.ok !== 'boolean') return false;
  if (value.ok) {
    if (!exactKeys(value, ['requestId', 'ok', 'result']) || !record(value.result)) return false;
    const r = value.result;
    return exactKeys(r, ['name', 'version', 'platform', 'stage']) && r.name === 'MultiRemoteTerminal' &&
      typeof r.version === 'string' && r.version.length <= 64 && typeof r.platform === 'string' &&
      r.platform.length <= 32 && r.stage === 'foundation';
  }
  if (!exactKeys(value, ['requestId', 'ok', 'error']) || !record(value.error)) return false;
  const e = value.error;
  return exactKeys(e, ['code', 'target', 'retryable']) && typeof e.code === 'string' &&
    ['INVALID_REQUEST', 'UNKNOWN_COMMAND', 'FORBIDDEN', 'UNAVAILABLE', 'TIMEOUT', 'BUSY'].includes(e.code) &&
    e.target === 'application' && typeof e.retryable === 'boolean';
}
