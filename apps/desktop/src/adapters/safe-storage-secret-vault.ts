import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { SecretVaultError } from '../../../../packages/application/src/secret-vault.ts';
import type { SecretVault, SecretVaultMode, SecretVaultState } from '../../../../packages/application/src/secret-vault.ts';
import { isCredentialSecret, parseCredentialReference } from '../../../../packages/domain/src/credentials.ts';
import type { CredentialReference } from '../../../../packages/domain/src/credentials.ts';
import { MasterPasswordKdfError } from './master-password-key-deriver.ts';
import type { MasterPasswordKeyDeriver } from './master-password-key-deriver.ts';
import { MASTER_PASSWORD_PROFILE } from './master-password-profile.ts';
import { isCanonicalBase64, isMasterPasswordEnvelope, isMasterPasswordProfile,
  openMasterPasswordEnvelope, sealMasterPasswordEnvelope, sealMasterSentinel, verifyMasterSentinel } from './master-password-crypto.ts';
import type { MasterPasswordEnvelope } from './master-password-crypto.ts';

const DOCUMENT_VERSION = 2;
const LEGACY_DOCUMENT_VERSION = 1;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_CIPHERTEXT_BYTES = 512 * 1024;
const MAX_QUEUED_OPERATIONS = 128;
const UNLOCK_FAILURES_PER_DELAY = 5;
const INITIAL_UNLOCK_DELAY_MS = 30_000;
const MAX_UNLOCK_DELAY_MS = 15 * 60_000;
const MAX_FAILURE_COUNT = 1_000_000;

export interface AsyncSafeStorage {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(plainText: string): Promise<Buffer>;
  decryptStringAsync(encrypted: Buffer): Promise<{ readonly result: string; readonly shouldReEncrypt: boolean }>;
}

interface WindowsAccountDocument {
  readonly version: 2;
  readonly mode: 'windows-account';
  readonly entries: Record<string, string>;
}

interface MasterPasswordDocument {
  readonly version: 2;
  readonly mode: 'master-password';
  readonly profile: typeof MASTER_PASSWORD_PROFILE;
  readonly salt: string;
  readonly sentinel: MasterPasswordEnvelope;
  readonly failedUnlocks: number;
  readonly blockedUntil: number;
  readonly entries: Record<string, MasterPasswordEnvelope>;
}

type StoredDocument = WindowsAccountDocument | MasterPasswordDocument;
type StoredEntry = string | MasterPasswordEnvelope;

interface DecodedDocument {
  readonly mode: SecretVaultMode;
  readonly records: Map<string, StoredEntry>;
  readonly salt?: string;
  readonly sentinel?: MasterPasswordEnvelope;
  readonly failedUnlocks: number;
  readonly blockedUntil: number;
}

export class SafeStorageSecretVault implements SecretVault {
  private readonly filePath: string;
  private readonly safeStorage: AsyncSafeStorage;
  private readonly keyDeriver: MasterPasswordKeyDeriver;
  private readonly now: () => number;
  private records = new Map<string, StoredEntry>();
  private recordsLoaded = false;
  private vaultState: SecretVaultState = 'uninitialized';
  private vaultMode: SecretVaultMode = 'windows-account';
  private lockRequested = false;
  private resetGeneration: number | undefined;
  private generation = 0;
  private masterSalt: string | undefined;
  private masterSentinel: MasterPasswordEnvelope | undefined;
  private failedUnlocks = 0;
  private blockedUntil = 0;
  private masterKey: Buffer | undefined;
  private derivationController: AbortController | undefined;
  private pendingOperations = 0;
  private queue = Promise.resolve();

  constructor(filePath: string, safeStorage: AsyncSafeStorage, keyDeriver: MasterPasswordKeyDeriver, now: () => number = Date.now) {
    if (typeof filePath !== 'string' || !isAbsolute(filePath)) throw new TypeError('Credential vault path must be absolute');
    this.filePath = resolve(filePath);
    this.safeStorage = safeStorage;
    this.keyDeriver = keyDeriver;
    this.now = now;
  }

  get state(): SecretVaultState { return this.vaultState; }
  get mode(): SecretVaultMode { return this.vaultMode; }

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
      const next = new Map(this.records);
      if (this.vaultMode === 'windows-account') {
        await this.requireEncryptionAvailable();
        let encrypted: Buffer;
        try { encrypted = await this.safeStorage.encryptStringAsync(encodeCredential(reference, secret)); }
        catch { throw new SecretVaultError('unavailable'); }
        this.requireSameUnlockedGeneration(generation);
        next.set(reference, encodeCiphertext(encrypted));
      } else {
        const key = this.requireMasterKey();
        const plaintext = Buffer.from(encodeCredential(reference, secret), 'utf8');
        try {
          next.set(reference, await sealMasterPasswordEnvelope(plaintext, key, reference));
        } catch { throw new SecretVaultError('unavailable'); }
        finally { plaintext.fill(0); }
        this.requireSameUnlockedGeneration(generation);
      }
      await this.writeCurrentDocument(next);
      this.requireSameUnlockedGeneration(generation);
      this.records = next;
    });
  }

  resolveForOperation(reference: CredentialReference): Promise<string> {
    if (!parseCredentialReference(reference)) return Promise.reject(new SecretVaultError('invalid-input'));
    return this.run(async () => {
      this.requireAvailable();
      const generation = this.generation;
      const stored = this.records.get(reference);
      if (stored === undefined) throw new SecretVaultError('not-found');

      if (this.vaultMode === 'windows-account') {
        if (typeof stored !== 'string') throw new SecretVaultError('corrupt');
        const encrypted = decodeCiphertext(stored);
        let decrypted: { readonly result: string; readonly shouldReEncrypt: boolean };
        try { decrypted = await this.safeStorage.decryptStringAsync(encrypted); }
        catch { throw new SecretVaultError('unavailable'); }
        if (typeof decrypted.result !== 'string' || typeof decrypted.shouldReEncrypt !== 'boolean') throw new SecretVaultError('corrupt');
        const secret = decodeCredential(reference, decrypted.result);
        if (decrypted.shouldReEncrypt) {
          this.requireSameUnlockedGeneration(generation);
          await this.requireEncryptionAvailable();
          let replacement: Buffer;
          try { replacement = await this.safeStorage.encryptStringAsync(decrypted.result); }
          catch { throw new SecretVaultError('unavailable'); }
          const next = new Map(this.records);
          next.set(reference, encodeCiphertext(replacement));
          await this.writeCurrentDocument(next);
          this.records = next;
        }
        this.requireSameUnlockedGeneration(generation);
        return secret;
      }

      if (!isMasterPasswordEnvelope(stored)) throw new SecretVaultError('corrupt');
      const plaintext = await this.decryptMasterEntry(reference, stored, this.requireMasterKey());
      try {
        const decoded = decodeUtf8(plaintext);
        const secret = decodeCredential(reference, decoded);
        this.requireSameUnlockedGeneration(generation);
        return secret;
      } finally { plaintext.fill(0); }
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
      await this.writeCurrentDocument(next);
      this.requireSameUnlockedGeneration(generation);
      this.records = next;
      return true;
    });
  }

  lock(): void {
    this.generation += 1;
    this.lockRequested = true;
    this.clearMasterKey();
    this.derivationController?.abort();
    if (this.vaultState !== 'unavailable') this.vaultState = 'locked';
  }

  unlock(masterPassword?: string): Promise<void> {
    const generation = this.generation;
    return this.run(async () => {
      if (!this.recordsLoaded || this.vaultState === 'unavailable' || this.vaultState === 'uninitialized') {
        await this.initializeWithinQueue();
      }
      if (generation !== this.generation) throw new SecretVaultError('locked');
      if (this.vaultState === 'available' && !this.lockRequested) return;
      if (!this.recordsLoaded) throw new SecretVaultError('unavailable');

      if (this.vaultMode === 'windows-account') {
        await this.requireEncryptionAvailable();
        if (generation !== this.generation || !this.lockRequested || this.vaultState !== 'locked') throw new SecretVaultError('locked');
        this.lockRequested = false;
        this.vaultState = 'available';
        return;
      }

      if (!isValidMasterPassword(masterPassword)) throw new SecretVaultError('invalid-input');
      if (this.blockedUntil > this.now()) throw new SecretVaultError('locked');
      let key: Buffer | undefined = await this.deriveUsingStoredSalt(masterPassword, generation);
      try {
        let authenticated = false;
        try { authenticated = await verifyMasterSentinel(this.requireMasterSentinel(), key); }
        catch { authenticated = false; }
        if (!authenticated) {
          await this.recordFailedUnlock();
          throw new SecretVaultError('password-rejected');
        }

        this.requireSameGeneration(generation);
        await this.persistSuccessfulUnlock();
        this.requireSameGeneration(generation);
        this.clearMasterKey();
        this.masterKey = key;
        key = undefined;
        this.lockRequested = false;
        this.vaultState = 'available';
      } finally { key?.fill(0); }
    });
  }

  enableMasterPassword(masterPassword: string): Promise<void> {
    if (!isValidMasterPassword(masterPassword)) return Promise.reject(new SecretVaultError('invalid-input'));
    return this.run(async () => {
      this.requireAvailable();
      if (this.vaultMode !== 'windows-account') throw new SecretVaultError('invalid-input');
      const generation = this.generation;
      const salt = randomBytes(MASTER_PASSWORD_PROFILE.saltLength);
      let key: Buffer | undefined;
      let temporaryPath: string | undefined;
      const sourcePlaintexts = new Map<string, Buffer>();
      try {
        key = await this.deriveKey(masterPassword, salt, generation);
        const encryptedEntries = new Map<string, StoredEntry>();
        for (const [reference, entry] of this.records) {
          if (typeof entry !== 'string') throw new SecretVaultError('corrupt');
          const decrypted = await this.safeStorage.decryptStringAsync(decodeCiphertext(entry));
          if (typeof decrypted.result !== 'string' || !decodeCredential(reference as CredentialReference, decrypted.result)) {
            throw new SecretVaultError('corrupt');
          }
          const plaintext = Buffer.from(decrypted.result, 'utf8');
          sourcePlaintexts.set(reference, plaintext);
          const envelope = await sealMasterPasswordEnvelope(plaintext, key, reference);
          encryptedEntries.set(reference, envelope);
          this.requireSameUnlockedGeneration(generation);
        }

        const sentinel = await sealMasterSentinel(key);
        const document = makeMasterPasswordDocument(encryptedEntries, salt.toString('base64'), sentinel, 0, 0);
        temporaryPath = await this.writeTemporaryDocument(document);
        this.requireSameUnlockedGeneration(generation);
        const staged = await this.readDocumentAt(temporaryPath);
        await this.verifyStagedMasterDocument(staged, sourcePlaintexts, key);
        this.requireSameUnlockedGeneration(generation);
        await rename(temporaryPath, this.filePath);
        temporaryPath = undefined;
        this.records = staged.records;
        this.adoptMasterMetadata(staged);
        this.vaultMode = 'master-password';
        this.clearMasterKey();
        this.masterKey = key;
        key = undefined;
        this.lockRequested = false;
        this.vaultState = 'available';
      } catch (error) {
        if (error instanceof SecretVaultError) throw error;
        throw new SecretVaultError('unavailable');
      } finally {
        key?.fill(0);
        salt.fill(0);
        for (const plaintext of sourcePlaintexts.values()) plaintext.fill(0);
        if (temporaryPath) await rm(temporaryPath, { force: true }).catch(() => undefined);
      }
    });
  }

  disableMasterPassword(masterPassword: string): Promise<void> {
    if (!isValidMasterPassword(masterPassword)) return Promise.reject(new SecretVaultError('invalid-input'));
    return this.run(async () => {
      this.requireInitialized();
      if (this.vaultMode !== 'master-password') throw new SecretVaultError('invalid-input');
      if (this.blockedUntil > this.now()) throw new SecretVaultError('locked');
      const generation = this.generation;
      let key: Buffer | undefined;
      let temporaryPath: string | undefined;
      const plaintexts = new Map<string, Buffer>();
      try {
        key = await this.deriveUsingStoredSalt(masterPassword, generation);
        let authenticated = false;
        try { authenticated = await verifyMasterSentinel(this.requireMasterSentinel(), key); }
        catch { authenticated = false; }
        if (!authenticated) {
          await this.recordFailedUnlock();
          throw new SecretVaultError('password-rejected');
        }
        this.requireSameGeneration(generation);
        await this.requireEncryptionAvailable();

        for (const [reference, stored] of this.records) {
          if (!isMasterPasswordEnvelope(stored)) throw new SecretVaultError('corrupt');
          const plaintext = await this.decryptMasterEntry(reference, stored, key);
          const serialized = decodeUtf8(plaintext);
          try { decodeCredential(reference as CredentialReference, serialized); }
          catch { plaintext.fill(0); throw new SecretVaultError('corrupt'); }
          plaintexts.set(reference, plaintext);
        }

        const encryptedEntries = new Map<string, StoredEntry>();
        for (const [reference, plaintext] of plaintexts) {
          const serialized = decodeUtf8(plaintext);
          const encrypted = await this.safeStorage.encryptStringAsync(serialized);
          encryptedEntries.set(reference, encodeCiphertext(encrypted));
          this.requireSameGeneration(generation);
        }
        const document = makeWindowsAccountDocument(encryptedEntries);
        temporaryPath = await this.writeTemporaryDocument(document);
        this.requireSameGeneration(generation);
        const staged = await this.readDocumentAt(temporaryPath);
        await this.verifyStagedWindowsDocument(staged, plaintexts);
        this.requireSameGeneration(generation);
        await rename(temporaryPath, this.filePath);
        temporaryPath = undefined;
        this.records = staged.records;
        this.vaultMode = 'windows-account';
        this.masterSalt = undefined;
        this.masterSentinel = undefined;
        this.failedUnlocks = 0;
        this.blockedUntil = 0;
        this.clearMasterKey();
        this.lockRequested = false;
        this.vaultState = 'available';
      } catch (error) {
        if (error instanceof SecretVaultError) throw error;
        throw new SecretVaultError('unavailable');
      } finally {
        key?.fill(0);
        for (const plaintext of plaintexts.values()) plaintext.fill(0);
        if (temporaryPath) await rm(temporaryPath, { force: true }).catch(() => undefined);
      }
    });
  }

  reset(): Promise<void> {
    if (this.pendingOperations >= MAX_QUEUED_OPERATIONS) return Promise.reject(new SecretVaultError('busy'));
    const generation = ++this.generation;
    const preserveLock = this.lockRequested;
    this.resetGeneration = generation;
    this.clearMasterKey();
    this.derivationController?.abort();
    if (this.vaultState === 'available') this.vaultState = 'locked';
    return this.run(async () => {
      try {
        await this.writeDocumentAtomic(makeWindowsAccountDocument(new Map()));
        this.records = new Map();
        this.recordsLoaded = true;
        this.vaultMode = 'windows-account';
        this.masterSalt = undefined;
        this.masterSentinel = undefined;
        this.failedUnlocks = 0;
        this.blockedUntil = 0;
        if (this.resetGeneration === generation) this.resetGeneration = undefined;
        if (generation !== this.generation) return;
        if (preserveLock) {
          this.lockRequested = true;
          this.vaultState = 'locked';
          return;
        }
        await this.requireEncryptionAvailable();
        if (generation !== this.generation) return;
        this.lockRequested = false;
        this.vaultState = 'available';
      } catch (error) {
        if (generation === this.generation) this.vaultState = 'unavailable';
        throw error;
      }
    });
  }

  private async initializeWithinQueue(): Promise<void> {
    const generation = this.generation;
    try {
      if (this.resetGeneration !== undefined) throw new SecretVaultError('unavailable');
      if (!this.recordsLoaded) {
        const document = await this.readDocumentAt(this.filePath);
        this.adoptDocument(document);
        this.recordsLoaded = true;
      }
      if (generation !== this.generation) return;
      if (this.vaultMode === 'master-password') {
        this.clearMasterKey();
        this.lockRequested = true;
        this.vaultState = 'locked';
        return;
      }
      await this.requireEncryptionAvailable();
      if (generation !== this.generation) return;
      this.vaultState = this.lockRequested ? 'locked' : 'available';
    } catch (error) {
      if (generation === this.generation) this.vaultState = 'unavailable';
      if (error instanceof SecretVaultError) throw error;
      throw new SecretVaultError('unavailable');
    }
  }

  private async deriveKey(masterPassword: string, salt: Uint8Array, generation: number): Promise<Buffer> {
    const passwordBytes = Buffer.from(masterPassword, 'utf8');
    const controller = new AbortController();
    this.derivationController = controller;
    try {
      const key = await this.keyDeriver.derive(passwordBytes, salt, controller.signal);
      if (generation !== this.generation || controller.signal.aborted) {
        key.fill(0);
        throw new SecretVaultError('locked');
      }
      if (!Buffer.isBuffer(key) || key.byteLength !== MASTER_PASSWORD_PROFILE.keyLength) {
        key.fill(0);
        throw new SecretVaultError('unavailable');
      }
      return key;
    } catch (error) {
      if (error instanceof SecretVaultError) throw error;
      if (generation !== this.generation || controller.signal.aborted || (error instanceof MasterPasswordKdfError && error.kind === 'cancelled')) {
        throw new SecretVaultError('locked');
      }
      if (error instanceof MasterPasswordKdfError && error.kind === 'timeout') throw new SecretVaultError('timeout');
      throw new SecretVaultError('unavailable');
    } finally {
      passwordBytes.fill(0);
      if (this.derivationController === controller) this.derivationController = undefined;
    }
  }

  private async deriveUsingStoredSalt(masterPassword: string, generation: number): Promise<Buffer> {
    const salt = this.requireMasterSalt();
    try { return await this.deriveKey(masterPassword, salt, generation); }
    finally { salt.fill(0); }
  }

  private async recordFailedUnlock(): Promise<void> {
    this.failedUnlocks = Math.min(this.failedUnlocks + 1, MAX_FAILURE_COUNT);
    if (this.failedUnlocks % UNLOCK_FAILURES_PER_DELAY === 0) {
      const rounds = this.failedUnlocks / UNLOCK_FAILURES_PER_DELAY;
      const delay = Math.min(INITIAL_UNLOCK_DELAY_MS * 2 ** (rounds - 1), MAX_UNLOCK_DELAY_MS);
      this.blockedUntil = this.now() + delay;
    }
    await this.writeCurrentDocument(this.records);
  }

  private async persistSuccessfulUnlock(): Promise<void> {
    if (this.failedUnlocks === 0 && this.blockedUntil === 0) return;
    this.failedUnlocks = 0;
    this.blockedUntil = 0;
    await this.writeCurrentDocument(this.records);
  }

  private async verifyStagedMasterDocument(document: DecodedDocument, sourcePlaintexts: Map<string, Buffer>, key: Buffer): Promise<void> {
    if (document.mode !== 'master-password' || document.records.size !== sourcePlaintexts.size || !document.sentinel ||
        !await verifyMasterSentinel(document.sentinel, key)) throw new SecretVaultError('corrupt');
    for (const [reference, source] of sourcePlaintexts) {
      const staged = document.records.get(reference);
      if (!isMasterPasswordEnvelope(staged)) throw new SecretVaultError('corrupt');
      const plaintext = await this.decryptMasterEntry(reference, staged, key);
      try { if (!plaintext.equals(source)) throw new SecretVaultError('corrupt'); }
      finally { plaintext.fill(0); }
    }
  }

  private async verifyStagedWindowsDocument(document: DecodedDocument, sourcePlaintexts: Map<string, Buffer>): Promise<void> {
    if (document.mode !== 'windows-account' || document.records.size !== sourcePlaintexts.size) throw new SecretVaultError('corrupt');
    for (const [reference, source] of sourcePlaintexts) {
      const stored = document.records.get(reference);
      if (typeof stored !== 'string') throw new SecretVaultError('corrupt');
      let decrypted: { readonly result: string; readonly shouldReEncrypt: boolean };
      try { decrypted = await this.safeStorage.decryptStringAsync(decodeCiphertext(stored)); }
      catch { throw new SecretVaultError('corrupt'); }
      const plaintext = Buffer.from(decrypted.result, 'utf8');
      try { if (!plaintext.equals(source)) throw new SecretVaultError('corrupt'); }
      finally { plaintext.fill(0); }
    }
  }

  private async decryptMasterEntry(reference: string, envelope: MasterPasswordEnvelope, key: Uint8Array): Promise<Buffer> {
    try { return await openMasterPasswordEnvelope(envelope, key, reference); }
    catch { throw new SecretVaultError('corrupt'); }
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

  private requireSameGeneration(generation: number): void {
    if (this.generation !== generation) throw new SecretVaultError('locked');
  }

  private requireMasterKey(): Buffer {
    if (!this.masterKey || this.masterKey.byteLength !== MASTER_PASSWORD_PROFILE.keyLength) throw new SecretVaultError('locked');
    return this.masterKey;
  }

  private requireMasterSalt(): Buffer {
    if (!this.masterSalt || !isCanonicalBase64(this.masterSalt, MASTER_PASSWORD_PROFILE.saltLength)) throw new SecretVaultError('corrupt');
    return Buffer.from(this.masterSalt, 'base64');
  }

  private requireMasterSentinel(): MasterPasswordEnvelope {
    if (!this.masterSentinel || !isMasterPasswordEnvelope(this.masterSentinel)) throw new SecretVaultError('corrupt');
    return this.masterSentinel;
  }

  private adoptMasterMetadata(document: DecodedDocument): void {
    this.masterSalt = document.salt;
    this.masterSentinel = document.sentinel;
    this.failedUnlocks = document.failedUnlocks;
    this.blockedUntil = document.blockedUntil;
  }

  private adoptDocument(document: DecodedDocument): void {
    this.records = document.records;
    this.vaultMode = document.mode;
    this.failedUnlocks = document.failedUnlocks;
    this.blockedUntil = document.blockedUntil;
    if (document.mode === 'master-password') this.adoptMasterMetadata(document);
    else {
      this.masterSalt = undefined;
      this.masterSentinel = undefined;
    }
  }

  private clearMasterKey(): void {
    this.masterKey?.fill(0);
    this.masterKey = undefined;
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

  private async writeCurrentDocument(records: Map<string, StoredEntry>): Promise<void> {
    if (this.vaultMode === 'windows-account') await this.writeDocumentAtomic(makeWindowsAccountDocument(records));
    else await this.writeDocumentAtomic(makeMasterPasswordDocument(records, this.requireStoredSalt(), this.requireMasterSentinel(),
      this.failedUnlocks, this.blockedUntil));
  }

  private async writeDocumentAtomic(document: StoredDocument): Promise<void> {
    const temporary = await this.writeTemporaryDocument(document);
    try { await rename(temporary, this.filePath); }
    catch {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw new SecretVaultError('unavailable');
    }
  }

  private async writeTemporaryDocument(document: StoredDocument): Promise<string> {
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
      return temporary;
    } catch {
      if (handle) await handle.close().catch(() => undefined);
      await rm(temporary, { force: true }).catch(() => undefined);
      throw new SecretVaultError('unavailable');
    }
  }

  private async readDocumentAt(path: string): Promise<DecodedDocument> {
    let fileStat;
    try { fileStat = await stat(path); }
    catch (error) {
      if (hasNodeCode(error, 'ENOENT') && path === this.filePath) return emptyDocument();
      throw error;
    }
    if (!fileStat.isFile() || fileStat.size > MAX_FILE_BYTES) throw new SecretVaultError('corrupt');
    const handle = await open(path, 'r');
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
    } finally { await handle.close(); }
    let value: unknown;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; }
    catch { throw new SecretVaultError('corrupt'); }
    return decodeDocument(value);
  }

  private requireStoredSalt(): string {
    if (!this.masterSalt) throw new SecretVaultError('corrupt');
    return this.masterSalt;
  }
}

function makeWindowsAccountDocument(records: Map<string, StoredEntry>): WindowsAccountDocument {
  const entries: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [reference, stored] of records) {
    if (typeof stored !== 'string') throw new SecretVaultError('corrupt');
    entries[reference] = stored;
  }
  return { version: DOCUMENT_VERSION, mode: 'windows-account', entries };
}

function makeMasterPasswordDocument(records: Map<string, StoredEntry>, salt: string, sentinel: MasterPasswordEnvelope,
  failedUnlocks: number, blockedUntil: number): MasterPasswordDocument {
  const entries: Record<string, MasterPasswordEnvelope> = Object.create(null) as Record<string, MasterPasswordEnvelope>;
  for (const [reference, stored] of records) {
    if (!isMasterPasswordEnvelope(stored)) throw new SecretVaultError('corrupt');
    entries[reference] = stored;
  }
  return { version: DOCUMENT_VERSION, mode: 'master-password', profile: MASTER_PASSWORD_PROFILE, salt, sentinel,
    failedUnlocks, blockedUntil, entries };
}

function emptyDocument(): DecodedDocument {
  return { mode: 'windows-account', records: new Map(), failedUnlocks: 0, blockedUntil: 0 };
}

function decodeDocument(input: unknown): DecodedDocument {
  if (!isRecord(input) || !isRecord(input.entries)) throw new SecretVaultError('corrupt');
  if (input.version === LEGACY_DOCUMENT_VERSION && Object.keys(input).length === 2) {
    return { mode: 'windows-account', records: decodeWindowsEntries(input.entries), failedUnlocks: 0, blockedUntil: 0 };
  }
  if (input.version !== DOCUMENT_VERSION) throw new SecretVaultError('corrupt');
  if (input.mode === 'windows-account' && Object.keys(input).length === 3) {
    return { mode: 'windows-account', records: decodeWindowsEntries(input.entries), failedUnlocks: 0, blockedUntil: 0 };
  }
  if (input.mode === 'master-password' && Object.keys(input).length === 8 && isMasterPasswordProfile(input.profile) &&
      isCanonicalBase64(input.salt, MASTER_PASSWORD_PROFILE.saltLength) && isMasterPasswordEnvelope(input.sentinel) &&
      Number.isSafeInteger(input.failedUnlocks) && (input.failedUnlocks as number) >= 0 && (input.failedUnlocks as number) <= MAX_FAILURE_COUNT &&
      Number.isSafeInteger(input.blockedUntil) && (input.blockedUntil as number) >= 0 && isRecord(input.entries)) {
    return { mode: 'master-password', records: decodeMasterEntries(input.entries), salt: input.salt,
      sentinel: input.sentinel, failedUnlocks: input.failedUnlocks as number, blockedUntil: input.blockedUntil as number };
  }
  throw new SecretVaultError('corrupt');
}

function decodeWindowsEntries(entries: Record<string, unknown>): Map<string, StoredEntry> {
  const records = new Map<string, StoredEntry>();
  for (const [reference, ciphertext] of Object.entries(entries)) {
    if (!parseCredentialReference(reference) || typeof ciphertext !== 'string') throw new SecretVaultError('corrupt');
    decodeCiphertext(ciphertext);
    records.set(reference, ciphertext);
  }
  return records;
}

function decodeMasterEntries(entries: Record<string, unknown>): Map<string, StoredEntry> {
  const records = new Map<string, StoredEntry>();
  for (const [reference, envelope] of Object.entries(entries)) {
    if (!parseCredentialReference(reference) || !isMasterPasswordEnvelope(envelope)) throw new SecretVaultError('corrupt');
    records.set(reference, envelope);
  }
  return records;
}

function encodeCredential(reference: CredentialReference, secret: string): string {
  return JSON.stringify({ version: 1, reference, secret });
}

function decodeCredential(reference: CredentialReference, plaintext: string): string {
  let value: unknown;
  try { value = JSON.parse(plaintext) as unknown; }
  catch { throw new SecretVaultError('corrupt'); }
  if (!isRecord(value) || Object.keys(value).length !== 3 || value.version !== 1 ||
      value.reference !== reference || !isCredentialSecret(value.secret)) throw new SecretVaultError('corrupt');
  return value.secret;
}

function isValidMasterPassword(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) return false;
  const bytes = Buffer.from(value, 'utf8');
  try { return bytes.byteLength <= 1024 && new TextDecoder('utf-8', { fatal: true }).decode(bytes) === value; }
  catch { return false; }
  finally { bytes.fill(0); }
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
    decoded.fill(0);
    throw new SecretVaultError('corrupt');
  }
  return decoded;
}

function decodeUtf8(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new SecretVaultError('corrupt'); }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasNodeCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
