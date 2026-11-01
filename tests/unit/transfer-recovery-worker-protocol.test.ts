import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStorageWorkerMessage, parseStorageWorkerRequest } from '../../apps/desktop/src/workers/storage-protocol.ts';

const requestId = '018f7b8a-6d19-4e0c-8c6a-682f1316f004';
const operationId = '118f7b8a-6d19-4e0c-8c6a-682f1316f004';
const envelope = { version: 1, type: 'request', requestId } as const;

test('storage worker accepts only bounded transfer recovery commands without paths or credentials', () => {
  const begin = { ...envelope, command: 'transferRecovery.begin', operationId, transport: 'ftps', direction: 'download', fileName: 'archive.tar' };
  assert.deepEqual(parseStorageWorkerRequest(begin), begin);
  assert.equal(parseStorageWorkerRequest({ ...begin, fileName: '../private.txt' }), undefined);
  assert.equal(parseStorageWorkerRequest({ ...begin, localPath: 'C:\\private\\file' }), undefined);
  assert.ok(parseStorageWorkerRequest({ ...envelope, command: 'transferRecovery.progress', operationId, bytesTransferred: 4, totalBytes: 8 }));
  const artifacts = { ...envelope, command: 'transferRecovery.artifacts', operationId, remoteArtifactNames: ['server-name.bin'] };
  assert.deepEqual(parseStorageWorkerRequest(artifacts), artifacts);
  assert.equal(parseStorageWorkerRequest({ ...artifacts, remoteArtifactNames: ['/private/server-name.bin'] }), undefined);
  assert.ok(parseStorageWorkerRequest({ ...envelope, command: 'transferRecovery.finish', operationId, state: 'interrupted',
    bytesTransferred: 4, totalBytes: 8, errorCode: 'UNAVAILABLE' }));
  const cursor = { updatedAt: '2026-10-31T10:00:01.000Z', operationId };
  assert.ok(parseStorageWorkerRequest({ ...envelope, command: 'transferRecovery.list', cursor: null }));
  assert.ok(parseStorageWorkerRequest({ ...envelope, command: 'transferRecovery.list', cursor }));
  assert.equal(parseStorageWorkerRequest({ ...envelope, command: 'transferRecovery.list', cursor: { ...cursor, localPath: 'C:\\private' } }), undefined);
  assert.ok(parseStorageWorkerRequest({ ...envelope, command: 'transferRecovery.find', operationId }));
  assert.ok(parseStorageWorkerRequest({ ...envelope, command: 'transferRecovery.dismiss', operationId }));
});

test('storage worker validates interrupted records before returning them', () => {
  const record = { operationId, transport: 'sftp', direction: 'upload', fileName: 'safe.txt', state: 'interrupted', bytesTransferred: 8,
    totalBytes: 16, errorCode: 'UNAVAILABLE', createdAt: '2026-10-31T10:00:00.000Z', updatedAt: '2026-10-31T10:00:01.000Z', remoteArtifactNames: [] };
  const reply = { version: 1, type: 'reply', requestId, ok: true, result: { kind: 'fileTransferRecoveryPage', value: { records: [record], nextCursor: null } } };
  assert.deepEqual(parseStorageWorkerMessage(reply), reply);
  assert.equal(parseStorageWorkerMessage({ ...reply, result: { kind: 'fileTransferRecoveryPage', value: { records: [{ ...record, password: 'secret' }], nextCursor: null } } }), undefined);
  assert.equal(parseStorageWorkerMessage({ ...reply, result: { kind: 'fileTransferRecoveryLookup', value: { ...record, state: 'running' } } }), undefined);
});
