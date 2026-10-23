import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { HostTrustStoreError } from '../../../../packages/application/src/host-trust.ts';
import type { HostTrustInsertResult, HostTrustStore } from '../../../../packages/application/src/host-trust.ts';
import { canonicalizeSshHostEndpoint, hostEndpointKey, isHostKeyEvidence, sameHostKey } from '../../../../packages/domain/src/host-trust.ts';
import type { SshHostEndpoint, TrustedHostKey } from '../../../../packages/domain/src/host-trust.ts';

const SCHEMA_VERSION = 1;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_ENTRIES = 100_000;
const MAX_QUEUED_OPERATIONS = 128;
const ENTRY_FIELDS = new Set(['host', 'port', 'algorithm', 'publicKey', 'fingerprint', 'trustedAt', 'approvalSource']);
const queuesByPath = new Map<string, StoreQueue>();

interface StoreQueue {
  pendingOperations: number;
  tail: Promise<void>;
}

interface StoredHostKey {
  readonly host: string;
  readonly port: number;
  readonly algorithm: string;
  readonly publicKey: string;
  readonly fingerprint: string;
  readonly trustedAt: number;
  readonly approvalSource: 'user';
}

interface StoreDocument {
  readonly version: 1;
  readonly entries: StoredHostKey[];
}

export class HostTrustJsonStore implements HostTrustStore {
  private readonly filePath: string;
  private readonly queue: StoreQueue;

  constructor(filePath: string) {
    if (typeof filePath !== 'string' || !isAbsolute(filePath)) throw new TypeError('Host trust store path must be absolute');
    this.filePath = resolve(filePath);
    this.queue = queueForPath(this.filePath);
  }

  find(endpoint: SshHostEndpoint): Promise<TrustedHostKey | undefined> {
    return this.run(async () => {
      const canonicalEndpoint = checkedEndpoint(endpoint);
      const entries = await this.readEntries();
      const key = hostEndpointKey(canonicalEndpoint);
      const stored = entries.find(item => hostEndpointKey({ host: item.host, port: item.port }) === key);
      return stored ? decodeEntry(stored) : undefined;
    });
  }

  trustIfAbsent(identity: TrustedHostKey): Promise<HostTrustInsertResult> {
    return this.run(async () => {
      const candidate = encodeEntry(identity);
      const entries = await this.readEntries();
      const key = hostEndpointKey(identity.endpoint);
      const existing = entries.find(item => hostEndpointKey({ host: item.host, port: item.port }) === key);
      if (existing) return sameHostKey(decodeEntry(existing), identity) ? 'matched' : 'changed';
      if (entries.length >= MAX_ENTRIES) throw new HostTrustStoreError('unavailable');
      entries.push(candidate);
      await this.writeEntries(entries);
      return 'inserted';
    });
  }

  remove(endpoint: SshHostEndpoint): Promise<boolean> {
    return this.run(async () => {
      const canonicalEndpoint = checkedEndpoint(endpoint);
      const entries = await this.readEntries();
      const key = hostEndpointKey(canonicalEndpoint);
      const remaining = entries.filter(item => hostEndpointKey({ host: item.host, port: item.port }) !== key);
      if (remaining.length === entries.length) return false;
      await this.writeEntries(remaining);
      return true;
    });
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.queue.pendingOperations >= MAX_QUEUED_OPERATIONS) return Promise.reject(new HostTrustStoreError('busy'));
    this.queue.pendingOperations += 1;
    const result = this.queue.tail.then(operation, operation);
    this.queue.tail = result.then(() => undefined, () => undefined);
    return result.catch(error => {
      if (error instanceof HostTrustStoreError) throw error;
      throw new HostTrustStoreError('unavailable');
    }).finally(() => { this.queue.pendingOperations -= 1; });
  }

  private async readEntries(): Promise<StoredHostKey[]> {
    let fileStat;
    try {
      fileStat = await stat(this.filePath);
    } catch (error) {
      if (hasNodeCode(error, 'ENOENT')) return [];
      throw error;
    }
    if (!fileStat.isFile() || fileStat.size > MAX_FILE_BYTES) throw new HostTrustStoreError('corrupt');

    const handle = await open(this.filePath, 'r');
    let bytes: Buffer;
    try {
      const openedStat = await handle.stat();
      if (!openedStat.isFile() || openedStat.size > MAX_FILE_BYTES) throw new HostTrustStoreError('corrupt');
      const bounded = Buffer.alloc(MAX_FILE_BYTES + 1);
      let offset = 0;
      while (offset < bounded.length) {
        const { bytesRead } = await handle.read(bounded, offset, bounded.length - offset, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      if (offset > MAX_FILE_BYTES || offset !== openedStat.size) throw new HostTrustStoreError('corrupt');
      const afterRead = await handle.stat();
      if (afterRead.size !== openedStat.size || afterRead.mtimeMs !== openedStat.mtimeMs) throw new HostTrustStoreError('corrupt');
      bytes = bounded.subarray(0, offset);
    } finally {
      await handle.close();
    }

    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
    } catch {
      throw new HostTrustStoreError('corrupt');
    }
    return parseDocument(value);
  }

  private async writeEntries(entries: StoredHostKey[]): Promise<void> {
    const document: StoreDocument = { version: SCHEMA_VERSION, entries };
    const serialized = `${JSON.stringify(document)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_FILE_BYTES) throw new HostTrustStoreError('unavailable');
    const directory = dirname(this.filePath);
    await mkdir(directory, { recursive: true });
    const temporary = join(directory, `.${randomUUID()}.host-trust.tmp`);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(serialized, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, this.filePath);
    } catch (error) {
      if (handle) await handle.close().catch(() => undefined);
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}

function parseDocument(input: unknown): StoredHostKey[] {
  if (!isRecord(input) || input.version !== SCHEMA_VERSION || !Array.isArray(input.entries) || input.entries.length > MAX_ENTRIES || Object.keys(input).some(key => key !== 'version' && key !== 'entries')) {
    throw new HostTrustStoreError('corrupt');
  }
  const entries: StoredHostKey[] = [];
  const endpoints = new Set<string>();
  for (const value of input.entries) {
    if (!isRecord(value) || Object.keys(value).length !== ENTRY_FIELDS.size || Object.keys(value).some(key => !ENTRY_FIELDS.has(key))) {
      throw new HostTrustStoreError('corrupt');
    }
    const endpoint = canonicalizeSshHostEndpoint({ host: value.host, port: value.port });
    if (!endpoint || endpoint.host !== value.host || endpoint.port !== value.port || typeof value.algorithm !== 'string' ||
        typeof value.publicKey !== 'string' || typeof value.fingerprint !== 'string' || !Number.isSafeInteger(value.trustedAt) ||
        (value.trustedAt as number) < 0 || value.approvalSource !== 'user') throw new HostTrustStoreError('corrupt');
    const key = hostEndpointKey(endpoint);
    if (endpoints.has(key)) throw new HostTrustStoreError('corrupt');
    endpoints.add(key);
    const stored: StoredHostKey = {
      host: endpoint.host,
      port: endpoint.port,
      algorithm: value.algorithm,
      publicKey: value.publicKey,
      fingerprint: value.fingerprint,
      trustedAt: value.trustedAt as number,
      approvalSource: 'user'
    };
    decodeEntry(stored);
    entries.push(stored);
  }
  return entries;
}

function checkedEndpoint(input: SshHostEndpoint): SshHostEndpoint {
  const endpoint = canonicalizeSshHostEndpoint(input);
  if (!endpoint || endpoint.host !== input.host || endpoint.port !== input.port) throw new HostTrustStoreError('unavailable');
  return endpoint;
}

function encodeEntry(identity: TrustedHostKey): StoredHostKey {
  const endpoint = canonicalizeSshHostEndpoint(identity.endpoint);
  const evidence = { algorithm: identity.algorithm, fingerprint: identity.fingerprint, publicKey: identity.publicKey };
  if (!endpoint || endpoint.host !== identity.endpoint.host || endpoint.port !== identity.endpoint.port ||
      !isHostKeyEvidence(evidence) || !Number.isSafeInteger(identity.trustedAt) || identity.trustedAt < 0 || identity.approvalSource !== 'user') {
    throw new HostTrustStoreError('unavailable');
  }
  const fingerprint = fingerprintOf(identity.publicKey);
  if (fingerprint !== identity.fingerprint) throw new HostTrustStoreError('unavailable');
  return {
    host: endpoint.host,
    port: endpoint.port,
    algorithm: identity.algorithm,
    publicKey: Buffer.from(identity.publicKey).toString('base64'),
    fingerprint,
    trustedAt: identity.trustedAt,
    approvalSource: 'user'
  };
}

function decodeEntry(value: StoredHostKey): TrustedHostKey {
  const publicKey = Buffer.from(value.publicKey, 'base64');
  if (publicKey.length === 0 || publicKey.toString('base64') !== value.publicKey || publicKey.length > 64 * 1024 ||
      !isHostKeyEvidence({ algorithm: value.algorithm, fingerprint: value.fingerprint, publicKey }) || fingerprintOf(publicKey) !== value.fingerprint) {
    throw new HostTrustStoreError('corrupt');
  }
  return {
    endpoint: { host: value.host, port: value.port },
    algorithm: value.algorithm,
    fingerprint: value.fingerprint,
    publicKey: Uint8Array.from(publicKey),
    trustedAt: value.trustedAt,
    approvalSource: 'user'
  };
}

function fingerprintOf(publicKey: Uint8Array): string {
  return `SHA256:${createHash('sha256').update(publicKey).digest('base64').replace(/=+$/, '')}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function queueForPath(filePath: string): StoreQueue {
  const key = process.platform === 'win32' ? filePath.toLowerCase() : filePath;
  let queue = queuesByPath.get(key);
  if (!queue) {
    queue = { pendingOperations: 0, tail: Promise.resolve() };
    queuesByPath.set(key, queue);
  }
  return queue;
}

function hasNodeCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
