export type SshCredentialPromptCategory = 'password' | 'key-passphrase' | 'agent-username';
export type SshSessionLogFailurePhase = 'preflight' | 'credential-prompt' | 'host-trust' | 'authentication' | 'transport';
export const SSH_TRANSPORT_NETWORK_FAILURES = ['DNS_LOOKUP_FAILED', 'DNS_TEMPORARY_FAILURE', 'CONNECTION_REFUSED', 'CONNECTION_RESET',
  'CONNECTION_TIMEOUT', 'NETWORK_UNREACHABLE', 'HOST_UNREACHABLE', 'LOCAL_ADDRESS_UNAVAILABLE'] as const;
export type SshTransportNetworkFailure = typeof SSH_TRANSPORT_NETWORK_FAILURES[number];

export function isSshTransportNetworkFailure(value: unknown): value is SshTransportNetworkFailure {
  return typeof value === 'string' && SSH_TRANSPORT_NETWORK_FAILURES.includes(value as SshTransportNetworkFailure);
}

export type SshSessionActivity =
  | { readonly type: 'credential-prompt-started'; readonly sessionId: string; readonly category: SshCredentialPromptCategory }
  | { readonly type: 'credential-prompt-finished'; readonly sessionId: string; readonly category: SshCredentialPromptCategory;
      readonly outcome: 'provided' | 'cancelled' | 'unavailable' | 'timeout' }
  | { readonly type: 'host-trust'; readonly sessionId: string; readonly host: string; readonly port: number;
      readonly outcome: 'trusted' | 'approved' | 'rejected' | 'changed' | 'expired' | 'unavailable' }
  | { readonly type: 'transport'; readonly sessionId: string; readonly outcome: 'started' | 'ready' | 'failed'; readonly code?: string;
      readonly networkFailure?: SshTransportNetworkFailure }
  | { readonly type: 'terminal-input'; readonly sessionId: string; readonly data: string }
  | { readonly type: 'terminal-output'; readonly sessionId: string; readonly sequence: number; readonly data: string }
  | { readonly type: 'terminal-resize'; readonly sessionId: string; readonly columns: number; readonly rows: number }
  | { readonly type: 'connection-failed'; readonly sessionId: string; readonly phase: SshSessionLogFailurePhase; readonly code: string }
  | { readonly type: 'session-closed'; readonly sessionId: string }
  | { readonly type: 'session-exited'; readonly sessionId: string; readonly exitCode: number };

export type SshSessionLogFinishReason = 'connection-failed' | 'session-closed' | 'session-exited' | 'application-shutdown' |
  'file-size-limit' | 'queue-limit' | 'record-limit' | 'write-error';
export type SshSessionLogStopReason = Extract<SshSessionLogFinishReason, 'file-size-limit' | 'queue-limit' | 'record-limit' | 'write-error'>;

export type SshSessionLogStatus =
  | { readonly sessionId: string; readonly status: 'finished'; readonly reason: Extract<SshSessionLogFinishReason,
      'connection-failed' | 'session-closed' | 'session-exited' | 'application-shutdown'>; readonly fileName: string }
  | { readonly sessionId: string; readonly status: 'stopped'; readonly reason: Extract<SshSessionLogFinishReason,
      'file-size-limit' | 'queue-limit' | 'record-limit' | 'write-error'>; readonly fileName: string };
