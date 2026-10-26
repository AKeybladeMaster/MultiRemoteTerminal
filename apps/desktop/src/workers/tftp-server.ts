import { lstat, open, realpath, stat } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { createSocket } from 'node:dgram';
import type { RemoteInfo, Socket } from 'node:dgram';
import { dirname, isAbsolute, relative, sep } from 'node:path';
import { createTftpDataPacket, createTftpErrorPacket, parseTftpAcknowledgement, parseTftpRequest } from './tftp-server-protocol.ts';

export type TftpServerFailureCode = 'INVALID_REQUEST' | 'UNAVAILABLE' | 'BUSY' | 'FORBIDDEN' | 'NOT_FOUND' | 'OUTPUT_LIMIT';

export class TftpServerFailure extends Error {
  readonly code: TftpServerFailureCode;

  constructor(code: TftpServerFailureCode) {
    super('TFTP server operation failed');
    this.name = 'TftpServerFailure';
    this.code = code;
  }
}

const BIND_ADDRESS = '127.0.0.1';
const MAX_ACTIVE_TRANSFERS = 8;
const MAX_PENDING_TRANSFERS = 8;
const MAX_PENDING_ERROR_RESPONSES = 8;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const BLOCK_BYTES = 512;
const RETRY_DELAY_MS = 1_000;
const MAX_RETRIES = 3;
const TRANSFER_DEADLINE_MS = 120_000;

interface OpenTftpFile {
  readonly handle: FileHandle;
  readonly size: number;
}

function isSameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function isSingleChild(rootDirectory: string, filePath: string): boolean {
  const child = relative(rootDirectory, filePath);
  return child.length > 0 && !isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`) && !child.includes(sep);
}

function tftpErrorCode(error: unknown): number {
  if (error instanceof TftpServerFailure) {
    if (error.code === 'NOT_FOUND') return 1;
    if (error.code === 'FORBIDDEN') return 2;
    if (error.code === 'OUTPUT_LIMIT') return 3;
  }
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (code === 'ENOENT') return 1;
  if (code === 'EACCES' || code === 'EPERM' || code === 'ENOTDIR') return 2;
  return 0;
}

function tftpErrorText(code: number): string {
  if (code === 1) return 'File not found';
  if (code === 2) return 'Access denied';
  if (code === 3) return 'File is too large';
  if (code === 4) return 'Unsupported request';
  return 'Transfer unavailable';
}

async function openRootFile(rootDirectory: string, fileName: string): Promise<OpenTftpFile> {
  const filePath = `${rootDirectory}${rootDirectory.endsWith(sep) ? '' : sep}${fileName}`;
  let handle: FileHandle | undefined;
  try {
    const before = await lstat(filePath);
    if (!before.isFile() || before.isSymbolicLink()) throw new TftpServerFailure('FORBIDDEN');
    handle = await open(filePath, 'r');
    const [opened, canonicalPath] = await Promise.all([handle.stat(), realpath(filePath)]);
    const current = await stat(canonicalPath);
    if (!opened.isFile() || !current.isFile() || !isSameFile(opened, current) || !isSameFile(before, opened) ||
        dirname(canonicalPath) !== rootDirectory || !isSingleChild(rootDirectory, canonicalPath)) {
      throw new TftpServerFailure('FORBIDDEN');
    }
    if (!Number.isSafeInteger(opened.size) || opened.size < 0 || opened.size > MAX_FILE_BYTES) throw new TftpServerFailure('OUTPUT_LIMIT');
    return { handle, size: opened.size };
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (error instanceof TftpServerFailure) throw error;
    if (error && typeof error === 'object' && 'code' in error && String(error.code) === 'ENOENT') throw new TftpServerFailure('NOT_FOUND');
    if (error && typeof error === 'object' && 'code' in error && ['EACCES', 'EPERM', 'ENOTDIR'].includes(String(error.code))) {
      throw new TftpServerFailure('FORBIDDEN');
    }
    throw new TftpServerFailure('UNAVAILABLE');
  }
}

function closeSocket(socket: Socket): Promise<void> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (): void => { if (settled) return; settled = true; resolve(); };
    socket.once('close', finish);
    try { socket.close(); } catch { finish(); }
  });
}

class TftpReadTransfer {
  private socket: Socket | undefined;
  private currentPacket: Buffer | undefined;
  private currentBlock = 1;
  private currentDataLength = 0;
  private currentIsFinal = false;
  private offset = 0;
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  constructor(
    private readonly file: OpenTftpFile,
    private readonly remote: RemoteInfo,
    private readonly onFinished: () => void
  ) {}

  async start(): Promise<void> {
    try {
      const socket = createSocket('udp4');
      this.socket = socket;
      socket.on('message', (packet, remote) => { void this.receive(packet, remote); });
      await new Promise<void>((resolve, reject) => {
        let binding = true;
        const removeBindingListeners = (): void => {
          socket.removeListener('listening', onListening);
          socket.removeListener('close', onClose);
        };
        const rejectBinding = (error: Error): void => {
          if (!binding) return;
          binding = false;
          removeBindingListeners();
          reject(error);
        };
        const onListening = (): void => {
          if (!binding) return;
          binding = false;
          socket.removeListener('close', onClose);
          if (this.closed) { resolve(); return; }
          this.deadlineTimer = setTimeout(() => { void this.finish(); }, TRANSFER_DEADLINE_MS);
          void this.sendNextBlock();
          resolve();
        };
        const onClose = (): void => rejectBinding(new TftpServerFailure('UNAVAILABLE'));
        socket.on('error', error => {
          if (binding) rejectBinding(error);
          else void this.finish();
        });
        socket.once('listening', onListening);
        socket.once('close', onClose);
        try { socket.bind(0, BIND_ADDRESS); }
        catch (error) { rejectBinding(error instanceof Error ? error : new Error('TFTP transfer socket bind failed')); }
      });
    } catch (error) {
      await this.finish();
      throw error;
    }
  }

  resendCurrent(): void {
    if (this.closed || !this.currentPacket) return;
    this.sendPacket(this.currentPacket, false);
  }

  async stop(): Promise<void> {
    await this.finish();
  }

  private async sendNextBlock(): Promise<void> {
    if (this.closed) return;
    const remaining = Math.max(0, this.file.size - this.offset);
    const requestedLength = Math.min(BLOCK_BYTES, remaining);
    const data = Buffer.allocUnsafe(requestedLength);
    let bytesRead = 0;
    while (bytesRead < requestedLength) {
      const result = await this.file.handle.read(data, bytesRead, requestedLength - bytesRead, this.offset + bytesRead).catch(() => undefined);
      if (!result || result.bytesRead === 0) { this.fail(); return; }
      bytesRead += result.bytesRead;
    }
    if (this.closed) return;
    const chunk = data.subarray(0, bytesRead);
    this.currentDataLength = chunk.byteLength;
    this.currentIsFinal = chunk.byteLength < BLOCK_BYTES;
    this.currentPacket = createTftpDataPacket(this.currentBlock, chunk);
    this.retries = 0;
    this.sendPacket(this.currentPacket, true);
  }

  private sendPacket(packet: Buffer, armRetry: boolean): void {
    const socket = this.socket;
    if (!socket || this.closed) return;
    socket.send(packet, this.remote.port, this.remote.address, error => {
      if (error) { void this.finish(); return; }
      if (armRetry) {
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => {
          if (this.closed) return;
          if (this.retries >= MAX_RETRIES) { void this.finish(); return; }
          this.retries++;
          if (this.currentPacket) this.sendPacket(this.currentPacket, true);
        }, RETRY_DELAY_MS);
      }
    });
  }

  private async receive(packet: Buffer, remote: RemoteInfo): Promise<void> {
    if (this.closed) return;
    if (remote.port !== this.remote.port || remote.address !== this.remote.address) {
      this.sendError(5, 'Unknown transfer ID', remote);
      return;
    }
    const block = parseTftpAcknowledgement(packet);
    if (block === undefined) {
      this.sendError(4, 'Illegal TFTP operation', remote, true);
      return;
    }
    if (block !== this.currentBlock) {
      const previous = (this.currentBlock + 65_535) & 65_535;
      if (block === previous) this.resendCurrent();
      return;
    }
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    if (this.currentIsFinal) { await this.finish(); return; }
    this.offset += this.currentDataLength;
    this.currentBlock = (this.currentBlock + 1) & 65_535;
    await this.sendNextBlock();
  }

  private fail(): void {
    this.sendError(0, 'Transfer unavailable', this.remote, true);
  }

  private sendError(code: number, message: string, remote: RemoteInfo, finishAfterSend = false): void {
    const socket = this.socket;
    if (!socket || this.closed) return;
    const finish = (): void => { if (finishAfterSend) void this.finish(); };
    try { socket.send(createTftpErrorPacket(code, message), remote.port, remote.address, finish); }
    catch { finish(); }
  }

  private async finish(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
    const socket = this.socket;
    this.socket = undefined;
    if (socket) await closeSocket(socket);
    await this.file.handle.close().catch(() => undefined);
    this.onFinished();
  }
}

export class ReadOnlyTftpServer {
  private listener: Socket | undefined;
  private rootDirectory: string | undefined;
  private readonly transfers = new Map<string, TftpReadTransfer>();
  private readonly pendingTransfers = new Set<string>();
  private readonly pendingTasks = new Set<Promise<void>>();
  private readonly errorSockets = new Set<Socket>();
  private stopping = false;

  constructor(private readonly onUnexpectedStop: () => void = () => {}) {}

  async start(rootDirectory: string, port: number): Promise<number> {
    if (this.listener || this.stopping) throw new TftpServerFailure('BUSY');
    if (typeof rootDirectory !== 'string' || !isAbsolute(rootDirectory) || !Number.isSafeInteger(port) || port < 0 || port > 65_535) {
      throw new TftpServerFailure('INVALID_REQUEST');
    }
    let canonicalRoot: string;
    try {
      canonicalRoot = await realpath(rootDirectory);
      const rootStats = await stat(canonicalRoot);
      if (!rootStats.isDirectory()) throw new TftpServerFailure('FORBIDDEN');
    } catch (error) {
      if (error instanceof TftpServerFailure) throw error;
      throw new TftpServerFailure('FORBIDDEN');
    }
    const socket = createSocket('udp4');
    this.listener = socket;
    this.rootDirectory = canonicalRoot;
    let binding = true;
    return await new Promise<number>((resolve, reject) => {
      let settled = false;
      const onError = (error: Error): void => {
        if (binding && !settled) {
          settled = true;
          this.listener = undefined;
          this.rootDirectory = undefined;
          socket.removeListener('message', onMessage);
          void closeSocket(socket);
          reject(new TftpServerFailure(error && 'code' in error && String((error as NodeJS.ErrnoException).code) === 'EADDRINUSE' ? 'BUSY' : 'UNAVAILABLE'));
          return;
        }
        if (!this.stopping && this.listener === socket) void this.failUnexpectedly(socket);
      };
      const onMessage = (packet: Buffer, remote: RemoteInfo): void => {
        const task = this.handleRequest(socket, packet, remote).catch(() => undefined);
        this.pendingTasks.add(task);
        void task.finally(() => this.pendingTasks.delete(task));
      };
      socket.on('error', onError);
      socket.on('message', onMessage);
      socket.once('listening', () => {
        if (settled) return;
        binding = false;
        settled = true;
        const address = socket.address();
        if (typeof address === 'string') {
          void this.stop();
          reject(new TftpServerFailure('UNAVAILABLE'));
          return;
        }
        resolve(address.port);
      });
      try { socket.bind(port, BIND_ADDRESS); }
      catch (error) { onError(error instanceof Error ? error : new Error('Socket bind failed')); }
    });
  }

  async stop(): Promise<void> {
    const listener = this.listener;
    this.stopping = true;
    this.listener = undefined;
    this.rootDirectory = undefined;
    const transfers = [...this.transfers.values()];
    const pendingTasks = [...this.pendingTasks];
    const errorSockets = [...this.errorSockets];
    this.transfers.clear();
    this.pendingTransfers.clear();
    try {
      if (listener) await closeSocket(listener);
      await Promise.allSettled([...errorSockets.map(closeSocket), ...transfers.map(transfer => transfer.stop()), ...pendingTasks]);
    } finally {
      this.stopping = false;
    }
  }

  private async handleRequest(listener: Socket, packet: Buffer, remote: RemoteInfo): Promise<void> {
    if (this.listener !== listener) return;
    if (parseTftpAcknowledgement(packet) !== undefined) {
      await this.sendRequestError(listener, remote, 5, 'Unknown transfer ID');
      return;
    }
    const parsed = parseTftpRequest(packet);
    if (!parsed.ok) {
      await this.sendRequestError(listener, remote, parsed.error.code, parsed.error.message);
      return;
    }
    const key = `${remote.address}:${remote.port}/${parsed.result.fileName}`;
    const existing = this.transfers.get(key);
    if (existing) { existing.resendCurrent(); return; }
    if (this.pendingTransfers.has(key)) return;
    if (this.transfers.size >= MAX_ACTIVE_TRANSFERS || this.pendingTransfers.size >= MAX_PENDING_TRANSFERS) {
      await this.sendRequestError(listener, remote, 0, 'Server is busy');
      return;
    }
    const rootDirectory = this.rootDirectory;
    if (!rootDirectory) return;
    this.pendingTransfers.add(key);
    let opened: OpenTftpFile | undefined;
    try {
      opened = await openRootFile(rootDirectory, parsed.result.fileName);
      if (this.listener !== listener) { await opened.handle.close(); return; }
      const transfer = new TftpReadTransfer(opened, remote, () => this.transfers.delete(key));
      this.transfers.set(key, transfer);
      opened = undefined;
      await transfer.start();
    } catch (error) {
      await opened?.handle.close().catch(() => undefined);
      const code = tftpErrorCode(error);
      await this.sendRequestError(listener, remote, code, tftpErrorText(code));
    } finally {
      this.pendingTransfers.delete(key);
    }
  }

  private async sendRequestError(listener: Socket, remote: RemoteInfo, code: number, message: string): Promise<void> {
    if (listener !== this.listener || this.errorSockets.size >= MAX_PENDING_ERROR_RESPONSES) return;
    const socket = createSocket('udp4');
    this.errorSockets.add(socket);
    await new Promise<void>(resolve => {
      let finished = false;
      const finish = (): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        socket.removeListener('listening', onListening);
        socket.removeListener('error', onError);
        socket.removeListener('close', onClose);
        void closeSocket(socket).finally(() => {
          this.errorSockets.delete(socket);
          resolve();
        });
      };
      const timer = setTimeout(finish, 2_000);
      const onError = (): void => finish();
      const onClose = (): void => finish();
      const onListening = (): void => {
        if (listener !== this.listener) { finish(); return; }
        try {
          socket.send(createTftpErrorPacket(code, message), remote.port, remote.address, () => finish());
        } catch { finish(); }
      };
      socket.on('error', onError);
      socket.once('close', onClose);
      socket.once('listening', onListening);
      try { socket.bind(0, BIND_ADDRESS); }
      catch { finish(); }
    });
  }

  private async failUnexpectedly(socket: Socket): Promise<void> {
    if (this.listener !== socket) return;
    await this.stop();
    this.onUnexpectedStop();
  }
}
