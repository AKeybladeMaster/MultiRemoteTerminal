import { createRequire } from 'node:module';
import { join } from 'node:path';
import type * as BasicFtp from 'basic-ftp';
import { FtpFilesProviderError } from '../../../../packages/application/src/ftp-files.ts';
import { createFtpTransportProvider } from './ftp-transport-provider.ts';
import { parseFtpWorkerInput, FTP_WORKER_PROTOCOL_VERSION } from './ftp-worker-protocol.ts';
import type { FtpWorkerRequest, FtpWorkerErrorCode } from './ftp-worker-protocol.ts';

const parent = process.parentPort;
if (!parent) throw new Error('FTP worker requires an Electron utility process');
const appRoot = process.env.MRT_APP_ROOT;
if (!appRoot) throw new Error('FTP worker is missing its application root');
const loadFromApp = createRequire(join(appRoot, 'package.json'));
const basicFtp = loadFromApp('basic-ftp') as typeof BasicFtp;
const provider = createFtpTransportProvider(
  (timeoutMs, options) => new basicFtp.Client(timeoutMs, options),
  error => error instanceof basicFtp.FTPError && error.code === 530,
  { directory: basicFtp.FileType.Directory, file: basicFtp.FileType.File, symbolicLink: basicFtp.FileType.SymbolicLink }
);

interface PendingListing {
  readonly sessionId: string;
  readonly cancellation: AbortController;
}

const pendingListings = new Map<string, PendingListing>();
let shuttingDown = false;

function send(value: unknown): void {
  try { parent.postMessage(value); } catch { /* The main process owns worker teardown. */ }
}

function errorCode(error: unknown): FtpWorkerErrorCode {
  if (error instanceof FtpFilesProviderError) return error.code;
  return 'UNAVAILABLE';
}

function replyError(requestId: string, error: unknown): void {
  send({ version: FTP_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: false, errorCode: errorCode(error) });
}

async function handle(request: Extract<FtpWorkerRequest, { readonly type: 'request' }>): Promise<void> {
  if (request.command === 'files.cancel') {
    const pending = pendingListings.get(request.operationId);
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
    pendingListings.set(request.requestId, { sessionId: request.sessionId, cancellation });
    try {
      const result = await provider.listDirectory(request.sessionId, request.path, cancellation.signal);
      send({ version: FTP_WORKER_PROTOCOL_VERSION, type: 'reply', requestId: request.requestId, ok: true, result });
    } catch (error) { replyError(request.requestId, error); }
    finally { pendingListings.delete(request.requestId); }
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
    for (const pending of pendingListings.values()) if (pending.sessionId === request.sessionId) pending.cancellation.abort();
    await provider.close(request.sessionId);
  } else {
    shuttingDown = true;
    for (const pending of pendingListings.values()) pending.cancellation.abort();
    await provider.shutdown();
  }
  send({ version: FTP_WORKER_PROTOCOL_VERSION, type: 'reply', requestId: request.requestId, ok: true, result: {} });
}

parent.on('message', event => {
  const request = parseFtpWorkerInput(event.data);
  if (request) void handle(request);
});
