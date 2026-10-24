import type { CancellationSignal } from './cancellation.ts';

export type CredentialPromptPurpose = 'ssh-password' | 'ssh-key-passphrase' | 'ftp-account' | 'master-password';

export type CredentialPromptResult =
  | { readonly kind: 'provided'; readonly username: string; readonly secret: string }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'timeout' };

export type CredentialPromptCancellation = CancellationSignal;

export interface CredentialPrompt {
  prompt(purpose: CredentialPromptPurpose, signal?: CredentialPromptCancellation): Promise<CredentialPromptResult>;
}
