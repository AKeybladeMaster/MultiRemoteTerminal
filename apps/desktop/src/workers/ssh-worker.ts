import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type * as Ssh2 from 'ssh2';
import { SshTerminalProviderError } from '../../../../packages/application/src/ssh-terminals.ts';
import type { HostKeyEvidence, SshHostEndpoint } from '../../../../packages/domain/src/host-trust.ts';
import type { FileTransferProgress } from '../../../../packages/domain/src/file-transfer.ts';
import { createSshTransportProvider } from './ssh-transport-provider.ts';
import { parseSshWorkerInput, SSH_WORKER_PROTOCOL_VERSION } from './ssh-protocol.ts';
import type { SshWorkerRequest, SshWorkerErrorCode } from './ssh-protocol.ts';

const parent = process.parentPort;
if (!parent) throw new Error('SSH worker requires an Electron utility process');

const appRoot = process.env.MRT_APP_ROOT;
if (!appRoot) throw new Error('SSH worker is missing its application root');
const loadFromApp = createRequire(join(appRoot, 'package.json'));
const ssh2 = loadFromApp('ssh2') as typeof Ssh2;

interface PendingHostCheck {
  readonly sessionId: string;
  readonly resolve: (accepted: boolean) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

const pendingHostChecks = new Map<string, PendingHostCheck>();
const pendingFileOperations = new Map<string, { readonly sessionId: string; readonly cancellation: AbortController }>();
let shuttingDown = false;

function send(value: unknown): void {
  try { parent.postMessage(value); } catch { /* The main process owns worker teardown. */ }
}

function requestHostVerification(sessionId: string, endpoint: SshHostEndpoint, evidence: HostKeyEvidence): Promise<boolean> {
  if (shuttingDown || pendingHostChecks.size >= 64) return Promise.resolve(false);
  const checkId = randomUUID();
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      pendingHostChecks.delete(checkId);
      resolve(false);
    }, 125_000);
    pendingHostChecks.set(checkId, { sessionId, resolve, timer });
    send({ version: SSH_WORKER_PROTOCOL_VERSION, type: 'host-key', sessionId, checkId, endpoint, evidence });
  });
}

const provider = createSshTransportProvider({
  create: () => new ssh2.Client(),
  parseHostKey: ssh2.utils.parseKey
}, event => send({ version: SSH_WORKER_PROTOCOL_VERSION, type: 'event', event }));

function errorCode(error: unknown): SshWorkerErrorCode {
  if (error instanceof SshTerminalProviderError) return error.code;
  return 'UNAVAILABLE';
}

function resolveHostCheck(request: Extract<SshWorkerRequest, { type: 'host-key-result' }>): void {
  const pending = pendingHostChecks.get(request.checkId);
  if (!pending || pending.sessionId !== request.sessionId) return;
  pendingHostChecks.delete(request.checkId);
  clearTimeout(pending.timer);
  pending.resolve(request.accepted);
}

function cancelHostChecksForSession(sessionId: string): void {
  for (const [checkId, pending] of pendingHostChecks) {
    if (pending.sessionId !== sessionId) continue;
    pendingHostChecks.delete(checkId);
    clearTimeout(pending.timer);
    pending.resolve(false);
  }
}

async function stop(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const sessionId of new Set([...pendingHostChecks.values()].map(pending => pending.sessionId))) cancelHostChecksForSession(sessionId);
  for (const pending of pendingFileOperations.values()) pending.cancellation.abort();
  await provider.shutdown().catch(() => undefined);
}

function cancelFileOperationsForSession(sessionId: string): void {
  for (const pending of pendingFileOperations.values()) if (pending.sessionId === sessionId) pending.cancellation.abort();
}

async function handle(request: Extract<SshWorkerRequest, { type: 'request' }>): Promise<void> {
  if (request.command === 'files.cancel') {
    const pending = pendingFileOperations.get(request.operationId);
    if (pending?.sessionId === request.sessionId) pending.cancellation.abort();
    send({ version: SSH_WORKER_PROTOCOL_VERSION, type: 'reply', requestId: request.requestId, ok: true, result: {} });
    return;
  }
  if (request.command === 'files.list') {
    const cancellation = new AbortController();
    pendingFileOperations.set(request.requestId, { sessionId: request.sessionId, cancellation });
    try {
      const result = await provider.listRemoteDirectory(request.sessionId, request.path, cancellation.signal);
      send({ version: SSH_WORKER_PROTOCOL_VERSION, type: 'reply', requestId: request.requestId, ok: true, result });
    } catch (error) {
      send({ version: SSH_WORKER_PROTOCOL_VERSION, type: 'reply', requestId: request.requestId, ok: false, errorCode: errorCode(error) });
    } finally { pendingFileOperations.delete(request.requestId); }
    return;
  }
  if (request.command === 'files.upload' || request.command === 'files.download') {
    if (pendingFileOperations.has(request.operationId)) {
      send({ version: SSH_WORKER_PROTOCOL_VERSION, type: 'reply', requestId: request.requestId, ok: false, errorCode: 'BUSY' });
      return;
    }
    const cancellation = new AbortController();
    pendingFileOperations.set(request.operationId, { sessionId: request.sessionId, cancellation });
    const onProgress = (progress: FileTransferProgress) =>
      send({ version: SSH_WORKER_PROTOCOL_VERSION, type: 'progress', requestId: request.requestId, progress });
    try {
      const result = request.command === 'files.upload'
        ? await provider.uploadRemoteFile(request.sessionId, request.operationId, request.localPath, request.remoteDirectory,
          request.fileName, request.conflictPolicy, cancellation.signal, onProgress)
        : await provider.downloadRemoteFile(request.sessionId, request.operationId, request.remotePath, request.localPath,
          request.conflictPolicy, cancellation.signal, onProgress);
      send({ version: SSH_WORKER_PROTOCOL_VERSION, type: 'reply', requestId: request.requestId, ok: true, result });
    } catch (error) {
      send({ version: SSH_WORKER_PROTOCOL_VERSION, type: 'reply', requestId: request.requestId, ok: false, errorCode: errorCode(error) });
    } finally {
      if (pendingFileOperations.get(request.operationId)?.cancellation === cancellation) pendingFileOperations.delete(request.operationId);
    }
    return;
  }
  try {
    if (request.command === 'open') {
      try {
        await provider.open(request.sessionId, request.endpoint, request.credentials, request.size,
          (endpoint, evidence) => requestHostVerification(request.sessionId, endpoint, evidence), request.gatewayHops ?? []);
      } finally {
        const credentials = request.credentials as { username: string; password: string };
        credentials.password = '';
        credentials.username = '';
        for (const hop of request.gatewayHops ?? []) { hop.credentials.password = ''; hop.credentials.username = ''; }
      }
    } else if (request.command === 'open-files') {
      try {
        await provider.openFiles(request.sessionId, request.endpoint, request.credentials,
          (endpoint, evidence) => requestHostVerification(request.sessionId, endpoint, evidence));
      } finally {
        const credentials = request.credentials as { username: string; password: string };
        credentials.password = '';
        credentials.username = '';
      }
    } else if (request.command === 'tunnel.forward.start') {
      const bindPort = await provider.startForward(request.sessionId, request.definition);
      send({ version: SSH_WORKER_PROTOCOL_VERSION, type: 'reply', requestId: request.requestId, ok: true, result: { bindPort } });
      return;
    } else if (request.command === 'tunnel.forward.stop') {
      await provider.stopForward(request.sessionId, request.tunnelId);
      send({ version: SSH_WORKER_PROTOCOL_VERSION, type: 'reply', requestId: request.requestId, ok: true, result: {} });
      return;
    } else if (request.command === 'write') await provider.write(request.sessionId, request.data);
    else if (request.command === 'resize') await provider.resize(request.sessionId, request.size);
    else if (request.command === 'ack') await provider.acknowledgeOutput(request.sessionId, request.sequence);
    else if (request.command === 'close') {
      cancelHostChecksForSession(request.sessionId);
      cancelFileOperationsForSession(request.sessionId);
      await provider.close(request.sessionId);
    }
    else await stop();
    send({ version: SSH_WORKER_PROTOCOL_VERSION, type: 'reply', requestId: request.requestId, ok: true, result: {} });
  } catch (error) {
    send({ version: SSH_WORKER_PROTOCOL_VERSION, type: 'reply', requestId: request.requestId, ok: false, errorCode: errorCode(error) });
  }
}

parent.on('message', event => {
  const request = parseSshWorkerInput(event.data);
  if (!request) return;
  if (request.type === 'host-key-result') resolveHostCheck(request);
  else void handle(request);
});
