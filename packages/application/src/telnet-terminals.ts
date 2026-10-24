import { failure } from '../../domain/src/errors.ts';
import type { ErrorCode, Outcome } from '../../domain/src/errors.ts';
import { MAX_QUEUED_TERMINAL_INPUT_CHARS, MAX_TERMINAL_INPUT_CHARS, isTerminalSize } from '../../domain/src/local-terminal.ts';
import type { TerminalSize } from '../../domain/src/local-terminal.ts';
import { canonicalizeRemoteEndpoint } from '../../domain/src/remote-endpoint.ts';
import type { RemoteEndpoint } from '../../domain/src/remote-endpoint.ts';
import type { LocalTerminalEvent } from './local-terminals.ts';

export type TelnetTerminalProviderErrorCode = 'UNAVAILABLE' | 'CANCELLED' | 'TIMEOUT' | 'BUSY' | 'OUTPUT_LIMIT';

export class TelnetTerminalProviderError extends Error {
  readonly code: TelnetTerminalProviderErrorCode;

  constructor(code: TelnetTerminalProviderErrorCode) {
    super('Telnet terminal operation failed');
    this.name = 'TelnetTerminalProviderError';
    this.code = code;
  }
}

export interface TelnetTerminalProvider {
  open(sessionId: string, endpoint: RemoteEndpoint, size: TerminalSize): Promise<void>;
  write(sessionId: string, data: string): Promise<void>;
  resize(sessionId: string, size: TerminalSize): Promise<void>;
  acknowledgeOutput(sessionId: string, sequence: number): Promise<void>;
  close(sessionId: string): Promise<void>;
  shutdown(): Promise<void>;
  subscribe(listener: (event: LocalTerminalEvent) => void): () => void;
}

export interface TelnetTerminalSession {
  readonly sessionId: string;
  readonly endpoint: RemoteEndpoint;
  readonly state: 'starting' | 'running' | 'exited' | 'failed' | 'closing';
}

interface SessionState {
  readonly sessionId: string;
  readonly endpoint: RemoteEndpoint;
  state: TelnetTerminalSession['state'];
  pendingInputChars: number;
  pendingEvents: LocalTerminalEvent[];
}

export interface TelnetTerminalController {
  open(sessionId: string, host: string, port: number, size: TerminalSize): Promise<Outcome<TelnetTerminalSession>>;
  write(sessionId: string, data: string): Promise<Outcome<Record<string, never>>>;
  resize(sessionId: string, size: TerminalSize): Promise<Outcome<Record<string, never>>>;
  acknowledgeOutput(sessionId: string, sequence: number): Promise<Outcome<Record<string, never>>>;
  close(sessionId: string): Promise<Outcome<Record<string, never>>>;
  closeAll(): Promise<void>;
  subscribe(listener: (event: LocalTerminalEvent) => void): () => void;
  dispose(): Promise<void>;
}

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_QUEUED_OPEN_EVENTS = 64;
const EMPTY_RESULT: Record<string, never> = Object.freeze({});

export function createTelnetTerminalController(provider: TelnetTerminalProvider): TelnetTerminalController {
  const sessions = new Map<string, SessionState>();
  const listeners = new Set<(event: LocalTerminalEvent) => void>();
  let shutdownPromise: Promise<void> | undefined;
  let disposed = false;

  const stopListening = provider.subscribe(event => {
    const session = sessions.get(event.sessionId);
    if (!session || session.state === 'closing') return;
    if (session.state === 'starting') {
      if (session.pendingEvents.length >= MAX_QUEUED_OPEN_EVENTS) {
        session.state = 'closing';
        sessions.delete(session.sessionId);
        void provider.close(session.sessionId).catch(() => undefined);
        publish({ kind: 'failure', sessionId: session.sessionId, error: failure('OUTPUT_LIMIT', 'terminal').error });
      } else session.pendingEvents.push(event);
      return;
    }
    if (event.kind === 'exit') session.state = 'exited';
    if (event.kind === 'failure') session.state = 'failed';
    publish(event);
  });

  async function open(sessionId: string, host: string, port: number, size: TerminalSize): Promise<Outcome<TelnetTerminalSession>> {
    if (disposed) return failure('CANCELLED', 'terminal');
    if (shutdownPromise) return failure('BUSY', 'terminal');
    if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId) || !isTerminalSize(size)) return failure('INVALID_REQUEST');
    const endpoint = canonicalizeRemoteEndpoint({ host, port });
    if (!endpoint) return failure('INVALID_REQUEST');
    if (sessions.has(sessionId)) return failure('UNAVAILABLE', 'terminal');
    const session: SessionState = { sessionId, endpoint, state: 'starting', pendingInputChars: 0, pendingEvents: [] };
    sessions.set(sessionId, session);
    try {
      await provider.open(sessionId, endpoint, size);
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
      return { ok: true, result: { sessionId, endpoint, state: session.state } };
    } catch (error) {
      session.pendingEvents.length = 0;
      sessions.delete(sessionId);
      const code: ErrorCode = error instanceof TelnetTerminalProviderError ? error.code : 'UNAVAILABLE';
      return failure(code, 'terminal');
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
    } catch (error) {
      const code: ErrorCode = error instanceof TelnetTerminalProviderError ? error.code : 'UNAVAILABLE';
      return failure(code, 'terminal');
    } finally { session.pendingInputChars -= data.length; }
  }

  async function resize(sessionId: string, size: TerminalSize): Promise<Outcome<Record<string, never>>> {
    const session = sessions.get(sessionId);
    if (!session || session.state !== 'running') return failure('NOT_FOUND', 'terminal');
    if (!isTerminalSize(size)) return failure('INVALID_REQUEST');
    try {
      await provider.resize(sessionId, size);
      return { ok: true, result: EMPTY_RESULT };
    } catch (error) {
      const code: ErrorCode = error instanceof TelnetTerminalProviderError ? error.code : 'UNAVAILABLE';
      return failure(code, 'terminal');
    }
  }

  async function acknowledgeOutput(sessionId: string, sequence: number): Promise<Outcome<Record<string, never>>> {
    const session = sessions.get(sessionId);
    if (!session || !Number.isSafeInteger(sequence) || sequence < 1) return failure('NOT_FOUND', 'terminal');
    try {
      await provider.acknowledgeOutput(sessionId, sequence);
      return { ok: true, result: EMPTY_RESULT };
    } catch (error) {
      const code: ErrorCode = error instanceof TelnetTerminalProviderError ? error.code : 'UNAVAILABLE';
      return failure(code, 'terminal');
    }
  }

  async function close(sessionId: string): Promise<Outcome<Record<string, never>>> {
    const session = sessions.get(sessionId);
    if (!session) return failure('NOT_FOUND', 'terminal');
    if (session.state === 'closing') return { ok: true, result: EMPTY_RESULT };
    session.state = 'closing';
    sessions.delete(sessionId);
    try {
      await provider.close(sessionId);
      return { ok: true, result: EMPTY_RESULT };
    } catch (error) {
      const code: ErrorCode = error instanceof TelnetTerminalProviderError ? error.code : 'UNAVAILABLE';
      return failure(code, 'terminal');
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
      try { listener(event); } catch { /* Presentation listeners cannot interrupt transport cleanup. */ }
    }
  }

  return Object.freeze({
    open, write, resize, acknowledgeOutput, close, closeAll,
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
