import type { CredentialReference } from '../../domain/src/credentials.ts';

export type SecretVaultState = 'uninitialized' | 'available' | 'locked' | 'unavailable';
export type SecretVaultMode = 'windows-account' | 'master-password';
export interface SecretVaultSnapshot {
  readonly state: SecretVaultState;
  readonly mode: SecretVaultMode;
}
export type SecretVaultErrorKind = 'busy' | 'corrupt' | 'invalid-input' | 'locked' | 'not-found' | 'password-rejected' | 'timeout' | 'unavailable';

export class SecretVaultError extends Error {
  readonly kind: SecretVaultErrorKind;

  constructor(kind: SecretVaultErrorKind) {
    super('Credential vault operation failed');
    this.name = 'SecretVaultError';
    this.kind = kind;
  }
}

export interface SecretVault {
  readonly state: SecretVaultState;
  readonly mode: SecretVaultMode;
  initialize(): Promise<void>;
  store(reference: CredentialReference, secret: string): Promise<void>;
  resolveForOperation(reference: CredentialReference): Promise<string>;
  delete(reference: CredentialReference): Promise<boolean>;
  reset(): Promise<void>;
  lock(): void;
  unlock(masterPassword?: string): Promise<void>;
  enableMasterPassword(masterPassword: string): Promise<void>;
  disableMasterPassword(masterPassword: string): Promise<void>;
}
