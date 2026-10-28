import assert from 'node:assert/strict';
import test from 'node:test';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { parseStorageWorkerMessage, parseStorageWorkerRequest, STORAGE_WORKER_PROTOCOL_VERSION } from '../../apps/desktop/src/workers/storage-protocol.ts';

const requestId = '5726a2ee-03cd-4f5a-a28c-bd72784f80a6';
const macroId = '7c08b18a-57cc-4b44-a8b3-2d404850e81c';

test('storage worker accepts exact macro catalog requests and rejects secret-shaped payloads', () => {
  const envelope = { version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'request', requestId };
  const valid = [
    { ...envelope, command: 'macro.list' },
    { ...envelope, command: 'macro.create', draft: { name: 'Build', steps: [{ kind: 'send', text: 'npm run build' }] } },
    { ...envelope, command: 'macro.update', id: macroId, draft: { name: 'Build', steps: [] } },
    { ...envelope, command: 'macro.remove', id: macroId },
    { ...envelope, command: 'macro.shortcut.list' },
    { ...envelope, command: 'macro.shortcut.set', macroId, code: 'F2' },
    { ...envelope, command: 'macro.shortcut.remove', macroId }
  ];
  assert.ok(valid.every(value => parseStorageWorkerRequest(value)));
  assert.equal(parseStorageWorkerRequest({ ...valid[1], draft: { name: 'Build', steps: [], password: 'hidden' } }), undefined);
  assert.equal(parseStorageWorkerRequest({ ...valid[1], draft: { name: 'Build', steps: [{ kind: 'send', text: 'echo ok\nshutdown' }] } }), undefined);
  assert.equal(parseStorageWorkerRequest({ ...valid[2], extra: true }), undefined);
  assert.equal(parseStorageWorkerRequest({ ...valid[5], code: 'Ctrl+F2' }), undefined);
});

test('storage worker validates macro replies before returning them to main', () => {
  const definition = { id: macroId, name: 'Build', steps: [{ kind: 'send', text: 'npm run build' }], schemaVersion: 1,
    createdAt: '2026-10-25T10:00:00.000Z', updatedAt: '2026-10-25T10:00:00.000Z' };
  const message = { version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
    result: { kind: 'macroDefinitions', value: [definition] } };
  assert.ok(parseStorageWorkerMessage(message));
  assert.equal(parseStorageWorkerMessage({ ...message, result: { kind: 'macroDefinitions', value: [{ ...definition, credential: 'hidden' }] } }), undefined);
  const shortcut = { version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
    result: { kind: 'macroShortcuts', value: [{ macroId, code: 'F2' }] } };
  assert.ok(parseStorageWorkerMessage(shortcut));
  assert.equal(parseStorageWorkerMessage({ ...shortcut, result: { kind: 'macroShortcuts', value: [{ macroId, code: 'Ctrl+F2' }] } }), undefined);
});

test('storage worker exposes a payload-free bulk credential-reference reset', () => {
  const request = { version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'request', requestId, command: 'session.credential.clear-all' };
  assert.ok(parseStorageWorkerRequest(request));
  assert.equal(parseStorageWorkerRequest({ ...request, references: [] }), undefined);
  assert.ok(parseStorageWorkerMessage({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
    result: { kind: 'changed', value: true } }));
});

test('storage worker carries only bounded encrypted credential bundle bytes and exact attachment metadata', () => {
  const destination = join(tmpdir(), 'credentials.mrtcred');
  const temporaryPath = join(tmpdir(), `.${basename(destination)}.${requestId}.tmp`);
  const attach = { version: 1, type: 'request', requestId, command: 'session.credential.attach-imported', credentials: [
    { sessionId: '11111111-1111-4111-8111-111111111111', host: 'server.example.net', port: 22,
      reference: '22222222-2222-4222-8222-222222222222' }
  ] };
  assert.ok(parseStorageWorkerRequest(attach));
  assert.equal(parseStorageWorkerRequest({ ...attach, credentials: [...attach.credentials, ...attach.credentials] }), undefined);
  assert.equal(parseStorageWorkerRequest({ ...attach, credentials: [{ ...attach.credentials[0], password: 'plaintext' }] }), undefined);
  const write = { version: 1, type: 'request', requestId, command: 'credential.bundle.write', path: destination, temporaryPath,
    contents: new Uint8Array([1, 2, 3]) };
  assert.ok(parseStorageWorkerRequest(write));
  assert.equal(parseStorageWorkerRequest({ ...write, contents: 'plaintext' }), undefined);
  const read = { version: 1, type: 'request', requestId, command: 'credential.bundle.read', path: destination };
  assert.ok(parseStorageWorkerRequest(read));
  assert.ok(parseStorageWorkerMessage({ version: 1, type: 'reply', requestId, ok: true,
    result: { kind: 'encryptedCredentialBundle', value: new Uint8Array([1, 2, 3]) } }));
  assert.equal(parseStorageWorkerMessage({ version: 1, type: 'reply', requestId, ok: true,
    result: { kind: 'encryptedCredentialBundle', value: new Uint8Array() } }), undefined);
});
