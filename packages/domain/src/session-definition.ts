import { canonicalizeSshHostEndpoint } from './host-trust.ts';
import { isLocalShell } from './local-terminal.ts';
import type { LocalShell } from './local-terminal.ts';

export interface SavedSessionBase {
  readonly id: string;
  readonly name: string;
  readonly favorite: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type SavedSessionDefinition =
  | (SavedSessionBase & { readonly kind: 'local'; readonly shell: LocalShell })
  | (SavedSessionBase & { readonly kind: 'ssh'; readonly host: string; readonly port: number });

export type SavedSessionDraft =
  | { readonly kind: 'local'; readonly name: string; readonly shell: LocalShell }
  | { readonly kind: 'ssh'; readonly name: string; readonly host: string; readonly port: number };

export function normalizeSavedSessionDraft(value: unknown): SavedSessionDraft | undefined {
  if (!isPlainRecord(value) || typeof value.kind !== 'string') return undefined;
  const name = normalizeName(value.name);
  if (!name) return undefined;
  if (value.kind === 'local') {
    if (!hasExactKeys(value, ['kind', 'name', 'shell']) || !isLocalShell(value.shell)) return undefined;
    return { kind: 'local', name, shell: value.shell };
  }
  if (value.kind === 'ssh') {
    if (!hasExactKeys(value, ['kind', 'name', 'host', 'port'])) return undefined;
    const endpoint = canonicalizeSshHostEndpoint({ host: value.host, port: value.port });
    if (!endpoint) return undefined;
    return { kind: 'ssh', name, host: endpoint.host, port: endpoint.port };
  }
  return undefined;
}

export function normalizeSessionSearch(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) return undefined;
  return value.trim();
}

export function isSavedSessionDefinition(value: unknown): value is SavedSessionDefinition {
  if (!isPlainRecord(value) || typeof value.kind !== 'string' || typeof value.id !== 'string' || !UUID.test(value.id) ||
      normalizeName(value.name) !== value.name || typeof value.favorite !== 'boolean' || !isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt)) return false;
  if (value.kind === 'local') return hasExactKeys(value, ['id', 'kind', 'name', 'shell', 'favorite', 'createdAt', 'updatedAt']) && isLocalShell(value.shell);
  if (value.kind === 'ssh') {
    if (!hasExactKeys(value, ['id', 'kind', 'name', 'host', 'port', 'favorite', 'createdAt', 'updatedAt'])) return false;
    const endpoint = canonicalizeSshHostEndpoint({ host: value.host, port: value.port });
    return endpoint !== undefined && endpoint.host === value.host && endpoint.port === value.port;
  }
  return false;
}

export function isSessionDefinitionId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function normalizeName(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) return undefined;
  const name = value.trim();
  return name.length > 0 ? name : undefined;
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const epoch = Date.parse(value);
  return Number.isSafeInteger(epoch) && new Date(epoch).toISOString() === value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
