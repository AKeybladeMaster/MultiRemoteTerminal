import { canonicalizeSshHostEndpoint, isHostKeyEvidence } from '../../../../packages/domain/src/host-trust.ts';
import type { SshHostEndpoint, TrustedHostKey } from '../../../../packages/domain/src/host-trust.ts';

export const STORAGE_WORKER_PROTOCOL_VERSION = 1;
const MAX_MIGRATION_ENTRIES = 100_000;
const MAX_MIGRATION_BYTES = 16 * 1024 * 1024;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type StorageWorkerRequest =
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'hostTrust.find'; readonly endpoint: SshHostEndpoint }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'hostTrust.trustIfAbsent'; readonly identity: TrustedHostKey }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'hostTrust.remove'; readonly endpoint: SshHostEndpoint }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'hostTrust.importLegacy'; readonly identities: readonly TrustedHostKey[] }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'shutdown' };

export type StorageWorkerResult =
  | { readonly kind: 'identity'; readonly value: TrustedHostKey | null }
  | { readonly kind: 'insert'; readonly value: 'inserted' | 'matched' | 'changed' }
  | { readonly kind: 'removed'; readonly value: boolean }
  | { readonly kind: 'migrated'; readonly value: { readonly sourceCount: number; readonly verifiedCount: number } }
  | { readonly kind: 'shutdown' };

export type StorageWorkerErrorCode = 'BUSY' | 'CORRUPT' | 'UNAVAILABLE';

export type StorageWorkerMessage =
  | { readonly version: 1; readonly type: 'ready' }
  | { readonly version: 1; readonly type: 'startup-error'; readonly errorCode: StorageWorkerErrorCode }
  | { readonly version: 1; readonly type: 'reply'; readonly requestId: string; readonly ok: true; readonly result: StorageWorkerResult }
  | { readonly version: 1; readonly type: 'reply'; readonly requestId: string; readonly ok: false; readonly errorCode: StorageWorkerErrorCode };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function endpoint(value: unknown): value is SshHostEndpoint {
  if (!record(value) || !exactKeys(value, ['host', 'port'])) return false;
  const canonical = canonicalizeSshHostEndpoint(value);
  return canonical !== undefined && canonical.host === value.host && canonical.port === value.port;
}

function identity(value: unknown): value is TrustedHostKey {
  if (!record(value) || !exactKeys(value, ['endpoint', 'algorithm', 'fingerprint', 'publicKey', 'trustedAt', 'approvalSource']) ||
      !endpoint(value.endpoint) || !Number.isSafeInteger(value.trustedAt) || (value.trustedAt as number) < 0 || value.approvalSource !== 'user') return false;
  return isHostKeyEvidence({ algorithm: value.algorithm, fingerprint: value.fingerprint, publicKey: value.publicKey });
}

export function parseStorageWorkerRequest(value: unknown): StorageWorkerRequest | undefined {
  if (!record(value) || value.version !== STORAGE_WORKER_PROTOCOL_VERSION || value.type !== 'request' ||
      typeof value.requestId !== 'string' || !REQUEST_ID.test(value.requestId) || typeof value.command !== 'string') return undefined;
  if (value.command === 'hostTrust.find' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'endpoint']) && endpoint(value.endpoint)) return value as unknown as StorageWorkerRequest;
  if (value.command === 'hostTrust.trustIfAbsent' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'identity']) && identity(value.identity)) return value as unknown as StorageWorkerRequest;
  if (value.command === 'hostTrust.remove' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'endpoint']) && endpoint(value.endpoint)) return value as unknown as StorageWorkerRequest;
  if (value.command === 'hostTrust.importLegacy' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'identities']) && Array.isArray(value.identities) && value.identities.length <= MAX_MIGRATION_ENTRIES) {
    let totalBytes = 0;
    for (const item of value.identities) {
      if (!identity(item)) return undefined;
      totalBytes += item.publicKey.byteLength;
      if (totalBytes > MAX_MIGRATION_BYTES) return undefined;
    }
    return value as unknown as StorageWorkerRequest;
  }
  if (value.command === 'shutdown' && exactKeys(value, ['version', 'type', 'requestId', 'command'])) return value as unknown as StorageWorkerRequest;
  return undefined;
}

export function parseStorageWorkerMessage(value: unknown): StorageWorkerMessage | undefined {
  if (!record(value) || value.version !== STORAGE_WORKER_PROTOCOL_VERSION || typeof value.type !== 'string') return undefined;
  if (value.type === 'ready' && exactKeys(value, ['version', 'type'])) return value as unknown as StorageWorkerMessage;
  if (value.type === 'startup-error' && exactKeys(value, ['version', 'type', 'errorCode']) && isErrorCode(value.errorCode)) return value as unknown as StorageWorkerMessage;
  if (value.type !== 'reply' || !REQUEST_ID.test(String(value.requestId)) || typeof value.ok !== 'boolean') return undefined;
  if (!value.ok && exactKeys(value, ['version', 'type', 'requestId', 'ok', 'errorCode']) && isErrorCode(value.errorCode)) return value as unknown as StorageWorkerMessage;
  if (!value.ok || !exactKeys(value, ['version', 'type', 'requestId', 'ok', 'result']) || !parseResult(value.result)) return undefined;
  return value as unknown as StorageWorkerMessage;
}

function parseResult(value: unknown): value is StorageWorkerResult {
  if (!record(value) || typeof value.kind !== 'string') return false;
  if (value.kind === 'identity' && exactKeys(value, ['kind', 'value']) && (value.value === null || identity(value.value))) return true;
  if (value.kind === 'insert' && exactKeys(value, ['kind', 'value']) && ['inserted', 'matched', 'changed'].includes(String(value.value))) return true;
  if (value.kind === 'removed' && exactKeys(value, ['kind', 'value']) && typeof value.value === 'boolean') return true;
  if (value.kind === 'migrated' && exactKeys(value, ['kind', 'value']) && record(value.value) && exactKeys(value.value, ['sourceCount', 'verifiedCount']) &&
      Number.isSafeInteger(value.value.sourceCount) && value.value.sourceCount === value.value.verifiedCount && (value.value.sourceCount as number) >= 0) return true;
  return value.kind === 'shutdown' && exactKeys(value, ['kind']);
}

function isErrorCode(value: unknown): value is StorageWorkerErrorCode {
  return value === 'BUSY' || value === 'CORRUPT' || value === 'UNAVAILABLE';
}
