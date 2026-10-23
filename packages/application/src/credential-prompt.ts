export type CredentialPromptPurpose = 'ssh-password' | 'ssh-key-passphrase' | 'master-password';

export type CredentialPromptResult =
  | { readonly kind: 'provided'; readonly username: string; readonly secret: string }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'timeout' };

export interface CredentialPromptCancellation {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void, options?: { readonly once?: boolean }): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

export interface CredentialPrompt {
  prompt(purpose: CredentialPromptPurpose, signal?: CredentialPromptCancellation): Promise<CredentialPromptResult>;
}
