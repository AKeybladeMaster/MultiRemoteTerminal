import { createTelnetTransportProvider } from './telnet-transport-provider.ts';
import { TelnetTerminalProviderError } from '../../../../packages/application/src/telnet-terminals.ts';
import { parseTelnetWorkerInput, TELNET_WORKER_PROTOCOL_VERSION } from './telnet-worker-protocol.ts';
import type { TelnetWorkerRequest, TelnetWorkerErrorCode } from './telnet-worker-protocol.ts';

const parent = process.parentPort;
if (!parent) throw new Error('Telnet worker requires an Electron utility process');

let shuttingDown = false;
function send(value: unknown): void {
  try { parent.postMessage(value); } catch { /* The main process owns worker teardown. */ }
}

const provider = createTelnetTransportProvider(event => send({ version: TELNET_WORKER_PROTOCOL_VERSION, type: 'event', event }));

function errorCode(error: unknown): TelnetWorkerErrorCode {
  if (error instanceof TelnetTerminalProviderError) return error.code;
  return 'UNAVAILABLE';
}

async function handle(request: Extract<TelnetWorkerRequest, { readonly type: 'request' }>): Promise<void> {
  if (shuttingDown && request.command !== 'shutdown') {
    send({ version: TELNET_WORKER_PROTOCOL_VERSION, type: 'reply', requestId: request.requestId, ok: false, errorCode: 'CANCELLED' });
    return;
  }
  try {
    if (request.command === 'open') await provider.open(request.sessionId, request.endpoint, request.size);
    else if (request.command === 'write') await provider.write(request.sessionId, request.data);
    else if (request.command === 'resize') await provider.resize(request.sessionId, request.size);
    else if (request.command === 'ack') await provider.acknowledgeOutput(request.sessionId, request.sequence);
    else if (request.command === 'close') await provider.close(request.sessionId);
    else {
      shuttingDown = true;
      await provider.shutdown();
    }
    send({ version: TELNET_WORKER_PROTOCOL_VERSION, type: 'reply', requestId: request.requestId, ok: true, result: {} });
  } catch (error) {
    send({ version: TELNET_WORKER_PROTOCOL_VERSION, type: 'reply', requestId: request.requestId, ok: false, errorCode: errorCode(error) });
  }
}

parent.on('message', event => {
  const request = parseTelnetWorkerInput(event.data);
  if (request) void handle(request);
});
