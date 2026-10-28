import { failure } from '../../domain/src/errors.ts';
import type { ErrorCode, Outcome } from '../../domain/src/errors.ts';
import { canonicalizeSshHostEndpoint } from '../../domain/src/host-trust.ts';
import type { CredentialReference } from '../../domain/src/credentials.ts';
import { isCredentialSecret, MAX_CREDENTIAL_SECRET_LENGTH, parseCredentialReference } from '../../domain/src/credentials.ts';
import type { SavedSessionDefinition } from '../../domain/src/session-definition.ts';
import { isSessionDefinitionId } from '../../domain/src/session-definition.ts';
import type { CancellationSignal } from './cancellation.ts';
import type { CredentialPrompt, CredentialPromptCancellation } from './credential-prompt.ts';
import type { SecretVault } from './secret-vault.ts';
import { SecretVaultError } from './secret-vault.ts';
import { storageOperationErrorCode } from './storage-errors.ts';

export const MAX_SSH_CREDENTIAL_BUNDLE_BYTES = 16 * 1024 * 1024;
export const MAX_SSH_CREDENTIAL_BUNDLE_PLAINTEXT_BYTES = 10 * 1024 * 1024;
export const MAX_SSH_CREDENTIAL_BUNDLE_ENTRIES = 10_000;
const EMPTY_RESULT = Object.freeze({ credentialCount: 0 });
const NEVER_CANCELLED: CredentialPromptCancellation = Object.freeze({
  aborted: false,
  addEventListener() {},
  removeEventListener() {}
});

export interface SshCredentialBundleEntry {
  readonly sessionId: string;
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly password: string;
}

export interface SshCredentialBundleProfile {
  readonly profile: Extract<SavedSessionDefinition, { readonly kind: 'ssh' }>;
  readonly reference: CredentialReference;
}

export interface ImportedSshCredentialReference {
  readonly sessionId: string;
  readonly host: string;
  readonly port: number;
  readonly reference: CredentialReference;
}

export interface SshCredentialBundleStore {
  listSshCredentials(cancellation?: CancellationSignal): Promise<readonly SshCredentialBundleProfile[]>;
  attachImportedSshCredentials(credentials: readonly ImportedSshCredentialReference[], cancellation?: CancellationSignal): Promise<boolean>;
  readEncryptedSshCredentialBundle(path: string, cancellation?: CancellationSignal): Promise<Uint8Array>;
  writeEncryptedSshCredentialBundle(path: string, contents: Uint8Array, cancellation?: CancellationSignal): Promise<void>;
}

export interface SshCredentialBundleDialog {
  selectExportPath(): Promise<string | undefined>;
  selectImportPath(): Promise<string | undefined>;
}

export interface SshCredentialBundleCodec {
  encrypt(plaintext: string, passphrase: string, cancellation?: CancellationSignal): Promise<Uint8Array>;
  decrypt(contents: Uint8Array, passphrase: string, cancellation?: CancellationSignal): Promise<string>;
}

export class SshCredentialBundleError extends Error {
  readonly kind: 'corrupt' | 'invalid' | 'cancelled' | 'timeout' | 'unavailable';
  constructor(kind: SshCredentialBundleError['kind']) {
    super('Encrypted SSH credential bundle operation failed');
    this.name = 'SshCredentialBundleError';
    this.kind = kind;
  }
}

export interface SshCredentialBundleManager {
  export(cancellation?: CancellationSignal): Promise<Outcome<{ readonly credentialCount: number }>>;
  import(cancellation?: CancellationSignal): Promise<Outcome<{ readonly credentialCount: number }>>;
}

export function createSshCredentialBundleManager(store: SshCredentialBundleStore, dialog: SshCredentialBundleDialog,
  prompt: CredentialPrompt, vault: SecretVault, codec: SshCredentialBundleCodec, createReference: () => string): SshCredentialBundleManager {
  return {
    async export(cancellation) {
      if (vault.state !== 'available') return failure('LOCKED');
      if (cancellation?.aborted) return failure('CANCELLED');
      let plaintext: string | undefined;
      let encrypted: Uint8Array | undefined;
      try {
        const saved = await store.listSshCredentials(cancellation);
        if (saved.length === 0) return { ok: true, result: EMPTY_RESULT };
        if (saved.length > MAX_SSH_CREDENTIAL_BUNDLE_ENTRIES) return failure('OUTPUT_LIMIT');
        const path = await dialog.selectExportPath();
        if (!path || cancellation?.aborted) return failure('CANCELLED');
        const passphrase = await requestPassphrase(prompt, cancellation, 'Enter a strong, unique passphrase to protect this credential bundle.');
        if (!passphrase.ok) return passphrase;
        const confirmation = await requestPassphrase(prompt, cancellation, 'Enter the same bundle passphrase again to confirm it.');
        if (!confirmation.ok) return confirmation;
        if (passphrase.result !== confirmation.result) return failure('CONFLICT');

        const prefix = '{"version":1,"credentials":[';
        const serializedCredentials: string[] = [];
        let plaintextLength = utf8ByteLength(prefix) + 2;
        for (const item of saved) {
          if (cancellation?.aborted) return failure('CANCELLED');
          if (vault.state !== 'available') return failure('LOCKED');
          const parsed = parseStoredCredential(await vault.resolveForOperation(item.reference));
          if (!parsed) return failure('CORRUPT');
          const entry = JSON.stringify({ sessionId: item.profile.id, host: item.profile.host, port: item.profile.port,
            username: parsed.username, password: parsed.password } satisfies SshCredentialBundleEntry);
          plaintextLength += utf8ByteLength(entry) + (serializedCredentials.length === 0 ? 0 : 1);
          if (plaintextLength > MAX_SSH_CREDENTIAL_BUNDLE_PLAINTEXT_BYTES) return failure('OUTPUT_LIMIT');
          serializedCredentials.push(entry);
        }
        plaintext = `${prefix}${serializedCredentials.join(',')}]}`;
        encrypted = await codec.encrypt(plaintext, passphrase.result, cancellation);
        if (encrypted.byteLength > MAX_SSH_CREDENTIAL_BUNDLE_BYTES) return failure('OUTPUT_LIMIT');
        if (cancellation?.aborted) return failure('CANCELLED');
        if (vault.state !== 'available') return failure('LOCKED');
        await store.writeEncryptedSshCredentialBundle(path, encrypted, cancellation);
        return { ok: true, result: { credentialCount: serializedCredentials.length } };
      } catch (error) { return failure(errorCode(error)); }
      finally { encrypted?.fill(0); }
    },
    async import(cancellation) {
      if (vault.state !== 'available') return failure('LOCKED');
      if (cancellation?.aborted) return failure('CANCELLED');
      let encrypted: Uint8Array | undefined;
      let plaintext: string | undefined;
      const storedReferences: CredentialReference[] = [];
      try {
        const path = await dialog.selectImportPath();
        if (!path || cancellation?.aborted) return failure('CANCELLED');
        const passphrase = await requestPassphrase(prompt, cancellation, 'Enter the passphrase for this encrypted credential bundle.');
        if (!passphrase.ok) return passphrase;
        encrypted = await store.readEncryptedSshCredentialBundle(path, cancellation);
        if (encrypted.byteLength > MAX_SSH_CREDENTIAL_BUNDLE_BYTES) return failure('OUTPUT_LIMIT');
        plaintext = await codec.decrypt(encrypted, passphrase.result, cancellation);
        if (utf8ByteLength(plaintext) > MAX_SSH_CREDENTIAL_BUNDLE_PLAINTEXT_BYTES) return failure('OUTPUT_LIMIT');
        const credentials = parseBundle(plaintext);
        if (!credentials) return failure('CORRUPT');
        if (credentials.length === 0) return failure('CORRUPT');

        const references: ImportedSshCredentialReference[] = [];
        for (const credential of credentials) {
          if (cancellation?.aborted) throw new SshCredentialBundleError('cancelled');
          if (vault.state !== 'available') throw new SecretVaultError('locked');
          const reference = parseCredentialReference(createReference());
          if (!reference || storedReferences.includes(reference)) throw new SshCredentialBundleError('unavailable');
          await vault.store(reference, JSON.stringify({ username: credential.username, password: credential.password }));
          storedReferences.push(reference);
          references.push({ sessionId: credential.sessionId, host: credential.host, port: credential.port, reference });
        }
        if (cancellation?.aborted) throw new SshCredentialBundleError('cancelled');
        if (vault.state !== 'available') throw new SecretVaultError('locked');
        const attached = await store.attachImportedSshCredentials(references, cancellation);
        if (!attached) {
          await deleteStoredReferences(vault, storedReferences);
          storedReferences.length = 0;
          return failure('CONFLICT');
        }
        return { ok: true, result: { credentialCount: credentials.length } };
      } catch (error) {
        if (storedReferences.length && !isAmbiguousStorageFailure(error)) await deleteStoredReferences(vault, storedReferences);
        return failure(errorCode(error));
      } finally { encrypted?.fill(0); }
    }
  };
}

async function requestPassphrase(prompt: CredentialPrompt, cancellation: CancellationSignal | undefined, context: string): Promise<
  { readonly ok: true; readonly result: string } | ReturnType<typeof failure>> {
  const result = await prompt.prompt('credential-bundle-passphrase', cancellation ?? NEVER_CANCELLED, context);
  if (cancellation?.aborted || result.kind === 'cancelled') return failure('CANCELLED');
  if (result.kind === 'timeout') return failure('TIMEOUT');
  if (result.kind !== 'provided') return failure('UNAVAILABLE');
  const valid = utf8ByteLength(result.secret) > 0 && utf8ByteLength(result.secret) <= 1024 && !result.secret.includes('\0') && isWellFormedString(result.secret);
  return valid ? { ok: true, result: result.secret } : failure('INVALID_REQUEST');
}

function parseBundle(contents: string): readonly SshCredentialBundleEntry[] | undefined {
  let parsed: unknown;
  try { parsed = JSON.parse(contents); }
  catch { return undefined; }
  if (!isRecord(parsed) || !exactKeys(parsed, ['version', 'credentials']) || parsed.version !== 1 ||
      !Array.isArray(parsed.credentials) || parsed.credentials.length > MAX_SSH_CREDENTIAL_BUNDLE_ENTRIES) return undefined;
  const sessionIds = new Set<string>();
  const credentials: SshCredentialBundleEntry[] = [];
  for (const value of parsed.credentials) {
    if (!isRecord(value) || !exactKeys(value, ['sessionId', 'host', 'port', 'username', 'password']) || !isSessionDefinitionId(value.sessionId) ||
        sessionIds.has(value.sessionId) || !isValidCredential(value.username, value.password)) return undefined;
    const endpoint = canonicalizeSshHostEndpoint({ host: value.host, port: value.port });
    if (!endpoint || endpoint.host !== value.host || endpoint.port !== value.port) return undefined;
    sessionIds.add(value.sessionId);
    credentials.push({ sessionId: value.sessionId, ...endpoint, username: value.username, password: value.password as string });
  }
  return credentials;
}

function parseStoredCredential(value: unknown): { readonly username: string; readonly password: string } | undefined {
  if (typeof value !== 'string' || value.length > MAX_CREDENTIAL_SECRET_LENGTH) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(value); }
  catch { return undefined; }
  return isRecord(parsed) && exactKeys(parsed, ['username', 'password']) && isValidCredential(parsed.username, parsed.password)
    ? { username: parsed.username, password: parsed.password as string } : undefined;
}

function isValidCredential(username: unknown, password: unknown): username is string {
  return typeof username === 'string' && username.length > 0 && username.length <= 256 && username.trim() === username &&
    !username.includes('\0') && typeof password === 'string' && isCredentialSecret(password) && !password.includes('\0') &&
    JSON.stringify({ username, password }).length <= MAX_CREDENTIAL_SECRET_LENGTH;
}

async function deleteStoredReferences(vault: SecretVault, references: readonly CredentialReference[]): Promise<void> {
  for (const reference of references) await vault.delete(reference).catch(() => false);
}

function isAmbiguousStorageFailure(error: unknown): boolean {
  return storageOperationErrorCode(error) !== undefined && storageOperationErrorCode(error) !== 'CONFLICT';
}

function errorCode(error: unknown): ErrorCode {
  if (error instanceof SshCredentialBundleError) {
    if (error.kind === 'corrupt') return 'CORRUPT';
    if (error.kind === 'invalid') return 'INVALID_REQUEST';
    if (error.kind === 'cancelled') return 'CANCELLED';
    if (error.kind === 'timeout') return 'TIMEOUT';
  }
  if (error instanceof SecretVaultError) {
    if (error.kind === 'locked') return 'LOCKED';
    if (error.kind === 'busy') return 'BUSY';
    if (error.kind === 'corrupt') return 'CORRUPT';
    if (error.kind === 'invalid-input') return 'INVALID_REQUEST';
    if (error.kind === 'not-found') return 'NOT_FOUND';
    if (error.kind === 'password-rejected') return 'CORRUPT';
    if (error.kind === 'timeout') return 'TIMEOUT';
  }
  const storageCode = storageOperationErrorCode(error);
  if (storageCode === 'CONFLICT') return 'CONFLICT';
  if (storageCode === 'CORRUPT') return 'CORRUPT';
  if (storageCode === 'INVALID_REQUEST') return 'INVALID_REQUEST';
  if (storageCode === 'BUSY') return 'BUSY';
  if (storageCode === 'CANCELLED') return 'CANCELLED';
  return 'UNAVAILABLE';
}

function utf8ByteLength(value: string): number {
  let length = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    length += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return length;
}

function isWellFormedString(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return false;
  }
  return true;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
