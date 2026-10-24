import { randomUUID } from 'node:crypto';
import type { UtilityProcess } from 'electron';
import { TelnetTerminalProviderError } from '../../../../packages/application/src/telnet-terminals.ts';
import type { TelnetTerminalProvider, TelnetTerminalProviderErrorCode } from '../../../../packages/application/src/telnet-terminals.ts';
import type { LocalTerminalEvent } from '../../../../packages/application/src/local-terminals.ts';
import type { RemoteEndpoint } from '../../../../packages/domain/src/remote-endpoint.ts';
import type { TerminalSize } from '../../../../packages/domain/src/local-terminal.ts';
import { parseTelnetWorkerMessage, TELNET_WORKER_PROTOCOL_VERSION } from '../workers/telnet-worker-protocol.ts';
import type { TelnetWorkerErrorCode, TelnetWorkerRequest } from '../workers/telnet-worker-protocol.ts';

interface PendingRequest {
  readonly resolve: (result: Record<string, never>) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export type TelnetWorkerLaunchOptions = {
  readonly cwd: string;
  readonly env: { readonly MRT_APP_ROOT: string };
  readonly serviceName: string;
  readonly stdio: 'ignore';
};
export type TelnetWorkerLauncher = (workerPath: string, args: string[], options: TelnetWorkerLaunchOptions) => UtilityProcess;

const MAX_PENDING_REQUESTS = 128;
const OPEN_TIMEOUT_MS = 15_000;
const ACTION_TIMEOUT_MS = 5_000;

function providerErrorCode(code: TelnetWorkerErrorCode): TelnetTerminalProviderErrorCode {
  if (code === 'CANCELLED' || code === 'TIMEOUT' || code === 'BUSY' || code === 'OUTPUT_LIMIT') return code;
  return 'UNAVAILABLE';
}

export class TelnetTerminalWorkerHost implements TelnetTerminalProvider {
  private readonly workerPath: string;
  private readonly appRoot: string;
  private readonly launchWorker: TelnetWorkerLauncher;
  private worker: UtilityProcess | undefined;
  private workerExit: Promise<void> | undefined;
  private resolveWorkerExit: (() => void) | undefined;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly sessions = new Set<string>();
  private readonly listeners = new Set<(event: LocalTerminalEvent) => void>();
  private stopping = false;
  private terminating = false;

  constructor(workerPath: string, appRoot: string, launchWorker: TelnetWorkerLauncher) {
    this.workerPath = workerPath;
    this.appRoot = appRoot;
    this.launchWorker = launchWorker;
  }

  async open(sessionId: string, endpoint: RemoteEndpoint, size: TerminalSize): Promise<void> {
    if (this.sessions.has(sessionId)) throw new TelnetTerminalProviderError('UNAVAILABLE');
    this.sessions.add(sessionId);
    try {
      await this.request({ version: TELNET_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(),
        command: 'open', sessionId, endpoint, size }, OPEN_TIMEOUT_MS);
    } catch (error) {
      this.sessions.delete(sessionId);
      throw error;
    }
  }

  async write(sessionId: string, data: string): Promise<void> {
    this.requireSession(sessionId);
    await this.request({ version: TELNET_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(), command: 'write', sessionId, data }, ACTION_TIMEOUT_MS);
  }

  async resize(sessionId: string, size: TerminalSize): Promise<void> {
    this.requireSession(sessionId);
    await this.request({ version: TELNET_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(), command: 'resize', sessionId, size }, ACTION_TIMEOUT_MS);
  }

  async acknowledgeOutput(sessionId: string, sequence: number): Promise<void> {
    if (!this.sessions.has(sessionId)) return;
    await this.request({ version: TELNET_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(), command: 'ack', sessionId, sequence }, ACTION_TIMEOUT_MS);
  }

  async close(sessionId: string): Promise<void> {
    if (!this.sessions.delete(sessionId)) return;
    await this.request({ version: TELNET_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(), command: 'close', sessionId }, ACTION_TIMEOUT_MS);
  }

  subscribe(listener: (event: LocalTerminalEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async shutdown(): Promise<void> {
    if (this.stopping) {
      await this.waitForCurrentWorkerExit();
      return;
    }
    this.stopping = true;
    const worker = this.worker;
    if (!worker) {
      this.sessions.clear();
      this.stopping = false;
      return;
    }
    try {
      await this.request({ version: TELNET_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(), command: 'shutdown' }, ACTION_TIMEOUT_MS);
    } catch { /* The process is killed below if it does not shut down cleanly. */ }
    worker.kill();
    await this.waitForWorkerExit(worker, 2_000).catch(() => undefined);
    this.sessions.clear();
    if (this.worker === worker) this.worker = undefined;
    this.stopping = false;
  }

  private requireSession(sessionId: string): void {
    if (!this.sessions.has(sessionId)) throw new TelnetTerminalProviderError('UNAVAILABLE');
  }

  private async request(request: Extract<TelnetWorkerRequest, { readonly type: 'request' }>, timeoutMs: number): Promise<Record<string, never>> {
    if (this.stopping && request.command !== 'shutdown') throw new TelnetTerminalProviderError('CANCELLED');
    if (this.pending.size >= MAX_PENDING_REQUESTS) throw new TelnetTerminalProviderError('BUSY');
    const worker = this.ensureWorker();
    return new Promise<Record<string, never>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.requestId);
        reject(new TelnetTerminalProviderError('TIMEOUT'));
        void this.killWorker(worker);
      }, timeoutMs);
      this.pending.set(request.requestId, { resolve, reject, timer });
      try { worker.postMessage(request); }
      catch {
        clearTimeout(timer);
        this.pending.delete(request.requestId);
        reject(new TelnetTerminalProviderError('UNAVAILABLE'));
        void this.killWorker(worker);
      }
    });
  }

  private ensureWorker(): UtilityProcess {
    if (this.worker && !this.terminating) return this.worker;
    if (this.worker) throw new TelnetTerminalProviderError('BUSY');
    let resolveExit!: () => void;
    const exited = new Promise<void>(resolve => { resolveExit = resolve; });
    const worker = this.launchWorker(this.workerPath, [], {
      cwd: this.appRoot,
      env: { MRT_APP_ROOT: this.appRoot },
      serviceName: 'MultiRemoteTerminal Telnet terminal provider',
      stdio: 'ignore'
    });
    this.worker = worker;
    this.terminating = false;
    this.workerExit = exited;
    this.resolveWorkerExit = resolveExit;
    worker.on('message', message => this.receive(worker, message));
    worker.on('exit', () => this.handleWorkerExit(worker));
    return worker;
  }

  private receive(worker: UtilityProcess, value: unknown): void {
    const message = parseTelnetWorkerMessage(value);
    if (!message) { void this.killWorker(worker); return; }
    if (message.type === 'event') {
      if (!this.sessions.has(message.event.sessionId)) return;
      for (const listener of this.listeners) {
        try { listener(message.event); } catch { /* Presentation cannot interrupt socket ownership. */ }
      }
      return;
    }
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.requestId);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new TelnetTerminalProviderError(providerErrorCode(message.errorCode)));
  }

  private handleWorkerExit(worker: UtilityProcess): void {
    const isCurrent = this.worker === worker;
    if (isCurrent) this.terminating = true;
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new TelnetTerminalProviderError('UNAVAILABLE'));
      this.pending.delete(requestId);
    }
    const sessions = [...this.sessions];
    this.sessions.clear();
    if (isCurrent) {
      this.worker = undefined;
      this.terminating = false;
      this.resolveWorkerExit?.();
    }
    if (!this.stopping) {
      for (const sessionId of sessions) {
        const event: LocalTerminalEvent = { kind: 'failure', sessionId, error: { code: 'UNAVAILABLE', target: 'terminal', retryable: true } };
        for (const listener of this.listeners) {
          try { listener(event); } catch { /* Worker cleanup precedes notification. */ }
        }
      }
    }
  }

  private async killWorker(worker: UtilityProcess): Promise<void> {
    if (this.worker === worker) this.terminating = true;
    try { worker.kill(); } catch { /* Exit handling still owns pending request settlement. */ }
    await this.waitForWorkerExit(worker, 2_000).catch(() => undefined);
  }

  private async waitForWorkerExit(worker: UtilityProcess, timeoutMs: number): Promise<void> {
    if (this.worker !== worker) return;
    const exit = this.workerExit;
    if (!exit) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([exit, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Telnet worker shutdown timed out')), timeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  }

  private async waitForCurrentWorkerExit(): Promise<void> {
    const worker = this.worker;
    if (worker) await this.waitForWorkerExit(worker, 2_000).catch(() => undefined);
  }
}
