import type { CredentialReference } from '../../domain/src/credentials.ts';

export type SecretVaultState = 'uninitialized' | 'available' | 'locked' | 'unavailable';
export type SecretVaultErrorKind = 'busy' | 'corrupt' | 'invalid-input' | 'locked' | 'not-found' | 'unavailable';

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
  initialize(): Promise<void>;
  store(reference: CredentialReference, secret: string): Promise<void>;
  resolveForOperation(reference: CredentialReference): Promise<string>;
  delete(reference: CredentialReference): Promise<boolean>;
  reset(): Promise<void>;
  lock(): void;
  unlock(): Promise<void>;
}
