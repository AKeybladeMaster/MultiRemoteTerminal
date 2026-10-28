import type { CancellationSignal } from './cancellation.ts';

export type CredentialPromptPurpose = 'ssh-password' | 'ssh-key-passphrase' | 'ssh-agent-username' | 'ftp-account' | 'master-password' | 'credential-bundle-passphrase';

export type CredentialPromptResult =
  | { readonly kind: 'provided'; readonly username: string; readonly secret: string }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'timeout' };

export type CredentialPromptCancellation = CancellationSignal;

export interface CredentialPrompt {
  prompt(purpose: CredentialPromptPurpose, signal?: CredentialPromptCancellation, context?: string): Promise<CredentialPromptResult>;
}
