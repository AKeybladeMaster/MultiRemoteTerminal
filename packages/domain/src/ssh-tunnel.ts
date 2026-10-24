import { failure } from './errors.ts';
import type { ErrorCode, Outcome } from './errors.ts';
import { canonicalizeRemoteEndpoint } from './remote-endpoint.ts';
import { isSessionDefinitionId } from './session-definition.ts';

interface SshTunnelDefinitionBase {
  readonly id: string;
  readonly sessionId: string;
  readonly name: string;
  readonly bindHost: '127.0.0.1';
  readonly bindPort: number;
  readonly createdAt: string;
}

export interface SshLocalTunnelDefinition extends SshTunnelDefinitionBase {
  readonly mode: 'local';
  readonly targetHost: string;
  readonly targetPort: number;
}

export interface SshRemoteTunnelDefinition extends SshTunnelDefinitionBase {
  readonly mode: 'remote';
  readonly targetHost: string;
  readonly targetPort: number;
}

export interface SshDynamicTunnelDefinition extends SshTunnelDefinitionBase {
  readonly mode: 'dynamic';
}

export type SshEndpointTunnelDefinition = SshLocalTunnelDefinition | SshRemoteTunnelDefinition;
export type SshTunnelDefinition = SshEndpointTunnelDefinition | SshDynamicTunnelDefinition;

interface SshTunnelDraftBase {
  readonly id?: string;
  readonly sessionId: string;
  readonly name: string;
  readonly bindHost: '127.0.0.1';
  readonly bindPort: number;
}

export interface SshLocalTunnelDraft extends SshTunnelDraftBase {
  readonly mode: 'local';
  readonly targetHost: string;
  readonly targetPort: number;
}

export interface SshRemoteTunnelDraft extends SshTunnelDraftBase {
  readonly mode: 'remote';
  readonly targetHost: string;
  readonly targetPort: number;
}

export interface SshDynamicTunnelDraft extends SshTunnelDraftBase {
  readonly mode: 'dynamic';
}

export type SshEndpointTunnelDraft = SshLocalTunnelDraft | SshRemoteTunnelDraft;
export type SshTunnelDraft = SshEndpointTunnelDraft | SshDynamicTunnelDraft;
export type SshTunnelMode = SshTunnelDraft['mode'];

export type TunnelRunStatus =
  | { readonly tunnelId: string; readonly state: 'stopped' | 'starting' | 'stopping' }
  | { readonly tunnelId: string; readonly state: 'active'; readonly bindHost: '127.0.0.1'; readonly bindPort: number }
  | { readonly tunnelId: string; readonly state: 'failed'; readonly errorCode: ErrorCode };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeSshTunnelDraft(value: unknown): SshTunnelDraft | undefined {
  if (!isPlainRecord(value)) return undefined;
  const id = value.id;
  const sessionId = value.sessionId;
  const name = normalizeName(value.name);
  const bindPort = value.bindPort;
  if (id !== undefined && !isTunnelId(id)) return undefined;
  if (!isSessionDefinitionId(sessionId) || !name || value.bindHost !== '127.0.0.1' ||
      !Number.isSafeInteger(bindPort) || (bindPort as number) < 0 || (bindPort as number) > 65_535) return undefined;
  if (value.mode === 'dynamic') {
    if (!exactKeys(value, ['sessionId', 'name', 'mode', 'bindHost', 'bindPort'], ['id'])) return undefined;
    return { ...(id === undefined ? {} : { id }), sessionId, name, mode: 'dynamic', bindHost: '127.0.0.1', bindPort: bindPort as number };
  }
  if ((value.mode !== 'local' && value.mode !== 'remote') ||
      !exactKeys(value, ['sessionId', 'name', 'mode', 'bindHost', 'bindPort', 'targetHost', 'targetPort'], ['id'])) return undefined;
  const endpoint = canonicalizeRemoteEndpoint({ host: value.targetHost, port: value.targetPort });
  if (!endpoint) return undefined;
  return {
    ...(id === undefined ? {} : { id }), sessionId, name, mode: value.mode, bindHost: '127.0.0.1',
    bindPort: bindPort as number, targetHost: endpoint.host, targetPort: endpoint.port
  };
}

export function isSshTunnelDefinition(value: unknown): value is SshTunnelDefinition {
  if (!isPlainRecord(value) || typeof value.id !== 'string' || typeof value.createdAt !== 'string') return false;
  const draftValue = { ...value };
  delete draftValue.createdAt;
  const draft = normalizeSshTunnelDraft(draftValue);
  return draft !== undefined && draft.id === value.id && draft.name === value.name && isTimestamp(value.createdAt) &&
    exactKeys(value, draft.mode === 'dynamic'
      ? ['id', 'sessionId', 'name', 'mode', 'bindHost', 'bindPort', 'createdAt']
      : ['id', 'sessionId', 'name', 'mode', 'bindHost', 'bindPort', 'targetHost', 'targetPort', 'createdAt']);
}

export function isTunnelId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export function isTunnelRunStatus(value: unknown): value is TunnelRunStatus {
  if (!isPlainRecord(value) || !isTunnelId(value.tunnelId) || typeof value.state !== 'string') return false;
  if (value.state === 'stopped' || value.state === 'starting' || value.state === 'stopping') return exactKeys(value, ['tunnelId', 'state']);
  if (value.state === 'active') return exactKeys(value, ['tunnelId', 'state', 'bindHost', 'bindPort']) && value.bindHost === '127.0.0.1' &&
    Number.isSafeInteger(value.bindPort) && (value.bindPort as number) >= 1 && (value.bindPort as number) <= 65_535;
  if (value.state === 'failed') return exactKeys(value, ['tunnelId', 'state', 'errorCode']) && isErrorCode(value.errorCode);
  return false;
}

export function tunnelFailure(code: ErrorCode): Outcome<never> {
  return failure(code, 'terminal');
}

function normalizeName(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 128 || /[\u0000-\u001f\u007f]/.test(value)) return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const epoch = Date.parse(value);
  return Number.isSafeInteger(epoch) && new Date(epoch).toISOString() === value;
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Object.keys(value);
  return required.every(key => Object.hasOwn(value, key)) && keys.every(key => required.includes(key) || optional.includes(key)) &&
    keys.length >= required.length && keys.length <= required.length + optional.length;
}

function isErrorCode(value: unknown): value is ErrorCode {
  return value === 'INVALID_REQUEST' || value === 'UNKNOWN_COMMAND' || value === 'FORBIDDEN' || value === 'UNAVAILABLE' ||
    value === 'NOT_SUPPORTED' || value === 'TIMEOUT' || value === 'BUSY' || value === 'NOT_FOUND' || value === 'CONFLICT' ||
    value === 'CANCELLED' || value === 'OUTPUT_LIMIT' || value === 'AUTHENTICATION_FAILED' || value === 'HOST_KEY_REJECTED' || value === 'HOST_KEY_CHANGED';
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
