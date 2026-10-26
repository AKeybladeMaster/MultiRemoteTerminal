import { createHash, randomUUID } from 'node:crypto';
import type { UtilityProcess } from 'electron';
import type { HostKeyEvidence, SshHostEndpoint } from '../../../../packages/domain/src/host-trust.ts';
import type { SshAuthenticationCredentials, SshConnectionGatewayCredentials, SshTerminalProvider, SshTerminalProviderErrorCode } from '../../../../packages/application/src/ssh-terminals.ts';
import { SshTerminalProviderError } from '../../../../packages/application/src/ssh-terminals.ts';
import type { SshTunnelForwardProvider } from '../../../../packages/application/src/ssh-tunnels.ts';
import { isSshTunnelDefinition, isTunnelId } from '../../../../packages/domain/src/ssh-tunnel.ts';
import type { SshTunnelDefinition } from '../../../../packages/domain/src/ssh-tunnel.ts';
import type { LocalTerminalEvent } from '../../../../packages/application/src/local-terminals.ts';
import type { CancellationSignal } from '../../../../packages/application/src/cancellation.ts';
import { isRemoteDirectoryListing } from '../../../../packages/domain/src/remote-files.ts';
import type { RemoteDirectoryListing } from '../../../../packages/domain/src/remote-files.ts';
import { isFileTransferResult } from '../../../../packages/domain/src/file-transfer.ts';
import type { FileTransferConflictPolicy, FileTransferProgress, FileTransferResult } from '../../../../packages/domain/src/file-transfer.ts';
import { isRemoteTextFile, isRemoteTextFileSaveResult, isRemoteTextRevision, remoteTextByteLength } from '../../../../packages/domain/src/remote-text-file.ts';
import type { RemoteTextFile, RemoteTextFileSaveResult } from '../../../../packages/domain/src/remote-text-file.ts';
import type { TerminalSize } from '../../../../packages/domain/src/local-terminal.ts';
import { parseSshWorkerMessage, SSH_WORKER_PROTOCOL_VERSION } from '../workers/ssh-protocol.ts';
import type { SshWorkerErrorCode, SshWorkerRequest } from '../workers/ssh-protocol.ts';
import { isWindowsOpenSshAgentPipePath, WINDOWS_OPENSSH_AGENT_PIPE_PATH } from './windows-openssh-agent.ts';

interface PendingRequest {
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly cleanup: () => void;
  readonly onProgress?: (progress: FileTransferProgress) => void;
  cleanupTimer?: ReturnType<typeof setTimeout>;
  timedOut: boolean;
  progressPhase?: FileTransferProgress['phase'];
}

interface OwnedSshSession {
  readonly endpoints: readonly SshHostEndpoint[];
  readonly verifyHost: (endpoint: SshHostEndpoint, evidence: HostKeyEvidence) => Promise<boolean>;
}

const MAX_PENDING_REQUESTS = 128;
const OPEN_TIMEOUT_MS = 140_000;
// 15s setup + 10s listing + 1s channel-close grace leaves 4s for worker IPC within this deadline.
const FILE_LIST_TIMEOUT_MS = 30_000;

function copyAuthenticationCredentials(credentials: SshAuthenticationCredentials): SshAuthenticationCredentials {
  if ('privateKey' in credentials) return { username: credentials.username, privateKey: new Uint8Array(credentials.privateKey), passphrase: credentials.passphrase };
  if ('method' in credentials) return { username: credentials.username, method: 'agent' };
  return { username: credentials.username, password: credentials.password };
}

function clearAuthenticationCredentials(credentials: SshAuthenticationCredentials): void {
  credentials.username = '';
  if ('privateKey' in credentials) {
    credentials.privateKey.fill(0);
    credentials.passphrase = '';
  } else if (!('method' in credentials)) credentials.password = '';
}
const FILE_TRANSFER_TIMEOUT_MS = 60 * 60_000;
const REMOTE_TEXT_TIMEOUT_MS = 60_000;
const FILE_TRANSFER_CLEANUP_GRACE_MS = 10_000;
const FILE_COMMIT_SETTLEMENT_GRACE_MS = 2 * 60_000;

function isCancellableFileRequest(request: Extract<SshWorkerRequest, { readonly type: 'request' }>): request is Extract<SshWorkerRequest,
  { readonly command: 'files.list' | 'files.upload' | 'files.download' | 'files.read-text' | 'files.write-text' }> {
  return request.command === 'files.list' || request.command === 'files.upload' || request.command === 'files.download' ||
    request.command === 'files.read-text' || request.command === 'files.write-text';
}

function isCommitAwareFileRequest(request: Extract<SshWorkerRequest, { readonly type: 'request' }>): request is Extract<SshWorkerRequest,
  { readonly command: 'files.upload' | 'files.download' | 'files.write-text' }> {
  return request.command === 'files.upload' || request.command === 'files.download' || request.command === 'files.write-text';
}
export type SshWorkerLaunchOptions = { readonly cwd: string;
  readonly env: { readonly MRT_APP_ROOT: string; readonly MRT_OPENSSH_AGENT_PIPE: string };
  readonly serviceName: string; readonly stdio: 'ignore' };
export type SshWorkerLauncher = (workerPath: string, args: string[], options: SshWorkerLaunchOptions) => UtilityProcess;

function providerErrorCode(code: SshWorkerErrorCode): SshTerminalProviderErrorCode {
  return code;
}

function hasMatchingRemoteTextRevision(value: unknown, remotePath: string): value is RemoteTextFile {
  if (!isRemoteTextFile(value) || value.path !== remotePath) return false;
  const actualRevision = createHash('sha256').update(Buffer.from(value.content, 'utf8')).digest('hex');
  return actualRevision === value.revision;
}

export class SshTerminalWorkerHost implements SshTerminalProvider, SshTunnelForwardProvider {
  private readonly workerPath: string;
  private readonly appRoot: string;
  private readonly opensshAgentPipePath: string;
  private readonly launchWorker: SshWorkerLauncher;
  private worker: UtilityProcess | undefined;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly sessions = new Map<string, OwnedSshSession>();
  private readonly listeners = new Set<(event: LocalTerminalEvent) => void>();
  private shuttingDown: Promise<void> | undefined;

  constructor(workerPath: string, appRoot: string, launchWorker: SshWorkerLauncher,
    opensshAgentPipePath: string = WINDOWS_OPENSSH_AGENT_PIPE_PATH) {
    if (!isWindowsOpenSshAgentPipePath(opensshAgentPipePath)) throw new SshTerminalProviderError('INVALID_REQUEST');
    this.workerPath = workerPath;
    this.appRoot = appRoot;
    this.launchWorker = launchWorker;
    this.opensshAgentPipePath = opensshAgentPipePath;
  }

  async open(sessionId: string, endpoint: SshHostEndpoint, credentials: SshAuthenticationCredentials, size: TerminalSize,
    verifyHost: (endpoint: SshHostEndpoint, evidence: HostKeyEvidence) => Promise<boolean>,
    gatewayHops: readonly SshConnectionGatewayCredentials[] = []): Promise<void> {
    if (this.sessions.has(sessionId)) throw new SshTerminalProviderError('UNAVAILABLE');
    const credentialsCopy = copyAuthenticationCredentials(credentials);
    const gatewayCopies = gatewayHops.map(hop => ({ endpoint: { ...hop.endpoint }, credentials: { ...hop.credentials } }));
    const request = { version: SSH_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(), command: 'open',
      sessionId, endpoint, credentials: credentialsCopy, size, gatewayHops: gatewayCopies } as const satisfies SshWorkerRequest;
    this.sessions.set(sessionId, { endpoints: [...gatewayCopies.map(hop => hop.endpoint), { ...endpoint }], verifyHost });
    try { await this.request(request, OPEN_TIMEOUT_MS); }
    catch (error) {
      this.sessions.delete(sessionId);
      throw error;
    } finally {
      clearAuthenticationCredentials(credentialsCopy);
      for (const hop of gatewayCopies) { hop.credentials.username = ''; hop.credentials.password = ''; }
    }
  }

  async openFiles(sessionId: string, endpoint: SshHostEndpoint, credentials: SshAuthenticationCredentials,
    verifyHost: (endpoint: SshHostEndpoint, evidence: HostKeyEvidence) => Promise<boolean>,
    gatewayHops: readonly SshConnectionGatewayCredentials[] = []): Promise<void> {
    if (this.sessions.has(sessionId)) throw new SshTerminalProviderError('UNAVAILABLE');
    const credentialsCopy = copyAuthenticationCredentials(credentials);
    const gatewayCopies = gatewayHops.map(hop => ({ endpoint: { ...hop.endpoint }, credentials: { ...hop.credentials } }));
    const request = { version: SSH_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(), command: 'open-files',
      sessionId, endpoint, credentials: credentialsCopy, ...(gatewayCopies.length > 0 ? { gatewayHops: gatewayCopies } : {}) } as const satisfies SshWorkerRequest;
    this.sessions.set(sessionId, { endpoints: [...gatewayCopies.map(hop => hop.endpoint), { ...endpoint }], verifyHost });
    try { await this.request(request, OPEN_TIMEOUT_MS); }
    catch (error) {
      this.sessions.delete(sessionId);
      throw error;
    } finally {
      clearAuthenticationCredentials(credentialsCopy);
      for (const hop of gatewayCopies) { hop.credentials.username = ''; hop.credentials.password = ''; }
    }
  }

  async write(sessionId: string, data: string): Promise<void> {
    await this.request({ version: SSH_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(), command: 'write', sessionId, data }, 5_000);
  }

  async resize(sessionId: string, size: TerminalSize): Promise<void> {
    await this.request({ version: SSH_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(), command: 'resize', sessionId, size }, 5_000);
  }

  async acknowledgeOutput(sessionId: string, sequence: number): Promise<void> {
    await this.request({ version: SSH_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(), command: 'ack', sessionId, sequence }, 5_000);
  }

  async listRemoteDirectory(sessionId: string, path: string, cancellation?: CancellationSignal): Promise<RemoteDirectoryListing> {
    if (!this.sessions.has(sessionId)) throw new SshTerminalProviderError('UNAVAILABLE');
    if (cancellation?.aborted) throw new SshTerminalProviderError('CANCELLED');
    const request = { version: SSH_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(), command: 'files.list', sessionId, path } as const satisfies SshWorkerRequest;
    const result = await this.request(request, FILE_LIST_TIMEOUT_MS, cancellation);
    if (!isRemoteDirectoryListing(result)) throw new SshTerminalProviderError('UNAVAILABLE');
    return result;
  }

  async uploadRemoteFile(sessionId: string, operationId: string, localPath: string, remoteDirectory: string, fileName: string,
    conflictPolicy: FileTransferConflictPolicy, cancellation?: CancellationSignal,
    onProgress?: (progress: FileTransferProgress) => void): Promise<FileTransferResult> {
    if (!this.sessions.has(sessionId)) throw new SshTerminalProviderError('UNAVAILABLE');
    const request = { version: SSH_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(), command: 'files.upload',
      sessionId, operationId, localPath, remoteDirectory, fileName, conflictPolicy } as const satisfies SshWorkerRequest;
    const result = await this.request(request, FILE_TRANSFER_TIMEOUT_MS, cancellation, onProgress);
    if (!isFileTransferResult(result) || result.direction !== 'upload') throw new SshTerminalProviderError('UNAVAILABLE');
    return result;
  }

  async downloadRemoteFile(sessionId: string, operationId: string, remotePath: string, localPath: string,
    conflictPolicy: FileTransferConflictPolicy, cancellation?: CancellationSignal,
    onProgress?: (progress: FileTransferProgress) => void): Promise<FileTransferResult> {
    if (!this.sessions.has(sessionId)) throw new SshTerminalProviderError('UNAVAILABLE');
    const request = { version: SSH_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(), command: 'files.download',
      sessionId, operationId, remotePath, localPath, conflictPolicy } as const satisfies SshWorkerRequest;
    const result = await this.request(request, FILE_TRANSFER_TIMEOUT_MS, cancellation, onProgress);
    if (!isFileTransferResult(result) || result.direction !== 'download') throw new SshTerminalProviderError('UNAVAILABLE');
    return result;
  }

  async readRemoteTextFile(sessionId: string, operationId: string, remotePath: string, cancellation?: CancellationSignal,
    onProgress?: (progress: FileTransferProgress) => void): Promise<RemoteTextFile> {
    if (!this.sessions.has(sessionId)) throw new SshTerminalProviderError('UNAVAILABLE');
    const request = { version: SSH_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(), command: 'files.read-text',
      sessionId, operationId, remotePath } as const satisfies SshWorkerRequest;
    const result = await this.request(request, REMOTE_TEXT_TIMEOUT_MS, cancellation, onProgress);
    if (!hasMatchingRemoteTextRevision(result, remotePath)) throw new SshTerminalProviderError('UNAVAILABLE');
    return result;
  }

  async saveRemoteTextFile(sessionId: string, operationId: string, remotePath: string, content: string, expectedRevision: string,
    cancellation?: CancellationSignal, onProgress?: (progress: FileTransferProgress) => void): Promise<RemoteTextFileSaveResult> {
    if (!this.sessions.has(sessionId)) throw new SshTerminalProviderError('UNAVAILABLE');
    const expectedBytes = remoteTextByteLength(content);
    if (expectedBytes === undefined || !isRemoteTextRevision(expectedRevision)) throw new SshTerminalProviderError('INVALID_REQUEST');
    const request = { version: SSH_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(), command: 'files.write-text',
      sessionId, operationId, remotePath, content, expectedRevision } as const satisfies SshWorkerRequest;
    const result = await this.request(request, REMOTE_TEXT_TIMEOUT_MS, cancellation, onProgress);
    if (!isRemoteTextFileSaveResult(result) || result.path !== remotePath || result.bytesSaved !== expectedBytes) {
      throw new SshTerminalProviderError('UNAVAILABLE');
    }
    return result;
  }

  async startForward(sessionId: string, tunnelId: string, definition: SshTunnelDefinition): Promise<number> {
    if (!this.sessions.has(sessionId) || !isTunnelId(tunnelId) || !isSshTunnelDefinition(definition) || definition.id !== tunnelId) {
      throw new SshTerminalProviderError('INVALID_REQUEST');
    }
    const request = { version: SSH_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(), command: 'tunnel.forward.start',
      sessionId, definition } as const satisfies SshWorkerRequest;
    const result = await this.request(request, 20_000);
    if (!isBindPortResult(result)) throw new SshTerminalProviderError('UNAVAILABLE');
    return result.bindPort;
  }

  async stopForward(sessionId: string, tunnelId: string): Promise<void> {
    if (!isTunnelId(tunnelId)) throw new SshTerminalProviderError('INVALID_REQUEST');
    if (!this.sessions.has(sessionId)) return;
    const request = { version: SSH_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(), command: 'tunnel.forward.stop',
      sessionId, tunnelId } as const satisfies SshWorkerRequest;
    await this.request(request, 5_000);
  }

  async close(sessionId: string): Promise<void> {
    if (!this.sessions.has(sessionId)) return;
    this.sessions.delete(sessionId);
    await this.request({ version: SSH_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(), command: 'close', sessionId }, 5_000);
  }

  subscribe(listener: (event: LocalTerminalEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return this.shuttingDown;
    const operation = this.stopWorker();
    this.shuttingDown = operation;
    try { await operation; }
    finally { if (this.shuttingDown === operation) this.shuttingDown = undefined; }
  }

  private async request(request: Extract<SshWorkerRequest, { type: 'request' }>, timeoutMs: number, cancellation?: CancellationSignal,
    onProgress?: (progress: FileTransferProgress) => void): Promise<unknown> {
    if (this.shuttingDown && request.command !== 'shutdown') throw new SshTerminalProviderError('UNAVAILABLE');
    if (this.pending.size >= MAX_PENDING_REQUESTS) throw new SshTerminalProviderError('UNAVAILABLE');
    const worker = this.ensureWorker();
    return new Promise<unknown>((resolve, reject) => {
      let removeCancellation = () => {};
      const timer = setTimeout(() => {
        const pending = this.pending.get(request.requestId);
        if (!pending) return;
        pending.timedOut = true;
        if (isCancellableFileRequest(request) && (!isCommitAwareFileRequest(request) || pending.progressPhase !== 'committing')) sendCancel();
        this.scheduleWorkerTermination(worker, request.requestId, pending,
          isCommitAwareFileRequest(request) && pending.progressPhase === 'committing' ? FILE_COMMIT_SETTLEMENT_GRACE_MS : FILE_TRANSFER_CLEANUP_GRACE_MS,
          new SshTerminalProviderError('TIMEOUT'));
      }, timeoutMs);
      const cleanup = () => { clearTimeout(timer); clearTimeout(current.cleanupTimer); removeCancellation(); };
      const current: PendingRequest = { resolve, reject, timer, cleanup, timedOut: false, ...(onProgress ? { onProgress } : {}) };
      this.pending.set(request.requestId, current);
      const sendCancel = () => {
        if (this.worker !== worker || !isCancellableFileRequest(request)) return;
        const operationId = request.command === 'files.list' ? request.requestId : request.operationId;
        const cancelRequest = { version: SSH_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(),
          command: 'files.cancel', sessionId: request.sessionId, operationId } as const satisfies SshWorkerRequest;
        try { worker.postMessage(cancelRequest); } catch { void this.killWorker(worker); }
      };
      if (isCancellableFileRequest(request) && cancellation) {
        const cancelOperation = () => {
          const pending = this.pending.get(request.requestId);
          if (!pending) return;
          if (isCommitAwareFileRequest(request) && pending.progressPhase === 'committing') {
            this.scheduleWorkerTermination(worker, request.requestId, pending, FILE_COMMIT_SETTLEMENT_GRACE_MS,
              new SshTerminalProviderError('CANCELLED'));
            return;
          }
          sendCancel();
          this.scheduleWorkerTermination(worker, request.requestId, pending, FILE_TRANSFER_CLEANUP_GRACE_MS, new SshTerminalProviderError('CANCELLED'));
        };
        cancellation.addEventListener('abort', cancelOperation, { once: true });
        removeCancellation = () => cancellation.removeEventListener('abort', cancelOperation);
      }
      try { worker.postMessage(request); }
      catch {
        cleanup();
        this.pending.delete(request.requestId);
        reject(new SshTerminalProviderError('UNAVAILABLE'));
        void this.killWorker(worker);
        return;
      }
      if (cancellation?.aborted) {
        sendCancel();
        this.scheduleWorkerTermination(worker, request.requestId, current, FILE_TRANSFER_CLEANUP_GRACE_MS,
          new SshTerminalProviderError('CANCELLED'));
      }
    });
  }

  private ensureWorker(): UtilityProcess {
    if (this.worker) return this.worker;
    const worker = this.launchWorker(this.workerPath, [], {
      cwd: process.resourcesPath ?? this.appRoot,
      env: { MRT_APP_ROOT: this.appRoot, MRT_OPENSSH_AGENT_PIPE: this.opensshAgentPipePath },
      serviceName: 'MultiRemoteTerminal SSH network provider',
      stdio: 'ignore'
    });
    this.worker = worker;
    worker.on('message', message => this.receive(worker, message));
    worker.on('exit', () => this.onWorkerExit(worker));
    return worker;
  }

  private receive(worker: UtilityProcess, value: unknown): void {
    if (this.worker !== worker) return;
    const message = parseSshWorkerMessage(value);
    if (!message) { void this.killWorker(worker); return; }
    if (message.type === 'progress') {
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      const previouslyCommitting = pending.progressPhase === 'committing';
      pending.progressPhase = message.progress.phase;
      if (message.progress.phase === 'committing' && !previouslyCommitting && pending.cleanupTimer !== undefined) {
        this.scheduleWorkerTermination(worker, message.requestId, pending, FILE_COMMIT_SETTLEMENT_GRACE_MS,
          new SshTerminalProviderError(pending.timedOut ? 'TIMEOUT' : 'CANCELLED'));
      }
      try { pending.onProgress?.(message.progress); } catch { /* Progress observers cannot interrupt worker ownership. */ }
      return;
    }
    if (message.type === 'reply') {
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      clearTimeout(pending.cleanupTimer);
      this.pending.delete(message.requestId);
      pending.cleanup();
      if (!message.ok) pending.reject(new SshTerminalProviderError(pending.timedOut && message.errorCode === 'CANCELLED'
        ? 'TIMEOUT' : providerErrorCode(message.errorCode)));
      else pending.resolve(message.result);
      return;
    }
    if (message.type === 'host-key') { this.verifyHostKey(worker, message.sessionId, message.checkId, message.endpoint, message.evidence); return; }
    if (!this.sessions.has(message.event.sessionId)) return;
    if (message.event.kind === 'exit' || message.event.kind === 'failure') {
      this.sessions.delete(message.event.sessionId);
    }
    for (const listener of this.listeners) {
      try { listener(message.event); } catch { /* UI subscribers cannot interrupt worker cleanup. */ }
    }
  }

  private scheduleWorkerTermination(worker: UtilityProcess, requestId: string, pending: PendingRequest, delayMs: number,
    error: SshTerminalProviderError): void {
    clearTimeout(pending.cleanupTimer);
    pending.cleanupTimer = setTimeout(() => {
      if (this.pending.get(requestId) !== pending) return;
      this.pending.delete(requestId);
      pending.cleanup();
      void this.killWorker(worker).finally(() => pending.reject(error));
    }, delayMs);
  }

  private verifyHostKey(worker: UtilityProcess, sessionId: string, checkId: string, endpoint: SshHostEndpoint, evidence: HostKeyEvidence): void {
    const owner = this.sessions.get(sessionId);
    const expectedEndpoints = owner?.endpoints;
    const matchesEndpoint = expectedEndpoints?.some(candidate => candidate.host === endpoint.host && candidate.port === endpoint.port) ?? false;
    const verifier = matchesEndpoint ? owner?.verifyHost : undefined;
    const check = verifier ? Promise.resolve().then(() => verifier(endpoint, evidence)).catch(() => false) : Promise.resolve(false);
    void check.then(accepted => {
      const stillCurrent = this.worker === worker && this.sessions.get(sessionId) === owner && owner?.endpoints === expectedEndpoints;
      if (!stillCurrent) accepted = false;
      const response = { version: SSH_WORKER_PROTOCOL_VERSION, type: 'host-key-result', sessionId, checkId, accepted } as const satisfies SshWorkerRequest;
      try { worker.postMessage(response); } catch { void this.killWorker(worker); }
    });
  }

  private onWorkerExit(worker: UtilityProcess): void {
    if (this.worker !== worker) return;
    this.worker = undefined;
    const wasShuttingDown = this.shuttingDown !== undefined;
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.cleanup();
      pending.reject(new SshTerminalProviderError('UNAVAILABLE'));
      this.pending.delete(requestId);
    }
    const sessions = [...this.sessions.keys()];
    this.sessions.clear();
    if (!wasShuttingDown) {
      for (const sessionId of sessions) {
        const event: LocalTerminalEvent = { kind: 'failure', sessionId, error: { code: 'UNAVAILABLE', target: 'terminal', retryable: true } };
        for (const listener of this.listeners) {
          try { listener(event); } catch { /* Crash notification follows resource cleanup. */ }
        }
      }
    }
  }

  private async stopWorker(): Promise<void> {
    const worker = this.worker;
    if (!worker) {
      this.sessions.clear();
      return;
    }
    try {
      await this.request({ version: SSH_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(), command: 'shutdown' }, 3_000);
    } catch { /* The worker is killed below if graceful shutdown failed. */ }
    await this.killWorker(worker);
    this.sessions.clear();
  }

  private async killWorker(worker: UtilityProcess): Promise<void> {
    if (this.worker !== worker) return;
    try { worker.kill(); } catch { /* Process exit handler completes pending request cleanup. */ }
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 1_000);
      worker.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
}

function isBindPortResult(value: unknown): value is { readonly bindPort: number } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 1 && Object.hasOwn(record, 'bindPort') && Number.isSafeInteger(record.bindPort) &&
    (record.bindPort as number) >= 1 && (record.bindPort as number) <= 65_535;
}
