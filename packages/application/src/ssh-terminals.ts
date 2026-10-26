import type { CredentialPrompt, CredentialPromptCancellation } from './credential-prompt.ts';
import type { HostKeyEvidence, SshHostEndpoint } from '../../domain/src/host-trust.ts';
import { canonicalizeSshHostEndpoint, hostEndpointKey, isHostKeyEvidence } from '../../domain/src/host-trust.ts';
import { normalizeSshGatewayRoute } from '../../domain/src/ssh-route.ts';
import { failure } from '../../domain/src/errors.ts';
import type { ErrorCode, Outcome } from '../../domain/src/errors.ts';
import { MAX_QUEUED_TERMINAL_INPUT_CHARS, MAX_TERMINAL_INPUT_CHARS, isTerminalSize } from '../../domain/src/local-terminal.ts';
import type { TerminalSize } from '../../domain/src/local-terminal.ts';
import type { HostKeyChallenge, HostTrustDecision, HostTrustManager } from './host-trust.ts';
import type { LocalTerminalEvent } from './local-terminals.ts';
import type { CancellationSignal } from './cancellation.ts';
import { isRemoteDirectoryListing, isRemoteFileName, isRemotePath } from '../../domain/src/remote-files.ts';
import type { RemoteDirectoryListing } from '../../domain/src/remote-files.ts';
import { isFileTransferConflictPolicy, isFileTransferProgress, isFileTransferResult } from '../../domain/src/file-transfer.ts';
import type { FileTransferConflictPolicy, FileTransferProgress, FileTransferResult } from '../../domain/src/file-transfer.ts';
import { isRemoteTextFile, isRemoteTextFileSaveResult, isRemoteTextRevision, remoteTextByteLength } from '../../domain/src/remote-text-file.ts';
import type { RemoteTextFile, RemoteTextFileSaveResult } from '../../domain/src/remote-text-file.ts';

export interface SshTerminalCredentials {
  username: string;
  password: string;
}

export interface SshPrivateKeySelection {
  readonly data: Uint8Array;
  readonly fileName: string;
}

export interface SshPrivateKeyCredentials {
  username: string;
  privateKey: Uint8Array;
  passphrase: string;
}

export interface SshAgentCredentials {
  username: string;
  readonly method: 'agent';
}

export type SshAuthenticationCredentials = SshTerminalCredentials | SshPrivateKeyCredentials | SshAgentCredentials;

export type SshAuthenticationSelection =
  | { readonly method: 'password'; readonly savedCredentials?: SshTerminalCredentials }
  | { readonly method: 'private-key'; readonly privateKey: SshPrivateKeySelection }
  | { readonly method: 'agent' };

export const MAX_SSH_PRIVATE_KEY_BYTES = 1_048_576;

export interface SshConnectionGatewayCredentials {
  readonly endpoint: SshHostEndpoint;
  readonly credentials: { username: string; password: string };
}

export type SshTerminalProviderErrorCode = 'INVALID_REQUEST' | 'UNAVAILABLE' | 'NOT_SUPPORTED' | 'CANCELLED' | 'TIMEOUT' | 'BUSY' | 'OUTPUT_LIMIT' |
  'AUTHENTICATION_FAILED' | 'HOST_KEY_REJECTED' | 'HOST_KEY_CHANGED' | 'CONFLICT' | 'NOT_FOUND' | 'FORBIDDEN';

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
    credentials: SshAuthenticationCredentials,
    size: TerminalSize,
    verifyHost: (endpoint: SshHostEndpoint, evidence: HostKeyEvidence) => Promise<boolean>,
    gatewayHops?: readonly SshConnectionGatewayCredentials[],
  ): Promise<void>;
  openFiles(
    sessionId: string,
    endpoint: SshHostEndpoint,
    credentials: SshAuthenticationCredentials,
    verifyHost: (endpoint: SshHostEndpoint, evidence: HostKeyEvidence) => Promise<boolean>,
  ): Promise<void>;
  write(sessionId: string, data: string): Promise<void>;
  resize(sessionId: string, size: TerminalSize): Promise<void>;
  acknowledgeOutput(sessionId: string, sequence: number): Promise<void>;
  listRemoteDirectory(sessionId: string, path: string, cancellation?: CancellationSignal): Promise<RemoteDirectoryListing>;
  uploadRemoteFile(sessionId: string, operationId: string, localPath: string, remoteDirectory: string, fileName: string,
    conflictPolicy: FileTransferConflictPolicy, cancellation?: CancellationSignal,
    onProgress?: (progress: FileTransferProgress) => void): Promise<FileTransferResult>;
  downloadRemoteFile(sessionId: string, operationId: string, remotePath: string, localPath: string,
    conflictPolicy: FileTransferConflictPolicy, cancellation?: CancellationSignal,
    onProgress?: (progress: FileTransferProgress) => void): Promise<FileTransferResult>;
  readRemoteTextFile(sessionId: string, operationId: string, remotePath: string, cancellation?: CancellationSignal,
    onProgress?: (progress: FileTransferProgress) => void): Promise<RemoteTextFile>;
  saveRemoteTextFile(sessionId: string, operationId: string, remotePath: string, content: string, expectedRevision: string,
    cancellation?: CancellationSignal, onProgress?: (progress: FileTransferProgress) => void): Promise<RemoteTextFileSaveResult>;
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
  open(sessionId: string, host: string, port: number, size: TerminalSize, gatewayEndpoints?: readonly SshHostEndpoint[],
    authentication?: SshAuthenticationSelection): Promise<Outcome<SshTerminalSession>>;
  openFiles(sessionId: string, host: string, port: number, authentication?: SshAuthenticationSelection): Promise<Outcome<SshTerminalSession>>;
  write(sessionId: string, data: string): Promise<Outcome<Record<string, never>>>;
  resize(sessionId: string, size: TerminalSize): Promise<Outcome<Record<string, never>>>;
  acknowledgeOutput(sessionId: string, sequence: number): Promise<Outcome<Record<string, never>>>;
  listRemoteDirectory(sessionId: string, path: string, cancellation?: CancellationSignal): Promise<Outcome<RemoteDirectoryListing>>;
  uploadRemoteFile(sessionId: string, operationId: string, localPath: string, remoteDirectory: string, fileName: string,
    conflictPolicy: FileTransferConflictPolicy, cancellation?: CancellationSignal,
    onProgress?: (progress: FileTransferProgress) => void): Promise<Outcome<FileTransferResult>>;
  downloadRemoteFile(sessionId: string, operationId: string, remotePath: string, localPath: string,
    conflictPolicy: FileTransferConflictPolicy, cancellation?: CancellationSignal,
    onProgress?: (progress: FileTransferProgress) => void): Promise<Outcome<FileTransferResult>>;
  readRemoteTextFile(sessionId: string, operationId: string, remotePath: string, cancellation?: CancellationSignal,
    onProgress?: (progress: FileTransferProgress) => void): Promise<Outcome<RemoteTextFile>>;
  saveRemoteTextFile(sessionId: string, operationId: string, remotePath: string, content: string, expectedRevision: string,
    cancellation?: CancellationSignal, onProgress?: (progress: FileTransferProgress) => void): Promise<Outcome<RemoteTextFileSaveResult>>;
  cancelTransfer(sessionId: string, operationId: string): Promise<Outcome<Record<string, never>>>;
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
  readonly endpoints: readonly SshHostEndpoint[];
  readonly cancellation: CancellationSource;
  readonly mode: 'terminal' | 'files';
  state: SshTerminalSession['state'];
  pendingInputChars: number;
  pendingEvents: LocalTerminalEvent[];
  failureCode?: 'HOST_KEY_REJECTED' | 'HOST_KEY_CHANGED' | 'TIMEOUT';
}

interface CancellationSource {
  readonly token: CredentialPromptCancellation;
  cancel(): void;
}

interface ActiveSftpTransfer {
  readonly sessionId: string;
  readonly cancellation: CancellationSource;
  readonly settled: Promise<void>;
  readonly settle: () => void;
  phase: FileTransferProgress['phase'];
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

function validPrivateKeySelection(value: SshPrivateKeySelection | undefined): value is SshPrivateKeySelection {
  return typeof value === 'object' && value !== null && value.data instanceof Uint8Array && value.data.byteLength > 0 &&
    value.data.byteLength <= MAX_SSH_PRIVATE_KEY_BYTES && typeof value.fileName === 'string' &&
    value.fileName.length > 0 && value.fileName.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(value.fileName);
}

function clearPrivateKeySelection(value: SshPrivateKeySelection | undefined): void {
  if (typeof value === 'object' && value !== null && value.data instanceof Uint8Array) value.data.fill(0);
}

function clearAuthenticationSelection(value: SshAuthenticationSelection | undefined): void {
  if (typeof value !== 'object' || value === null) return;
  if (value.method === 'private-key') clearPrivateKeySelection(value.privateKey);
  if (value.method === 'password' && typeof value.savedCredentials === 'object' && value.savedCredentials !== null) {
    value.savedCredentials.username = '';
    value.savedCredentials.password = '';
  }
}

function validAuthenticationSelection(value: SshAuthenticationSelection | undefined): value is SshAuthenticationSelection | undefined {
  if (value === undefined) return true;
  if (typeof value !== 'object' || value === null) return false;
  if (value.method === 'password') return value.savedCredentials === undefined ||
    (typeof value.savedCredentials === 'object' && value.savedCredentials !== null &&
      typeof value.savedCredentials.username === 'string' && value.savedCredentials.username.length <= 512 &&
      typeof value.savedCredentials.password === 'string' && value.savedCredentials.password.length <= 65_536);
  if (value.method === 'private-key') return validPrivateKeySelection(value.privateKey);
  if (value.method === 'agent') return Object.keys(value).length === 1;
  return false;
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
  const transfers = new Map<string, ActiveSftpTransfer>();
  let shutdownPromise: Promise<void> | undefined;
  let disposed = false;

  const stopListening = provider.subscribe(event => {
    const session = sessions.get(event.sessionId);
    if (!session || session.state === 'closing') return;
    if (event.kind === 'exit' || event.kind === 'failure') {
      for (const transfer of transfers.values()) {
        if (transfer.sessionId === event.sessionId && transfer.phase !== 'committing') transfer.cancellation.cancel();
      }
    }
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

  async function verifyHost(session: SessionState, endpoint: SshHostEndpoint, evidence: HostKeyEvidence): Promise<boolean> {
    if (session.cancellation.token.aborted || sessions.get(session.sessionId) !== session || !isHostKeyEvidence(evidence) ||
        !session.endpoints.some(candidate => hostEndpointKey(candidate) === hostEndpointKey(endpoint))) return false;
    let inspected: Outcome<HostTrustDecision>;
    try { inspected = await hostTrust.inspect(endpoint, evidence, session.cancellation.token); }
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

  async function openConnection(sessionId: string, host: string, port: number, size?: TerminalSize,
    gatewayEndpoints: readonly SshHostEndpoint[] = [], authenticationSelection?: SshAuthenticationSelection): Promise<Outcome<SshTerminalSession>> {
    if (disposed) { clearAuthenticationSelection(authenticationSelection); return failure('CANCELLED', 'terminal'); }
    if (shutdownPromise) { clearAuthenticationSelection(authenticationSelection); return failure('BUSY', 'terminal'); }
    const endpoint = canonicalizeSshHostEndpoint({ host, port });
    if (!SESSION_ID.test(sessionId) || !endpoint || (size !== undefined && !isTerminalSize(size)) || sessions.has(sessionId) ||
        !validAuthenticationSelection(authenticationSelection)) {
      clearAuthenticationSelection(authenticationSelection);
      return failure('INVALID_REQUEST');
    }
    const gateways = normalizeSshGatewayRoute(gatewayEndpoints, endpoint);
    if (!gateways) { clearAuthenticationSelection(authenticationSelection); return failure('INVALID_REQUEST'); }
    const mode = size === undefined ? 'files' : 'terminal';
    const session: SessionState = { sessionId, endpoint, endpoints: [...gateways, endpoint], cancellation: createCancellationSource(), mode,
      state: 'starting', pendingInputChars: 0, pendingEvents: [] };
    sessions.set(sessionId, session);

    let username = '';
    let password = '';
    let providerCredentials: SshAuthenticationCredentials | undefined;
    const privateKey = authenticationSelection?.method === 'private-key' ? authenticationSelection.privateKey : undefined;
    const savedCredentials = authenticationSelection?.method === 'password' ? authenticationSelection.savedCredentials : undefined;
    const useAgent = authenticationSelection?.method === 'agent';
    const gatewayCredentials: SshConnectionGatewayCredentials[] = [];
    try {
      for (const [index, gatewayEndpoint] of gateways.entries()) {
        const credential = await credentialPrompt.prompt('ssh-password', session.cancellation.token,
          `Gateway ${index + 1}: ${gatewayEndpoint.host}:${gatewayEndpoint.port}`);
        if (session.cancellation.token.aborted || sessions.get(sessionId) !== session) return failOpen(session, 'CANCELLED');
        if (credential.kind === 'cancelled') return failOpen(session, 'CANCELLED');
        if (credential.kind !== 'provided') return failOpen(session, credential.kind === 'timeout' ? 'TIMEOUT' : 'UNAVAILABLE');
        if (credential.username.length === 0 || credential.username.trim() !== credential.username || credential.username.includes('\0') || credential.secret.includes('\0')) {
          return failOpen(session, 'INVALID_REQUEST');
        }
        gatewayCredentials.push({ endpoint: gatewayEndpoint, credentials: { username: credential.username, password: credential.secret } });
      }

      if (privateKey) {
        const credential = await credentialPrompt.prompt('ssh-key-passphrase', session.cancellation.token,
          `SSH destination: ${endpoint.host}:${endpoint.port}\nSelected key: ${privateKey.fileName}`);
        if (session.cancellation.token.aborted || sessions.get(sessionId) !== session) return failOpen(session, 'CANCELLED');
        if (credential.kind === 'cancelled') return failOpen(session, 'CANCELLED');
        if (credential.kind !== 'provided') return failOpen(session, credential.kind === 'timeout' ? 'TIMEOUT' : 'UNAVAILABLE');
        username = credential.username;
        if (username.length === 0 || username.trim() !== username || username.includes('\0') ||
            credential.secret.length > 65_536 || credential.secret.includes('\0')) return failOpen(session, 'INVALID_REQUEST');
        providerCredentials = { username, privateKey: privateKey.data, passphrase: credential.secret };
      } else if (useAgent) {
        const credential = await credentialPrompt.prompt('ssh-agent-username', session.cancellation.token,
          `SSH destination: ${endpoint.host}:${endpoint.port}`);
        if (session.cancellation.token.aborted || sessions.get(sessionId) !== session) return failOpen(session, 'CANCELLED');
        if (credential.kind === 'cancelled') return failOpen(session, 'CANCELLED');
        if (credential.kind !== 'provided') return failOpen(session, credential.kind === 'timeout' ? 'TIMEOUT' : 'UNAVAILABLE');
        username = credential.username;
        if (username.length === 0 || username.trim() !== username || username.includes('\0') || credential.secret.length !== 0) {
          return failOpen(session, 'INVALID_REQUEST');
        }
        providerCredentials = { username, method: 'agent' };
      } else if (savedCredentials) {
        username = savedCredentials.username;
        password = savedCredentials.password;
      } else {
        const credential = await credentialPrompt.prompt('ssh-password', session.cancellation.token, `SSH destination: ${endpoint.host}:${endpoint.port}`);
        if (session.cancellation.token.aborted || sessions.get(sessionId) !== session) return failOpen(session, 'CANCELLED');
        if (credential.kind === 'cancelled') return failOpen(session, 'CANCELLED');
        if (credential.kind !== 'provided') return failOpen(session, credential.kind === 'timeout' ? 'TIMEOUT' : 'UNAVAILABLE');
        username = credential.username;
        password = credential.secret;
      }
      if (username.length === 0 || username.trim() !== username || username.includes('\0') || password.includes('\0')) return failOpen(session, 'INVALID_REQUEST');
      providerCredentials ??= { username, password };

      const verifyEndpoint = (remoteEndpoint: SshHostEndpoint, evidence: HostKeyEvidence) => verifyHost(session, remoteEndpoint, evidence);
      if (size === undefined) await provider.openFiles(sessionId, endpoint, providerCredentials, verifyEndpoint);
      else await provider.open(sessionId, endpoint, providerCredentials, size, verifyEndpoint, gatewayCredentials);
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
      if (providerCredentials) {
        providerCredentials.username = '';
        if ('privateKey' in providerCredentials) {
          providerCredentials.privateKey.fill(0);
          providerCredentials.passphrase = '';
        } else if (!('method' in providerCredentials)) providerCredentials.password = '';
      }
      clearAuthenticationSelection(authenticationSelection);
      for (const gateway of gatewayCredentials) {
        gateway.credentials.username = '';
        gateway.credentials.password = '';
      }
      if (savedCredentials) {
        savedCredentials.username = '';
        savedCredentials.password = '';
      }
    }
  }

  async function open(sessionId: string, host: string, port: number, size: TerminalSize,
    gatewayEndpoints: readonly SshHostEndpoint[] = [], authentication?: SshAuthenticationSelection): Promise<Outcome<SshTerminalSession>> {
    return openConnection(sessionId, host, port, size, gatewayEndpoints, authentication);
  }

  async function openFiles(sessionId: string, host: string, port: number,
    authentication?: SshAuthenticationSelection): Promise<Outcome<SshTerminalSession>> {
    return openConnection(sessionId, host, port, undefined, [], authentication);
  }

  async function write(sessionId: string, data: string): Promise<Outcome<Record<string, never>>> {
    const session = sessions.get(sessionId);
    if (!session || session.mode !== 'terminal' || session.state !== 'running') return failure('NOT_FOUND', 'terminal');
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
    if (!session || session.mode !== 'terminal' || session.state !== 'running') return failure('NOT_FOUND', 'terminal');
    if (!isTerminalSize(size)) return failure('INVALID_REQUEST');
    try { await provider.resize(sessionId, size); return { ok: true, result: EMPTY_RESULT }; }
    catch { return failure('UNAVAILABLE', 'terminal'); }
  }

  async function acknowledgeOutput(sessionId: string, sequence: number): Promise<Outcome<Record<string, never>>> {
    const session = sessions.get(sessionId);
    if (!session || session.mode !== 'terminal' || !Number.isSafeInteger(sequence) || sequence < 1) return failure('NOT_FOUND', 'terminal');
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
      if (error instanceof SshTerminalProviderError && error.code === 'OUTPUT_LIMIT') return failure('OUTPUT_LIMIT', 'terminal');
      return failure('UNAVAILABLE', 'terminal');
    }
  }

  async function transferRemoteFile(sessionId: string, operationId: string, request: {
    readonly direction: 'upload'; readonly localPath: string; readonly remoteDirectory: string; readonly fileName: string;
    readonly conflictPolicy: FileTransferConflictPolicy;
  } | {
    readonly direction: 'download'; readonly remotePath: string; readonly localPath: string;
    readonly conflictPolicy: FileTransferConflictPolicy;
  }, cancellation?: CancellationSignal, onProgress?: (progress: FileTransferProgress) => void): Promise<Outcome<FileTransferResult>> {
    const session = sessions.get(sessionId);
    if (!session || session.state !== 'running') return failure('NOT_FOUND', 'terminal');
    if (!SESSION_ID.test(operationId) || transfers.has(operationId)) return failure('INVALID_REQUEST');
    if ([...transfers.values()].some(transfer => transfer.sessionId === sessionId)) return failure('BUSY', 'terminal');
    if (cancellation?.aborted) return failure('CANCELLED', 'terminal');
    if (!isFileTransferConflictPolicy(request.conflictPolicy) || typeof request.localPath !== 'string' || request.localPath.length === 0 ||
        request.localPath.length > 32_768 || request.localPath.includes('\0')) return failure('INVALID_REQUEST');
    if (request.direction === 'upload' && (!isRemotePath(request.remoteDirectory) || !isRemoteFileName(request.fileName))) return failure('INVALID_REQUEST');
    if (request.direction === 'download' && !isRemotePath(request.remotePath)) return failure('INVALID_REQUEST');
    if (disposed || shutdownPromise) return failure('CANCELLED', 'terminal');

    const transferCancellation = createCancellationSource();
    let settleTransfer!: () => void;
    const settled = new Promise<void>(resolveSettled => { settleTransfer = resolveSettled; });
    const transfer: ActiveSftpTransfer = { sessionId, cancellation: transferCancellation, settled, settle: settleTransfer, phase: 'transferring' };
    transfers.set(operationId, transfer);
    const cancelForCaller = () => transferCancellation.cancel();
    cancellation?.addEventListener('abort', cancelForCaller, { once: true });
    try {
      const progress = (event: FileTransferProgress) => {
        if (transfers.get(operationId) !== transfer || event.sessionId !== sessionId || event.operationId !== operationId || !isFileTransferProgress(event)) return;
        if (event.phase === 'committing') transfer.phase = 'committing';
        try { onProgress?.(event); } catch { /* A UI progress listener cannot interrupt the transfer owner. */ }
      };
      const result = request.direction === 'upload'
        ? await provider.uploadRemoteFile(sessionId, operationId, request.localPath, request.remoteDirectory, request.fileName,
          request.conflictPolicy, transferCancellation.token, progress)
        : await provider.downloadRemoteFile(sessionId, operationId, request.remotePath, request.localPath,
          request.conflictPolicy, transferCancellation.token, progress);
      if (!isFileTransferResult(result) || result.direction !== request.direction) return failure('UNAVAILABLE', 'terminal');
      return { ok: true, result };
    } catch (error) {
      const code: ErrorCode = error instanceof SshTerminalProviderError ? error.code : 'UNAVAILABLE';
      return failure(code, 'terminal');
    } finally {
      cancellation?.removeEventListener('abort', cancelForCaller);
      if (transfers.get(operationId) === transfer) transfers.delete(operationId);
      transfer.settle();
    }
  }

  async function uploadRemoteFile(sessionId: string, operationId: string, localPath: string, remoteDirectory: string, fileName: string,
    conflictPolicy: FileTransferConflictPolicy, cancellation?: CancellationSignal,
    onProgress?: (progress: FileTransferProgress) => void): Promise<Outcome<FileTransferResult>> {
    return transferRemoteFile(sessionId, operationId, { direction: 'upload', localPath, remoteDirectory, fileName, conflictPolicy }, cancellation, onProgress);
  }

  async function downloadRemoteFile(sessionId: string, operationId: string, remotePath: string, localPath: string,
    conflictPolicy: FileTransferConflictPolicy, cancellation?: CancellationSignal,
    onProgress?: (progress: FileTransferProgress) => void): Promise<Outcome<FileTransferResult>> {
    return transferRemoteFile(sessionId, operationId, { direction: 'download', remotePath, localPath, conflictPolicy }, cancellation, onProgress);
  }

  async function runSftpOperation<T>(sessionId: string, operationId: string, cancellation: CancellationSignal | undefined,
    onProgress: ((progress: FileTransferProgress) => void) | undefined,
    operation: (signal: CancellationSignal, progress: (event: FileTransferProgress) => void) => Promise<T>,
    validate: (value: unknown) => value is T): Promise<Outcome<T>> {
    const session = sessions.get(sessionId);
    if (!session || session.state !== 'running') return failure('NOT_FOUND', 'terminal');
    if (!SESSION_ID.test(operationId) || transfers.has(operationId)) return failure('INVALID_REQUEST');
    if ([...transfers.values()].some(transfer => transfer.sessionId === sessionId)) return failure('BUSY', 'terminal');
    if (cancellation?.aborted) return failure('CANCELLED', 'terminal');
    if (disposed || shutdownPromise) return failure('CANCELLED', 'terminal');

    const operationCancellation = createCancellationSource();
    let settleOperation!: () => void;
    const settled = new Promise<void>(resolveSettled => { settleOperation = resolveSettled; });
    const active: ActiveSftpTransfer = { sessionId, cancellation: operationCancellation, settled, settle: settleOperation, phase: 'transferring' };
    transfers.set(operationId, active);
    const cancelForCaller = () => operationCancellation.cancel();
    cancellation?.addEventListener('abort', cancelForCaller, { once: true });
    try {
      const progress = (event: FileTransferProgress) => {
        if (transfers.get(operationId) !== active || event.sessionId !== sessionId || event.operationId !== operationId || !isFileTransferProgress(event)) return;
        if (event.phase === 'committing') active.phase = 'committing';
        try { onProgress?.(event); } catch { /* A UI progress listener cannot interrupt file cleanup. */ }
      };
      const result = await operation(operationCancellation.token, progress);
      if (!validate(result)) return failure('UNAVAILABLE', 'terminal');
      return { ok: true, result };
    } catch (error) {
      const code: ErrorCode = error instanceof SshTerminalProviderError ? error.code : 'UNAVAILABLE';
      return failure(code, 'terminal');
    } finally {
      cancellation?.removeEventListener('abort', cancelForCaller);
      if (transfers.get(operationId) === active) transfers.delete(operationId);
      active.settle();
    }
  }

  async function readRemoteTextFile(sessionId: string, operationId: string, remotePath: string, cancellation?: CancellationSignal,
    onProgress?: (progress: FileTransferProgress) => void): Promise<Outcome<RemoteTextFile>> {
    if (!isRemotePath(remotePath) || remotePath === '.' || remotePath === '/') return failure('INVALID_REQUEST');
    return runSftpOperation(sessionId, operationId, cancellation, onProgress,
      (signal, progress) => provider.readRemoteTextFile(sessionId, operationId, remotePath, signal, progress),
      (value): value is RemoteTextFile => isRemoteTextFile(value) && value.path === remotePath);
  }

  async function saveRemoteTextFile(sessionId: string, operationId: string, remotePath: string, content: string, expectedRevision: string,
    cancellation?: CancellationSignal, onProgress?: (progress: FileTransferProgress) => void): Promise<Outcome<RemoteTextFileSaveResult>> {
    const contentBytes = typeof content === 'string' ? remoteTextByteLength(content) : undefined;
    if (!isRemotePath(remotePath) || remotePath === '.' || remotePath === '/' || contentBytes === undefined || !isRemoteTextRevision(expectedRevision)) {
      return failure('INVALID_REQUEST');
    }
    return runSftpOperation(sessionId, operationId, cancellation, onProgress,
      (signal, progress) => provider.saveRemoteTextFile(sessionId, operationId, remotePath, content, expectedRevision, signal, progress),
      (value): value is RemoteTextFileSaveResult => isRemoteTextFileSaveResult(value) && value.path === remotePath && value.bytesSaved === contentBytes);
  }

  async function cancelTransfer(sessionId: string, operationId: string): Promise<Outcome<Record<string, never>>> {
    const transfer = transfers.get(operationId);
    if (!transfer || transfer.sessionId !== sessionId) return failure('NOT_FOUND', 'terminal');
    const currentPhase = () => transfer.phase;
    if (currentPhase() === 'committing') return failure('CONFLICT', 'terminal');
    transfer.cancellation.cancel();
    await transfer.settled;
    return currentPhase() === 'committing' ? failure('CONFLICT', 'terminal') : { ok: true, result: EMPTY_RESULT };
  }

  async function close(sessionId: string): Promise<Outcome<Record<string, never>>> {
    const session = sessions.get(sessionId);
    if (!session) return failure('NOT_FOUND', 'terminal');
    session.state = 'closing';
    session.cancellation.cancel();
    const closingTransfers = [...transfers.values()].filter(transfer => transfer.sessionId === sessionId);
    for (const transfer of closingTransfers) transfer.cancellation.cancel();
    await Promise.all(closingTransfers.map(transfer => transfer.settled));
    sessions.delete(sessionId);
    for (const token of trustTokensBySession.get(sessionId) ?? []) hostTrust.reject(token);
    trustTokensBySession.delete(sessionId);
    for (const [token, owner] of sessionByTrustToken) if (owner === sessionId) sessionByTrustToken.delete(token);
    try { await provider.close(sessionId); return { ok: true, result: EMPTY_RESULT }; }
    catch { return failure('UNAVAILABLE', 'terminal'); }
  }

  return Object.freeze({
    open, openFiles, write, resize, acknowledgeOutput, listRemoteDirectory, uploadRemoteFile, downloadRemoteFile, readRemoteTextFile,
    saveRemoteTextFile, cancelTransfer, close,
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
      const activeTransfers = [...transfers.values()];
      for (const transfer of activeTransfers) transfer.cancellation.cancel();
      for (const session of sessions.values()) {
        session.state = 'closing';
        session.cancellation.cancel();
      }
      for (const tokens of trustTokensBySession.values()) for (const token of tokens) hostTrust.reject(token);
      sessions.clear();
      trustTokensBySession.clear();
      sessionByTrustToken.clear();
      const shuttingDown = Promise.all(activeTransfers.map(transfer => transfer.settled)).then(() => provider.shutdown());
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
