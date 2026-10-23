import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { SecretVaultError } from '../../../../packages/application/src/secret-vault.ts';
import type { SecretVault, SecretVaultState } from '../../../../packages/application/src/secret-vault.ts';
import { isCredentialSecret, parseCredentialReference } from '../../../../packages/domain/src/credentials.ts';
import type { CredentialReference } from '../../../../packages/domain/src/credentials.ts';

const SCHEMA_VERSION = 1;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_CIPHERTEXT_BYTES = 512 * 1024;
const MAX_QUEUED_OPERATIONS = 128;

export interface AsyncSafeStorage {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(plainText: string): Promise<Buffer>;
  decryptStringAsync(encrypted: Buffer): Promise<{ readonly result: string; readonly shouldReEncrypt: boolean }>;
}

interface StoredDocument {
  readonly version: 1;
  readonly entries: Record<string, string>;
}

export class SafeStorageSecretVault implements SecretVault {
  private readonly filePath: string;
  private readonly safeStorage: AsyncSafeStorage;
  private records = new Map<string, string>();
  private recordsLoaded = false;
  private vaultState: SecretVaultState = 'uninitialized';
  private generation = 0;
  private pendingOperations = 0;
  private queue = Promise.resolve();

  constructor(filePath: string, safeStorage: AsyncSafeStorage) {
    if (typeof filePath !== 'string' || !isAbsolute(filePath)) throw new TypeError('Credential vault path must be absolute');
    this.filePath = resolve(filePath);
    this.safeStorage = safeStorage;
  }

  get state(): SecretVaultState {
    return this.vaultState;
  }

  initialize(): Promise<void> {
    return this.run(async () => this.initializeWithinQueue());
  }

  store(reference: CredentialReference, secret: string): Promise<void> {
    if (!parseCredentialReference(reference) || !isCredentialSecret(secret)) {
      return Promise.reject(new SecretVaultError('invalid-input'));
    }
    return this.run(async () => {
      this.requireAvailable();
      const generation = this.generation;
      await this.requireEncryptionAvailable();
      let encrypted: Buffer;
      try {
        encrypted = await this.safeStorage.encryptStringAsync(encodeCredential(reference, secret));
      } catch {
        throw new SecretVaultError('unavailable');
      }
      this.requireSameUnlockedGeneration(generation);
      const ciphertext = encodeCiphertext(encrypted);
      const next = new Map(this.records);
      next.set(reference, ciphertext);
      await this.writeRecords(next);
      this.records = next;
    });
  }

  resolveForOperation(reference: CredentialReference): Promise<string> {
    if (!parseCredentialReference(reference)) return Promise.reject(new SecretVaultError('invalid-input'));
    return this.run(async () => {
      this.requireAvailable();
      const generation = this.generation;
      const ciphertext = this.records.get(reference);
      if (!ciphertext) throw new SecretVaultError('not-found');

      const encrypted = decodeCiphertext(ciphertext);
      let decrypted: { readonly result: string; readonly shouldReEncrypt: boolean };
      try {
        decrypted = await this.safeStorage.decryptStringAsync(encrypted);
      } catch {
        throw new SecretVaultError('unavailable');
      }
      if (typeof decrypted.result !== 'string' || typeof decrypted.shouldReEncrypt !== 'boolean') {
        throw new SecretVaultError('corrupt');
      }
      const secret = decodeCredential(reference, decrypted.result);

      if (decrypted.shouldReEncrypt) {
        this.requireSameUnlockedGeneration(generation);
        await this.requireEncryptionAvailable();
        let replacement: Buffer;
        try {
          replacement = await this.safeStorage.encryptStringAsync(decrypted.result);
        } catch {
          throw new SecretVaultError('unavailable');
        }
        const next = new Map(this.records);
        next.set(reference, encodeCiphertext(replacement));
        await this.writeRecords(next);
        this.records = next;
      }

      this.requireSameUnlockedGeneration(generation);
      return secret;
    });
  }

  delete(reference: CredentialReference): Promise<boolean> {
    if (!parseCredentialReference(reference)) return Promise.reject(new SecretVaultError('invalid-input'));
    return this.run(async () => {
      this.requireAvailable();
      if (!this.records.has(reference)) return false;
      const generation = this.generation;
      const next = new Map(this.records);
      next.delete(reference);
      this.requireSameUnlockedGeneration(generation);
      await this.writeRecords(next);
      this.records = next;
      return true;
    });
  }

  lock(): void {
    this.generation += 1;
    if (this.vaultState !== 'unavailable') this.vaultState = 'locked';
  }

  unlock(): Promise<void> {
    const generation = this.generation;
    return this.run(async () => {
      if (this.vaultState === 'available' && this.recordsLoaded) return;
      if (!this.recordsLoaded || this.vaultState === 'unavailable' || this.vaultState === 'uninitialized') {
        await this.initializeWithinQueue();
      }
      if (generation !== this.generation) throw new SecretVaultError('locked');
      if (this.vaultState === 'available' && this.recordsLoaded) return;
      if (!this.recordsLoaded) throw new SecretVaultError('unavailable');
      await this.requireEncryptionAvailable();
      if (generation !== this.generation || this.vaultState !== 'locked') throw new SecretVaultError('locked');
      this.vaultState = 'available';
    });
  }

  reset(): Promise<void> {
    const generation = ++this.generation;
    const preserveLock = this.vaultState === 'locked';
    if (this.vaultState === 'available') this.vaultState = 'locked';
    return this.run(async () => {
      try {
        await this.writeRecords(new Map());
        this.records = new Map();
        this.recordsLoaded = true;
        if (generation !== this.generation) return;
        if (preserveLock) return;
        await this.requireEncryptionAvailable();
        if (generation !== this.generation) return;
        this.vaultState = 'available';
      } catch (error) {
        if (generation === this.generation) this.vaultState = 'unavailable';
        throw error;
      }
    });
  }

  private async initializeWithinQueue(): Promise<void> {
    if (this.vaultState === 'available' && this.recordsLoaded) return;
    const generation = this.generation;
    const preserveLock = this.vaultState === 'locked';
    try {
      await this.requireEncryptionAvailable();
      if (!this.recordsLoaded) {
        this.records = await this.readRecords();
        this.recordsLoaded = true;
      }
      if (generation !== this.generation) return;
      this.vaultState = preserveLock ? 'locked' : 'available';
    } catch (error) {
      if (generation === this.generation) this.vaultState = 'unavailable';
      if (error instanceof SecretVaultError) throw error;
      throw new SecretVaultError('unavailable');
    }
  }

  private async requireEncryptionAvailable(): Promise<void> {
    try {
      if (!(await this.safeStorage.isAsyncEncryptionAvailable())) throw new SecretVaultError('unavailable');
    } catch (error) {
      if (error instanceof SecretVaultError) throw error;
      throw new SecretVaultError('unavailable');
    }
  }

  private requireInitialized(): void {
    if (!this.recordsLoaded || this.vaultState === 'unavailable' || this.vaultState === 'uninitialized') {
      throw new SecretVaultError('unavailable');
    }
  }

  private requireAvailable(): void {
    this.requireInitialized();
    if (this.vaultState === 'locked') throw new SecretVaultError('locked');
  }

  private requireSameUnlockedGeneration(generation: number): void {
    if (this.vaultState !== 'available' || this.generation !== generation) throw new SecretVaultError('locked');
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.pendingOperations >= MAX_QUEUED_OPERATIONS) return Promise.reject(new SecretVaultError('busy'));
    this.pendingOperations += 1;
    const result = this.queue.then(operation, operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result.catch(error => {
      if (error instanceof SecretVaultError) throw error;
      throw new SecretVaultError('unavailable');
    }).finally(() => { this.pendingOperations -= 1; });
  }

  private async readRecords(): Promise<Map<string, string>> {
    let fileStat;
    try {
      fileStat = await stat(this.filePath);
    } catch (error) {
      if (hasNodeCode(error, 'ENOENT')) return new Map();
      throw error;
    }
    if (!fileStat.isFile() || fileStat.size > MAX_FILE_BYTES) throw new SecretVaultError('corrupt');

    const handle = await open(this.filePath, 'r');
    let bytes: Buffer;
    try {
      const openedStat = await handle.stat();
      if (!openedStat.isFile() || openedStat.size > MAX_FILE_BYTES) throw new SecretVaultError('corrupt');
      const bounded = Buffer.alloc(MAX_FILE_BYTES + 1);
      let offset = 0;
      while (offset < bounded.length) {
        const { bytesRead } = await handle.read(bounded, offset, bounded.length - offset, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      if (offset > MAX_FILE_BYTES || offset !== openedStat.size) throw new SecretVaultError('corrupt');
      const afterRead = await handle.stat();
      if (afterRead.size !== openedStat.size || afterRead.mtimeMs !== openedStat.mtimeMs) throw new SecretVaultError('corrupt');
      bytes = bounded.subarray(0, offset);
    } finally {
      await handle.close();
    }

    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
    } catch {
      throw new SecretVaultError('corrupt');
    }
    return decodeDocument(value);
  }

  private async writeRecords(records: Map<string, string>): Promise<void> {
    const entries = Object.fromEntries(records);
    const document: StoredDocument = { version: SCHEMA_VERSION, entries };
    const serialized = JSON.stringify(document) + '\n';
    if (Buffer.byteLength(serialized, 'utf8') > MAX_FILE_BYTES) throw new SecretVaultError('unavailable');
    const directory = dirname(this.filePath);
    await mkdir(directory, { recursive: true });
    const temporary = join(directory, '.' + randomUUID() + '.credential-vault.tmp');
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(serialized, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, this.filePath);
    } catch {
      if (handle) await handle.close().catch(() => undefined);
      await rm(temporary, { force: true }).catch(() => undefined);
      throw new SecretVaultError('unavailable');
    }
  }
}

function encodeCredential(reference: CredentialReference, secret: string): string {
  return JSON.stringify({ version: 1, reference, secret });
}

function decodeCredential(reference: CredentialReference, plaintext: string): string {
  let value: unknown;
  try {
    value = JSON.parse(plaintext) as unknown;
  } catch {
    throw new SecretVaultError('corrupt');
  }
  if (!isRecord(value) || Object.keys(value).length !== 3 || value.version !== 1 ||
      value.reference !== reference || !isCredentialSecret(value.secret)) throw new SecretVaultError('corrupt');
  return value.secret;
}

function encodeCiphertext(value: unknown): string {
  if (!Buffer.isBuffer(value) || value.byteLength === 0 || value.byteLength > MAX_CIPHERTEXT_BYTES) {
    throw new SecretVaultError('unavailable');
  }
  return value.toString('base64');
}

function decodeCiphertext(value: string): Buffer {
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length === 0 || decoded.length > MAX_CIPHERTEXT_BYTES || decoded.toString('base64') !== value) {
    throw new SecretVaultError('corrupt');
  }
  return decoded;
}

function decodeDocument(input: unknown): Map<string, string> {
  if (!isRecord(input) || input.version !== SCHEMA_VERSION || !isRecord(input.entries) || Object.keys(input).length !== 2) {
    throw new SecretVaultError('corrupt');
  }
  const records = new Map<string, string>();
  for (const [reference, ciphertext] of Object.entries(input.entries)) {
    if (!parseCredentialReference(reference) || typeof ciphertext !== 'string') throw new SecretVaultError('corrupt');
    decodeCiphertext(ciphertext);
    records.set(reference, ciphertext);
  }
  return records;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasNodeCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
