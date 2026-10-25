import { failure } from '../../domain/src/errors.ts';
import type { ErrorCode, Outcome } from '../../domain/src/errors.ts';
import { canonicalizeSshHostEndpoint } from '../../domain/src/host-trust.ts';
import type { CredentialReference } from '../../domain/src/credentials.ts';
import { isCredentialSecret, MAX_CREDENTIAL_SECRET_LENGTH, parseCredentialReference } from '../../domain/src/credentials.ts';
import type { SavedSessionDefinition } from '../../domain/src/session-definition.ts';
import { isSessionDefinitionId } from '../../domain/src/session-definition.ts';
import type { CancellationSignal } from './cancellation.ts';
import type { CredentialPrompt, CredentialPromptCancellation } from './credential-prompt.ts';
import type { SecretVault, SecretVaultSnapshot } from './secret-vault.ts';
import { SecretVaultError } from './secret-vault.ts';
import { storageOperationErrorCode } from './storage-errors.ts';
import type { SshTerminalCredentials } from './ssh-terminals.ts';

export interface SessionCredentialStore {
  getSessionDefinition(id: string, cancellation?: CancellationSignal): Promise<SavedSessionDefinition | undefined>;
  getSessionCredentialReference(id: string, cancellation?: CancellationSignal): Promise<CredentialReference | undefined>;
  setSessionCredentialReference(id: string, reference: CredentialReference | null, expectedReference: CredentialReference | null,
    cancellation?: CancellationSignal): Promise<boolean>;
  clearAllSessionCredentialReferences(cancellation?: CancellationSignal): Promise<void>;
}

export interface SessionCredentialManager {
  state(): SecretVaultSnapshot;
  lock(): void;
  unlock(): Promise<Outcome<SecretVaultSnapshot>>;
  enableMasterPassword(): Promise<Outcome<SecretVaultSnapshot>>;
  disableMasterPassword(): Promise<Outcome<SecretVaultSnapshot>>;
  resetVault(): Promise<Outcome<SecretVaultSnapshot>>;
  hasSshCredential(sessionId: unknown, cancellation?: CancellationSignal): Promise<Outcome<boolean>>;
  saveSshCredential(sessionId: unknown, cancellation?: CancellationSignal): Promise<Outcome<Record<string, never>>>;
  forgetSshCredential(sessionId: unknown, cancellation?: CancellationSignal): Promise<Outcome<Record<string, never>>>;
  resolveSshCredential(sessionId: unknown, host: unknown, port: unknown,
    cancellation?: CancellationSignal): Promise<Outcome<SshTerminalCredentials | undefined>>;
}

const EMPTY_RESULT: Record<string, never> = Object.freeze({});
const NEVER_CANCELLED: CredentialPromptCancellation = Object.freeze({
  aborted: false,
  addEventListener() {},
  removeEventListener() {}
});

export function createSessionCredentialManager(store: SessionCredentialStore, prompt: CredentialPrompt, vault: SecretVault,
  createReference: () => string): SessionCredentialManager {
  return {
    state: () => ({ state: vault.state, mode: vault.mode }),
    lock: () => vault.lock(),
    async unlock() {
      try {
        let password: string | undefined;
        if (vault.mode === 'master-password' && vault.state !== 'available') {
          const credential = await prompt.prompt('master-password', NEVER_CANCELLED, 'Unlock the saved SSH credential vault.');
          if (credential.kind === 'cancelled') return failure('CANCELLED');
          if (credential.kind !== 'provided') return failure(credential.kind === 'timeout' ? 'TIMEOUT' : 'UNAVAILABLE');
          password = credential.secret;
        }
        await vault.unlock(password);
        return { ok: true, result: { state: vault.state, mode: vault.mode } };
      } catch (error) { return failure(errorCode(error)); }
    },
    async enableMasterPassword() {
      if (vault.mode !== 'windows-account' || vault.state !== 'available') return failure('LOCKED');
      const first = await prompt.prompt('master-password', NEVER_CANCELLED, 'Create a long, unique master password. You will need it to unlock saved credentials.');
      if (first.kind === 'cancelled') return failure('CANCELLED');
      if (first.kind !== 'provided') return failure(first.kind === 'timeout' ? 'TIMEOUT' : 'UNAVAILABLE');
      const confirmation = await prompt.prompt('master-password', NEVER_CANCELLED, 'Enter the same master password again to confirm it.');
      if (confirmation.kind === 'cancelled') return failure('CANCELLED');
      if (confirmation.kind !== 'provided') return failure(confirmation.kind === 'timeout' ? 'TIMEOUT' : 'UNAVAILABLE');
      if (first.secret !== confirmation.secret) return failure('CONFLICT');
      try {
        await vault.enableMasterPassword(first.secret);
        return { ok: true, result: { state: vault.state, mode: vault.mode } };
      } catch (error) { return failure(errorCode(error)); }
    },
    async disableMasterPassword() {
      if (vault.mode !== 'master-password') return failure('INVALID_REQUEST');
      const credential = await prompt.prompt('master-password', NEVER_CANCELLED, 'Confirm the current master password to switch vault protection.');
      if (credential.kind === 'cancelled') return failure('CANCELLED');
      if (credential.kind !== 'provided') return failure(credential.kind === 'timeout' ? 'TIMEOUT' : 'UNAVAILABLE');
      try {
        await vault.disableMasterPassword(credential.secret);
        return { ok: true, result: { state: vault.state, mode: vault.mode } };
      } catch (error) { return failure(errorCode(error)); }
    },
    async resetVault() {
      let vaultReset = false;
      try {
        await vault.reset();
        vaultReset = true;
        await store.clearAllSessionCredentialReferences();
        return { ok: true, result: { state: vault.state, mode: vault.mode } };
      } catch (error) { return failure(vaultReset ? 'CONFLICT' : errorCode(error)); }
    },
    async hasSshCredential(sessionId: unknown, cancellation?: CancellationSignal) {
      if (!isSessionDefinitionId(sessionId)) return failure('INVALID_REQUEST');
      if (cancellation?.aborted) return failure('CANCELLED');
      try {
        const profile = await store.getSessionDefinition(sessionId, cancellation);
        if (!profile) return failure('NOT_FOUND');
        if (profile.kind !== 'ssh') return { ok: true, result: false };
        return { ok: true, result: Boolean(await store.getSessionCredentialReference(sessionId, cancellation)) };
      } catch (error) { return failure(errorCode(error)); }
    },
    async saveSshCredential(sessionId: unknown, cancellation?: CancellationSignal) {
      if (!isSessionDefinitionId(sessionId)) return failure('INVALID_REQUEST');
      if (cancellation?.aborted) return failure('CANCELLED');
      try {
        const profile = await store.getSessionDefinition(sessionId, cancellation);
        if (!profile) return failure('NOT_FOUND');
        if (profile.kind !== 'ssh') return failure('INVALID_REQUEST');
        const existingReference = await store.getSessionCredentialReference(sessionId, cancellation) ?? null;
        if (cancellation?.aborted) return failure('CANCELLED');
        const credential = await prompt.prompt('ssh-password', cancellation ?? NEVER_CANCELLED,
          `Saved SSH profile: ${profile.host}:${profile.port}`);
        if (cancellation?.aborted || credential.kind === 'cancelled') return failure('CANCELLED');
        if (credential.kind !== 'provided') return failure(credential.kind === 'timeout' ? 'TIMEOUT' : 'UNAVAILABLE');
        if (!isValidCredential(credential.username, credential.secret)) return failure('INVALID_REQUEST');
        const serialized = JSON.stringify({ username: credential.username, password: credential.secret });
        if (!isCredentialSecret(serialized)) return failure('OUTPUT_LIMIT');
        const reference = parseCredentialReference(createReference());
        if (!reference || reference === existingReference) return failure('UNAVAILABLE');
        if (cancellation?.aborted) return failure('CANCELLED');
        await vault.store(reference, serialized);
        if (cancellation?.aborted) {
          await vault.delete(reference).catch(() => false);
          return failure('CANCELLED');
        }
        const attached = await store.setSessionCredentialReference(sessionId, reference, existingReference, cancellation);
        if (!attached) {
          await vault.delete(reference).catch(() => false);
          return failure(cancellation?.aborted ? 'CANCELLED' : 'CONFLICT');
        }
        if (existingReference) await vault.delete(existingReference).catch(() => false);
        return { ok: true, result: EMPTY_RESULT };
      } catch (error) { return failure(errorCode(error)); }
    },
    async forgetSshCredential(sessionId: unknown, cancellation?: CancellationSignal) {
      if (!isSessionDefinitionId(sessionId)) return failure('INVALID_REQUEST');
      if (cancellation?.aborted) return failure('CANCELLED');
      try {
        const profile = await store.getSessionDefinition(sessionId, cancellation);
        if (!profile) return failure('NOT_FOUND');
        if (profile.kind !== 'ssh') return { ok: true, result: EMPTY_RESULT };
        const reference = await store.getSessionCredentialReference(sessionId, cancellation);
        if (!reference) return { ok: true, result: EMPTY_RESULT };
        if (cancellation?.aborted) return failure('CANCELLED');
        await vault.delete(reference);
        const detached = await store.setSessionCredentialReference(sessionId, null, reference, cancellation);
        return detached ? { ok: true, result: EMPTY_RESULT } : failure(cancellation?.aborted ? 'CANCELLED' : 'CONFLICT');
      } catch (error) { return failure(errorCode(error)); }
    },
    async resolveSshCredential(sessionId: unknown, host: unknown, port: unknown, cancellation?: CancellationSignal) {
      if (!isSessionDefinitionId(sessionId)) return failure('INVALID_REQUEST');
      if (cancellation?.aborted) return failure('CANCELLED');
      const requestedEndpoint = canonicalizeSshHostEndpoint({ host, port });
      if (!requestedEndpoint) return failure('INVALID_REQUEST');
      try {
        const profile = await store.getSessionDefinition(sessionId, cancellation);
        if (!profile) return failure('NOT_FOUND');
        if (profile.kind !== 'ssh' || profile.host !== requestedEndpoint.host || profile.port !== requestedEndpoint.port) return failure('INVALID_REQUEST');
        let reference = await store.getSessionCredentialReference(sessionId, cancellation);
        for (let retry = 0; retry < 2; retry += 1) {
          if (!reference) return { ok: true, result: undefined };
          if (cancellation?.aborted) return failure('CANCELLED');
          try {
            const serialized = await vault.resolveForOperation(reference);
            const credentials = parseStoredCredential(serialized);
            return credentials ? { ok: true, result: credentials } : failure('CORRUPT');
          } catch (error) {
            if (!(error instanceof SecretVaultError) || error.kind !== 'not-found') throw error;
            const currentReference = await store.getSessionCredentialReference(sessionId, cancellation);
            if (currentReference !== reference) {
              reference = currentReference;
              continue;
            }
            const detached = await store.setSessionCredentialReference(sessionId, null, reference, cancellation);
            if (detached) return { ok: true, result: undefined };
            reference = await store.getSessionCredentialReference(sessionId, cancellation);
          }
        }
        return failure('NOT_FOUND');
      } catch (error) { return failure(errorCode(error)); }
    }
  };
}

function isValidCredential(username: unknown, password: unknown): username is string {
  return typeof username === 'string' && username.length > 0 && username.length <= 256 && username.trim() === username &&
    !username.includes('\0') && typeof password === 'string' && isCredentialSecret(password) && !password.includes('\0') &&
    JSON.stringify({ username, password }).length <= MAX_CREDENTIAL_SECRET_LENGTH;
}

function parseStoredCredential(value: unknown): SshTerminalCredentials | undefined {
  if (typeof value !== 'string' || value.length > MAX_CREDENTIAL_SECRET_LENGTH) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || Object.keys(parsed).length !== 2 || !Object.hasOwn(parsed, 'username') || !Object.hasOwn(parsed, 'password') ||
        !isValidCredential(parsed.username, parsed.password)) return undefined;
    return { username: parsed.username, password: parsed.password as string };
  } catch { return undefined; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown): ErrorCode {
  if (error instanceof SecretVaultError) {
    if (error.kind === 'locked') return 'LOCKED';
    if (error.kind === 'busy') return 'BUSY';
    if (error.kind === 'corrupt') return 'CORRUPT';
    if (error.kind === 'invalid-input') return 'INVALID_REQUEST';
    if (error.kind === 'not-found') return 'NOT_FOUND';
    if (error.kind === 'password-rejected') return 'AUTHENTICATION_FAILED';
    if (error.kind === 'timeout') return 'TIMEOUT';
  }
  return storageOperationErrorCode(error) ?? 'UNAVAILABLE';
}
