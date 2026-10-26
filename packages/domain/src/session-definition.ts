import { canonicalizeSshHostEndpoint } from './host-trust.ts';
import { canonicalizeTelnetEndpoint } from './telnet.ts';
import { canonicalizeRemoteEndpoint } from './remote-endpoint.ts';
import { canonicalizeRdpEndpoint } from './rdp.ts';
import { canonicalizeVncEndpoint } from './vnc.ts';
import { isLocalShell } from './local-terminal.ts';
import type { LocalShell } from './local-terminal.ts';
import { isWslDistributionName } from './wsl-distributions.ts';
import { isSerialConfiguration, normalizeSerialConfiguration } from './serial.ts';
import type { SerialConfiguration } from './serial.ts';

export interface SavedSessionBase {
  readonly id: string;
  readonly folderId: string | null;
  readonly name: string;
  readonly favorite: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type SavedSessionDefinition =
  | (SavedSessionBase & ({ readonly kind: 'local'; readonly shell: Exclude<LocalShell, 'wsl'> } |
      { readonly kind: 'local'; readonly shell: 'wsl'; readonly distribution: string }))
  | (SavedSessionBase & { readonly kind: 'ssh'; readonly host: string; readonly port: number })
  | (SavedSessionBase & { readonly kind: 'sftp'; readonly host: string; readonly port: number })
  | (SavedSessionBase & { readonly kind: 'telnet'; readonly host: string; readonly port: number })
  | (SavedSessionBase & { readonly kind: 'ftp'; readonly host: string; readonly port: number; readonly secure: boolean })
  | (SavedSessionBase & { readonly kind: 'rdp'; readonly host: string; readonly port: number })
  | (SavedSessionBase & { readonly kind: 'vnc'; readonly host: string; readonly port: number })
  | (SavedSessionBase & { readonly kind: 'serial'; readonly configuration: SerialConfiguration });

export type SavedSessionDraft =
  | ({ readonly kind: 'local'; readonly name: string; readonly shell: Exclude<LocalShell, 'wsl'> } |
      { readonly kind: 'local'; readonly name: string; readonly shell: 'wsl'; readonly distribution: string })
  | { readonly kind: 'ssh'; readonly name: string; readonly host: string; readonly port: number }
  | { readonly kind: 'sftp'; readonly name: string; readonly host: string; readonly port: number }
  | { readonly kind: 'telnet'; readonly name: string; readonly host: string; readonly port: number }
  | { readonly kind: 'ftp'; readonly name: string; readonly host: string; readonly port: number; readonly secure: boolean }
  | { readonly kind: 'rdp'; readonly name: string; readonly host: string; readonly port: number }
  | { readonly kind: 'vnc'; readonly name: string; readonly host: string; readonly port: number }
  | { readonly kind: 'serial'; readonly name: string; readonly configuration: SerialConfiguration };

export function normalizeSavedSessionDraft(value: unknown): SavedSessionDraft | undefined {
  if (!isPlainRecord(value) || typeof value.kind !== 'string') return undefined;
  const name = normalizeName(value.name);
  if (!name) return undefined;
  if (value.kind === 'local') {
    if (value.shell === 'wsl') {
      if (!hasExactKeys(value, ['kind', 'name', 'shell', 'distribution']) || !isWslDistributionName(value.distribution)) return undefined;
      return { kind: 'local', name, shell: 'wsl', distribution: value.distribution };
    }
    if (!hasExactKeys(value, ['kind', 'name', 'shell']) || !isLocalShell(value.shell) || value.shell === 'wsl') return undefined;
    return { kind: 'local', name, shell: value.shell };
  }
  if (value.kind === 'serial') {
    if (!hasExactKeys(value, ['kind', 'name', 'configuration'])) return undefined;
    const configuration = normalizeSerialConfiguration(value.configuration);
    return configuration ? { kind: 'serial', name, configuration } : undefined;
  }
  if (value.kind === 'ssh') {
    if (!hasExactKeys(value, ['kind', 'name', 'host', 'port'])) return undefined;
    const endpoint = canonicalizeSshHostEndpoint({ host: value.host, port: value.port });
    if (!endpoint) return undefined;
    return { kind: 'ssh', name, host: endpoint.host, port: endpoint.port };
  }
  if (value.kind === 'sftp') {
    if (!hasExactKeys(value, ['kind', 'name', 'host', 'port'])) return undefined;
    const endpoint = canonicalizeSshHostEndpoint({ host: value.host, port: value.port });
    if (!endpoint) return undefined;
    return { kind: 'sftp', name, host: endpoint.host, port: endpoint.port };
  }
  if (value.kind === 'telnet') {
    if (!hasExactKeys(value, ['kind', 'name', 'host', 'port'])) return undefined;
    const endpoint = canonicalizeTelnetEndpoint({ host: value.host, port: value.port });
    if (!endpoint) return undefined;
    return { kind: 'telnet', name, host: endpoint.host, port: endpoint.port };
  }
  if (value.kind === 'ftp') {
    if (!hasExactKeys(value, ['kind', 'name', 'host', 'port', 'secure']) || typeof value.secure !== 'boolean') return undefined;
    const endpoint = canonicalizeRemoteEndpoint({ host: value.host, port: value.port });
    if (!endpoint) return undefined;
    return { kind: 'ftp', name, host: endpoint.host, port: endpoint.port, secure: value.secure };
  }
  if (value.kind === 'rdp') {
    if (!hasExactKeys(value, ['kind', 'name', 'host', 'port'])) return undefined;
    const endpoint = canonicalizeRdpEndpoint({ host: value.host, port: value.port });
    if (!endpoint) return undefined;
    return { kind: 'rdp', name, host: endpoint.host, port: endpoint.port };
  }
  if (value.kind === 'vnc') {
    if (!hasExactKeys(value, ['kind', 'name', 'host', 'port'])) return undefined;
    const endpoint = canonicalizeVncEndpoint({ host: value.host, port: value.port });
    if (!endpoint) return undefined;
    return { kind: 'vnc', name, host: endpoint.host, port: endpoint.port };
  }
  return undefined;
}

export function normalizeSessionSearch(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) return undefined;
  return value.trim();
}

export function isSavedSessionDefinition(value: unknown): value is SavedSessionDefinition {
  if (!isPlainRecord(value) || typeof value.kind !== 'string' || typeof value.id !== 'string' || !UUID.test(value.id) ||
      !(value.folderId === null || (typeof value.folderId === 'string' && UUID.test(value.folderId))) ||
      normalizeName(value.name) !== value.name || typeof value.favorite !== 'boolean' || !isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt)) return false;
  if (value.kind === 'local') {
    if (value.shell === 'wsl') return hasExactKeys(value, ['id', 'folderId', 'kind', 'name', 'shell', 'distribution', 'favorite', 'createdAt', 'updatedAt']) &&
      isWslDistributionName(value.distribution);
    return hasExactKeys(value, ['id', 'folderId', 'kind', 'name', 'shell', 'favorite', 'createdAt', 'updatedAt']) && isLocalShell(value.shell) && value.shell !== 'wsl';
  }
  if (value.kind === 'serial') return hasExactKeys(value, ['id', 'folderId', 'kind', 'name', 'configuration', 'favorite', 'createdAt', 'updatedAt']) &&
    isSerialConfiguration(value.configuration);
  if (value.kind === 'ssh') {
    if (!hasExactKeys(value, ['id', 'folderId', 'kind', 'name', 'host', 'port', 'favorite', 'createdAt', 'updatedAt'])) return false;
    const endpoint = canonicalizeSshHostEndpoint({ host: value.host, port: value.port });
    return endpoint !== undefined && endpoint.host === value.host && endpoint.port === value.port;
  }
  if (value.kind === 'sftp') {
    if (!hasExactKeys(value, ['id', 'folderId', 'kind', 'name', 'host', 'port', 'favorite', 'createdAt', 'updatedAt'])) return false;
    const endpoint = canonicalizeSshHostEndpoint({ host: value.host, port: value.port });
    return endpoint !== undefined && endpoint.host === value.host && endpoint.port === value.port;
  }
  if (value.kind === 'telnet') {
    if (!hasExactKeys(value, ['id', 'folderId', 'kind', 'name', 'host', 'port', 'favorite', 'createdAt', 'updatedAt'])) return false;
    const endpoint = canonicalizeTelnetEndpoint({ host: value.host, port: value.port });
    return endpoint !== undefined && endpoint.host === value.host && endpoint.port === value.port;
  }
  if (value.kind === 'ftp') {
    if (!hasExactKeys(value, ['id', 'folderId', 'kind', 'name', 'host', 'port', 'secure', 'favorite', 'createdAt', 'updatedAt']) || typeof value.secure !== 'boolean') return false;
    const endpoint = canonicalizeRemoteEndpoint({ host: value.host, port: value.port });
    return endpoint !== undefined && endpoint.host === value.host && endpoint.port === value.port;
  }
  if (value.kind === 'rdp') {
    if (!hasExactKeys(value, ['id', 'folderId', 'kind', 'name', 'host', 'port', 'favorite', 'createdAt', 'updatedAt'])) return false;
    const endpoint = canonicalizeRdpEndpoint({ host: value.host, port: value.port });
    return endpoint !== undefined && endpoint.host === value.host && endpoint.port === value.port;
  }
  if (value.kind === 'vnc') {
    if (!hasExactKeys(value, ['id', 'folderId', 'kind', 'name', 'host', 'port', 'favorite', 'createdAt', 'updatedAt'])) return false;
    const endpoint = canonicalizeVncEndpoint({ host: value.host, port: value.port });
    return endpoint !== undefined && endpoint.host === value.host && endpoint.port === value.port;
  }
  return false;
}

export function isSessionFolderId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
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
