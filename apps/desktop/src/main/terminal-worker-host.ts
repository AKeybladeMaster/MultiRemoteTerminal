import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { utilityProcess } from 'electron';
import type { UtilityProcess } from 'electron';
import type { LocalTerminalEvent, LocalTerminalProvider } from '../../../../packages/application/src/local-terminals.ts';
import type { LocalTerminalLaunch, TerminalSize } from '../../../../packages/domain/src/local-terminal.ts';
import type { WslDistribution } from '../../../../packages/domain/src/wsl-distributions.ts';
import { parseTerminalWorkerMessage, WORKER_PROTOCOL_VERSION } from '../workers/protocol.ts';
import type { TerminalWorkerRequest } from '../workers/protocol.ts';

type TerminalWorkerRequestBody = TerminalWorkerRequest extends infer Request
  ? Request extends { readonly type: 'request' }
    ? Omit<Request, 'version' | 'type' | 'requestId'>
    : never
  : never;

interface PendingRequest {
  readonly resolve: (result: Record<string, unknown>) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly command: TerminalWorkerRequest['command'];
}

interface TerminalWorkerHostOptions {
  readonly systemDirectory: string;
  readonly wslHarnessEnabled?: boolean;
}

const MAX_PENDING_REQUESTS = 256;
export class TerminalWorkerHost implements LocalTerminalProvider {
  private worker: UtilityProcess | undefined;
  private workerExit: Promise<void> | undefined;
  private resolveWorkerExit: (() => void) | undefined;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly processIds = new Map<string, number>();
  private readonly opening = new Set<string>();
  private readonly exitedDuringOpen = new Set<string>();
  private readonly earlyEvents = new Map<string, LocalTerminalEvent[]>();
  private readonly listeners = new Set<(event: LocalTerminalEvent) => void>();
  private stopping = false;
  private terminating = false;

  constructor(
    private readonly workerPath: string,
    private readonly appRoot: string,
    private readonly openReplyBarrier?: (sessionId: string) => Promise<void>,
    private readonly options: TerminalWorkerHostOptions = { systemDirectory: '' }
  ) {}

  async open(sessionId: string, launch: LocalTerminalLaunch, size: TerminalSize): Promise<void> {
    this.opening.add(sessionId);
    this.exitedDuringOpen.delete(sessionId);
    try {
      const result = await this.request({ command: 'open', sessionId, launch, size });
      await this.openReplyBarrier?.(sessionId);
      if (!Number.isSafeInteger(result.pid) || (result.pid as number) < 1) throw new Error('Terminal worker returned an invalid process ID');
      if (!this.exitedDuringOpen.has(sessionId)) this.processIds.set(sessionId, result.pid as number);
    } finally {
      this.opening.delete(sessionId);
      this.exitedDuringOpen.delete(sessionId);
      this.earlyEvents.delete(sessionId);
    }
  }

  async listWslDistributions(): Promise<readonly WslDistribution[]> {
    const result = await this.request({ command: 'wsl.list' });
    if (!Array.isArray(result.distributions)) throw new Error('Terminal worker returned an invalid WSL distribution list');
    return result.distributions as unknown as readonly WslDistribution[];
  }

  async cancelWslDistributionDiscovery(): Promise<void> {
    await this.request({ command: 'wsl.cancel' });
  }

  async write(sessionId: string, data: string): Promise<void> {
    await this.request({ command: 'write', sessionId, data });
  }

  async resize(sessionId: string, size: TerminalSize): Promise<void> {
    await this.request({ command: 'resize', sessionId, size });
  }

  async acknowledgeOutput(sessionId: string, sequence: number): Promise<void> {
    await this.request({ command: 'ack', sessionId, sequence });
  }

  async close(sessionId: string): Promise<void> {
    const pid = this.processIds.get(sessionId);
    try {
      await this.request({ command: 'close', sessionId });
      this.processIds.delete(sessionId);
    } catch (error) {
      if (pid !== undefined) await this.killProcessTree(pid);
      this.processIds.delete(sessionId);
      throw error;
    }
  }

  subscribe(listener: (event: LocalTerminalEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async shutdown(): Promise<void> {
    this.stopping = true;
    const worker = this.worker;
    if (!worker) {
      this.stopping = false;
      return;
    }
    try {
      await this.request({ command: 'shutdown' });
      worker.kill();
      await this.waitForWorkerExit(worker, 3_000);
    } catch {
      if (worker.pid !== undefined) await this.killProcessTree(worker.pid);
      worker.kill();
      await this.waitForWorkerExit(worker, 2_000).catch(() => undefined);
    } finally {
      this.processIds.clear();
      this.opening.clear();
      this.exitedDuringOpen.clear();
      this.earlyEvents.clear();
      if (this.worker === worker) this.worker = undefined;
      this.stopping = false;
    }
  }

  private async request(command: TerminalWorkerRequestBody): Promise<Record<string, unknown>> {
    if (this.pending.size >= MAX_PENDING_REQUESTS) throw new Error('Terminal worker queue is full');
    const worker = this.ensureWorker();
    const requestId = randomUUID();
    const request = { version: WORKER_PROTOCOL_VERSION, type: 'request', requestId, ...command } as TerminalWorkerRequest;
    const timeoutMs = request.command === 'open' ? 15_000 : request.command === 'wsl.list' ? 8_000 :
      request.command === 'close' || request.command === 'shutdown' ? 5_000 : 3_000;
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('Terminal worker request timed out'));
        void this.stopTimedOutWorker(worker);
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer, command: request.command });
      try { worker.postMessage(request); } catch {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(new Error('Terminal worker is unavailable'));
      }
    });
  }

  private ensureWorker(): UtilityProcess {
    if (this.worker && !this.terminating) return this.worker;
    if (this.worker) throw new Error('Terminal worker is stopping');
    let resolveExit!: () => void;
    const exited = new Promise<void>(resolve => { resolveExit = resolve; });
    const worker = utilityProcess.fork(this.workerPath, [], {
      cwd: process.resourcesPath ?? this.appRoot,
      env: { ...process.env, MRT_APP_ROOT: this.appRoot, MRT_WINDOWS_SYSTEM_DIRECTORY: this.options.systemDirectory,
        MRT_E2E_WSL_HARNESS: this.options.wslHarnessEnabled === true ? '1' : '0' },
      serviceName: 'MultiRemoteTerminal local terminal provider',
      stdio: 'ignore'
    });
    this.worker = worker;
    this.terminating = false;
    this.workerExit = exited;
    this.resolveWorkerExit = resolveExit;
    worker.on('message', message => this.receive(worker, message));
    worker.on('exit', () => { void this.handleWorkerExit(worker); });
    return worker;
  }

  private receive(worker: UtilityProcess, value: unknown): void {
    const message = parseTerminalWorkerMessage(value);
    if (!message) {
      if (this.worker === worker) {
        this.terminating = true;
        void this.stopTimedOutWorker(worker);
      }
      return;
    }
    if (message.type === 'started') {
      if (!this.opening.has(message.sessionId)) return;
      this.processIds.set(message.sessionId, message.pid);
      for (const event of this.earlyEvents.get(message.sessionId) ?? []) this.deliverEvent(event);
      this.earlyEvents.delete(message.sessionId);
      return;
    }
    if (message.type === 'reply') {
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.requestId);
      if (!message.ok) pending.reject(new Error('Terminal worker operation failed'));
      else pending.resolve(message.result);
      return;
    }
    const event = message.event;
    if (!this.processIds.has(event.sessionId) && !this.opening.has(event.sessionId)) return;
    if (this.opening.has(event.sessionId) && !this.processIds.has(event.sessionId)) {
      const queue = this.earlyEvents.get(event.sessionId) ?? [];
      queue.push(event);
      this.earlyEvents.set(event.sessionId, queue);
      return;
    }
    this.deliverEvent(event);
  }

  private deliverEvent(event: LocalTerminalEvent): void {
    if (event.kind === 'exit') {
      this.processIds.delete(event.sessionId);
      if (this.opening.has(event.sessionId)) this.exitedDuringOpen.add(event.sessionId);
    }
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* Renderer listeners cannot interrupt worker ownership. */ }
    }
  }

  private async handleWorkerExit(worker: UtilityProcess): Promise<void> {
    const isCurrent = this.worker === worker;
    if (isCurrent) this.terminating = true;
    const sessions = [...this.processIds.entries()];
    this.processIds.clear();
    this.opening.clear();
    this.exitedDuringOpen.clear();
    this.earlyEvents.clear();
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Terminal worker stopped'));
      this.pending.delete(requestId);
    }
    await Promise.allSettled(sessions.map(([, pid]) => this.killProcessTree(pid)));
    if (!this.stopping) {
      for (const [sessionId] of sessions) this.publishFailure(sessionId);
    }
    if (isCurrent) {
      this.worker = undefined;
      this.terminating = false;
      this.resolveWorkerExit?.();
    }
  }

  private publishFailure(sessionId: string): void {
    const event: LocalTerminalEvent = { kind: 'failure', sessionId, error: {
      code: 'UNAVAILABLE', target: 'terminal', retryable: true
    } };
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* Worker cleanup has priority over presentation updates. */ }
    }
  }

  private async stopTimedOutWorker(worker: UtilityProcess): Promise<void> {
    if (this.worker === worker) this.terminating = true;
    if (worker.pid !== undefined) await this.killProcessTree(worker.pid);
    worker.kill();
    await this.waitForWorkerExit(worker, 2_000).catch(() => undefined);
  }

  private async waitForWorkerExit(worker: UtilityProcess, timeoutMs: number): Promise<void> {
    if (this.worker !== worker) return;
    const exit = this.workerExit;
    if (!exit) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([exit, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Terminal worker shutdown timed out')), timeoutMs);
      })]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async killProcessTree(pid: number): Promise<void> {
    if (process.platform !== 'win32' || !Number.isSafeInteger(pid) || pid < 1) return;
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
    await new Promise<void>(resolve => {
      const killer = spawn(join(systemRoot, 'System32', 'taskkill.exe'), ['/F', '/T', '/PID', String(pid)], {
        windowsHide: true, stdio: 'ignore'
      });
      const timer = setTimeout(() => { killer.kill(); resolve(); }, 3_000);
      killer.once('error', () => { clearTimeout(timer); resolve(); });
      killer.once('close', () => { clearTimeout(timer); resolve(); });
    });
  }
}
