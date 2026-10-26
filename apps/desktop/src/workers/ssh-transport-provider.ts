import type { Client, ClientChannel, ConnectConfig, VerifyCallback } from 'ssh2';
import type { FileEntryWithStats, SFTPWrapper } from 'ssh2';
import { createHash } from 'node:crypto';
import { connect as connectTcp, createServer, isIP } from 'node:net';
import type { Server, Socket } from 'node:net';
import { posix } from 'node:path';
import type { HostKeyEvidence, SshHostEndpoint } from '../../../../packages/domain/src/host-trust.ts';
import type { LocalTerminalEvent } from '../../../../packages/application/src/local-terminals.ts';
import { SshTerminalProviderError } from '../../../../packages/application/src/ssh-terminals.ts';
import type { SshAuthenticationCredentials, SshConnectionGatewayCredentials } from '../../../../packages/application/src/ssh-terminals.ts';
import type { TerminalSize } from '../../../../packages/domain/src/local-terminal.ts';
import { evidenceFromSsh2HostKey } from '../adapters/host-key-evidence.ts';
import { awaitWithCancellation } from '../../../../packages/application/src/cancellation.ts';
import type { CancellationSignal } from '../../../../packages/application/src/cancellation.ts';
import type { FileTransferConflictPolicy, FileTransferProgress, FileTransferResult } from '../../../../packages/domain/src/file-transfer.ts';
import type { SshTunnelDefinition } from '../../../../packages/domain/src/ssh-tunnel.ts';
import { canonicalizeRemoteEndpoint } from '../../../../packages/domain/src/remote-endpoint.ts';
import { isRemotePath, MAX_REMOTE_DIRECTORY_ENTRIES, MAX_REMOTE_FILE_NAME_CHARS } from '../../../../packages/domain/src/remote-files.ts';
import type { RemoteDirectoryListing, RemoteFileEntry, RemoteFileKind } from '../../../../packages/domain/src/remote-files.ts';
import type { RemoteTextFile, RemoteTextFileSaveResult } from '../../../../packages/domain/src/remote-text-file.ts';
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
const FORWARDED_CONNECTION_OPEN_TIMEOUT_MS = 15_000;
const SSH_ROUTE_CHANNEL_OPEN_TIMEOUT_MS = 15_000;
const LOCAL_FORWARD_CLOSE_GRACE_MS = 1_000;
const REMOTE_FORWARD_BIND_TIMEOUT_MS = 10_000;
const REMOTE_FORWARD_CLOSE_GRACE_MS = 1_500;
const SOCKS_REJECT_CLOSE_GRACE_MS = 250;
const MAX_SOCKS_PENDING_BYTES = 65_536;
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

interface SocksForwardedConnection extends ForwardedConnection {
  input: Buffer;
  stage: 'methods' | 'request' | 'connecting' | 'connected' | 'rejecting';
}

interface LocalForwardRuntime {
  readonly definition: Extract<SshTunnelDefinition, { readonly mode: 'local' | 'dynamic' }>;
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
  readonly definition: Extract<SshTunnelDefinition, { readonly mode: 'remote' }>;
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
  open(sessionId: string, endpoint: SshHostEndpoint, credentials: SshAuthenticationCredentials, size: TerminalSize,
    verifyHost: (endpoint: SshHostEndpoint, evidence: HostKeyEvidence) => Promise<boolean>,
    gatewayHops?: readonly SshConnectionGatewayCredentials[]): Promise<void>;
  openFiles(sessionId: string, endpoint: SshHostEndpoint, credentials: SshAuthenticationCredentials,
    verifyHost: (endpoint: SshHostEndpoint, evidence: HostKeyEvidence) => Promise<boolean>): Promise<void>;
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
  readRemoteTextFile(sessionId: string, operationId: string, remotePath: string, cancellation?: CancellationSignal,
    onProgress?: (progress: FileTransferProgress) => void): Promise<RemoteTextFile>;
  saveRemoteTextFile(sessionId: string, operationId: string, remotePath: string, content: string, expectedRevision: string,
    cancellation?: CancellationSignal, onProgress?: (progress: FileTransferProgress) => void): Promise<RemoteTextFileSaveResult>;
  startForward(sessionId: string, definition: SshTunnelDefinition): Promise<number>;
  stopForward(sessionId: string, tunnelId: string): Promise<void>;
  close(sessionId: string): Promise<void>;
  shutdown(): Promise<void>;
}

interface RuntimeSession {
  readonly sessionId: string;
  client: Client;
  readonly clients: Client[];
  readonly routeChannels: ClientChannel[];
  readonly mode: 'terminal' | 'files';
  channel?: ClientChannel;
  sftp: SftpChannel | undefined;
  readonly localForwards: Map<string, LocalForwardRuntime>;
  readonly remoteForwards: Map<string, RemoteForwardRuntime>;
  sftpBusy: boolean;
  sftpOpenAttempt: PendingSftpOpen | undefined;
  sftpRecoveryCheckedChannel: SftpChannel | undefined;
  fileRecoveryScope: string | undefined;
  pendingUploadSettlement: Promise<void> | undefined;
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
  clearAuthenticationSecrets: () => void;
  openTimer: ReturnType<typeof setTimeout> | undefined;
  resolveOpen: (() => void) | undefined;
  rejectOpen: ((error: Error) => void) | undefined;
}

export function createSshTransportProvider(
  clients: SshTransportClientFactory,
  publish: (event: LocalTerminalEvent) => void,
  connectToDestination: (port: number, host: string) => Socket = connectTcp,
): SshTransportProvider {
  const sessions = new Map<string, RuntimeSession>();
  const disconnectedUploadsByScope = new Map<string, Set<Promise<void>>>();
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
      timer: setTimeout(() => closeRemoteForwardConnection(forward, connection), FORWARDED_CONNECTION_OPEN_TIMEOUT_MS),
      closed: false
    };
    forward.connections.add(connection);
    channel.once('error', () => closeRemoteForwardConnection(forward, connection));
    channel.once('close', () => closeRemoteForwardConnection(forward, connection));

    let socket: Socket;
    try { socket = connectToDestination(forward.definition.targetPort, forward.definition.targetHost); }
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
      timer: setTimeout(() => closeForwardConnection(forward, connection), FORWARDED_CONNECTION_OPEN_TIMEOUT_MS),
      closed: false
    };
    forward.connections.add(connection);
    socket.once('error', () => closeForwardConnection(forward, connection));
    socket.once('close', () => closeForwardConnection(forward, connection));
    if (forward.definition.mode === 'dynamic') {
      const socks = connection as SocksForwardedConnection;
      socks.input = Buffer.alloc(0);
      socks.stage = 'methods';
      acceptSocksConnection(session, forward, socks);
      return;
    }
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

  function acceptSocksConnection(session: RuntimeSession, forward: LocalForwardRuntime, socks: SocksForwardedConnection): void {
    const onData = (chunk: Buffer): void => {
      if (socks.closed || socks.stage === 'connecting' || socks.stage === 'connected' || socks.stage === 'rejecting') return;
      socks.input = Buffer.concat([socks.input, chunk]);
      if (socks.input.length > MAX_SOCKS_PENDING_BYTES) {
        finishSocksConnection(socks, Buffer.from([5, 1, 0, 1, 0, 0, 0, 0, 0, 0]));
        return;
      }

      if (socks.stage === 'methods') {
        if (socks.input.length < 2) return;
        const methodCount = socks.input[1]!;
        if (socks.input[0] !== 5 || methodCount === 0) {
          finishSocksConnection(socks, Buffer.from([5, 0xff]));
          return;
        }
        const messageLength = 2 + methodCount;
        if (socks.input.length < messageLength) return;
        let supportsNoAuthentication = false;
        for (let index = 2; index < messageLength; index += 1) {
          if (socks.input[index] === 0) supportsNoAuthentication = true;
        }
        if (!supportsNoAuthentication) {
          finishSocksConnection(socks, Buffer.from([5, 0xff]));
          return;
        }
        socks.input = socks.input.subarray(messageLength);
        socks.stage = 'request';
        writeSocket(socks.socket, Buffer.from([5, 0]));
      }

      const parsed = parseSocksConnectRequest(socks.input);
      if (parsed.kind === 'incomplete') return;
      if (parsed.kind === 'invalid') {
        finishSocksConnection(socks, socksReply(parsed.replyCode));
        return;
      }
      if (parsed.command !== 1) {
        finishSocksConnection(socks, socksReply(7));
        return;
      }

      socks.input = socks.input.subarray(parsed.consumedBytes);
      socks.stage = 'connecting';
      socks.socket.pause();
      socks.socket.removeListener('data', onData);
      const sourceAddress = (socks.socket.remoteAddress ?? '127.0.0.1').replace(/^::ffff:/, '');
      try {
        session.client.forwardOut(sourceAddress, socks.socket.remotePort ?? 0, parsed.host, parsed.port, (error, channel) => {
          if (socks.closed) { channel?.destroy(); return; }
          if (error || !channel || session.closing || sessions.get(session.sessionId) !== session || socks.socket.destroyed) {
            channel?.destroy();
            finishSocksConnection(socks, socksReply(mapSocksConnectionError(error)));
            return;
          }
          socks.channel = channel;
          channel.once('error', () => closeForwardConnection(forward, socks));
          channel.once('close', () => closeForwardConnection(forward, socks));
          socks.stage = 'connected';
          const pendingData = socks.input;
          socks.input = Buffer.alloc(0);
          writeSocket(socks.socket, socksReply(0), () => {
            if (socks.closed) return;
            clearTimeout(socks.timer);
            try {
              if (pendingData.length > 0) channel.write(pendingData);
              socks.socket.pipe(channel);
              channel.pipe(socks.socket);
              socks.socket.resume();
            } catch { closeForwardConnection(forward, socks); }
          });
        });
      } catch {
        finishSocksConnection(socks, socksReply(1));
      }
    };

    socks.socket.pause();
    socks.socket.on('data', onData);
    socks.socket.resume();
  }

  function finishSocksConnection(connection: SocksForwardedConnection, response: Buffer): void {
    if (connection.closed || connection.stage === 'rejecting') return;
    connection.stage = 'rejecting';
    clearTimeout(connection.timer);
    try { connection.channel?.destroy(); } catch { /* The response is still sent to the local client. */ }
    const socket = connection.socket;
    const timer = setTimeout(() => socket.destroy(), SOCKS_REJECT_CLOSE_GRACE_MS);
    socket.once('close', () => clearTimeout(timer));
    try { socket.end(response); } catch { socket.destroy(); }
  }

  function terminate(session: RuntimeSession): void {
    if (session.closing) return;
    session.closing = true;
    sessions.delete(session.sessionId);
    const recoveryScope = session.fileRecoveryScope;
    const pendingUpload = session.pendingUploadSettlement;
    if (recoveryScope && pendingUpload) {
      let pending = disconnectedUploadsByScope.get(recoveryScope);
      if (!pending) { pending = new Set(); disconnectedUploadsByScope.set(recoveryScope, pending); }
      pending.add(pendingUpload);
      void pendingUpload.then(() => {
        pending?.delete(pendingUpload);
        if (pending?.size === 0) disconnectedUploadsByScope.delete(recoveryScope);
      });
    }
    session.sftpOpenAttempt?.cancel(new SshTerminalProviderError('CANCELLED'));
    session.sftpOpenAttempt = undefined;
    session.sftpBusy = false;
    session.clearAuthenticationSecrets();
    clearTimeout(session.openTimer);
    session.pendingText = '';
    session.outputBytesBySequence.clear();
    session.pendingOutputBytes = 0;
    void closeLocalForwards(session);
    void closeRemoteForwards(session);
    try { session.channel?.end(); } catch { /* Session teardown continues if the channel has already closed. */ }
    try { session.channel?.destroy(); } catch { /* Session teardown continues if the channel has already closed. */ }
    void closeSftpChannel(session);
    for (const routeChannel of session.routeChannels) {
      try { routeChannel.destroy(); } catch { /* Remaining hops still receive teardown. */ }
    }
    for (const client of [...session.clients].reverse()) {
      try { client.end(); } catch { /* Remaining hops still receive teardown. */ }
    }
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

  function openConnection(sessionId: string, endpoint: SshHostEndpoint, credentials: SshAuthenticationCredentials,
    mode: RuntimeSession['mode'], size: TerminalSize | undefined,
    verifyHost: (endpoint: SshHostEndpoint, evidence: HostKeyEvidence) => Promise<boolean>,
    gatewayHops: readonly SshConnectionGatewayCredentials[] = []): Promise<void> {
    if (sessions.has(sessionId)) return Promise.reject(new SshTerminalProviderError('UNAVAILABLE'));
    const firstClient = clients.create();
    const session: RuntimeSession = {
      sessionId, client: firstClient, clients: [firstClient], routeChannels: [], mode, opening: true, closing: false, terminalEventSent: false, exitCode: 0,
      sftp: undefined, localForwards: new Map(), remoteForwards: new Map(), sftpBusy: false, sftpOpenAttempt: undefined,
      sftpRecoveryCheckedChannel: undefined, fileRecoveryScope: undefined, pendingUploadSettlement: undefined,
      nextSequence: 1, lastAcknowledged: 0, pendingOutputBytes: 0, pendingText: '',
      outputBytesBySequence: new Map(), outputPaused: false, clearAuthenticationSecrets: () => {},
      openTimer: undefined, resolveOpen: undefined, rejectOpen: undefined
    };
    sessions.set(sessionId, session);

    const clientConfigs = new Map<Client, ConnectConfig>();
    const verifiedHostFingerprints: string[] = [];
    session.clearAuthenticationSecrets = () => {
      for (const [client, config] of clientConfigs) {
        if (config.privateKey instanceof Uint8Array) config.privateKey.fill(0);
        delete config.password;
        delete config.privateKey;
        delete config.passphrase;
        delete config.agent;
        const clientState = client as unknown as { config?: { password?: string; privateKey?: Buffer | string; passphrase?: string; agent?: unknown }; _agent?: unknown };
        const internal = clientState.config;
        if (internal?.privateKey instanceof Uint8Array) internal.privateKey.fill(0);
        if (internal) {
          delete internal.password;
          delete internal.privateKey;
          delete internal.passphrase;
          delete internal.agent;
        }
        delete clientState._agent;
      }
    };

    function addClient(client: Client, isDestination: boolean): void {
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
      if (isDestination) client.on('tcp connection', (details, accept, rejectConnection) =>
        acceptRemoteForwardConnection(session, details, accept, rejectConnection));
    }

    function connectHop(client: Client, hopEndpoint: SshHostEndpoint, hopCredentials: SshAuthenticationCredentials,
      socket: ClientChannel | undefined, isDestination: boolean, routeIndex: number): Promise<void> {
      const config: ConnectConfig = {
        host: hopEndpoint.host,
        port: hopEndpoint.port,
        username: hopCredentials.username,
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
          void verifyHost(hopEndpoint, evidence).then((accepted: boolean) => {
            const stillAccepted = accepted && !session.closing;
            if (!stillAccepted) session.failureCode ??= 'HOST_KEY_REJECTED';
            else verifiedHostFingerprints[routeIndex] = evidence.fingerprint;
            callback(stillAccepted);
          }, () => {
            session.failureCode ??= 'UNAVAILABLE';
            callback(false);
          });
        }
      };
      if ('privateKey' in hopCredentials) {
        config.privateKey = Buffer.from(hopCredentials.privateKey);
        config.passphrase = hopCredentials.passphrase;
        config.authHandler = ['publickey'];
      } else if ('socketPath' in hopCredentials) {
        config.agent = hopCredentials.socketPath;
        config.authHandler = ['agent'];
        config.agentForward = false;
      } else {
        config.password = hopCredentials.password;
        config.authHandler = ['password'];
      }
      if (socket) config.sock = socket;
      clientConfigs.set(client, config);
      addClient(client, isDestination);
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error): void => {
          if (settled) return;
          settled = true;
          client.removeListener('ready', onReady);
          client.removeListener('error', onError);
          client.removeListener('close', onClose);
          if (error) reject(error);
          else resolve();
        };
        const onReady = (): void => {
          session.clearAuthenticationSecrets();
          finish(session.closing ? new SshTerminalProviderError('CANCELLED') : undefined);
        };
        const onError = (error: Error): void => finish(new SshTerminalProviderError(classifyClientError(error)));
        const onClose = (): void => finish(new SshTerminalProviderError(session.failureCode ?? 'UNAVAILABLE'));
        client.once('ready', onReady);
        client.once('error', onError);
        client.once('close', onClose);
        try { client.connect(config); }
        catch { finish(new SshTerminalProviderError('UNAVAILABLE')); }
      });
    }

    function openRouteChannel(client: Client, nextEndpoint: SshHostEndpoint): Promise<ClientChannel> {
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error, channel?: ClientChannel): void => {
          if (settled) { channel?.destroy(); return; }
          settled = true;
          clearTimeout(timer);
          if (error || !channel || session.closing) {
            channel?.destroy();
            reject(error ?? new SshTerminalProviderError('CANCELLED'));
            return;
          }
          channel.once('error', () => fail(session, 'UNAVAILABLE'));
          channel.once('close', () => { if (!session.closing) fail(session, 'UNAVAILABLE'); });
          session.routeChannels.push(channel);
          resolve(channel);
        };
        const timer = setTimeout(() => finish(new SshTerminalProviderError('TIMEOUT')), SSH_ROUTE_CHANNEL_OPEN_TIMEOUT_MS);
        try {
          client.forwardOut('127.0.0.1', 0, nextEndpoint.host, nextEndpoint.port, (error, channel) => {
            finish(error ? new SshTerminalProviderError('UNAVAILABLE') : undefined, channel ?? undefined);
          });
        } catch { finish(new SshTerminalProviderError('UNAVAILABLE')); }
      });
    }

    function finishOpen(): void {
      if (session.closing) return;
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
      session.client.shell({ term: 'xterm-256color', cols: size.columns, rows: size.rows }, (error, channel) => {
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
    }

    const opened = new Promise<void>((resolve, reject) => {
      session.resolveOpen = resolve;
      session.rejectOpen = reject;
      session.openTimer = setTimeout(() => fail(session, 'TIMEOUT'), CONNECT_TIMEOUT_MS);
    });
    void (async () => {
      const route = [...gatewayHops, { endpoint, credentials }];
      let socket: ClientChannel | undefined;
      for (const [index, hop] of route.entries()) {
        const client = index === 0 ? firstClient : clients.create();
        if (index > 0) session.clients.push(client);
        session.client = client;
        const isDestination = index === route.length - 1;
        await connectHop(client, hop.endpoint, hop.credentials, socket, isDestination, index);
        if (!isDestination) socket = await openRouteChannel(client, route[index + 1]!.endpoint);
      }
      const recoveryRoute = route.map((hop, index) => {
        const canonicalEndpoint = canonicalizeRemoteEndpoint(hop.endpoint);
        const hostFingerprint = verifiedHostFingerprints[index];
        return canonicalEndpoint && hostFingerprint
          ? { endpoint: canonicalEndpoint, username: hop.credentials.username, hostFingerprint }
          : undefined;
      });
      if (recoveryRoute.every(hop => hop !== undefined)) {
        session.fileRecoveryScope = createHash('sha256').update(JSON.stringify(recoveryRoute)).digest('hex');
      }
      finishOpen();
    })().catch(error => {
      const code = session.failureCode ?? (error instanceof SshTerminalProviderError && error.code === 'TIMEOUT' ? 'TIMEOUT' : 'UNAVAILABLE');
      fail(session, code);
    });
    return opened;
  }

  async function startRemoteForward(session: RuntimeSession, definition: Extract<SshTunnelDefinition, { readonly mode: 'remote' }>): Promise<number> {
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
    open(sessionId, endpoint, credentials, size, verifyHost, gatewayHops = []): Promise<void> {
      return openConnection(sessionId, endpoint, credentials, 'terminal', size, verifyHost, gatewayHops);
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
        const sftp = await getSftpForSession(session, cancellation);
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
        const channel = await getSftpForSession(session, cancellation);
        if (cancellation?.aborted) throw new SshTerminalProviderError('CANCELLED');
        const upload = fileTransfers.upload(sessionId, operationId, channel, localPath, remoteDirectory, fileName, conflictPolicy, cancellation,
          onProgress, session.fileRecoveryScope);
        const settlement = upload.then(() => undefined, () => undefined);
        session.pendingUploadSettlement = settlement;
        try { return await upload; }
        finally { if (session.pendingUploadSettlement === settlement) session.pendingUploadSettlement = undefined; }
      } finally { if (!session.sftpOpenAttempt) session.sftpBusy = false; }
    },

    async downloadRemoteFile(sessionId, operationId, remotePath, localPath, conflictPolicy, cancellation, onProgress) {
      const session = sessions.get(sessionId);
      if (!session || session.closing || session.opening || (!session.channel && session.mode !== 'files')) throw new SshTerminalProviderError('UNAVAILABLE');
      if (cancellation?.aborted) throw new SshTerminalProviderError('CANCELLED');
      if (session.sftpBusy) throw new SshTerminalProviderError('BUSY');
      session.sftpBusy = true;
      try {
        const channel = await getSftpForSession(session, cancellation);
        if (cancellation?.aborted) throw new SshTerminalProviderError('CANCELLED');
        return await fileTransfers.download(sessionId, operationId, channel, remotePath, localPath, conflictPolicy, cancellation, onProgress);
      } finally { if (!session.sftpOpenAttempt) session.sftpBusy = false; }
    },

    async readRemoteTextFile(sessionId, operationId, remotePath, cancellation, onProgress) {
      const session = sessions.get(sessionId);
      if (!session || session.closing || session.opening || (!session.channel && session.mode !== 'files')) throw new SshTerminalProviderError('UNAVAILABLE');
      if (cancellation?.aborted) throw new SshTerminalProviderError('CANCELLED');
      if (session.sftpBusy) throw new SshTerminalProviderError('BUSY');
      session.sftpBusy = true;
      try {
        const channel = await getSftpForSession(session, cancellation);
        if (cancellation?.aborted) throw new SshTerminalProviderError('CANCELLED');
        return await fileTransfers.readText(sessionId, operationId, channel, remotePath, cancellation, onProgress);
      } finally { if (!session.sftpOpenAttempt) session.sftpBusy = false; }
    },

    async saveRemoteTextFile(sessionId, operationId, remotePath, content, expectedRevision, cancellation, onProgress) {
      const session = sessions.get(sessionId);
      if (!session || session.closing || session.opening || (!session.channel && session.mode !== 'files')) throw new SshTerminalProviderError('UNAVAILABLE');
      if (cancellation?.aborted) throw new SshTerminalProviderError('CANCELLED');
      if (session.sftpBusy) throw new SshTerminalProviderError('BUSY');
      session.sftpBusy = true;
      try {
        const channel = await getSftpForSession(session, cancellation);
        if (cancellation?.aborted) throw new SshTerminalProviderError('CANCELLED');
        return await fileTransfers.saveText(sessionId, operationId, channel, remotePath, content, expectedRevision, cancellation, onProgress);
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

  async function getSftpForSession(session: RuntimeSession, cancellation?: CancellationSignal): Promise<SftpChannel> {
    const channel = await getSftp(session, cancellation);
    if (session.sftpRecoveryCheckedChannel !== channel) {
      const pendingUploads = session.fileRecoveryScope ? disconnectedUploadsByScope.get(session.fileRecoveryScope) : undefined;
      if (pendingUploads?.size) {
        await awaitWithCancellation(Promise.all([...pendingUploads]).then(() => undefined), cancellation,
          () => new SshTerminalProviderError('CANCELLED'));
      }
      await fileTransfers.cleanupOrphanedUploads(channel, session.fileRecoveryScope, cancellation);
      session.sftpRecoveryCheckedChannel = channel;
    }
    return channel;
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

type SocksRequestParse =
  | { readonly kind: 'incomplete' }
  | { readonly kind: 'invalid'; readonly replyCode: number }
  | { readonly kind: 'request'; readonly command: number; readonly host: string; readonly port: number; readonly consumedBytes: number };

function parseSocksConnectRequest(input: Buffer): SocksRequestParse {
  if (input.length < 4) return { kind: 'incomplete' };
  if (input[0] !== 5 || input[2] !== 0) return { kind: 'invalid', replyCode: 1 };
  const command = input[1]!;
  const addressType = input[3]!;
  let host: string;
  let addressEnd: number;
  if (addressType === 1) {
    addressEnd = 8;
    if (input.length < addressEnd + 2) return { kind: 'incomplete' };
    host = `${input[4]}.${input[5]}.${input[6]}.${input[7]}`;
  } else if (addressType === 3) {
    if (input.length < 5) return { kind: 'incomplete' };
    const nameLength = input[4]!;
    if (nameLength === 0) return { kind: 'invalid', replyCode: 1 };
    addressEnd = 5 + nameLength;
    if (input.length < addressEnd + 2) return { kind: 'incomplete' };
    const nameBytes = input.subarray(5, addressEnd);
    if ([...nameBytes].some(byte => byte < 0x21 || byte > 0x7e)) return { kind: 'invalid', replyCode: 1 };
    host = nameBytes.toString('ascii');
  } else if (addressType === 4) {
    addressEnd = 20;
    if (input.length < addressEnd + 2) return { kind: 'incomplete' };
    host = Array.from({ length: 8 }, (_, index) => input.readUInt16BE(4 + index * 2).toString(16)).join(':');
  } else return { kind: 'invalid', replyCode: 8 };

  const port = input.readUInt16BE(addressEnd);
  const endpoint = canonicalizeRemoteEndpoint({ host, port });
  if (!endpoint || (addressType !== 3 && isIP(endpoint.host) === 0)) return { kind: 'invalid', replyCode: 1 };
  return { kind: 'request', command, host: endpoint.host, port: endpoint.port, consumedBytes: addressEnd + 2 };
}

function socksReply(replyCode: number): Buffer {
  return Buffer.from([5, replyCode, 0, 1, 0, 0, 0, 0, 0, 0]);
}

function mapSocksConnectionError(error: unknown): number {
  const code = typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: unknown }).code : undefined;
  if (code === 'EACCES' || code === 'EPERM') return 2;
  if (code === 'ENETUNREACH') return 3;
  if (code === 'EHOSTUNREACH' || code === 'ENOTFOUND') return 4;
  if (code === 'ECONNREFUSED') return 5;
  return 1;
}

function writeSocket(socket: Socket, data: Buffer, onFlushed?: () => void): void {
  try { if (!socket.destroyed) socket.write(data, () => onFlushed?.()); }
  catch { socket.destroy(); }
}
