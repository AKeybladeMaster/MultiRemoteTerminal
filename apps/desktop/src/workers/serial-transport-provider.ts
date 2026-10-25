import { StringDecoder } from 'node:string_decoder';
import { autoDetect } from '@serialport/bindings-cpp';
import { SerialPortStream } from '@serialport/stream';
import { SerialTerminalProviderError } from '../../../../packages/application/src/serial-terminals.ts';
import type { SerialTerminalProvider } from '../../../../packages/application/src/serial-terminals.ts';
import type { LocalTerminalEvent } from '../../../../packages/application/src/local-terminals.ts';
import { MAX_QUEUED_TERMINAL_INPUT_CHARS, MAX_TERMINAL_INPUT_CHARS, isTerminalSize } from '../../../../packages/domain/src/local-terminal.ts';
import { MAX_SERIAL_INPUT_CHARS, SERIAL_PORT_LIST_LIMIT, normalizeSerialConfiguration } from '../../../../packages/domain/src/serial.ts';
import type { SerialConfiguration, SerialPortInfo } from '../../../../packages/domain/src/serial.ts';
import { canonicalizeSerialPortPath } from '../../../../packages/domain/src/serial.ts';

type SerialBinding = ReturnType<typeof autoDetect>;

interface RuntimeSession {
  readonly sessionId: string;
  readonly configuration: SerialConfiguration;
  readonly port: SerialPortStream;
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

export const SERIAL_OPEN_TIMEOUT_MS = 12_000;
export const SERIAL_CLOSE_GRACE_MS = 500;
export const MAX_ACTIVE_SERIAL_SESSIONS = 32;
export const MAX_SERIAL_TERMINAL_EVENT_CHARS = 16_384;
export const MAX_PENDING_SERIAL_TEXT_CHARS = 131_072;
export const PAUSE_SERIAL_OUTPUT_BYTES = 128 * 1024;
export const MAX_UNACKNOWLEDGED_SERIAL_OUTPUT_BYTES = 256 * 1024;

export function createSerialTransportProvider(options: {
  readonly connectionBinding?: SerialBinding;
  readonly listBindings?: readonly SerialBinding[];
  readonly publish?: (event: LocalTerminalEvent) => void;
} = {}): SerialTerminalProvider {
  const defaultBinding = autoDetect();
  const connectionBinding = options.connectionBinding ?? defaultBinding;
  const listBindings = options.listBindings ?? [defaultBinding];
  const publish = options.publish ?? (() => {});
  const sessions = new Map<string, RuntimeSession>();
  const listeners = new Set<(event: LocalTerminalEvent) => void>();

  function emit(event: LocalTerminalEvent): void {
    try { publish(event); } catch { /* A main-process subscriber cannot interrupt serial port cleanup. */ }
    for (const listener of listeners) {
      try { listener(event); } catch { /* A terminal subscriber cannot interrupt serial port cleanup. */ }
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

  function destroySession(session: RuntimeSession): void {
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
      session.rejectOpen?.(new SerialTerminalProviderError('CANCELLED'));
      session.resolveOpen = undefined;
      session.rejectOpen = undefined;
    }
    try { session.port.destroy(); } catch { /* Worker exit remains a final release guarantee. */ }
  }

  function fail(session: RuntimeSession, code: 'UNAVAILABLE' | 'TIMEOUT' | 'OUTPUT_LIMIT'): void {
    if (session.closing) return;
    if (session.opening) {
      session.opening = false;
      clearTimeout(session.openTimer);
      session.rejectOpen?.(new SerialTerminalProviderError(code));
      session.resolveOpen = undefined;
      session.rejectOpen = undefined;
    } else emitFailure(session, code);
    destroySession(session);
  }

  function appendText(session: RuntimeSession, text: string): void {
    session.pendingText += text;
    if (session.pendingText.length > MAX_PENDING_SERIAL_TEXT_CHARS) { fail(session, 'OUTPUT_LIMIT'); return; }
    while (session.pendingText.length > 0 && session.pendingOutputBytes < PAUSE_SERIAL_OUTPUT_BYTES && !session.closing) {
      let end = Math.min(MAX_SERIAL_TERMINAL_EVENT_CHARS, session.pendingText.length);
      if (end < session.pendingText.length) {
        const last = session.pendingText.charCodeAt(end - 1);
        const next = session.pendingText.charCodeAt(end);
        if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end -= 1;
      }
      if (end === 0) end = Math.min(2, session.pendingText.length);
      const data = session.pendingText.slice(0, end);
      session.pendingText = session.pendingText.slice(end);
      const bytes = Buffer.byteLength(data, 'utf8');
      if (session.pendingOutputBytes + bytes > MAX_UNACKNOWLEDGED_SERIAL_OUTPUT_BYTES) { fail(session, 'OUTPUT_LIMIT'); return; }
      const sequence = session.nextSequence++;
      session.outputBytesBySequence.set(sequence, bytes);
      session.pendingOutputBytes += bytes;
      emit({ kind: 'data', sessionId: session.sessionId, sequence, data });
    }
    if (session.pendingText.length > 0 && !session.outputPaused) {
      session.outputPaused = true;
      session.port.pause();
    }
  }

  function flushPendingText(session: RuntimeSession): void {
    if (session.closing || session.pendingText.length === 0) return;
    appendText(session, '');
    if (session.pendingText.length === 0 && session.outputPaused && session.pendingOutputBytes < PAUSE_SERIAL_OUTPUT_BYTES) {
      session.outputPaused = false;
      session.port.resume();
    }
  }

  async function listPorts(): Promise<readonly SerialPortInfo[]> {
    try {
      const byPath = new Map<string, SerialPortInfo>();
      for (const binding of listBindings) {
        const entries = await binding.list();
        if (!Array.isArray(entries) || entries.length > SERIAL_PORT_LIST_LIMIT) throw new SerialTerminalProviderError('OUTPUT_LIMIT');
        for (const entry of entries) {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
          const raw = entry as { readonly path?: unknown; readonly manufacturer?: unknown };
          const path = canonicalizeSerialPortPath(raw.path);
          if (!path) continue;
          const manufacturer = typeof raw.manufacturer === 'string' && raw.manufacturer.length <= 256 && !/[\u0000-\u001f\u007f]/.test(raw.manufacturer)
            ? raw.manufacturer : undefined;
          const existing = byPath.get(path);
          byPath.set(path, existing?.manufacturer ? existing : manufacturer ? { path, manufacturer } : { path });
          if (byPath.size > SERIAL_PORT_LIST_LIMIT) throw new SerialTerminalProviderError('OUTPUT_LIMIT');
        }
      }
      return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path, undefined, { numeric: true }));
    } catch (error) {
      if (error instanceof SerialTerminalProviderError) throw error;
      throw new SerialTerminalProviderError('UNAVAILABLE');
    }
  }

  const provider: SerialTerminalProvider = {
    listPorts,

    open(sessionId, input): Promise<void> {
      if (sessions.has(sessionId) || sessions.size >= MAX_ACTIVE_SERIAL_SESSIONS) return Promise.reject(new SerialTerminalProviderError('BUSY'));
      const configuration = normalizeSerialConfiguration(input);
      if (!configuration) return Promise.reject(new SerialTerminalProviderError('UNAVAILABLE'));
      let port: SerialPortStream;
      try {
        const flowControl = configuration.flowControl;
        port = new SerialPortStream({
          binding: connectionBinding,
          autoOpen: false,
          highWaterMark: 64 * 1024,
          path: configuration.path,
          baudRate: configuration.baudRate,
          dataBits: configuration.dataBits,
          parity: configuration.parity,
          stopBits: configuration.stopBits,
          rtscts: flowControl === 'rtscts',
          xon: flowControl === 'xonxoff',
          xoff: flowControl === 'xonxoff'
        });
      } catch {
        return Promise.reject(new SerialTerminalProviderError('UNAVAILABLE'));
      }

      const session: RuntimeSession = {
        sessionId, configuration, port, decoder: new StringDecoder('utf8'), outputBytesBySequence: new Map(),
        opening: true, closing: false, terminalEventSent: false, nextSequence: 1, lastAcknowledged: 0,
        pendingOutputBytes: 0, pendingText: '', pendingInputChars: 0, outputPaused: false,
        openTimer: undefined, resolveOpen: undefined, rejectOpen: undefined, inputTail: Promise.resolve()
      };
      sessions.set(sessionId, session);
      port.on('data', data => { if (!session.closing) appendText(session, session.decoder.write(data as Buffer)); });
      port.on('error', () => fail(session, 'UNAVAILABLE'));
      port.once('close', (error: Error | undefined) => {
        if (session.closing) return;
        if (session.opening) {
          session.opening = false;
          clearTimeout(session.openTimer);
          session.rejectOpen?.(new SerialTerminalProviderError('UNAVAILABLE'));
          session.resolveOpen = undefined;
          session.rejectOpen = undefined;
        } else if (error) emitFailure(session, 'UNAVAILABLE');
        else emitExit(session);
        sessions.delete(session.sessionId);
      });

      return new Promise<void>((resolve, reject) => {
        session.resolveOpen = resolve;
        session.rejectOpen = reject;
        session.openTimer = setTimeout(() => fail(session, 'TIMEOUT'), SERIAL_OPEN_TIMEOUT_MS);
        try {
          port.open(error => {
            if (session.closing || !session.opening) return;
            if (error) { fail(session, 'UNAVAILABLE'); return; }
            session.opening = false;
            clearTimeout(session.openTimer);
            session.resolveOpen?.();
            session.resolveOpen = undefined;
            session.rejectOpen = undefined;
          });
        } catch { fail(session, 'UNAVAILABLE'); }
      });
    },

    async write(sessionId, data): Promise<void> {
      const session = sessions.get(sessionId);
      if (!session || session.closing || session.opening) throw new SerialTerminalProviderError('UNAVAILABLE');
      if (typeof data !== 'string' || data.length > MAX_SERIAL_INPUT_CHARS || data.length > MAX_TERMINAL_INPUT_CHARS) throw new SerialTerminalProviderError('UNAVAILABLE');
      if (session.pendingInputChars + data.length > MAX_QUEUED_TERMINAL_INPUT_CHARS) throw new SerialTerminalProviderError('BUSY');
      if (data.length === 0) return;
      session.pendingInputChars += data.length;
      const operation = session.inputTail.then(() => new Promise<void>((resolve, reject) => {
        if (session.closing || !sessions.has(sessionId)) { reject(new SerialTerminalProviderError('CANCELLED')); return; }
        try {
          session.port.write(Buffer.from(data, 'utf8'), error => error ? reject(new SerialTerminalProviderError('UNAVAILABLE')) : resolve());
        } catch { reject(new SerialTerminalProviderError('UNAVAILABLE')); }
      }));
      session.inputTail = operation.catch(() => undefined).finally(() => { session.pendingInputChars = Math.max(0, session.pendingInputChars - data.length); });
      return operation;
    },

    async resize(sessionId, size): Promise<void> {
      const session = sessions.get(sessionId);
      if (!session || session.closing || session.opening || !isTerminalSize(size)) throw new SerialTerminalProviderError('UNAVAILABLE');
      // A serial device has no terminal window dimensions; resizing affects the local view only.
    },

    async acknowledgeOutput(sessionId, sequence): Promise<void> {
      const session = sessions.get(sessionId);
      if (!session || session.closing) return;
      if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > session.nextSequence - 1) throw new SerialTerminalProviderError('UNAVAILABLE');
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
      if (!session || session.closing) return;
      session.closing = true;
      sessions.delete(sessionId);
      clearTimeout(session.openTimer);
      session.pendingText = '';
      session.pendingInputChars = 0;
      session.outputBytesBySequence.clear();
      session.pendingOutputBytes = 0;
      if (session.opening) {
        session.opening = false;
        session.rejectOpen?.(new SerialTerminalProviderError('CANCELLED'));
        session.resolveOpen = undefined;
        session.rejectOpen = undefined;
      }
      await closePort(session.port);
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

async function closePort(port: SerialPortStream): Promise<void> {
  if (!port.isOpen) {
    try { port.destroy(); } catch { /* Destroy is idempotent for closed and opening streams. */ }
    return;
  }
  await new Promise<void>(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      port.removeListener('close', finish);
      resolve();
    };
    const timer = setTimeout(() => { try { port.destroy(); } catch { /* The worker owns final cleanup. */ } finish(); }, SERIAL_CLOSE_GRACE_MS);
    port.once('close', finish);
    try { port.close(() => finish()); } catch { finish(); }
  });
}
