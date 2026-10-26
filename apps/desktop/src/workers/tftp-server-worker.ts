import { parentPort } from 'node:worker_threads';
import { ReadOnlyTftpServer, TftpServerFailure } from './tftp-server.ts';
import type { TftpServerWorkerRequest } from './tftp-server-worker-protocol.ts';
import { parseTftpServerWorkerInput, TFTP_SERVER_WORKER_PROTOCOL_VERSION } from './tftp-server-worker-protocol.ts';

const parent = process.parentPort ?? parentPort;
if (!parent) throw new Error('TFTP server requires an Electron utility process');

function send(value: unknown): void {
  try { parent.postMessage(value); } catch { /* The main process owns worker teardown. */ }
}

const server = new ReadOnlyTftpServer(() => send({ version: TFTP_SERVER_WORKER_PROTOCOL_VERSION, type: 'state', state: 'stopped' }));
let shuttingDown = false;
let tail = Promise.resolve();

async function handle(request: TftpServerWorkerRequest): Promise<void> {
  if (shuttingDown && request.command !== 'shutdown') {
    send({ version: TFTP_SERVER_WORKER_PROTOCOL_VERSION, type: 'reply', requestId: request.requestId, ok: false, errorCode: 'UNAVAILABLE' });
    return;
  }
  try {
    let result: Record<string, never> | { readonly port: number } = {};
    if (request.command === 'start') result = { port: await server.start(request.rootDirectory, request.port) };
    else if (request.command === 'stop') await server.stop();
    else {
      shuttingDown = true;
      await server.stop();
    }
    send({ version: TFTP_SERVER_WORKER_PROTOCOL_VERSION, type: 'reply', requestId: request.requestId, ok: true, result });
  } catch (error) {
    const errorCode = error instanceof TftpServerFailure ? error.code : 'UNAVAILABLE';
    send({ version: TFTP_SERVER_WORKER_PROTOCOL_VERSION, type: 'reply', requestId: request.requestId, ok: false, errorCode });
  }
}

parent.on('message', event => {
  const request = parseTftpServerWorkerInput(event.data);
  if (!request) return;
  tail = tail.then(() => handle(request)).catch(() => {
    send({ version: TFTP_SERVER_WORKER_PROTOCOL_VERSION, type: 'reply', requestId: request.requestId, ok: false, errorCode: 'UNAVAILABLE' });
  });
});
