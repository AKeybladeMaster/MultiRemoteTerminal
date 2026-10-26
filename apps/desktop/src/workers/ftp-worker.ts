import { createRequire } from 'node:module';
import { join, posix } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import type * as BasicFtp from 'basic-ftp';
import { FtpFilesProviderError } from '../../../../packages/application/src/ftp-files.ts';
import { createFtpTransportProvider } from './ftp-transport-provider.ts';
import { parseFtpWorkerInput, FTP_WORKER_PROTOCOL_VERSION } from './ftp-worker-protocol.ts';
import type { FtpWorkerRequest, FtpWorkerErrorCode } from './ftp-worker-protocol.ts';
import type { FtpTransferProgress } from '../../../../packages/domain/src/ftp.ts';
import { isFtpFileName } from '../../../../packages/domain/src/ftp.ts';
import { remoteChildPath, remoteParentPath } from '../../../../packages/domain/src/remote-files.ts';

const parent = process.parentPort;
if (!parent) throw new Error('FTP worker requires an Electron utility process');
const appRoot = process.env.MRT_APP_ROOT;
if (!appRoot) throw new Error('FTP worker is missing its application root');
const loadFromApp = createRequire(join(appRoot, 'package.json'));
const basicFtp = loadFromApp('basic-ftp') as typeof BasicFtp;
function uniqueStorePath(message: string, currentDirectory: string, requestedDirectory: string): string | undefined {
  const match = /(?:^|\n)(?:125|150) FILE: ([^\n]+)(?:$|\n)/u.exec(message);
  const reportedPath = match?.[1];
  if (!reportedPath) return undefined;
  const normalizedDirectory = posix.normalize(currentDirectory);
  const resolvedReportedPath = reportedPath.startsWith('/')
    ? posix.normalize(reportedPath)
    : posix.resolve(normalizedDirectory, reportedPath);
  if (posix.dirname(resolvedReportedPath) !== normalizedDirectory) return undefined;
  const fileName = posix.basename(resolvedReportedPath);
  if (!isFtpFileName(fileName)) return undefined;
  return remoteChildPath(requestedDirectory, fileName);
}

class MrtFtpClient extends basicFtp.Client {
  override async access(options: BasicFtp.AccessOptions = {}): Promise<BasicFtp.FTPResponse> {
    const testCaPath = process.env.MRT_E2E_FTP_CA;
    if (!testCaPath || options.secure !== true) return super.access(options);
    const ca = await readFile(testCaPath);
    return super.access({ ...options, secureOptions: { ...options.secureOptions, ca } });
  }

  async uploadUniqueFrom(source: Readable, remotePath: string, onUniquePath: (remotePath: string) => void): Promise<string> {
    let generatedPath: string | undefined;
    const requestedDirectory = remoteParentPath(remotePath);
    const originalDirectory = await this.pwd();
    if (requestedDirectory !== '.') await this.cd(requestedDirectory);
    const currentDirectory = await this.pwd();
    const ftp = this.ftp;
    const originalHandle = ftp.handle.bind(ftp);
    const interceptHandle: typeof ftp.handle = (command, responseHandler) => {
      if (command?.startsWith('STOU ')) {
        return originalHandle('STOU', (response, task) => {
          if (!(response instanceof Error) && (response.code === 125 || response.code === 150)) {
            generatedPath = uniqueStorePath(response.message, currentDirectory, requestedDirectory);
            if (generatedPath) onUniquePath(generatedPath);
          }
          responseHandler(response, task);
        });
      }
      return originalHandle(command, responseHandler);
    };
    ftp.handle = interceptHandle;
    try {
      // basic-ftp 6.2.3 owns stream setup/cleanup. Its protected method adds a path to
      // commands, so the handler rewrites this call to standard argumentless STOU.
      await this._uploadFromStream(source, 'mrt-stou', 'STOU' as never);
    } catch (error) {
      if (error instanceof basicFtp.FTPError && [500, 501, 502, 504].includes(error.code)) {
        throw new FtpFilesProviderError('NOT_SUPPORTED', true);
      }
      throw error;
    } finally {
      ftp.handle = originalHandle;
      if (!this.closed && requestedDirectory !== '.') {
        try { await this.cd(originalDirectory); }
        catch { this.close(); throw new FtpFilesProviderError('UNAVAILABLE', false); }
      }
    }
    if (!generatedPath) {
      this.close();
      throw new FtpFilesProviderError('NOT_SUPPORTED', false);
    }
    return generatedPath;
  }
}

const provider = createFtpTransportProvider(
  (timeoutMs, options) => new MrtFtpClient(timeoutMs, options),
  error => error instanceof basicFtp.FTPError && error.code === 530,
  { directory: basicFtp.FileType.Directory, file: basicFtp.FileType.File, symbolicLink: basicFtp.FileType.SymbolicLink }
);

interface PendingFtpOperation {
  readonly sessionId: string;
  readonly cancellation: AbortController;
}

const pendingOperations = new Map<string, PendingFtpOperation>();
let shuttingDown = false;

function send(value: unknown): void {
  try { parent.postMessage(value); } catch { /* The main process owns worker teardown. */ }
}

function errorCode(error: unknown): FtpWorkerErrorCode {
  if (error instanceof FtpFilesProviderError) return error.code;
  return 'UNAVAILABLE';
}

function replyError(requestId: string, error: unknown): void {
  const sessionUsable = error instanceof FtpFilesProviderError ? error.sessionUsable : undefined;
  send({ version: FTP_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: false, errorCode: errorCode(error),
    ...(sessionUsable === undefined ? {} : { sessionUsable }) });
}

async function handle(request: Extract<FtpWorkerRequest, { readonly type: 'request' }>): Promise<void> {
  if (request.command === 'files.cancel') {
    const pending = pendingOperations.get(request.operationId);
    if (pending?.sessionId === request.sessionId) pending.cancellation.abort();
    send({ version: FTP_WORKER_PROTOCOL_VERSION, type: 'reply', requestId: request.requestId, ok: true, result: {} });
    return;
  }
  if (shuttingDown && request.command !== 'shutdown') {
    replyError(request.requestId, new FtpFilesProviderError('CANCELLED'));
    return;
  }
  if (request.command === 'files.list') {
    const cancellation = new AbortController();
    pendingOperations.set(request.requestId, { sessionId: request.sessionId, cancellation });
    try {
      const result = await provider.listDirectory(request.sessionId, request.path, cancellation.signal);
      send({ version: FTP_WORKER_PROTOCOL_VERSION, type: 'reply', requestId: request.requestId, ok: true, result });
    } catch (error) { replyError(request.requestId, error); }
    finally { pendingOperations.delete(request.requestId); }
    return;
  }
  if (request.command === 'files.upload' || request.command === 'files.download') {
    const cancellation = new AbortController();
    pendingOperations.set(request.operationId, { sessionId: request.sessionId, cancellation });
    const onProgress = (progress: FtpTransferProgress) => {
      if (cancellation.signal.aborted) return;
      send({ version: FTP_WORKER_PROTOCOL_VERSION, type: 'progress', requestId: request.requestId, progress });
    };
    try {
      const result = request.command === 'files.upload'
        ? await provider.uploadFile(request.sessionId, request.operationId, request.localPath, request.remoteDirectory, request.fileName,
          request.conflictPolicy, cancellation.signal, onProgress)
        : await provider.downloadFile(request.sessionId, request.operationId, request.remotePath, request.localPath,
          request.conflictPolicy, cancellation.signal, onProgress);
      send({ version: FTP_WORKER_PROTOCOL_VERSION, type: 'reply', requestId: request.requestId, ok: true, result });
    } catch (error) { replyError(request.requestId, error); }
    finally { pendingOperations.delete(request.operationId); }
    return;
  }
  if (request.command === 'open') {
    try { await provider.open(request.sessionId, request.endpoint, request.credentials); }
    catch (error) { replyError(request.requestId, error); return; }
    finally {
      const credentials = request.credentials as { username: string; password: string };
      credentials.username = '';
      credentials.password = '';
    }
  } else if (request.command === 'close') {
    for (const pending of pendingOperations.values()) if (pending.sessionId === request.sessionId) pending.cancellation.abort();
    await provider.close(request.sessionId);
  } else {
    shuttingDown = true;
    for (const pending of pendingOperations.values()) pending.cancellation.abort();
    await provider.shutdown();
  }
  send({ version: FTP_WORKER_PROTOCOL_VERSION, type: 'reply', requestId: request.requestId, ok: true, result: {} });
}

parent.on('message', event => {
  const request = parseFtpWorkerInput(event.data);
  if (request) void handle(request);
});
