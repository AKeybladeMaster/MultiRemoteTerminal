import type { AppError, Outcome } from '../../domain/src/errors.ts';
import { failure } from '../../domain/src/errors.ts';
import { isLocalTerminalLaunch, isTerminalSize, MAX_QUEUED_TERMINAL_INPUT_CHARS, MAX_TERMINAL_INPUT_CHARS } from '../../domain/src/local-terminal.ts';
import type { LocalTerminalLaunch, TerminalSize } from '../../domain/src/local-terminal.ts';
import type { WslDistribution } from '../../domain/src/wsl-distributions.ts';
import { normalizeWslDistributionList } from '../../domain/src/wsl-distributions.ts';

export type LocalTerminalEvent =
  | { readonly kind: 'data'; readonly sessionId: string; readonly sequence: number; readonly data: string }
  | { readonly kind: 'exit'; readonly sessionId: string; readonly exitCode: number }
  | { readonly kind: 'failure'; readonly sessionId: string; readonly error: AppError };

export interface LocalTerminalProvider {
  open(sessionId: string, launch: LocalTerminalLaunch, size: TerminalSize): Promise<void>;
  listWslDistributions(): Promise<readonly WslDistribution[]>;
  cancelWslDistributionDiscovery(): void | Promise<void>;
  write(sessionId: string, data: string): Promise<void>;
  resize(sessionId: string, size: TerminalSize): Promise<void>;
  acknowledgeOutput(sessionId: string, sequence: number): Promise<void>;
  close(sessionId: string): Promise<void>;
  shutdown(): Promise<void>;
  subscribe(listener: (event: LocalTerminalEvent) => void): () => void;
}

export type LocalTerminalSession = {
  readonly sessionId: string;
  readonly state: 'starting' | 'running' | 'exited' | 'failed' | 'closing';
} & LocalTerminalLaunch;

interface SessionState {
  readonly sessionId: string;
  readonly launch: LocalTerminalLaunch;
  state: LocalTerminalSession['state'];
  pendingInputChars: number;
  pendingEvents: LocalTerminalEvent[];
}

export interface LocalTerminalController {
  open(sessionId: string, launch: LocalTerminalLaunch, size: TerminalSize): Promise<Outcome<LocalTerminalSession>>;
  listWslDistributions(): Promise<Outcome<readonly WslDistribution[]>>;
  cancelWslDistributionDiscovery(): Promise<Outcome<Record<string, never>>>;
  write(sessionId: string, data: string): Promise<Outcome<Record<string, never>>>;
  resize(sessionId: string, size: TerminalSize): Promise<Outcome<Record<string, never>>>;
  acknowledgeOutput(sessionId: string, sequence: number): Promise<Outcome<Record<string, never>>>;
  close(sessionId: string): Promise<Outcome<Record<string, never>>>;
  closeAll(): Promise<void>;
  subscribe(listener: (event: LocalTerminalEvent) => void): () => void;
  dispose(): Promise<void>;
}

const EMPTY_RESULT: Record<string, never> = Object.freeze({});

export function createLocalTerminalController(
  provider: LocalTerminalProvider,
): LocalTerminalController {
  const sessions = new Map<string, SessionState>();
  const listeners = new Set<(event: LocalTerminalEvent) => void>();
  let shutdownPromise: Promise<void> | undefined;
  let disposed = false;

  const stopListening = provider.subscribe(event => {
    const session = sessions.get(event.sessionId);
    if (!session || session.state === 'closing') return;
    if (session.state === 'starting') {
      session.pendingEvents.push(event);
      return;
    }
    if (event.kind === 'exit') session.state = 'exited';
    if (event.kind === 'failure') session.state = 'failed';
    publish(event);
  });

  async function open(sessionId: string, launch: LocalTerminalLaunch, size: TerminalSize): Promise<Outcome<LocalTerminalSession>> {
    if (disposed) return failure('CANCELLED', 'terminal');
    if (shutdownPromise) return failure('BUSY', 'terminal');
    if (typeof sessionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId) ||
        !isLocalTerminalLaunch(launch) || !isTerminalSize(size)) return failure('INVALID_REQUEST');
    if (sessions.has(sessionId)) return failure('UNAVAILABLE', 'terminal');
    const session: SessionState = { sessionId, launch, state: 'starting', pendingInputChars: 0, pendingEvents: [] };
    sessions.set(sessionId, session);
    try {
      await provider.open(sessionId, launch, size);
      if (session.state === 'closing' || sessions.get(sessionId) !== session) {
        await provider.close(sessionId).catch(() => undefined);
        return failure('CANCELLED', 'terminal');
      }
      if (session.state === 'starting') session.state = 'running';
      for (const event of session.pendingEvents.splice(0)) {
        if (event.kind === 'exit') session.state = 'exited';
        if (event.kind === 'failure') session.state = 'failed';
        publish(event);
      }
      return { ok: true, result: { sessionId, ...launch, state: session.state } };
    } catch {
      session.pendingEvents.length = 0;
      sessions.delete(sessionId);
      return failure('UNAVAILABLE', 'terminal');
    }
  }

  let listingWslDistributions = false;
  let discoveryCancelled = false;

  async function listWslDistributions(): Promise<Outcome<readonly WslDistribution[]>> {
    if (disposed) return failure('CANCELLED', 'terminal');
    if (shutdownPromise || listingWslDistributions) return failure('BUSY', 'terminal');
    listingWslDistributions = true;
    discoveryCancelled = false;
    try {
      const distributions = normalizeWslDistributionList(await provider.listWslDistributions());
      return distributions ? { ok: true, result: distributions } : failure('UNAVAILABLE', 'terminal');
    } catch {
      return failure(discoveryCancelled ? 'CANCELLED' : 'UNAVAILABLE', 'terminal');
    } finally {
      listingWslDistributions = false;
      discoveryCancelled = false;
    }
  }

  async function cancelWslDistributionDiscovery(): Promise<Outcome<Record<string, never>>> {
    if (listingWslDistributions) {
      discoveryCancelled = true;
      try { await provider.cancelWslDistributionDiscovery(); }
      catch { return failure('UNAVAILABLE', 'terminal'); }
    }
    return { ok: true, result: EMPTY_RESULT };
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
    } catch {
      return failure('UNAVAILABLE', 'terminal');
    } finally {
      session.pendingInputChars -= data.length;
    }
  }

  async function resize(sessionId: string, size: TerminalSize): Promise<Outcome<Record<string, never>>> {
    const session = sessions.get(sessionId);
    if (!session || session.state !== 'running') return failure('NOT_FOUND', 'terminal');
    if (!isTerminalSize(size)) return failure('INVALID_REQUEST');
    try {
      await provider.resize(sessionId, size);
      return { ok: true, result: EMPTY_RESULT };
    } catch {
      return failure('UNAVAILABLE', 'terminal');
    }
  }

  async function acknowledgeOutput(sessionId: string, sequence: number): Promise<Outcome<Record<string, never>>> {
    const session = sessions.get(sessionId);
    if (!session || !Number.isSafeInteger(sequence) || sequence < 1) return failure('NOT_FOUND', 'terminal');
    try {
      await provider.acknowledgeOutput(sessionId, sequence);
      return { ok: true, result: EMPTY_RESULT };
    } catch {
      return failure('UNAVAILABLE', 'terminal');
    }
  }

  async function close(sessionId: string): Promise<Outcome<Record<string, never>>> {
    const session = sessions.get(sessionId);
    if (!session) return failure('NOT_FOUND', 'terminal');
    if (session.state === 'closing') return { ok: true, result: EMPTY_RESULT };
    const wasRunning = session.state === 'running' || session.state === 'starting';
    session.state = 'closing';
    sessions.delete(sessionId);
    if (!wasRunning) return { ok: true, result: EMPTY_RESULT };
    try {
      await provider.close(sessionId);
      return { ok: true, result: EMPTY_RESULT };
    } catch {
      return failure('UNAVAILABLE', 'terminal');
    }
  }

  async function closeAll(): Promise<void> {
    if (shutdownPromise) return shutdownPromise;
    for (const session of sessions.values()) session.state = 'closing';
    sessions.clear();
    const shuttingDown = provider.shutdown();
    shutdownPromise = shuttingDown;
    try { await shuttingDown; }
    finally { if (shutdownPromise === shuttingDown) shutdownPromise = undefined; }
  }

  function publish(event: LocalTerminalEvent): void {
    for (const listener of listeners) {
      try { listener(event); } catch { /* A presentation listener cannot interrupt process cleanup. */ }
    }
  }

  return Object.freeze({
    open, listWslDistributions, cancelWslDistributionDiscovery, write, resize, acknowledgeOutput, close, closeAll,
    subscribe(listener: (event: LocalTerminalEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async dispose() {
      disposed = true;
      await closeAll().catch(() => undefined);
      stopListening();
      listeners.clear();
    }
  });
}
