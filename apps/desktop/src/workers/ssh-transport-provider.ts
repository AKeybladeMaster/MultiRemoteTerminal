import type { Client, ClientChannel, ConnectConfig, VerifyCallback } from 'ssh2';
import type { HostKeyEvidence, SshHostEndpoint } from '../../../../packages/domain/src/host-trust.ts';
import type { LocalTerminalEvent } from '../../../../packages/application/src/local-terminals.ts';
import { SshTerminalProviderError } from '../../../../packages/application/src/ssh-terminals.ts';
import type { SshTerminalCredentials } from '../../../../packages/application/src/ssh-terminals.ts';
import type { TerminalSize } from '../../../../packages/domain/src/local-terminal.ts';
import { evidenceFromSsh2HostKey } from '../adapters/host-key-evidence.ts';

const CONNECT_TIMEOUT_MS = 130_000;
const MAX_TERMINAL_EVENT_CHARS = 16_384;
const MAX_PENDING_REMOTE_TEXT_CHARS = 131_072;
const PAUSE_OUTPUT_BYTES = 128 * 1024;
const MAX_UNACKNOWLEDGED_OUTPUT_BYTES = 256 * 1024;

export type SshTransportClient = Client;
export type SshTransportChannel = ClientChannel;
export type SshTransportConfig = ConnectConfig;
export type SshTransportHostVerifier = VerifyCallback;

export interface SshTransportClientFactory {
  create(): Client;
  parseHostKey: Parameters<typeof evidenceFromSsh2HostKey>[1];
}

export interface SshTransportProvider {
  open(sessionId: string, endpoint: SshHostEndpoint, credentials: SshTerminalCredentials, size: TerminalSize,
    verifyHost: (evidence: HostKeyEvidence) => Promise<boolean>): Promise<void>;
  write(sessionId: string, data: string): Promise<void>;
  resize(sessionId: string, size: TerminalSize): Promise<void>;
  acknowledgeOutput(sessionId: string, sequence: number): Promise<void>;
  close(sessionId: string): Promise<void>;
  shutdown(): Promise<void>;
}

interface RuntimeSession {
  readonly sessionId: string;
  readonly client: Client;
  channel?: ClientChannel;
  opening: boolean;
  closing: boolean;
  terminalEventSent: boolean;
  exitCode: number;
  nextSequence: number;
  lastAcknowledged: number;
  pendingOutputBytes: number;
  pendingText: string;
  readonly outputBytesBySequence: Map<number, number>;
  outputPaused: boolean;
  failureCode?: 'AUTHENTICATION_FAILED' | 'HOST_KEY_REJECTED' | 'HOST_KEY_CHANGED' | 'TIMEOUT' | 'UNAVAILABLE';
  clearPassword: () => void;
  openTimer: ReturnType<typeof setTimeout> | undefined;
  resolveOpen: (() => void) | undefined;
  rejectOpen: ((error: Error) => void) | undefined;
}

export function createSshTransportProvider(
  clients: SshTransportClientFactory,
  publish: (event: LocalTerminalEvent) => void,
): SshTransportProvider {
  const sessions = new Map<string, RuntimeSession>();

  function terminate(session: RuntimeSession): void {
    if (session.closing) return;
    session.closing = true;
    sessions.delete(session.sessionId);
    session.clearPassword();
    clearTimeout(session.openTimer);
    session.pendingText = '';
    session.outputBytesBySequence.clear();
    session.pendingOutputBytes = 0;
    try { session.channel?.end(); } catch { /* Session teardown continues if the channel has already closed. */ }
    try { session.channel?.destroy(); } catch { /* Session teardown continues if the channel has already closed. */ }
    try { session.client.end(); } catch { /* Session teardown continues if the connection has already closed. */ }
    if (session.opening) {
      session.opening = false;
      session.rejectOpen?.(new SshTerminalProviderError(session.failureCode ?? 'UNAVAILABLE'));
      session.resolveOpen = undefined;
      session.rejectOpen = undefined;
    }
  }

  function emitFailure(session: RuntimeSession, code: 'AUTHENTICATION_FAILED' | 'HOST_KEY_REJECTED' | 'HOST_KEY_CHANGED' | 'TIMEOUT' | 'UNAVAILABLE' | 'OUTPUT_LIMIT'): void {
    if (session.terminalEventSent || session.closing) return;
    session.terminalEventSent = true;
    const retryable = code === 'AUTHENTICATION_FAILED' || code === 'TIMEOUT' || code === 'UNAVAILABLE' || code === 'HOST_KEY_REJECTED';
    publish({ kind: 'failure', sessionId: session.sessionId, error: { code, target: 'terminal', retryable } });
  }

  function emitExit(session: RuntimeSession): void {
    if (session.terminalEventSent || session.closing) return;
    session.terminalEventSent = true;
    publish({ kind: 'exit', sessionId: session.sessionId, exitCode: session.exitCode });
  }

  function classifyClientError(error: Error & { readonly level?: string; readonly code?: string }): NonNullable<RuntimeSession['failureCode']> {
    if (error.level === 'client-authentication') return 'AUTHENTICATION_FAILED';
    if (error.code === 'ETIMEDOUT' || error.code === 'ESOCKETTIMEDOUT') return 'TIMEOUT';
    return 'UNAVAILABLE';
  }

  function fail(session: RuntimeSession, code: NonNullable<RuntimeSession['failureCode']>): void {
    if (session.closing) return;
    const failureCode = session.failureCode ?? code;
    session.failureCode = failureCode;
    if (session.opening) {
      session.opening = false;
      clearTimeout(session.openTimer);
      session.rejectOpen?.(new SshTerminalProviderError(failureCode));
      session.resolveOpen = undefined;
      session.rejectOpen = undefined;
    } else emitFailure(session, failureCode);
    terminate(session);
  }

  function splitText(session: RuntimeSession, text: string): void {
    session.pendingText += text;
    if (session.pendingText.length > MAX_PENDING_REMOTE_TEXT_CHARS) {
      session.failureCode = 'UNAVAILABLE';
      emitFailure(session, 'OUTPUT_LIMIT');
      terminate(session);
      return;
    }

    while (session.pendingText.length > 0 && session.pendingOutputBytes < PAUSE_OUTPUT_BYTES && !session.closing) {
      let end = Math.min(MAX_TERMINAL_EVENT_CHARS, session.pendingText.length);
      if (end < session.pendingText.length && end > 0) {
        const last = session.pendingText.charCodeAt(end - 1);
        const next = session.pendingText.charCodeAt(end);
        if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end -= 1;
      }
      const data = session.pendingText.slice(0, end);
      session.pendingText = session.pendingText.slice(end);
      const bytes = Buffer.byteLength(data, 'utf8');
      if (session.pendingOutputBytes + bytes > MAX_UNACKNOWLEDGED_OUTPUT_BYTES) {
        emitFailure(session, 'OUTPUT_LIMIT');
        terminate(session);
        return;
      }
      const sequence = session.nextSequence++;
      session.outputBytesBySequence.set(sequence, bytes);
      session.pendingOutputBytes += bytes;
      try { publish({ kind: 'data', sessionId: session.sessionId, sequence, data }); }
      catch { fail(session, 'UNAVAILABLE'); return; }
    }
    if (session.pendingText.length > 0 && !session.outputPaused) {
      session.outputPaused = true;
      session.channel?.pause();
    }
  }

  function flushPendingText(session: RuntimeSession): void {
    if (session.closing || !session.pendingText) return;
    splitText(session, '');
    if (session.pendingText.length === 0 && session.outputPaused && session.pendingOutputBytes < PAUSE_OUTPUT_BYTES) {
      session.outputPaused = false;
      session.channel?.resume();
    }
  }

  const provider: SshTransportProvider = {
    open(sessionId, endpoint, credentials, size, verifyHost): Promise<void> {
      if (sessions.has(sessionId)) return Promise.reject(new SshTerminalProviderError('UNAVAILABLE'));
      const client = clients.create();
      const session: RuntimeSession = {
        sessionId, client, opening: true, closing: false, terminalEventSent: false, exitCode: 0,
        nextSequence: 1, lastAcknowledged: 0, pendingOutputBytes: 0, pendingText: '',
        outputBytesBySequence: new Map(), outputPaused: false, clearPassword: () => {},
        openTimer: undefined, resolveOpen: undefined, rejectOpen: undefined
      };
      sessions.set(sessionId, session);

      const config: ConnectConfig = {
        host: endpoint.host,
        port: endpoint.port,
        username: credentials.username,
        password: credentials.password,
        authHandler: ['password'],
        readyTimeout: CONNECT_TIMEOUT_MS,
        keepaliveInterval: 10_000,
        keepaliveCountMax: 3,
        hostVerifier: (key: Buffer, callback: VerifyCallback) => {
          const evidence = evidenceFromSsh2HostKey(key, clients.parseHostKey);
          if (!evidence) {
            session.failureCode = 'HOST_KEY_REJECTED';
            callback(false);
            return;
          }
          void verifyHost(evidence).then((accepted: boolean) => {
            const stillAccepted = accepted && !session.closing;
            if (!stillAccepted) session.failureCode ??= 'HOST_KEY_REJECTED';
            callback(stillAccepted);
          }, () => {
            session.failureCode ??= 'UNAVAILABLE';
            callback(false);
          });
        }
      };
      session.clearPassword = () => {
        delete config.password;
        const internal = (client as unknown as { config?: { password?: string } }).config;
        if (internal) delete internal.password;
      };

      const opened = new Promise<void>((resolve, reject) => {
        session.resolveOpen = resolve;
        session.rejectOpen = reject;
        session.openTimer = setTimeout(() => fail(session, 'TIMEOUT'), CONNECT_TIMEOUT_MS);

        client.on('error', error => fail(session, classifyClientError(error)));
        client.on('timeout', () => fail(session, 'TIMEOUT'));
        client.on('close', () => {
          if (session.closing) return;
          if (session.opening) fail(session, session.failureCode ?? 'UNAVAILABLE');
          else {
            emitExit(session);
            terminate(session);
          }
        });
        client.once('ready', () => {
          if (session.closing) return;
          session.clearPassword();
          client.shell({ term: 'xterm-256color', cols: size.columns, rows: size.rows }, (error, channel) => {
            if (error || !channel || session.closing) { fail(session, session.failureCode ?? 'UNAVAILABLE'); return; }
            session.channel = channel;
            channel.setEncoding('utf8');
            channel.on('data', (data: Buffer | string) => splitText(session, typeof data === 'string' ? data : data.toString('utf8')));
            channel.on('exit', code => { if (Number.isSafeInteger(code)) session.exitCode = code as number; });
            channel.on('error', () => fail(session, 'UNAVAILABLE'));
            channel.on('close', () => {
              if (session.closing) return;
              emitExit(session);
              terminate(session);
            });
            session.opening = false;
            clearTimeout(session.openTimer);
            const resolve = session.resolveOpen;
            session.resolveOpen = undefined;
            session.rejectOpen = undefined;
            resolve?.();
          });
        });

        try { client.connect(config); }
        catch { fail(session, 'UNAVAILABLE'); }
      });
      return opened;
    },

    async write(sessionId, data): Promise<void> {
      const session = sessions.get(sessionId);
      const channel = session?.channel;
      if (!session || session.closing || session.opening || !channel) throw new SshTerminalProviderError('UNAVAILABLE');
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => finish(new SshTerminalProviderError('TIMEOUT')), 5_000);
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (error) reject(error);
          else resolve();
        };
        try { channel.write(data, 'utf8', () => finish()); }
        catch { finish(new SshTerminalProviderError('UNAVAILABLE')); }
      });
    },

    async resize(sessionId, size): Promise<void> {
      const session = sessions.get(sessionId);
      if (!session || session.closing || session.opening || !session.channel) throw new SshTerminalProviderError('UNAVAILABLE');
      try { session.channel.setWindow(size.rows, size.columns, 0, 0); }
      catch { throw new SshTerminalProviderError('UNAVAILABLE'); }
    },

    async acknowledgeOutput(sessionId, sequence): Promise<void> {
      const session = sessions.get(sessionId);
      // Output callbacks can arrive after the remote channel has already closed. The
      // application controller has already validated that this id belonged to a session.
      if (!session || session.closing) return;
      if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > session.nextSequence - 1) throw new SshTerminalProviderError('UNAVAILABLE');
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
      if (session) terminate(session);
    },

    async shutdown(): Promise<void> {
      for (const session of [...sessions.values()]) terminate(session);
    }
  };
  return Object.freeze(provider);
}
