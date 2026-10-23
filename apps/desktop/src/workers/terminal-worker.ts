import { createRequire } from 'node:module';
import { join } from 'node:path';
import type * as NodePty from 'node-pty';
import { LocalPtyProvider } from './local-pty-provider.ts';
import { parseTerminalWorkerRequest, WORKER_PROTOCOL_VERSION } from './protocol.ts';

const parent = process.parentPort;
if (!parent) throw new Error('Terminal worker requires an Electron utility process');

const appRoot = process.env.MRT_APP_ROOT;
if (!appRoot) throw new Error('Terminal worker is missing its application root');
const loadFromApp = createRequire(join(appRoot, 'package.json'));
const nodePty = loadFromApp('node-pty') as typeof NodePty;
const provider = new LocalPtyProvider(nodePty.spawn);

function send(value: unknown): void {
  try { parent.postMessage(value); } catch { /* The main process owns worker teardown. */ }
}

provider.subscribe(event => send({ version: WORKER_PROTOCOL_VERSION, type: 'event', event }));

parent.on('message', event => {
  const request = parseTerminalWorkerRequest(event.data);
  if (!request) return;
  void (async () => {
    try {
      let result: { readonly pid?: number } = {};
      if (request.command === 'open') {
        await provider.open(request.sessionId, request.shell, request.size);
        const pid = provider.processId(request.sessionId);
        send({ version: WORKER_PROTOCOL_VERSION, type: 'started', sessionId: request.sessionId, pid });
        result = { pid };
      } else if (request.command === 'write') await provider.write(request.sessionId, request.data);
      else if (request.command === 'resize') await provider.resize(request.sessionId, request.size);
      else if (request.command === 'ack') await provider.acknowledgeOutput(request.sessionId, request.sequence);
      else if (request.command === 'close') await provider.close(request.sessionId);
      else await provider.shutdown();

      send({ version: WORKER_PROTOCOL_VERSION, type: 'reply', requestId: request.requestId, ok: true, result });
    } catch {
      send({ version: WORKER_PROTOCOL_VERSION, type: 'reply', requestId: request.requestId, ok: false, errorCode: 'UNAVAILABLE' });
    }
  })();
});
