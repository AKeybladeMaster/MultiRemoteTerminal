import { randomUUID } from 'node:crypto';
import type { UtilityProcess } from 'electron';
import { SerialTerminalProviderError } from '../../../../packages/application/src/serial-terminals.ts';
import type { SerialTerminalProvider, SerialTerminalProviderErrorCode } from '../../../../packages/application/src/serial-terminals.ts';
import type { LocalTerminalEvent } from '../../../../packages/application/src/local-terminals.ts';
import type { SerialConfiguration, SerialPortInfo } from '../../../../packages/domain/src/serial.ts';
import { serialWriteTimeoutMs } from '../../../../packages/domain/src/serial.ts';
import type { TerminalSize } from '../../../../packages/domain/src/local-terminal.ts';
import { parseSerialWorkerMessage, SERIAL_WORKER_PROTOCOL_VERSION } from '../workers/serial-worker-protocol.ts';
import type { SerialWorkerErrorCode, SerialWorkerRequest } from '../workers/serial-worker-protocol.ts';

interface PendingRequest {
  readonly resolve: (result: Record<string, never> | { readonly ports: readonly SerialPortInfo[] }) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export type SerialWorkerLaunchOptions = {
  readonly cwd: string;
  readonly env: { readonly MRT_APP_ROOT: string; readonly MRT_SERIAL_MOCK_MODE?: '1' };
  readonly serviceName: string;
  readonly stdio: 'ignore';
};
export type SerialWorkerLauncher = (workerPath: string, args: string[], options: SerialWorkerLaunchOptions) => UtilityProcess;

const MAX_PENDING_REQUESTS = 128;
const OPEN_TIMEOUT_MS = 15_000;
const LIST_TIMEOUT_MS = 8_000;
const ACTION_TIMEOUT_MS = 5_000;
const SHUTDOWN_TIMEOUT_MS = 3_000;

function providerErrorCode(code: SerialWorkerErrorCode): SerialTerminalProviderErrorCode { return code; }

export class SerialTerminalWorkerHost implements SerialTerminalProvider {
  private readonly workerPath: string;
  private readonly appRoot: string;
  private readonly launchWorker: SerialWorkerLauncher;
  private readonly useMockForE2e: boolean;
  private worker: UtilityProcess | undefined;
  private workerExit: Promise<void> | undefined;
  private resolveWorkerExit: (() => void) | undefined;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly sessions = new Map<string, SerialConfiguration>();
  private readonly listeners = new Set<(event: LocalTerminalEvent) => void>();
  private stopping = false;
  private terminating = false;

  constructor(workerPath: string, appRoot: string, launchWorker: SerialWorkerLauncher, useMockForE2e = false) {
    this.workerPath = workerPath;
    this.appRoot = appRoot;
    this.launchWorker = launchWorker;
    this.useMockForE2e = useMockForE2e;
  }

  async listPorts(): Promise<readonly SerialPortInfo[]> {
    const result = await this.request({ version: SERIAL_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(), command: 'list' }, LIST_TIMEOUT_MS);
    if (!('ports' in result)) throw new SerialTerminalProviderError('UNAVAILABLE');
    return result.ports;
  }

  async open(sessionId: string, configuration: SerialConfiguration): Promise<void> {
    if (this.sessions.has(sessionId)) throw new SerialTerminalProviderError('UNAVAILABLE');
    this.sessions.set(sessionId, configuration);
    try {
      await this.request({ version: SERIAL_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(), command: 'open', sessionId, configuration }, OPEN_TIMEOUT_MS);
    } catch (error) {
      this.sessions.delete(sessionId);
      throw error;
    }
  }

  async write(sessionId: string, data: string): Promise<void> {
    const configuration = this.sessions.get(sessionId);
    if (!configuration) throw new SerialTerminalProviderError('UNAVAILABLE');
    await this.request({ version: SERIAL_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(), command: 'write', sessionId, data },
      serialWriteTimeoutMs(configuration, data.length));
  }

  async resize(sessionId: string, size: TerminalSize): Promise<void> {
    this.requireSession(sessionId);
    await this.request({ version: SERIAL_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(), command: 'resize', sessionId, size }, ACTION_TIMEOUT_MS);
  }

  async acknowledgeOutput(sessionId: string, sequence: number): Promise<void> {
    if (!this.sessions.has(sessionId)) return;
    await this.request({ version: SERIAL_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(), command: 'ack', sessionId, sequence }, ACTION_TIMEOUT_MS);
  }

  async close(sessionId: string): Promise<void> {
    if (!this.sessions.delete(sessionId)) return;
    await this.request({ version: SERIAL_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(), command: 'close', sessionId }, ACTION_TIMEOUT_MS);
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
      await this.request({ version: SERIAL_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(), command: 'shutdown' }, SHUTDOWN_TIMEOUT_MS);
    } catch { /* The process is killed below if it does not shut down cleanly. */ }
    worker.kill();
    await this.waitForWorkerExit(worker, 2_000).catch(() => undefined);
    this.sessions.clear();
    if (this.worker === worker) this.worker = undefined;
    this.stopping = false;
  }

  private requireSession(sessionId: string): void {
    if (!this.sessions.has(sessionId)) throw new SerialTerminalProviderError('UNAVAILABLE');
  }

  private async request(request: Extract<SerialWorkerRequest, { readonly type: 'request' }>, timeoutMs: number): Promise<Record<string, never> | { readonly ports: readonly SerialPortInfo[] }> {
    if (this.stopping && request.command !== 'shutdown') throw new SerialTerminalProviderError('CANCELLED');
    if (this.pending.size >= MAX_PENDING_REQUESTS) throw new SerialTerminalProviderError('BUSY');
    const worker = this.ensureWorker();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.requestId);
        reject(new SerialTerminalProviderError('TIMEOUT'));
        void this.killWorker(worker);
      }, timeoutMs);
      this.pending.set(request.requestId, { resolve, reject, timer });
      try { worker.postMessage(request); }
      catch {
        clearTimeout(timer);
        this.pending.delete(request.requestId);
        reject(new SerialTerminalProviderError('UNAVAILABLE'));
        void this.killWorker(worker);
      }
    });
  }

  private ensureWorker(): UtilityProcess {
    if (this.worker && !this.terminating) return this.worker;
    if (this.worker) throw new SerialTerminalProviderError('BUSY');
    let resolveExit!: () => void;
    const exited = new Promise<void>(resolve => { resolveExit = resolve; });
    const worker = this.launchWorker(this.workerPath, [], {
      cwd: process.resourcesPath ?? this.appRoot,
      env: { MRT_APP_ROOT: this.appRoot, ...(this.useMockForE2e ? { MRT_SERIAL_MOCK_MODE: '1' as const } : {}) },
      serviceName: 'MultiRemoteTerminal serial provider',
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
    const message = parseSerialWorkerMessage(value);
    if (!message) { void this.killWorker(worker); return; }
    if (message.type === 'event') {
      if (!this.sessions.has(message.event.sessionId)) return;
      for (const listener of this.listeners) {
        try { listener(message.event); } catch { /* Renderer notification cannot interrupt port cleanup. */ }
      }
      return;
    }
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.requestId);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new SerialTerminalProviderError(providerErrorCode(message.errorCode)));
  }

  private handleWorkerExit(worker: UtilityProcess): void {
    const isCurrent = this.worker === worker;
    if (isCurrent) this.terminating = true;
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new SerialTerminalProviderError('UNAVAILABLE'));
      this.pending.delete(requestId);
    }
    const sessionIds = [...this.sessions.keys()];
    this.sessions.clear();
    if (isCurrent) {
      this.worker = undefined;
      this.terminating = false;
      this.resolveWorkerExit?.();
    }
    if (!this.stopping) {
      for (const sessionId of sessionIds) {
        const event: LocalTerminalEvent = { kind: 'failure', sessionId, error: { code: 'UNAVAILABLE', target: 'terminal', retryable: true } };
        for (const listener of this.listeners) {
          try { listener(event); } catch { /* Process cleanup has already completed. */ }
        }
      }
    }
  }

  private async killWorker(worker: UtilityProcess): Promise<void> {
    if (this.worker === worker) this.terminating = true;
    try { worker.kill(); } catch { /* Exit handling settles pending operations. */ }
    await this.waitForWorkerExit(worker, 2_000).catch(() => undefined);
  }

  private async waitForWorkerExit(worker: UtilityProcess, timeoutMs: number): Promise<void> {
    if (this.worker !== worker) return;
    const exit = this.workerExit;
    if (!exit) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([exit, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Serial worker shutdown timed out')), timeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  }

  private async waitForCurrentWorkerExit(): Promise<void> {
    const worker = this.worker;
    if (worker) await this.waitForWorkerExit(worker, 2_000).catch(() => undefined);
  }
}
