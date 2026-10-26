import { randomUUID } from 'node:crypto';
import { utilityProcess } from 'electron';
import type { UtilityProcess } from 'electron';
import { createUtilityWorkerEnvironment } from './utility-worker-environment.ts';
import { TftpServerProviderError } from '../../../../packages/application/src/tftp-server.ts';
import type { TftpServerProvider } from '../../../../packages/application/src/tftp-server.ts';
import { parseTftpServerWorkerMessage, TFTP_SERVER_WORKER_PROTOCOL_VERSION } from '../workers/tftp-server-worker-protocol.ts';
import type { TftpServerWorkerRequest } from '../workers/tftp-server-worker-protocol.ts';

interface PendingRequest {
  readonly resolve: (result: Record<string, unknown>) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

type TftpServerWorkerRequestBody =
  | { readonly command: 'start'; readonly rootDirectory: string; readonly port: number }
  | { readonly command: 'stop' | 'shutdown' };

const MAX_PENDING_REQUESTS = 8;
const REQUEST_TIMEOUT_MS = 10_000;
const SHUTDOWN_TIMEOUT_MS = 3_000;

export class TftpServerWorkerHost implements TftpServerProvider {
  private worker: UtilityProcess | undefined;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly exitListeners = new Set<() => void>();
  private stopping = false;

  constructor(private readonly workerPath: string, private readonly appRoot: string) {}

  async start(rootDirectory: string, port: number): Promise<number> {
    const result = await this.request({ command: 'start', rootDirectory, port });
    if (!Number.isSafeInteger(result.port) || (result.port as number) < 1 || (result.port as number) > 65_535) {
      throw new TftpServerProviderError('UNAVAILABLE');
    }
    return result.port as number;
  }

  async stop(): Promise<void> {
    if (!this.worker) return;
    await this.request({ command: 'stop' });
  }

  async shutdown(): Promise<void> {
    const worker = this.worker;
    if (!worker) return;
    this.stopping = true;
    try { await this.request({ command: 'shutdown' }, SHUTDOWN_TIMEOUT_MS); }
    catch { /* The process is terminated below after the bounded stop request. */ }
    worker.kill();
    await this.waitForExit(worker, SHUTDOWN_TIMEOUT_MS).catch(() => undefined);
    if (this.worker === worker) await this.handleExit(worker);
    this.stopping = false;
  }

  subscribeToExit(listener: () => void): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  private async request(command: TftpServerWorkerRequestBody,
    timeoutMs = REQUEST_TIMEOUT_MS): Promise<Record<string, unknown>> {
    if (this.pending.size >= MAX_PENDING_REQUESTS) throw new TftpServerProviderError('BUSY');
    const worker = this.ensureWorker();
    const requestId = randomUUID();
    const request = { version: TFTP_SERVER_WORKER_PROTOCOL_VERSION, type: 'request', requestId, ...command } as TftpServerWorkerRequest;
    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new TftpServerProviderError('TIMEOUT'));
        if (this.worker === worker) {
          worker.kill();
          void this.waitForExit(worker, SHUTDOWN_TIMEOUT_MS).then(() => this.handleExit(worker)).catch(() => undefined);
        }
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      try { worker.postMessage(request); } catch {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(new TftpServerProviderError('UNAVAILABLE'));
      }
    });
  }

  private ensureWorker(): UtilityProcess {
    if (this.worker) return this.worker;
    if (this.stopping) throw new TftpServerProviderError('UNAVAILABLE');
    const worker = utilityProcess.fork(this.workerPath, [], {
      cwd: process.resourcesPath ?? this.appRoot,
      env: createUtilityWorkerEnvironment(this.appRoot, process.env),
      serviceName: 'MultiRemoteTerminal local TFTP server',
      stdio: 'ignore'
    });
    this.worker = worker;
    worker.on('message', message => this.receive(worker, message));
    worker.on('exit', () => { void this.handleExit(worker); });
    return worker;
  }

  private receive(worker: UtilityProcess, value: unknown): void {
    if (worker !== this.worker) return;
    const message = parseTftpServerWorkerMessage(value);
    if (!message) {
      worker.kill();
      void this.handleExit(worker);
      return;
    }
    if (message.type === 'state') {
      for (const listener of this.exitListeners) {
        try { listener(); } catch { /* Presentation and controller listeners cannot interrupt worker cleanup. */ }
      }
      return;
    }
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.requestId);
    if (!message.ok) {
      pending.reject(new TftpServerProviderError(message.errorCode));
      return;
    }
    pending.resolve(message.result);
  }

  private async handleExit(worker: UtilityProcess): Promise<void> {
    if (this.worker !== worker) return;
    this.worker = undefined;
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new TftpServerProviderError('UNAVAILABLE'));
      this.pending.delete(requestId);
    }
    if (!this.stopping) {
      for (const listener of this.exitListeners) {
        try { listener(); } catch { /* Process exit cleanup has priority. */ }
      }
    }
  }

  private async waitForExit(worker: UtilityProcess, timeoutMs: number): Promise<void> {
    if (this.worker !== worker) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { worker.removeListener('exit', onExit); reject(new TftpServerProviderError('TIMEOUT')); }, timeoutMs);
      const onExit = (): void => { clearTimeout(timer); resolve(); };
      worker.once('exit', onExit);
    });
  }
}
