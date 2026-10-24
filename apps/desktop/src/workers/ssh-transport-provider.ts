import type { Client, ClientChannel, ConnectConfig, VerifyCallback } from 'ssh2';
import type { FileEntryWithStats, SFTPWrapper } from 'ssh2';
import { connect as connectTcp, createServer } from 'node:net';
import type { Server, Socket } from 'node:net';
import { posix } from 'node:path';
import type { HostKeyEvidence, SshHostEndpoint } from '../../../../packages/domain/src/host-trust.ts';
import type { LocalTerminalEvent } from '../../../../packages/application/src/local-terminals.ts';
import { SshTerminalProviderError } from '../../../../packages/application/src/ssh-terminals.ts';
import type { SshTerminalCredentials } from '../../../../packages/application/src/ssh-terminals.ts';
import type { TerminalSize } from '../../../../packages/domain/src/local-terminal.ts';
import { evidenceFromSsh2HostKey } from '../adapters/host-key-evidence.ts';
import type { CancellationSignal } from '../../../../packages/application/src/cancellation.ts';
import type { FileTransferConflictPolicy, FileTransferProgress, FileTransferResult } from '../../../../packages/domain/src/file-transfer.ts';
import type { SshTunnelDefinition } from '../../../../packages/domain/src/ssh-tunnel.ts';
import { isRemotePath, MAX_REMOTE_DIRECTORY_ENTRIES, MAX_REMOTE_FILE_NAME_CHARS } from '../../../../packages/domain/src/remote-files.ts';
import type { RemoteDirectoryListing, RemoteFileEntry, RemoteFileKind } from '../../../../packages/domain/src/remote-files.ts';
import { createSftpFileTransfers } from './sftp-file-transfers.ts';

const CONNECT_TIMEOUT_MS = 130_000;
const MAX_TERMINAL_EVENT_CHARS = 16_384;
const MAX_PENDING_REMOTE_TEXT_CHARS = 131_072;
const PAUSE_OUTPUT_BYTES = 128 * 1024;
const MAX_UNACKNOWLEDGED_OUTPUT_BYTES = 256 * 1024;
const SFTP_OPEN_TIMEOUT_MS = 15_000;
const SFTP_OPERATION_TIMEOUT_MS = 10_000;
const SFTP_CLOSE_GRACE_MS = 1_000;
const SFTP_STATUS_EOF = 1;
const LOCAL_FORWARD_BIND_TIMEOUT_MS = 10_000;
const LOCAL_FORWARD_OPEN_TIMEOUT_MS = 15_000;
const LOCAL_FORWARD_CLOSE_GRACE_MS = 1_000;
const REMOTE_FORWARD_BIND_TIMEOUT_MS = 10_000;
const REMOTE_FORWARD_CLOSE_GRACE_MS = 1_500;
const MAX_FORWARD_CONNECTIONS = 64;

type SftpChannel = SFTPWrapper & { end(): void };

interface PendingSftpOpen {
  cancel(error: Error): void;
}

interface ForwardedConnection {
  readonly socket: Socket;
  readonly timer: ReturnType<typeof setTimeout>;
  channel?: ClientChannel;
  closed: boolean;
}

interface LocalForwardRuntime {
  readonly definition: SshTunnelDefinition;
  readonly server: Server;
  readonly connections: Set<ForwardedConnection>;
}

interface RemoteForwardedConnection {
  readonly channel: ClientChannel;
  readonly timer: ReturnType<typeof setTimeout>;
  socket?: Socket;
  closed: boolean;
}

interface RemoteForwardRuntime {
  readonly definition: SshTunnelDefinition;
  readonly connections: Set<RemoteForwardedConnection>;
  bindPort?: number;
  cancelStart?: (error: Error) => void;
}

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
  openFiles(sessionId: string, endpoint: SshHostEndpoint, credentials: SshTerminalCredentials,
    verifyHost: (evidence: HostKeyEvidence) => Promise<boolean>): Promise<void>;
  write(sessionId: string, data: string): Promise<void>;
  resize(sessionId: string, size: TerminalSize): Promise<void>;
  acknowledgeOutput(sessionId: string, sequence: number): Promise<void>;
  listRemoteDirectory(sessionId: string, path: string, cancellation?: CancellationSignal): Promise<RemoteDirectoryListing>;
  uploadRemoteFile(sessionId: string, operationId: string, localPath: string, remoteDirectory: string, fileName: string,
    conflictPolicy: FileTransferConflictPolicy, cancellation?: CancellationSignal,
    onProgress?: (progress: FileTransferProgress) => void): Promise<FileTransferResult>;
  downloadRemoteFile(sessionId: string, operationId: string, remotePath: string, localPath: string,
    conflictPolicy: FileTransferConflictPolicy, cancellation?: CancellationSignal,
    onProgress?: (progress: FileTransferProgress) => void): Promise<FileTransferResult>;
  startForward(sessionId: string, definition: SshTunnelDefinition): Promise<number>;
  stopForward(sessionId: string, tunnelId: string): Promise<void>;
  close(sessionId: string): Promise<void>;
  shutdown(): Promise<void>;
}

interface RuntimeSession {
  readonly sessionId: string;
  readonly client: Client;
  readonly mode: 'terminal' | 'files';
  channel?: ClientChannel;
  sftp: SftpChannel | undefined;
  readonly localForwards: Map<string, LocalForwardRuntime>;
  readonly remoteForwards: Map<string, RemoteForwardRuntime>;
  sftpBusy: boolean;
  sftpOpenAttempt: PendingSftpOpen | undefined;
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
  const fileTransfers = createSftpFileTransfers();

  function closeSftpChannel(session: RuntimeSession, channel = session.sftp): Promise<void> {
    if (!channel) return Promise.resolve();
    if (session.sftp === channel) session.sftp = undefined;
    return new Promise(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        channel.removeListener('close', finish);
        resolve();
      };
      const timer = setTimeout(finish, SFTP_CLOSE_GRACE_MS);
      channel.once('close', finish);
      try { channel.end(); } catch { finish(); }
    });
  }

  function closeForwardConnection(forward: LocalForwardRuntime, connection: ForwardedConnection): void {
    if (connection.closed) return;
    connection.closed = true;
    clearTimeout(connection.timer);
    forward.connections.delete(connection);
    try { connection.socket.destroy(); } catch { /* The paired channel still receives cleanup. */ }
    try { connection.channel?.destroy(); } catch { /* The paired socket is already closed. */ }
  }

  function closeLocalForward(forward: LocalForwardRuntime): Promise<void> {
    for (const connection of [...forward.connections]) closeForwardConnection(forward, connection);
    if (!forward.server.listening) return Promise.resolve();
    return new Promise(resolve => {
      let settled = false;
      const finish = (): void => { if (settled) return; settled = true; clearTimeout(timer); resolve(); };
      const timer = setTimeout(finish, LOCAL_FORWARD_CLOSE_GRACE_MS);
      try { forward.server.close(finish); } catch { finish(); }
    });
  }

  function closeLocalForwards(session: RuntimeSession): Promise<void> {
    const forwards = [...session.localForwards.values()];
    session.localForwards.clear();
    return Promise.all(forwards.map(closeLocalForward)).then(() => undefined);
  }

  function closeRemoteForwardConnection(forward: RemoteForwardRuntime, connection: RemoteForwardedConnection): void {
    if (connection.closed) return;
    connection.closed = true;
    clearTimeout(connection.timer);
    forward.connections.delete(connection);
    try { connection.socket?.destroy(); } catch { /* The SSH channel still receives cleanup. */ }
    try { connection.channel.destroy(); } catch { /* The local socket is already closed. */ }
  }

  function acceptRemoteForwardConnection(session: RuntimeSession, details: { readonly destIP: string; readonly destPort: number },
    accept: () => ClientChannel, reject: () => void): void {
    const matching = [...session.remoteForwards.values()].filter(forward => details.destIP === '127.0.0.1' &&
      forward.definition.bindHost === details.destIP &&
      forward.bindPort === details.destPort);
    const forward = matching.length === 1 ? matching[0] : undefined;
    if (!forward || session.closing || sessions.get(session.sessionId) !== session ||
        forward.connections.size >= MAX_FORWARD_CONNECTIONS) {
      reject();
      return;
    }

    let channel: ClientChannel;
    try { channel = accept(); }
    catch { reject(); return; }
    const connection: RemoteForwardedConnection = {
      channel,
      timer: setTimeout(() => closeRemoteForwardConnection(forward, connection), LOCAL_FORWARD_OPEN_TIMEOUT_MS),
      closed: false
    };
    forward.connections.add(connection);
    channel.once('error', () => closeRemoteForwardConnection(forward, connection));
    channel.once('close', () => closeRemoteForwardConnection(forward, connection));

    let socket: Socket;
    try { socket = connectTcp(forward.definition.targetPort, forward.definition.targetHost); }
    catch { closeRemoteForwardConnection(forward, connection); return; }
    connection.socket = socket;
    socket.once('error', () => closeRemoteForwardConnection(forward, connection));
    socket.once('close', () => closeRemoteForwardConnection(forward, connection));
    socket.once('connect', () => {
      if (connection.closed || session.closing) { closeRemoteForwardConnection(forward, connection); return; }
      clearTimeout(connection.timer);
      socket.pipe(channel);
      channel.pipe(socket);
    });
  }

  function closeRemoteForward(session: RuntimeSession, forward: RemoteForwardRuntime): Promise<void> {
    if (session.remoteForwards.get(forward.definition.id) === forward) session.remoteForwards.delete(forward.definition.id);
    forward.cancelStart?.(new SshTerminalProviderError('CANCELLED'));
    for (const connection of [...forward.connections]) closeRemoteForwardConnection(forward, connection);
    const bindPort = forward.bindPort;
    if (session.closing || bindPort === undefined) return Promise.resolve();

    return new Promise(resolve => {
      let settled = false;
      const finish = (): void => { if (settled) return; settled = true; clearTimeout(timer); resolve(); };
      const timer = setTimeout(finish, REMOTE_FORWARD_CLOSE_GRACE_MS);
      try { session.client.unforwardIn('127.0.0.1', bindPort, () => finish()); }
      catch { finish(); }
    });
  }

  function closeRemoteForwards(session: RuntimeSession): Promise<void> {
    const forwards = [...session.remoteForwards.values()];
    session.remoteForwards.clear();
    return Promise.all(forwards.map(forward => closeRemoteForward(session, forward))).then(() => undefined);
  }

  function acceptForwardConnection(session: RuntimeSession, forward: LocalForwardRuntime, socket: Socket): void {
    if (session.closing || sessions.get(session.sessionId) !== session || forward.connections.size >= MAX_FORWARD_CONNECTIONS) {
      socket.destroy();
      return;
    }
    const connection: ForwardedConnection = {
      socket,
      timer: setTimeout(() => closeForwardConnection(forward, connection), LOCAL_FORWARD_OPEN_TIMEOUT_MS),
      closed: false
    };
    forward.connections.add(connection);
    socket.once('error', () => closeForwardConnection(forward, connection));
    socket.once('close', () => closeForwardConnection(forward, connection));
    const sourceAddress = (socket.remoteAddress ?? '127.0.0.1').replace(/^::ffff:/, '');
    try {
      session.client.forwardOut(sourceAddress, socket.remotePort ?? 0, forward.definition.targetHost, forward.definition.targetPort,
        (error, channel) => {
          if (connection.closed) { channel?.destroy(); return; }
          if (error || !channel || session.closing || socket.destroyed) {
            closeForwardConnection(forward, connection);
            return;
          }
          clearTimeout(connection.timer);
          connection.channel = channel;
          channel.once('error', () => closeForwardConnection(forward, connection));
          channel.once('close', () => closeForwardConnection(forward, connection));
          socket.pipe(channel);
          channel.pipe(socket);
        });
    } catch { closeForwardConnection(forward, connection); }
  }

  function terminate(session: RuntimeSession): void {
    if (session.closing) return;
    session.closing = true;
    sessions.delete(session.sessionId);
    session.sftpOpenAttempt?.cancel(new SshTerminalProviderError('CANCELLED'));
    session.sftpOpenAttempt = undefined;
    session.sftpBusy = false;
    session.clearPassword();
    clearTimeout(session.openTimer);
    session.pendingText = '';
    session.outputBytesBySequence.clear();
    session.pendingOutputBytes = 0;
    void closeLocalForwards(session);
    void closeRemoteForwards(session);
    try { session.channel?.end(); } catch { /* Session teardown continues if the channel has already closed. */ }
    try { session.channel?.destroy(); } catch { /* Session teardown continues if the channel has already closed. */ }
    void closeSftpChannel(session);
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

  function openConnection(sessionId: string, endpoint: SshHostEndpoint, credentials: SshTerminalCredentials,
    mode: RuntimeSession['mode'], size: TerminalSize | undefined, verifyHost: (evidence: HostKeyEvidence) => Promise<boolean>): Promise<void> {
      if (sessions.has(sessionId)) return Promise.reject(new SshTerminalProviderError('UNAVAILABLE'));
      const client = clients.create();
      const session: RuntimeSession = {
        sessionId, client, mode, opening: true, closing: false, terminalEventSent: false, exitCode: 0,
        sftp: undefined, localForwards: new Map(), remoteForwards: new Map(), sftpBusy: false, sftpOpenAttempt: undefined,
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
        client.on('tcp connection', (details, accept, rejectConnection) =>
          acceptRemoteForwardConnection(session, details, accept, rejectConnection));
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
          if (mode === 'files') {
            session.opening = false;
            clearTimeout(session.openTimer);
            const resolve = session.resolveOpen;
            session.resolveOpen = undefined;
            session.rejectOpen = undefined;
            resolve?.();
            return;
          }
          if (!size) { fail(session, 'UNAVAILABLE'); return; }
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
  }

  async function startRemoteForward(session: RuntimeSession, definition: SshTunnelDefinition): Promise<number> {
    const forward: RemoteForwardRuntime = { definition, connections: new Set() };
    session.remoteForwards.set(definition.id, forward);
    try {
      return await new Promise<number>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error, assignedPort?: number): void => {
          if (settled) {
            if (!error && assignedPort && (session.closing || session.remoteForwards.get(definition.id) !== forward)) {
              try { session.client.unforwardIn('127.0.0.1', assignedPort); } catch { /* Closing the SSH transport drops a late bind. */ }
            }
            return;
          }
          settled = true;
          clearTimeout(timer);
          delete forward.cancelStart;
          if (error) { reject(error); return; }
          const port = definition.bindPort === 0 ? assignedPort : definition.bindPort;
          if (!Number.isSafeInteger(port) || (port as number) < 1 || (port as number) > 65_535) {
            reject(new SshTerminalProviderError('UNAVAILABLE'));
            return;
          }
          forward.bindPort = port as number;
          resolve(port as number);
        };
        const timer = setTimeout(() => finish(new SshTerminalProviderError('TIMEOUT')), REMOTE_FORWARD_BIND_TIMEOUT_MS);
        forward.cancelStart = error => finish(error);
        try {
          session.client.forwardIn('127.0.0.1', definition.bindPort, (error, assignedPort) => {
            if (error) {
              const code = (error as NodeJS.ErrnoException).code;
              finish(new SshTerminalProviderError(code === 'EADDRINUSE' ? 'CONFLICT'
                : code === 'EACCES' || code === 'EPERM' || /administratively prohibited|permission denied/i.test(error.message) ? 'FORBIDDEN' : 'UNAVAILABLE'));
              return;
            }
            if (session.closing || session.remoteForwards.get(definition.id) !== forward) {
              finish(new SshTerminalProviderError('CANCELLED'), assignedPort);
              if (assignedPort > 0) {
                try { session.client.unforwardIn('127.0.0.1', assignedPort); } catch { /* The SSH connection is closing. */ }
              }
              return;
            }
            finish(undefined, assignedPort);
          });
        } catch { finish(new SshTerminalProviderError('UNAVAILABLE')); }
      });
    } catch (error) {
      await closeRemoteForward(session, forward);
      throw error;
    }
  }

  const provider: SshTransportProvider = {
    open(sessionId, endpoint, credentials, size, verifyHost): Promise<void> {
      return openConnection(sessionId, endpoint, credentials, 'terminal', size, verifyHost);
    },

    openFiles(sessionId, endpoint, credentials, verifyHost): Promise<void> {
      return openConnection(sessionId, endpoint, credentials, 'files', undefined, verifyHost);
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

    async listRemoteDirectory(sessionId: string, path: string, cancellation?: CancellationSignal): Promise<RemoteDirectoryListing> {
      const session = sessions.get(sessionId);
      if (!session || session.closing || session.opening || (!session.channel && session.mode !== 'files')) throw new SshTerminalProviderError('UNAVAILABLE');
      if (!isRemotePath(path)) throw new SshTerminalProviderError('UNAVAILABLE');
      if (cancellation?.aborted) throw new SshTerminalProviderError('CANCELLED');
      if (session.sftpBusy) throw new SshTerminalProviderError('BUSY');
      session.sftpBusy = true;
      try {
        const sftp = await getSftp(session, cancellation);
        if (cancellation?.aborted) {
          await closeSftpChannel(session, sftp);
          throw new SshTerminalProviderError('CANCELLED');
        }
        return await listSftpDirectory(session, sftp, path, cancellation);
      } finally { if (!session.sftpOpenAttempt) session.sftpBusy = false; }
    },

    async uploadRemoteFile(sessionId, operationId, localPath, remoteDirectory, fileName, conflictPolicy, cancellation, onProgress) {
      const session = sessions.get(sessionId);
      if (!session || session.closing || session.opening || (!session.channel && session.mode !== 'files')) throw new SshTerminalProviderError('UNAVAILABLE');
      if (cancellation?.aborted) throw new SshTerminalProviderError('CANCELLED');
      if (session.sftpBusy) throw new SshTerminalProviderError('BUSY');
      session.sftpBusy = true;
      try {
        const channel = await getSftp(session, cancellation);
        if (cancellation?.aborted) throw new SshTerminalProviderError('CANCELLED');
        return await fileTransfers.upload(sessionId, operationId, channel, localPath, remoteDirectory, fileName, conflictPolicy, cancellation, onProgress);
      } finally { if (!session.sftpOpenAttempt) session.sftpBusy = false; }
    },

    async downloadRemoteFile(sessionId, operationId, remotePath, localPath, conflictPolicy, cancellation, onProgress) {
      const session = sessions.get(sessionId);
      if (!session || session.closing || session.opening || (!session.channel && session.mode !== 'files')) throw new SshTerminalProviderError('UNAVAILABLE');
      if (cancellation?.aborted) throw new SshTerminalProviderError('CANCELLED');
      if (session.sftpBusy) throw new SshTerminalProviderError('BUSY');
      session.sftpBusy = true;
      try {
        const channel = await getSftp(session, cancellation);
        if (cancellation?.aborted) throw new SshTerminalProviderError('CANCELLED');
        return await fileTransfers.download(sessionId, operationId, channel, remotePath, localPath, conflictPolicy, cancellation, onProgress);
      } finally { if (!session.sftpOpenAttempt) session.sftpBusy = false; }
    },

    async startForward(sessionId, definition): Promise<number> {
      const session = sessions.get(sessionId);
      if (!session || session.closing || session.opening || session.mode !== 'files') throw new SshTerminalProviderError('UNAVAILABLE');
      if (session.localForwards.has(definition.id) || session.remoteForwards.has(definition.id)) throw new SshTerminalProviderError('BUSY');
      if (definition.mode === 'remote') return startRemoteForward(session, definition);
      const forward: LocalForwardRuntime = { definition, server: createServer({ allowHalfOpen: true }), connections: new Set() };
      session.localForwards.set(definition.id, forward);
      try {
        const assignedPort = await new Promise<number>((resolve, reject) => {
          let settled = false;
          const finish = (error?: Error): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            forward.server.removeListener('listening', onListening);
            if (error) reject(error);
            else {
              const address = forward.server.address();
              if (!address || typeof address === 'string' || !Number.isSafeInteger(address.port) || address.port < 1) {
                reject(new SshTerminalProviderError('UNAVAILABLE'));
              } else resolve(address.port);
            }
          };
          const onListening = (): void => {
            if (settled) { void closeLocalForward(forward); return; }
            finish();
          };
          const onError = (error: NodeJS.ErrnoException): void => {
            if (settled) {
              if (forward.server.listening) fail(session, 'UNAVAILABLE');
              return;
            }
            if (error.code === 'EADDRINUSE') finish(new SshTerminalProviderError('CONFLICT'));
            else if (error.code === 'EACCES' || error.code === 'EPERM') finish(new SshTerminalProviderError('FORBIDDEN'));
            else finish(new SshTerminalProviderError('UNAVAILABLE'));
          };
          const timer = setTimeout(() => finish(new SshTerminalProviderError('TIMEOUT')), LOCAL_FORWARD_BIND_TIMEOUT_MS);
          forward.server.once('listening', onListening);
          forward.server.on('error', onError);
          forward.server.on('connection', socket => acceptForwardConnection(session, forward, socket));
          try { forward.server.listen({ host: '127.0.0.1', port: definition.bindPort, exclusive: true }); }
          catch { finish(new SshTerminalProviderError('UNAVAILABLE')); }
        });
        if (session.closing || sessions.get(sessionId) !== session) throw new SshTerminalProviderError('CANCELLED');
        return assignedPort;
      } catch (error) {
        session.localForwards.delete(definition.id);
        await closeLocalForward(forward);
        throw error;
      }
    },

    async stopForward(sessionId, tunnelId): Promise<void> {
      const session = sessions.get(sessionId);
      if (!session) return;
      const localForward = session.localForwards.get(tunnelId);
      if (localForward) {
        session.localForwards.delete(tunnelId);
        await closeLocalForward(localForward);
        return;
      }
      const remoteForward = session.remoteForwards.get(tunnelId);
      if (remoteForward) await closeRemoteForward(session, remoteForward);
    },

    async close(sessionId): Promise<void> {
      const session = sessions.get(sessionId);
      if (session) {
        await Promise.all([closeLocalForwards(session), closeRemoteForwards(session)]);
        terminate(session);
      }
    },

    async shutdown(): Promise<void> {
      for (const session of [...sessions.values()]) {
        await Promise.all([closeLocalForwards(session), closeRemoteForwards(session)]);
        terminate(session);
      }
    }
  };

  function getSftp(session: RuntimeSession, cancellation?: CancellationSignal): Promise<SftpChannel> {
    if (session.sftp) return Promise.resolve(session.sftp);
    if (session.closing || cancellation?.aborted) return Promise.reject(new SshTerminalProviderError('CANCELLED'));
    if (session.sftpOpenAttempt) return Promise.reject(new SshTerminalProviderError('BUSY'));
    return new Promise((resolve, reject) => {
      let callerSettled = false;
      let callbackSettled = false;
      let removeCancellation = () => {};
      const timer = setTimeout(() => {
        const timeout = new SshTerminalProviderError('TIMEOUT');
        session.failureCode = 'TIMEOUT';
        emitFailure(session, 'TIMEOUT');
        attempt.cancel(timeout);
        terminate(session);
      }, SFTP_OPEN_TIMEOUT_MS);
      const attempt: PendingSftpOpen = {
        cancel(error) {
          if (callbackSettled) return;
          callbackSettled = true;
          clearTimeout(timer);
          removeCancellation();
          if (session.sftpOpenAttempt === attempt) session.sftpOpenAttempt = undefined;
          session.sftpBusy = false;
          if (!callerSettled) { callerSettled = true; reject(error); }
        }
      };
      session.sftpOpenAttempt = attempt;
      const cancelCaller = () => {
        if (callerSettled) return;
        callerSettled = true;
        removeCancellation();
        reject(new SshTerminalProviderError('CANCELLED'));
        // Keep the open attempt and watchdog until its callback arrives or the SSH session is closed.
      };
      if (cancellation) {
        cancellation.addEventListener('abort', cancelCaller, { once: true });
        removeCancellation = () => cancellation.removeEventListener('abort', cancelCaller);
      }
      if (cancellation?.aborted) { cancelCaller(); return; }
      try {
        session.client.sftp((error, rawChannel) => {
          const channel = rawChannel as SftpChannel | undefined;
          if (callbackSettled) { if (channel) void closeSftpChannel(session, channel); return; }
          callbackSettled = true;
          clearTimeout(timer);
          removeCancellation();
          if (session.sftpOpenAttempt === attempt) session.sftpOpenAttempt = undefined;
          if (callerSettled) {
            if (channel) void closeSftpChannel(session, channel);
            session.sftpBusy = false;
            return;
          }
          callerSettled = true;
          if (error) { session.sftpBusy = false; reject(new SshTerminalProviderError('NOT_SUPPORTED')); return; }
          if (!channel || session.closing) {
            if (channel) void closeSftpChannel(session, channel);
            session.sftpBusy = false;
            reject(new SshTerminalProviderError('UNAVAILABLE'));
            return;
          }
          if (cancellation?.aborted) {
            session.sftpBusy = false;
            void closeSftpChannel(session, channel).finally(() => reject(new SshTerminalProviderError('CANCELLED')));
            return;
          }
          session.sftp = channel;
          channel.on('error', () => { if (session.sftp === channel) session.sftp = undefined; });
          channel.once('close', () => { if (session.sftp === channel) session.sftp = undefined; });
          resolve(channel);
        });
      } catch { attempt.cancel(new SshTerminalProviderError('UNAVAILABLE')); }
    });
  }

  async function listSftpDirectory(
    session: RuntimeSession, channel: SftpChannel, path: string, cancellation?: CancellationSignal
  ): Promise<RemoteDirectoryListing> {
    const operation = listSftpDirectoryEntries(channel, path);
    return new Promise((resolve, reject) => {
      let settled = false;
      let ending = false;
      const finish = (error?: Error, listing?: RemoteDirectoryListing) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cancellation?.removeEventListener('abort', cancel);
        if (error) reject(error);
        else if (!listing) reject(new SshTerminalProviderError('UNAVAILABLE'));
        else resolve(listing);
      };
      const cancel = () => {
        if (ending || settled) return;
        ending = true;
        void closeSftpChannel(session, channel).finally(() => finish(new SshTerminalProviderError('CANCELLED')));
      };
      const timer = setTimeout(() => {
        if (ending || settled) return;
        ending = true;
        void closeSftpChannel(session, channel).finally(() => finish(new SshTerminalProviderError('TIMEOUT')));
      }, SFTP_OPERATION_TIMEOUT_MS);
      if (cancellation?.aborted) { cancel(); return; }
      cancellation?.addEventListener('abort', cancel, { once: true });
      operation.then(listing => { if (!ending) finish(undefined, listing); }, () => { if (!ending) finish(new SshTerminalProviderError('UNAVAILABLE')); });
    });
  }

  async function listSftpDirectoryEntries(channel: SftpChannel, requestedPath: string): Promise<RemoteDirectoryListing> {
    const path = await sftpCall<string>(callback => channel.realpath(requestedPath, callback));
    if (!isRemotePath(path)) throw new SshTerminalProviderError('OUTPUT_LIMIT');
    const handle = await sftpCall<Buffer>(callback => channel.opendir(path, callback));
    const entries: RemoteFileEntry[] = [];
    let truncated = false;
    try {
      while (!truncated) {
        let page: FileEntryWithStats[];
        try { page = await sftpCall<FileEntryWithStats[]>(callback => channel.readdir(handle, callback)); }
        catch (error) {
          if (sftpStatusCode(error) === SFTP_STATUS_EOF) break;
          throw error;
        }
        if (page.length === 0) break;
        for (const entry of page) {
          if (!validRemoteName(entry.filename)) continue;
          if (entries.length >= MAX_REMOTE_DIRECTORY_ENTRIES) { truncated = true; break; }
          const childPath = posix.join(path, entry.filename);
          if (!isRemotePath(childPath)) continue;
          const attributes = entry.attrs;
          const kind: RemoteFileKind = attributes.isSymbolicLink() ? 'symlink' : attributes.isDirectory() ? 'directory'
            : attributes.isFile() ? 'file' : 'other';
          const size = Number.isSafeInteger(attributes.size) && attributes.size >= 0 ? attributes.size : 0;
          const modifiedAt = Number.isSafeInteger(attributes.mtime) && attributes.mtime >= 0 ? attributes.mtime : null;
          entries.push({ name: entry.filename, path: childPath, kind, size, modifiedAt });
        }
      }
    } finally {
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, SFTP_CLOSE_GRACE_MS);
        try { channel.close(handle, () => { clearTimeout(timer); resolve(); }); }
        catch { clearTimeout(timer); resolve(); }
      });
    }
    entries.sort((left, right) => Number(right.kind === 'directory') - Number(left.kind === 'directory') || left.name.localeCompare(right.name));
    return { path, entries, truncated };
  }

  function sftpCall<T>(call: (callback: (error: Error | undefined, result: T) => void) => void): Promise<T> {
    return new Promise((resolve, reject) => {
      try { call((error, result) => error ? reject(error) : resolve(result)); }
      catch { reject(new SshTerminalProviderError('UNAVAILABLE')); }
    });
  }

  function sftpStatusCode(error: unknown): unknown {
    return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  }

  function validRemoteName(name: unknown): name is string {
    return typeof name === 'string' && name.length > 0 && name.length <= MAX_REMOTE_FILE_NAME_CHARS &&
      name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\0');
  }

  return Object.freeze(provider);
}
