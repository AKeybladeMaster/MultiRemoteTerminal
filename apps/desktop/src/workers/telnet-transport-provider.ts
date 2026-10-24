import { createConnection } from 'node:net';
import type { Socket } from 'node:net';
import { StringDecoder } from 'node:string_decoder';
import type { LocalTerminalEvent } from '../../../../packages/application/src/local-terminals.ts';
import { TelnetTerminalProviderError } from '../../../../packages/application/src/telnet-terminals.ts';
import type { TelnetTerminalProvider } from '../../../../packages/application/src/telnet-terminals.ts';
import type { RemoteEndpoint } from '../../../../packages/domain/src/remote-endpoint.ts';
import type { TerminalSize } from '../../../../packages/domain/src/local-terminal.ts';
import { MAX_QUEUED_TERMINAL_INPUT_CHARS, MAX_TERMINAL_INPUT_CHARS, isTerminalSize } from '../../../../packages/domain/src/local-terminal.ts';
import { TelnetCodec } from './telnet-codec.ts';

const CONNECT_TIMEOUT_MS = 12_000;
const CLOSE_GRACE_MS = 250;
const MAX_TERMINAL_EVENT_CHARS = 16_384;
const MAX_PENDING_REMOTE_TEXT_CHARS = 131_072;
const PAUSE_OUTPUT_BYTES = 128 * 1024;
const MAX_UNACKNOWLEDGED_OUTPUT_BYTES = 256 * 1024;

interface RuntimeSession {
  readonly sessionId: string;
  readonly socket: Socket;
  readonly codec: TelnetCodec;
  readonly decoder: StringDecoder;
  readonly outputBytesBySequence: Map<number, number>;
  opening: boolean;
  closing: boolean;
  terminalEventSent: boolean;
  nextSequence: number;
  lastAcknowledged: number;
  pendingOutputBytes: number;
  pendingText: string;
  pendingInputChars: number;
  outputPaused: boolean;
  openTimer: ReturnType<typeof setTimeout> | undefined;
  resolveOpen: (() => void) | undefined;
  rejectOpen: ((error: Error) => void) | undefined;
  inputTail: Promise<void>;
}

export function createTelnetTransportProvider(publish: (event: LocalTerminalEvent) => void): TelnetTerminalProvider {
  const sessions = new Map<string, RuntimeSession>();
  const listeners = new Set<(event: LocalTerminalEvent) => void>();

  function emit(event: LocalTerminalEvent): void {
    try { publish(event); } catch { /* A main-process subscriber cannot interrupt socket cleanup. */ }
    for (const listener of listeners) {
      try { listener(event); } catch { /* A terminal subscriber cannot interrupt socket cleanup. */ }
    }
  }

  function emitFailure(session: RuntimeSession, code: 'UNAVAILABLE' | 'TIMEOUT' | 'OUTPUT_LIMIT'): void {
    if (session.terminalEventSent || session.closing) return;
    session.terminalEventSent = true;
    emit({ kind: 'failure', sessionId: session.sessionId, error: {
      code, target: 'terminal', retryable: code === 'UNAVAILABLE' || code === 'TIMEOUT'
    } });
  }

  function emitExit(session: RuntimeSession): void {
    if (session.terminalEventSent || session.closing) return;
    session.terminalEventSent = true;
    emit({ kind: 'exit', sessionId: session.sessionId, exitCode: 0 });
  }

  function terminate(session: RuntimeSession): void {
    if (session.closing) return;
    session.closing = true;
    sessions.delete(session.sessionId);
    clearTimeout(session.openTimer);
    session.pendingText = '';
    session.pendingInputChars = 0;
    session.outputBytesBySequence.clear();
    session.pendingOutputBytes = 0;
    if (session.opening) {
      session.opening = false;
      session.rejectOpen?.(new TelnetTerminalProviderError('CANCELLED'));
      session.resolveOpen = undefined;
      session.rejectOpen = undefined;
    }
    try { session.socket.destroy(); } catch { /* Session teardown continues after socket failure. */ }
  }

  function fail(session: RuntimeSession, code: 'UNAVAILABLE' | 'TIMEOUT' | 'OUTPUT_LIMIT'): void {
    if (session.closing) return;
    if (session.opening) {
      session.opening = false;
      clearTimeout(session.openTimer);
      session.rejectOpen?.(new TelnetTerminalProviderError(code));
      session.resolveOpen = undefined;
      session.rejectOpen = undefined;
    } else emitFailure(session, code);
    terminate(session);
  }

  function splitText(session: RuntimeSession, text: string): void {
    session.pendingText += text;
    if (session.pendingText.length > MAX_PENDING_REMOTE_TEXT_CHARS) { fail(session, 'OUTPUT_LIMIT'); return; }
    while (session.pendingText.length > 0 && session.pendingOutputBytes < PAUSE_OUTPUT_BYTES && !session.closing) {
      let end = Math.min(MAX_TERMINAL_EVENT_CHARS, session.pendingText.length);
      if (end < session.pendingText.length) {
        const last = session.pendingText.charCodeAt(end - 1);
        const next = session.pendingText.charCodeAt(end);
        if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end -= 1;
      }
      if (end === 0) end = Math.min(2, session.pendingText.length);
      const data = session.pendingText.slice(0, end);
      session.pendingText = session.pendingText.slice(end);
      const bytes = Buffer.byteLength(data, 'utf8');
      if (session.pendingOutputBytes + bytes > MAX_UNACKNOWLEDGED_OUTPUT_BYTES) { fail(session, 'OUTPUT_LIMIT'); return; }
      const sequence = session.nextSequence++;
      session.outputBytesBySequence.set(sequence, bytes);
      session.pendingOutputBytes += bytes;
      emit({ kind: 'data', sessionId: session.sessionId, sequence, data });
    }
    if (session.pendingText.length > 0 && !session.outputPaused) {
      session.outputPaused = true;
      session.socket.pause();
    }
  }

  function flushPendingText(session: RuntimeSession): void {
    if (session.closing || session.pendingText.length === 0) return;
    splitText(session, '');
    if (session.pendingText.length === 0 && session.outputPaused && session.pendingOutputBytes < PAUSE_OUTPUT_BYTES) {
      session.outputPaused = false;
      session.socket.resume();
    }
  }

  const provider: TelnetTerminalProvider = {
    open(sessionId: string, endpoint: RemoteEndpoint, size: TerminalSize): Promise<void> {
      if (sessions.has(sessionId)) return Promise.reject(new TelnetTerminalProviderError('UNAVAILABLE'));
      if (!isTerminalSize(size)) return Promise.reject(new TelnetTerminalProviderError('UNAVAILABLE'));
      let socket: Socket;
      try {
        socket = createConnection({ host: endpoint.host, port: endpoint.port });
        socket.setNoDelay(true);
      } catch { return Promise.reject(new TelnetTerminalProviderError('UNAVAILABLE')); }

      const session: RuntimeSession = {
        sessionId, socket, codec: new TelnetCodec(size), decoder: new StringDecoder('utf8'),
        outputBytesBySequence: new Map(), opening: true, closing: false, terminalEventSent: false,
        nextSequence: 1, lastAcknowledged: 0, pendingOutputBytes: 0, pendingText: '', pendingInputChars: 0,
        outputPaused: false, openTimer: undefined, resolveOpen: undefined, rejectOpen: undefined, inputTail: Promise.resolve()
      };
      sessions.set(sessionId, session);

      return new Promise<void>((resolve, reject) => {
        session.resolveOpen = resolve;
        session.rejectOpen = reject;
        session.openTimer = setTimeout(() => fail(session, 'TIMEOUT'), CONNECT_TIMEOUT_MS);
        socket.on('connect', () => {
          if (session.closing) return;
          session.opening = false;
          clearTimeout(session.openTimer);
          session.resolveOpen?.();
          session.resolveOpen = undefined;
          session.rejectOpen = undefined;
          try { socket.write(session.codec.start()); }
          catch { fail(session, 'UNAVAILABLE'); }
        });
        socket.on('data', data => {
          if (session.closing) return;
          const decoded = session.codec.receive(data);
          for (const reply of decoded.replies) {
            try { socket.write(reply); } catch { fail(session, 'UNAVAILABLE'); return; }
          }
          splitText(session, session.decoder.write(decoded.data));
        });
        socket.once('end', () => {
          const remaining = session.decoder.end();
          if (remaining) splitText(session, remaining);
          emitExit(session);
        });
        socket.once('error', error => fail(session,
          (error as NodeJS.ErrnoException).code === 'ETIMEDOUT' ? 'TIMEOUT' : 'UNAVAILABLE'));
        socket.once('close', () => {
          clearTimeout(session.openTimer);
          if (session.closing) return;
          if (session.opening) {
            session.opening = false;
            session.rejectOpen?.(new TelnetTerminalProviderError('UNAVAILABLE'));
            session.resolveOpen = undefined;
            session.rejectOpen = undefined;
          } else emitExit(session);
          sessions.delete(session.sessionId);
        });
      });
    },

    async write(sessionId, data): Promise<void> {
      const session = sessions.get(sessionId);
      if (!session || session.closing || session.opening) throw new TelnetTerminalProviderError('UNAVAILABLE');
      if (typeof data !== 'string' || data.length > MAX_TERMINAL_INPUT_CHARS) throw new TelnetTerminalProviderError('UNAVAILABLE');
      if (session.pendingInputChars + data.length > MAX_QUEUED_TERMINAL_INPUT_CHARS) throw new TelnetTerminalProviderError('BUSY');
      session.pendingInputChars += data.length;
      const operation = session.inputTail.then(() => new Promise<void>((resolve, reject) => {
        if (session.closing || !sessions.has(sessionId)) { reject(new TelnetTerminalProviderError('CANCELLED')); return; }
        const bytes = session.codec.encodeInput(data);
        session.socket.write(bytes, error => error ? reject(new TelnetTerminalProviderError('UNAVAILABLE')) : resolve());
      }));
      session.inputTail = operation.catch(() => undefined).finally(() => { session.pendingInputChars = Math.max(0, session.pendingInputChars - data.length); });
      return operation;
    },

    async resize(sessionId, size): Promise<void> {
      const session = sessions.get(sessionId);
      if (!session || session.closing || session.opening || !isTerminalSize(size)) throw new TelnetTerminalProviderError('UNAVAILABLE');
      const command = session.codec.resize(size);
      if (command) session.socket.write(command, error => { if (error) fail(session, 'UNAVAILABLE'); });
    },

    async acknowledgeOutput(sessionId, sequence): Promise<void> {
      const session = sessions.get(sessionId);
      if (!session || session.closing) return;
      if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > session.nextSequence - 1) throw new TelnetTerminalProviderError('UNAVAILABLE');
      if (sequence <= session.lastAcknowledged) return;
      for (const [current, bytes] of session.outputBytesBySequence) {
        if (current > sequence) break;
        session.pendingOutputBytes -= bytes;
        session.outputBytesBySequence.delete(current);
      }
      session.lastAcknowledged = sequence;
      flushPendingText(session);
    },

    async close(sessionId): Promise<void> {
      const session = sessions.get(sessionId);
      if (!session) return;
      if (session.closing) return;
      session.closing = true;
      sessions.delete(sessionId);
      clearTimeout(session.openTimer);
      if (session.opening) {
        session.opening = false;
        session.rejectOpen?.(new TelnetTerminalProviderError('CANCELLED'));
        session.resolveOpen = undefined;
        session.rejectOpen = undefined;
      }
      await new Promise<void>(resolve => {
        let settled = false;
        const finish = () => { if (settled) return; settled = true; clearTimeout(timer); session.socket.removeListener('close', finish); resolve(); };
        const timer = setTimeout(() => { session.socket.destroy(); finish(); }, CLOSE_GRACE_MS);
        session.socket.once('close', finish);
        try { session.socket.end(); } catch { session.socket.destroy(); finish(); }
      });
    },

    async shutdown(): Promise<void> {
      await Promise.allSettled([...sessions.keys()].map(sessionId => provider.close(sessionId)));
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
  return provider;
}
