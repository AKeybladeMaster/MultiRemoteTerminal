import { createRequire } from 'node:module';
import { join } from 'node:path';
import type * as SerialBindings from '@serialport/bindings-cpp';
import { SerialTerminalProviderError } from '../../../../packages/application/src/serial-terminals.ts';
import { createSerialTransportProvider } from './serial-transport-provider.ts';
import { parseSerialWorkerInput, SERIAL_WORKER_PROTOCOL_VERSION } from './serial-worker-protocol.ts';
import type { SerialWorkerRequest, SerialWorkerErrorCode } from './serial-worker-protocol.ts';

const parent = process.parentPort;
if (!parent) throw new Error('Serial worker requires an Electron utility process');
const appRoot = process.env.MRT_APP_ROOT;
if (!appRoot) throw new Error('Serial worker is missing its application root');
const loadFromApp = createRequire(join(appRoot, 'package.json'));
const serialBindings = loadFromApp('@serialport/bindings-cpp') as typeof SerialBindings;
const nativeBinding = serialBindings.autoDetect();
let connectionBinding = nativeBinding;
let listBindings = [nativeBinding];

if (process.env.MRT_SERIAL_MOCK_MODE === '1') {
  const { MockBinding } = loadFromApp('@serialport/binding-mock') as { readonly MockBinding: {
    reset(): void;
    createPort(path: string, options: { readonly echo: boolean; readonly record: boolean; readonly manufacturer: string; readonly readyData: Buffer }): void;
    list(): Promise<readonly unknown[]>;
  } };
  MockBinding.reset();
  MockBinding.createPort('COM4095', { echo: true, record: true, manufacturer: 'MultiRemoteTerminal test device', readyData: Buffer.from('MRT serial mock ready\r\n') });
  connectionBinding = MockBinding as unknown as typeof nativeBinding;
  listBindings = [...listBindings, MockBinding as unknown as typeof nativeBinding];
}

function send(value: unknown): void {
  try { parent.postMessage(value); } catch { /* The main process owns worker teardown. */ }
}

const provider = createSerialTransportProvider({ connectionBinding, listBindings, publish: event =>
  send({ version: SERIAL_WORKER_PROTOCOL_VERSION, type: 'event', event })
});
let shuttingDown = false;

function errorCode(error: unknown): SerialWorkerErrorCode {
  if (error instanceof SerialTerminalProviderError) return error.code;
  return 'UNAVAILABLE';
}

async function handle(request: Extract<SerialWorkerRequest, { readonly type: 'request' }>): Promise<void> {
  if (shuttingDown && request.command !== 'shutdown') {
    send({ version: SERIAL_WORKER_PROTOCOL_VERSION, type: 'reply', requestId: request.requestId, ok: false, errorCode: 'CANCELLED' });
    return;
  }
  try {
    let result: Record<string, never> | { readonly ports: readonly unknown[] } = {};
    if (request.command === 'list') result = { ports: await provider.listPorts() };
    else if (request.command === 'open') await provider.open(request.sessionId, request.configuration);
    else if (request.command === 'write') await provider.write(request.sessionId, request.data);
    else if (request.command === 'resize') await provider.resize(request.sessionId, request.size);
    else if (request.command === 'ack') await provider.acknowledgeOutput(request.sessionId, request.sequence);
    else if (request.command === 'close') await provider.close(request.sessionId);
    else {
      shuttingDown = true;
      await provider.shutdown();
    }
    send({ version: SERIAL_WORKER_PROTOCOL_VERSION, type: 'reply', requestId: request.requestId, ok: true, result });
  } catch (error) {
    send({ version: SERIAL_WORKER_PROTOCOL_VERSION, type: 'reply', requestId: request.requestId, ok: false, errorCode: errorCode(error) });
  }
}

parent.on('message', event => {
  const request = parseSerialWorkerInput(event.data);
  if (request) void handle(request);
});
