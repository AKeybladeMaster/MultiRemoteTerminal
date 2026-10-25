import { failure } from '../../domain/src/errors.ts';
import type { ErrorCode, Outcome } from '../../domain/src/errors.ts';
import { MAX_QUEUED_TERMINAL_INPUT_CHARS, MAX_TERMINAL_INPUT_CHARS, isTerminalSize } from '../../domain/src/local-terminal.ts';
import type { TerminalSize } from '../../domain/src/local-terminal.ts';
import { MAX_SERIAL_INPUT_CHARS, normalizeSerialConfiguration, normalizeSerialPortList } from '../../domain/src/serial.ts';
import type { SerialConfiguration, SerialPortInfo } from '../../domain/src/serial.ts';
import type { LocalTerminalEvent } from './local-terminals.ts';

export type SerialTerminalProviderErrorCode = 'UNAVAILABLE' | 'CANCELLED' | 'TIMEOUT' | 'BUSY' | 'OUTPUT_LIMIT';

export class SerialTerminalProviderError extends Error {
  readonly code: SerialTerminalProviderErrorCode;

  constructor(code: SerialTerminalProviderErrorCode) {
    super('Serial terminal operation failed');
    this.name = 'SerialTerminalProviderError';
    this.code = code;
  }
}

export interface SerialTerminalProvider {
  listPorts(): Promise<readonly SerialPortInfo[]>;
  open(sessionId: string, configuration: SerialConfiguration): Promise<void>;
  write(sessionId: string, data: string): Promise<void>;
  resize(sessionId: string, size: TerminalSize): Promise<void>;
  acknowledgeOutput(sessionId: string, sequence: number): Promise<void>;
  close(sessionId: string): Promise<void>;
  shutdown(): Promise<void>;
  subscribe(listener: (event: LocalTerminalEvent) => void): () => void;
}

export interface SerialTerminalSession {
  readonly sessionId: string;
  readonly configuration: SerialConfiguration;
  readonly state: 'starting' | 'running' | 'exited' | 'failed' | 'closing';
}

interface SessionState {
  readonly sessionId: string;
  readonly configuration: SerialConfiguration;
  state: SerialTerminalSession['state'];
  pendingInputChars: number;
  pendingEvents: LocalTerminalEvent[];
}

export interface SerialTerminalController {
  listPorts(): Promise<Outcome<readonly SerialPortInfo[]>>;
  open(sessionId: string, configuration: unknown, size: TerminalSize): Promise<Outcome<SerialTerminalSession>>;
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

export function createSerialTerminalController(provider: SerialTerminalProvider): SerialTerminalController {
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

  async function listPorts(): Promise<Outcome<readonly SerialPortInfo[]>> {
    if (disposed) return failure('CANCELLED', 'terminal');
    if (shutdownPromise) return failure('BUSY', 'terminal');
    try {
      const ports = normalizeSerialPortList(await provider.listPorts());
      return ports ? { ok: true, result: ports } : failure('UNAVAILABLE', 'terminal');
    } catch (error) {
      return failure(error instanceof SerialTerminalProviderError ? error.code as ErrorCode : 'UNAVAILABLE', 'terminal');
    }
  }

  async function open(sessionId: string, input: unknown, size: TerminalSize): Promise<Outcome<SerialTerminalSession>> {
    if (disposed) return failure('CANCELLED', 'terminal');
    if (shutdownPromise) return failure('BUSY', 'terminal');
    const configuration = normalizeSerialConfiguration(input);
    if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId) || !configuration || !isTerminalSize(size)) return failure('INVALID_REQUEST');
    if (sessions.has(sessionId)) return failure('UNAVAILABLE', 'terminal');
    const session: SessionState = { sessionId, configuration, state: 'starting', pendingInputChars: 0, pendingEvents: [] };
    sessions.set(sessionId, session);
    try {
      await provider.open(sessionId, configuration);
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
      return { ok: true, result: { sessionId, configuration, state: session.state } };
    } catch (error) {
      session.pendingEvents.length = 0;
      sessions.delete(sessionId);
      const code: ErrorCode = error instanceof SerialTerminalProviderError ? error.code as ErrorCode : 'UNAVAILABLE';
      return failure(code, 'terminal');
    }
  }

  async function write(sessionId: string, data: string): Promise<Outcome<Record<string, never>>> {
    const session = sessions.get(sessionId);
    if (!session || session.state !== 'running') return failure('NOT_FOUND', 'terminal');
    if (typeof data !== 'string' || data.length > Math.min(MAX_TERMINAL_INPUT_CHARS, MAX_SERIAL_INPUT_CHARS)) return failure('INVALID_REQUEST');
    if (session.pendingInputChars + data.length > MAX_QUEUED_TERMINAL_INPUT_CHARS) return failure('BUSY', 'terminal');
    if (data.length === 0) return { ok: true, result: EMPTY_RESULT };
    session.pendingInputChars += data.length;
    try {
      await provider.write(sessionId, data);
      return { ok: true, result: EMPTY_RESULT };
    } catch (error) {
      const code: ErrorCode = error instanceof SerialTerminalProviderError ? error.code as ErrorCode : 'UNAVAILABLE';
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
      const code: ErrorCode = error instanceof SerialTerminalProviderError ? error.code as ErrorCode : 'UNAVAILABLE';
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
      const code: ErrorCode = error instanceof SerialTerminalProviderError ? error.code as ErrorCode : 'UNAVAILABLE';
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
      const code: ErrorCode = error instanceof SerialTerminalProviderError ? error.code as ErrorCode : 'UNAVAILABLE';
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
      try { listener(event); } catch { /* Presentation cannot interrupt serial port cleanup. */ }
    }
  }

  return Object.freeze({
    listPorts, open, write, resize, acknowledgeOutput, close, closeAll,
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
