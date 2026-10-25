import { randomUUID } from 'node:crypto';
import type { UtilityProcess } from 'electron';
import { FtpFilesProviderError } from '../../../../packages/application/src/ftp-files.ts';
import type { FtpFilesProvider, FtpCredentials } from '../../../../packages/application/src/ftp-files.ts';
import type { CancellationSignal } from '../../../../packages/application/src/cancellation.ts';
import { isFtpDirectoryListing, isFtpTransferResult } from '../../../../packages/domain/src/ftp.ts';
import type { FtpEndpoint } from '../../../../packages/domain/src/ftp.ts';
import type { FtpTransferConflictPolicy, FtpTransferProgress, FtpTransferResult } from '../../../../packages/domain/src/ftp.ts';
import type { RemoteDirectoryListing } from '../../../../packages/domain/src/remote-files.ts';
import { parseFtpWorkerMessage, FTP_WORKER_PROTOCOL_VERSION } from '../workers/ftp-worker-protocol.ts';
import type { FtpWorkerErrorCode, FtpWorkerRequest } from '../workers/ftp-worker-protocol.ts';

interface PendingRequest {
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  cleanup: () => void;
  readonly onProgress?: (progress: FtpTransferProgress) => void;
  cleanupTimer?: ReturnType<typeof setTimeout>;
  timedOut: boolean;
  progressPhase?: FtpTransferProgress['phase'];
}

export type FtpWorkerLaunchOptions = {
  readonly cwd: string;
  readonly env: { readonly MRT_APP_ROOT: string };
  readonly serviceName: string;
  readonly stdio: 'ignore';
};
export type FtpWorkerLauncher = (workerPath: string, args: string[], options: FtpWorkerLaunchOptions) => UtilityProcess;

const MAX_PENDING_REQUESTS = 128;
export const MAX_ACTIVE_FTP_SESSIONS = 32;
const OPEN_TIMEOUT_MS = 45_000;
const LIST_TIMEOUT_MS = 20_000;
const TRANSFER_TIMEOUT_MS = 60 * 60_000;
const ACTION_TIMEOUT_MS = 5_000;
const WORKER_CLEANUP_GRACE_MS = 2_000;
const COMMIT_SETTLEMENT_GRACE_MS = 2 * 60_000;

function providerErrorCode(code: FtpWorkerErrorCode): FtpWorkerErrorCode {
  return code;
}

export class FtpFilesWorkerHost implements FtpFilesProvider {
  private readonly workerPath: string;
  private readonly appRoot: string;
  private readonly launchWorker: FtpWorkerLauncher;
  private worker: UtilityProcess | undefined;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly sessions = new Set<string>();
  private shuttingDown: Promise<void> | undefined;
  private workerExit: Promise<void> | undefined;
  private resolveWorkerExit: (() => void) | undefined;
  private terminating = false;

  constructor(workerPath: string, appRoot: string, launchWorker: FtpWorkerLauncher) {
    this.workerPath = workerPath;
    this.appRoot = appRoot;
    this.launchWorker = launchWorker;
  }

  async open(sessionId: string, endpoint: FtpEndpoint, credentials: FtpCredentials, cancellation?: CancellationSignal): Promise<void> {
    if (this.sessions.has(sessionId) || this.sessions.size >= MAX_ACTIVE_FTP_SESSIONS) throw new FtpFilesProviderError('BUSY');
    this.sessions.add(sessionId);
    const credentialsCopy = { username: credentials.username, password: credentials.password };
    const request = { version: FTP_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(), command: 'open', sessionId,
      endpoint, credentials: credentialsCopy } as const satisfies FtpWorkerRequest;
    try { await this.request(request, OPEN_TIMEOUT_MS, cancellation); }
    catch (error) { this.sessions.delete(sessionId); throw error; }
    finally { credentialsCopy.username = ''; credentialsCopy.password = ''; }
  }

  async listDirectory(sessionId: string, path: string, cancellation?: CancellationSignal): Promise<RemoteDirectoryListing> {
    if (!this.sessions.has(sessionId)) throw new FtpFilesProviderError('UNAVAILABLE');
    if (cancellation?.aborted) throw new FtpFilesProviderError('CANCELLED');
    const request = { version: FTP_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(), command: 'files.list', sessionId, path } as const satisfies FtpWorkerRequest;
    const result = await this.request(request, LIST_TIMEOUT_MS, cancellation);
    if (!isFtpDirectoryListing(result)) throw new FtpFilesProviderError('UNAVAILABLE');
    return result;
  }

  async uploadFile(sessionId: string, operationId: string, localPath: string, remoteDirectory: string, fileName: string,
    conflictPolicy: FtpTransferConflictPolicy, cancellation?: CancellationSignal,
    onProgress?: (progress: FtpTransferProgress) => void): Promise<FtpTransferResult> {
    if (!this.sessions.has(sessionId)) throw new FtpFilesProviderError('UNAVAILABLE');
    const request = { version: FTP_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(), command: 'files.upload', sessionId,
      operationId, localPath, remoteDirectory, fileName, conflictPolicy } as const satisfies FtpWorkerRequest;
    const result = await this.request(request, TRANSFER_TIMEOUT_MS, cancellation, onProgress);
    if (!isFtpTransferResult(result) || result.direction !== 'upload') throw new FtpFilesProviderError('UNAVAILABLE');
    return result;
  }

  async downloadFile(sessionId: string, operationId: string, remotePath: string, localPath: string,
    conflictPolicy: FtpTransferConflictPolicy, cancellation?: CancellationSignal,
    onProgress?: (progress: FtpTransferProgress) => void): Promise<FtpTransferResult> {
    if (!this.sessions.has(sessionId)) throw new FtpFilesProviderError('UNAVAILABLE');
    const request = { version: FTP_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(), command: 'files.download', sessionId,
      operationId, remotePath, localPath, conflictPolicy } as const satisfies FtpWorkerRequest;
    const result = await this.request(request, TRANSFER_TIMEOUT_MS, cancellation, onProgress);
    if (!isFtpTransferResult(result) || result.direction !== 'download') throw new FtpFilesProviderError('UNAVAILABLE');
    return result;
  }

  async close(sessionId: string): Promise<void> {
    if (!this.sessions.delete(sessionId)) return;
    await this.request({ version: FTP_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(), command: 'close', sessionId }, ACTION_TIMEOUT_MS);
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return this.shuttingDown;
    const operation = this.stopWorker();
    this.shuttingDown = operation;
    try { await operation; }
    finally { if (this.shuttingDown === operation) this.shuttingDown = undefined; }
  }

  private async request(request: Extract<FtpWorkerRequest, { readonly type: 'request' }>, timeoutMs: number,
    cancellation?: CancellationSignal, onProgress?: (progress: FtpTransferProgress) => void): Promise<unknown> {
    if (this.shuttingDown && request.command !== 'shutdown') throw new FtpFilesProviderError('CANCELLED');
    if (this.pending.size >= MAX_PENDING_REQUESTS) throw new FtpFilesProviderError('BUSY');
    const worker = this.ensureWorker();
    return new Promise<unknown>((resolve, reject) => {
      let removeCancellation = () => {};
      const timer = setTimeout(() => {
        removeCancellation();
        const current = this.pending.get(request.requestId);
        if (!current) return;
        current.timedOut = true;
        const isTransfer = request.command === 'files.upload' || request.command === 'files.download';
        if (request.command === 'files.list' || isTransfer) {
          const committing = isTransfer && current.progressPhase === 'committing';
          if (!committing) {
            const operationId = request.command === 'files.list' ? request.requestId : request.operationId;
            try {
              worker.postMessage({ version: FTP_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(), command: 'files.cancel',
                sessionId: request.sessionId, operationId } satisfies FtpWorkerRequest);
            } catch { /* The bounded cleanup timer below terminates a worker that cannot accept cancellation. */ }
          }
          this.scheduleWorkerTermination(worker, request.requestId, current,
            committing ? COMMIT_SETTLEMENT_GRACE_MS : WORKER_CLEANUP_GRACE_MS);
          return;
        }
        this.pending.delete(request.requestId);
        current.cleanup();
        void this.killWorker(worker).finally(() => current.reject(new FtpFilesProviderError('TIMEOUT')));
      }, timeoutMs);
      const current: PendingRequest = { resolve, reject, timer, cleanup: () => {}, timedOut: false,
        ...(onProgress ? { onProgress } : {}) };
      current.cleanup = () => { clearTimeout(timer); clearTimeout(current.cleanupTimer); removeCancellation(); };
      this.pending.set(request.requestId, current);
      const operationId = request.command === 'files.upload' || request.command === 'files.download' ? request.operationId : request.requestId;
      if ((request.command === 'files.list' || request.command === 'files.upload' || request.command === 'files.download' || request.command === 'open') && cancellation) {
        const cancel = () => {
          if (this.worker !== worker) return;
          const message = request.command === 'open'
            ? { version: FTP_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(), command: 'close', sessionId: request.sessionId } as const satisfies FtpWorkerRequest
            : { version: FTP_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(), command: 'files.cancel',
              sessionId: request.sessionId, operationId } as const satisfies FtpWorkerRequest;
          try { worker.postMessage(message); }
          catch { void this.killWorker(worker); }
        };
        cancellation.addEventListener('abort', cancel, { once: true });
        removeCancellation = () => cancellation.removeEventListener('abort', cancel);
      }
      try { worker.postMessage(request); }
      catch {
        current.cleanup();
        this.pending.delete(request.requestId);
        reject(new FtpFilesProviderError('UNAVAILABLE'));
        void this.killWorker(worker);
        return;
      }
      if (cancellation?.aborted && (request.command === 'files.list' || request.command === 'files.upload' || request.command === 'files.download' || request.command === 'open')) {
        const message = request.command === 'open'
          ? { version: FTP_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(), command: 'close', sessionId: request.sessionId } as const satisfies FtpWorkerRequest
          : { version: FTP_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(), command: 'files.cancel',
            sessionId: request.sessionId, operationId } as const satisfies FtpWorkerRequest;
        try { worker.postMessage(message); }
        catch { void this.killWorker(worker); }
      }
    });
  }

  private ensureWorker(): UtilityProcess {
    if (this.worker && !this.terminating) return this.worker;
    if (this.worker) throw new FtpFilesProviderError('BUSY');
    let resolveExit!: () => void;
    const exited = new Promise<void>(resolve => { resolveExit = resolve; });
    const worker = this.launchWorker(this.workerPath, [], {
      cwd: process.resourcesPath ?? this.appRoot,
      env: { MRT_APP_ROOT: this.appRoot },
      serviceName: 'MultiRemoteTerminal FTP file provider',
      stdio: 'ignore'
    });
    this.worker = worker;
    this.terminating = false;
    this.workerExit = exited;
    this.resolveWorkerExit = resolveExit;
    worker.on('message', message => this.receive(worker, message));
    worker.on('exit', () => this.onWorkerExit(worker));
    return worker;
  }

  private receive(worker: UtilityProcess, value: unknown): void {
    if (this.worker !== worker) return;
    const message = parseFtpWorkerMessage(value);
    if (!message) { void this.killWorker(worker); return; }
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    if (message.type === 'progress') {
      const previouslyCommitting = pending.progressPhase === 'committing';
      pending.progressPhase = message.progress.phase;
      if (pending.timedOut && message.progress.phase === 'committing' && !previouslyCommitting) {
        this.scheduleWorkerTermination(worker, message.requestId, pending, COMMIT_SETTLEMENT_GRACE_MS);
      }
      try { pending.onProgress?.(message.progress); } catch { /* The UI listener cannot interrupt worker ownership. */ }
      return;
    }
    clearTimeout(pending.timer);
    clearTimeout(pending.cleanupTimer);
    this.pending.delete(message.requestId);
    pending.cleanup();
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new FtpFilesProviderError(pending.timedOut && message.errorCode === 'CANCELLED' ? 'TIMEOUT' : providerErrorCode(message.errorCode),
      message.sessionUsable));
  }

  private scheduleWorkerTermination(worker: UtilityProcess, requestId: string, pending: PendingRequest, delayMs: number): void {
    clearTimeout(pending.cleanupTimer);
    pending.cleanupTimer = setTimeout(() => {
      if (this.pending.get(requestId) !== pending) return;
      this.pending.delete(requestId);
      pending.cleanup();
      void this.killWorker(worker).finally(() => pending.reject(new FtpFilesProviderError('TIMEOUT')));
    }, delayMs);
  }

  private onWorkerExit(worker: UtilityProcess): void {
    if (this.worker !== worker) return;
    this.terminating = true;
    for (const [requestId, pending] of this.pending) {
      pending.cleanup();
      pending.reject(new FtpFilesProviderError('UNAVAILABLE'));
      this.pending.delete(requestId);
    }
    this.sessions.clear();
    this.worker = undefined;
    this.terminating = false;
    this.resolveWorkerExit?.();
  }

  private async killWorker(worker: UtilityProcess): Promise<void> {
    if (this.worker === worker) this.terminating = true;
    try { worker.kill(); } catch { /* Exit handling settles pending work. */ }
    await this.waitForWorkerExit(worker, 2_000).catch(() => undefined);
  }

  private async stopWorker(): Promise<void> {
    const worker = this.worker;
    if (!worker) { this.sessions.clear(); return; }
    try {
      await this.request({ version: FTP_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(), command: 'shutdown' }, ACTION_TIMEOUT_MS);
    } catch { /* The process is killed below if it does not shut down cleanly. */ }
    worker.kill();
    await this.waitForWorkerExit(worker, 2_000).catch(() => undefined);
    this.sessions.clear();
    if (this.worker === worker) this.worker = undefined;
  }

  private async waitForWorkerExit(worker: UtilityProcess, timeoutMs: number): Promise<void> {
    if (this.worker !== worker) return;
    const exit = this.workerExit;
    if (!exit) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([exit, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('FTP worker shutdown timed out')), timeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  }
}
