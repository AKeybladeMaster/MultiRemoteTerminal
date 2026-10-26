import { LocalTextFileProviderError } from '../../../../packages/application/src/local-text-editor.ts';
import { readLocalTextFile, saveLocalTextFile, LocalTextFileOperationError } from './local-text-file-provider.ts';
import { LOCAL_TEXT_WORKER_PROTOCOL_VERSION, parseLocalTextWorkerInput } from './local-text-worker-protocol.ts';
import type { LocalTextWorkerRequest } from './local-text-worker-protocol.ts';

const parent = process.parentPort;
if (!parent) throw new Error('Local text worker requires an Electron utility process');
let received = false;

function send(value: unknown): void {
  try { parent.postMessage(value); } catch { /* The main process owns worker cleanup. */ }
}

function errorCode(error: unknown): string {
  if (error instanceof LocalTextFileOperationError || error instanceof LocalTextFileProviderError) return error.code;
  return 'UNAVAILABLE';
}

async function handle(request: LocalTextWorkerRequest): Promise<void> {
  try {
    const result = request.command === 'read' ? await readLocalTextFile(request.path)
      : await saveLocalTextFile(request.path, request.content, request.expectedRevision);
    send({ version: LOCAL_TEXT_WORKER_PROTOCOL_VERSION, type: 'reply', requestId: request.requestId, ok: true, result });
  } catch (error) {
    send({ version: LOCAL_TEXT_WORKER_PROTOCOL_VERSION, type: 'reply', requestId: request.requestId, ok: false, errorCode: errorCode(error) });
  }
}

parent.on('message', event => {
  if (received) return;
  received = true;
  const request = parseLocalTextWorkerInput(event.data);
  if (request) void handle(request);
});
