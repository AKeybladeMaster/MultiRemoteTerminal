import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStorageWorkerMessage, parseStorageWorkerRequest, STORAGE_WORKER_PROTOCOL_VERSION } from '../../apps/desktop/src/workers/storage-protocol.ts';

const requestId = '5726a2ee-03cd-4f5a-a28c-bd72784f80a6';
const macroId = '7c08b18a-57cc-4b44-a8b3-2d404850e81c';

test('storage worker accepts exact macro catalog requests and rejects secret-shaped payloads', () => {
  const envelope = { version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'request', requestId };
  const valid = [
    { ...envelope, command: 'macro.list' },
    { ...envelope, command: 'macro.create', draft: { name: 'Build', steps: [{ kind: 'send', text: 'npm run build' }] } },
    { ...envelope, command: 'macro.update', id: macroId, draft: { name: 'Build', steps: [] } },
    { ...envelope, command: 'macro.remove', id: macroId }
  ];
  assert.ok(valid.every(value => parseStorageWorkerRequest(value)));
  assert.equal(parseStorageWorkerRequest({ ...valid[1], draft: { name: 'Build', steps: [], password: 'hidden' } }), undefined);
  assert.equal(parseStorageWorkerRequest({ ...valid[1], draft: { name: 'Build', steps: [{ kind: 'send', text: 'echo ok\nshutdown' }] } }), undefined);
  assert.equal(parseStorageWorkerRequest({ ...valid[2], extra: true }), undefined);
});

test('storage worker validates macro replies before returning them to main', () => {
  const definition = { id: macroId, name: 'Build', steps: [{ kind: 'send', text: 'npm run build' }], schemaVersion: 1,
    createdAt: '2026-10-25T10:00:00.000Z', updatedAt: '2026-10-25T10:00:00.000Z' };
  const message = { version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
    result: { kind: 'macroDefinitions', value: [definition] } };
  assert.ok(parseStorageWorkerMessage(message));
  assert.equal(parseStorageWorkerMessage({ ...message, result: { kind: 'macroDefinitions', value: [{ ...definition, credential: 'hidden' }] } }), undefined);
});
