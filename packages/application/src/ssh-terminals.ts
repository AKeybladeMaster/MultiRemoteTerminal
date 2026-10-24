import type { CredentialPrompt, CredentialPromptCancellation } from './credential-prompt.ts';
import type { HostKeyEvidence, SshHostEndpoint } from '../../domain/src/host-trust.ts';
import { canonicalizeSshHostEndpoint, isHostKeyEvidence } from '../../domain/src/host-trust.ts';
import { failure } from '../../domain/src/errors.ts';
import type { ErrorCode, Outcome } from '../../domain/src/errors.ts';
import { MAX_QUEUED_TERMINAL_INPUT_CHARS, MAX_TERMINAL_INPUT_CHARS, isTerminalSize } from '../../domain/src/local-terminal.ts';
import type { TerminalSize } from '../../domain/src/local-terminal.ts';
import type { HostKeyChallenge, HostTrustDecision, HostTrustManager } from './host-trust.ts';
import type { LocalTerminalEvent } from './local-terminals.ts';
import type { CancellationSignal } from './cancellation.ts';
import { isRemoteDirectoryListing, isRemotePath } from '../../domain/src/remote-files.ts';
import type { RemoteDirectoryListing } from '../../domain/src/remote-files.ts';

export interface SshTerminalCredentials {
  readonly username: string;
  readonly password: string;
}

export type SshTerminalProviderErrorCode = 'UNAVAILABLE' | 'NOT_SUPPORTED' | 'CANCELLED' | 'TIMEOUT' | 'BUSY' | 'OUTPUT_LIMIT' | 'AUTHENTICATION_FAILED' | 'HOST_KEY_REJECTED' | 'HOST_KEY_CHANGED';

export class SshTerminalProviderError extends Error {
  readonly code: SshTerminalProviderErrorCode;

  constructor(code: SshTerminalProviderErrorCode) {
    super('SSH terminal operation failed');
    this.name = 'SshTerminalProviderError';
    this.code = code;
  }
}

export interface SshTerminalProvider {
  open(
    sessionId: string,
    endpoint: SshHostEndpoint,
    credentials: SshTerminalCredentials,
    size: TerminalSize,
    verifyHost: (evidence: HostKeyEvidence) => Promise<boolean>,
  ): Promise<void>;
  write(sessionId: string, data: string): Promise<void>;
  resize(sessionId: string, size: TerminalSize): Promise<void>;
  acknowledgeOutput(sessionId: string, sequence: number): Promise<void>;
  listRemoteDirectory(sessionId: string, path: string, cancellation?: CancellationSignal): Promise<RemoteDirectoryListing>;
  close(sessionId: string): Promise<void>;
  shutdown(): Promise<void>;
  subscribe(listener: (event: LocalTerminalEvent) => void): () => void;
}

export interface SshTerminalSession {
  readonly sessionId: string;
  readonly endpoint: SshHostEndpoint;
  readonly state: 'starting' | 'running' | 'exited' | 'failed' | 'closing';
}

export type SshTrustEvent =
  | { readonly kind: 'challenge'; readonly sessionId: string; readonly challenge: HostKeyChallenge }
  | { readonly kind: 'changed'; readonly sessionId: string; readonly host: string; readonly port: number; readonly algorithm: string; readonly fingerprint: string };

export interface SshTerminalController {
  open(sessionId: string, host: string, port: number, size: TerminalSize): Promise<Outcome<SshTerminalSession>>;
  write(sessionId: string, data: string): Promise<Outcome<Record<string, never>>>;
  resize(sessionId: string, size: TerminalSize): Promise<Outcome<Record<string, never>>>;
  acknowledgeOutput(sessionId: string, sequence: number): Promise<Outcome<Record<string, never>>>;
  listRemoteDirectory(sessionId: string, path: string, cancellation?: CancellationSignal): Promise<Outcome<RemoteDirectoryListing>>;
  close(sessionId: string): Promise<Outcome<Record<string, never>>>;
  approveHostKey(token: string): Promise<Outcome<Record<string, never>>>;
  rejectHostKey(token: string): Outcome<Record<string, never>>;
  revokeHostKey(host: string, port: number): Promise<Outcome<Record<string, never>>>;
  closeAll(): Promise<void>;
  subscribe(listener: (event: LocalTerminalEvent) => void): () => void;
  subscribeTrust(listener: (event: SshTrustEvent) => void): () => void;
  dispose(): Promise<void>;
}

interface SessionState {
  readonly sessionId: string;
  readonly endpoint: SshHostEndpoint;
  readonly cancellation: CancellationSource;
  state: SshTerminalSession['state'];
  pendingInputChars: number;
  pendingEvents: LocalTerminalEvent[];
  failureCode?: 'HOST_KEY_REJECTED' | 'HOST_KEY_CHANGED' | 'TIMEOUT';
}

interface CancellationSource {
  readonly token: CredentialPromptCancellation;
  cancel(): void;
}

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_QUEUED_OPEN_EVENTS = 64;
const EMPTY_RESULT: Record<string, never> = Object.freeze({});

function createCancellationSource(): CancellationSource {
  let aborted = false;
  const listeners = new Set<() => void>();
  const token: CredentialPromptCancellation = Object.freeze({
    get aborted() { return aborted; },
    addEventListener(_type: 'abort', listener: () => void, options?: { readonly once?: boolean }) {
      if (aborted) { listener(); return; }
      if (options?.once) listeners.add(listener);
      else listeners.add(listener);
    },
    removeEventListener(_type: 'abort', listener: () => void) { listeners.delete(listener); }
  });
  return Object.freeze({
    token,
    cancel() {
      if (aborted) return;
      aborted = true;
      for (const listener of [...listeners]) {
        listeners.delete(listener);
        try { listener(); } catch { /* Cancellation must continue to other observers. */ }
      }
    }
  });
}

export function createSshTerminalController(
  provider: SshTerminalProvider,
  credentialPrompt: CredentialPrompt,
  hostTrust: HostTrustManager,
): SshTerminalController {
  const sessions = new Map<string, SessionState>();
  const trustTokensBySession = new Map<string, Set<string>>();
  const sessionByTrustToken = new Map<string, string>();
  const terminalListeners = new Set<(event: LocalTerminalEvent) => void>();
  const trustListeners = new Set<(event: SshTrustEvent) => void>();
  let shutdownPromise: Promise<void> | undefined;
  let disposed = false;

  const stopListening = provider.subscribe(event => {
    const session = sessions.get(event.sessionId);
    if (!session || session.state === 'closing') return;
    if (session.state === 'starting') {
      if (session.pendingEvents.length >= MAX_QUEUED_OPEN_EVENTS) {
        session.cancellation.cancel();
        void provider.close(session.sessionId).catch(() => undefined);
        session.pendingEvents.length = 0;
        publishTerminal({ kind: 'failure', sessionId: session.sessionId, error: failure('OUTPUT_LIMIT', 'terminal').error });
      } else session.pendingEvents.push(event);
      return;
    }
    if (event.kind === 'exit') session.state = 'exited';
    if (event.kind === 'failure') session.state = 'failed';
    publishTerminal(event);
  });

  function publishTerminal(event: LocalTerminalEvent): void {
    for (const listener of terminalListeners) {
      try { listener(event); } catch { /* A UI subscriber cannot interrupt transport cleanup. */ }
    }
  }

  function publishTrust(event: SshTrustEvent): void {
    for (const listener of trustListeners) {
      try { listener(event); } catch { /* A UI subscriber cannot hold the SSH handshake open. */ }
    }
  }

  function dropTrustToken(sessionId: string, token: string): void {
    sessionByTrustToken.delete(token);
    const tokens = trustTokensBySession.get(sessionId);
    tokens?.delete(token);
    if (tokens?.size === 0) trustTokensBySession.delete(sessionId);
  }

  function failOpen(session: SessionState, code: ErrorCode) {
    if (sessions.get(session.sessionId) === session) sessions.delete(session.sessionId);
    session.state = 'failed';
    session.pendingEvents.length = 0;
    return failure(code, 'terminal');
  }

  async function verifyHost(session: SessionState, evidence: HostKeyEvidence): Promise<boolean> {
    if (session.cancellation.token.aborted || sessions.get(session.sessionId) !== session || !isHostKeyEvidence(evidence)) return false;
    let inspected: Outcome<HostTrustDecision>;
    try { inspected = await hostTrust.inspect(session.endpoint, evidence, session.cancellation.token); }
    catch { return false; }
    if (!inspected.ok) return false;
    const decision = inspected.result;
    if (decision.kind === 'trusted' || decision.kind === 'approved') return true;
    if (decision.kind === 'rejected') return false;
    if (decision.kind === 'changed') {
      session.failureCode = 'HOST_KEY_CHANGED';
      publishTrust({ kind: 'changed', sessionId: session.sessionId, host: decision.host, port: decision.port,
        algorithm: decision.algorithm, fingerprint: decision.fingerprint });
      return false;
    }

    const { challenge } = decision;
    const tokens = trustTokensBySession.get(session.sessionId) ?? new Set<string>();
    tokens.add(challenge.token);
    trustTokensBySession.set(session.sessionId, tokens);
    sessionByTrustToken.set(challenge.token, session.sessionId);
    publishTrust({ kind: 'challenge', sessionId: session.sessionId, challenge });
    const resolution = await hostTrust.waitForResolution(challenge.token);
    dropTrustToken(session.sessionId, challenge.token);
    if (resolution === 'rejected' || resolution === 'cancelled') session.failureCode = 'HOST_KEY_REJECTED';
    else if (resolution === 'expired') session.failureCode = 'TIMEOUT';
    return resolution === 'approved' && !session.cancellation.token.aborted && sessions.get(session.sessionId) === session;
  }

  async function open(sessionId: string, host: string, port: number, size: TerminalSize): Promise<Outcome<SshTerminalSession>> {
    if (disposed) return failure('CANCELLED', 'terminal');
    if (shutdownPromise) return failure('BUSY', 'terminal');
    const endpoint = canonicalizeSshHostEndpoint({ host, port });
    if (!SESSION_ID.test(sessionId) || !endpoint || !isTerminalSize(size) || sessions.has(sessionId)) return failure('INVALID_REQUEST');
    const session: SessionState = { sessionId, endpoint, cancellation: createCancellationSource(), state: 'starting', pendingInputChars: 0, pendingEvents: [] };
    sessions.set(sessionId, session);

    let username = '';
    let password = '';
    try {
      const credential = await credentialPrompt.prompt('ssh-password', session.cancellation.token);
      if (session.cancellation.token.aborted || sessions.get(sessionId) !== session) return failOpen(session, 'CANCELLED');
      if (credential.kind === 'cancelled') return failOpen(session, 'CANCELLED');
      if (credential.kind !== 'provided') return failOpen(session, credential.kind === 'timeout' ? 'TIMEOUT' : 'UNAVAILABLE');
      username = credential.username;
      password = credential.secret;
      if (username.length === 0 || username.trim() !== username || username.includes('\0') || password.includes('\0')) return failOpen(session, 'INVALID_REQUEST');

      await provider.open(sessionId, endpoint, { username, password }, size, evidence => verifyHost(session, evidence));
      if (session.cancellation.token.aborted || sessions.get(sessionId) !== session || session.state === 'closing') {
        await provider.close(sessionId).catch(() => undefined);
        return failOpen(session, 'CANCELLED');
      }
      if (session.state === 'starting') session.state = 'running';
      for (const event of session.pendingEvents.splice(0)) {
        if (event.kind === 'exit') session.state = 'exited';
        if (event.kind === 'failure') session.state = 'failed';
        publishTerminal(event);
      }
      return { ok: true, result: { sessionId, endpoint, state: session.state } };
    } catch (error) {
      if (sessions.get(sessionId) === session) await provider.close(sessionId).catch(() => undefined);
      for (const token of trustTokensBySession.get(sessionId) ?? []) hostTrust.reject(token);
      const providerCode = error instanceof SshTerminalProviderError ? error.code : undefined;
      return failOpen(session, session.cancellation.token.aborted ? 'CANCELLED' : session.failureCode ?? providerCode ?? 'UNAVAILABLE');
    } finally {
      username = '';
      password = '';
    }
  }

  async function write(sessionId: string, data: string): Promise<Outcome<Record<string, never>>> {
    const session = sessions.get(sessionId);
    if (!session || session.state !== 'running') return failure('NOT_FOUND', 'terminal');
    if (typeof data !== 'string' || data.length > MAX_TERMINAL_INPUT_CHARS) return failure('INVALID_REQUEST');
    if (session.pendingInputChars + data.length > MAX_QUEUED_TERMINAL_INPUT_CHARS) return failure('BUSY', 'terminal');
    if (data.length === 0) return { ok: true, result: EMPTY_RESULT };
    session.pendingInputChars += data.length;
    try {
      await provider.write(sessionId, data);
      return { ok: true, result: EMPTY_RESULT };
    } catch { return failure('UNAVAILABLE', 'terminal'); }
    finally { session.pendingInputChars -= data.length; }
  }

  async function resize(sessionId: string, size: TerminalSize): Promise<Outcome<Record<string, never>>> {
    const session = sessions.get(sessionId);
    if (!session || session.state !== 'running') return failure('NOT_FOUND', 'terminal');
    if (!isTerminalSize(size)) return failure('INVALID_REQUEST');
    try { await provider.resize(sessionId, size); return { ok: true, result: EMPTY_RESULT }; }
    catch { return failure('UNAVAILABLE', 'terminal'); }
  }

  async function acknowledgeOutput(sessionId: string, sequence: number): Promise<Outcome<Record<string, never>>> {
    if (!sessions.has(sessionId) || !Number.isSafeInteger(sequence) || sequence < 1) return failure('NOT_FOUND', 'terminal');
    try { await provider.acknowledgeOutput(sessionId, sequence); return { ok: true, result: EMPTY_RESULT }; }
    catch { return failure('UNAVAILABLE', 'terminal'); }
  }

  async function listRemoteDirectory(sessionId: string, path: string, cancellation?: CancellationSignal): Promise<Outcome<RemoteDirectoryListing>> {
    const session = sessions.get(sessionId);
    if (!session || session.state !== 'running') return failure('NOT_FOUND', 'terminal');
    if (!isRemotePath(path)) return failure('INVALID_REQUEST');
    if (cancellation?.aborted) return failure('CANCELLED', 'terminal');
    try {
      const listing = await provider.listRemoteDirectory(sessionId, path, cancellation);
      if (cancellation?.aborted) return failure('CANCELLED', 'terminal');
      if (!isRemoteDirectoryListing(listing)) return failure('OUTPUT_LIMIT', 'terminal');
      return { ok: true, result: listing };
    } catch (error) {
      if (cancellation?.aborted || error instanceof SshTerminalProviderError && error.code === 'CANCELLED') return failure('CANCELLED', 'terminal');
      if (error instanceof SshTerminalProviderError && error.code === 'NOT_SUPPORTED') return failure('NOT_SUPPORTED', 'terminal');
      if (error instanceof SshTerminalProviderError && error.code === 'TIMEOUT') return failure('TIMEOUT', 'terminal');
      if (error instanceof SshTerminalProviderError && error.code === 'BUSY') return failure('BUSY', 'terminal');
      return failure('UNAVAILABLE', 'terminal');
    }
  }

  async function close(sessionId: string): Promise<Outcome<Record<string, never>>> {
    const session = sessions.get(sessionId);
    if (!session) return failure('NOT_FOUND', 'terminal');
    session.state = 'closing';
    session.cancellation.cancel();
    sessions.delete(sessionId);
    for (const token of trustTokensBySession.get(sessionId) ?? []) hostTrust.reject(token);
    trustTokensBySession.delete(sessionId);
    for (const [token, owner] of sessionByTrustToken) if (owner === sessionId) sessionByTrustToken.delete(token);
    try { await provider.close(sessionId); return { ok: true, result: EMPTY_RESULT }; }
    catch { return failure('UNAVAILABLE', 'terminal'); }
  }

  return Object.freeze({
    open, write, resize, acknowledgeOutput, listRemoteDirectory, close,
    async approveHostKey(token: string): Promise<Outcome<Record<string, never>>> {
      if (!sessionByTrustToken.has(token)) return failure('NOT_FOUND');
      const approved = await hostTrust.approve(token);
      return approved.ok ? { ok: true, result: EMPTY_RESULT } : { ok: false, error: approved.error };
    },
    rejectHostKey(token: string): Outcome<Record<string, never>> {
      if (!sessionByTrustToken.has(token)) return failure('NOT_FOUND');
      const rejected = hostTrust.reject(token);
      return rejected.ok ? { ok: true, result: EMPTY_RESULT } : { ok: false, error: rejected.error };
    },
    async revokeHostKey(host: string, port: number): Promise<Outcome<Record<string, never>>> {
      const endpoint = canonicalizeSshHostEndpoint({ host, port });
      if (!endpoint) return failure('INVALID_REQUEST');
      return hostTrust.revoke(endpoint);
    },
    async closeAll() {
      if (shutdownPromise) return shutdownPromise;
      for (const session of sessions.values()) {
        session.state = 'closing';
        session.cancellation.cancel();
      }
      for (const tokens of trustTokensBySession.values()) for (const token of tokens) hostTrust.reject(token);
      sessions.clear();
      trustTokensBySession.clear();
      sessionByTrustToken.clear();
      const shuttingDown = provider.shutdown();
      shutdownPromise = shuttingDown;
      try { await shuttingDown; } finally { if (shutdownPromise === shuttingDown) shutdownPromise = undefined; }
    },
    subscribe(listener: (event: LocalTerminalEvent) => void) {
      terminalListeners.add(listener);
      return () => terminalListeners.delete(listener);
    },
    subscribeTrust(listener: (event: SshTrustEvent) => void) {
      trustListeners.add(listener);
      return () => trustListeners.delete(listener);
    },
    async dispose() {
      disposed = true;
      await this.closeAll().catch(() => undefined);
      hostTrust.dispose();
      stopListening();
      terminalListeners.clear();
      trustListeners.clear();
    }
  });
}
