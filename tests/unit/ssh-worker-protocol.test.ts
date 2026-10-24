import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseSshWorkerInput, parseSshWorkerMessage, SSH_WORKER_PROTOCOL_VERSION } from '../../apps/desktop/src/workers/ssh-protocol.ts';

const requestId = '22222222-2222-4222-8222-222222222222';
const sessionId = '11111111-1111-4111-8111-111111111111';

function hostKey(): Uint8Array {
  const algorithm = Buffer.from('ssh-ed25519', 'ascii');
  const key = Buffer.alloc(4 + algorithm.length + 32);
  key.writeUInt32BE(algorithm.length, 0);
  algorithm.copy(key, 4);
  return key;
}

test('SSH worker accepts only bounded, exact open requests and valid host-key replies', () => {
  const open = {
    version: SSH_WORKER_PROTOCOL_VERSION, type: 'request', requestId, command: 'open', sessionId,
    endpoint: { host: 'server.example.net', port: 22 }, credentials: { username: 'alice', password: 'one-time secret' },
    size: { columns: 80, rows: 24 }
  };
  assert.equal(parseSshWorkerInput(open)?.type, 'request');
  assert.equal(parseSshWorkerInput({ ...open, unexpected: true }), undefined);
  assert.equal(parseSshWorkerInput({ ...open, endpoint: { host: 'Server.Example.Net.', port: 22 } }), undefined);
  assert.equal(parseSshWorkerInput({ ...open, credentials: { username: 'alice', password: 'x'.repeat(65_537) } }), undefined);
  assert.equal(parseSshWorkerInput({ ...open, credentials: { username: 'alice', password: 'x', apiKey: 'secret' } }), undefined);

  const key = hostKey();
  const evidence = {
    algorithm: 'ssh-ed25519',
    fingerprint: `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`,
    publicKey: key
  };
  const challenge = { version: SSH_WORKER_PROTOCOL_VERSION, type: 'host-key', sessionId,
    checkId: requestId, endpoint: open.endpoint, evidence };
  assert.equal(parseSshWorkerMessage(challenge)?.type, 'host-key');
  assert.equal(parseSshWorkerInput({ version: 1, type: 'host-key-result', sessionId, checkId: requestId, accepted: false })?.type, 'host-key-result');
  assert.equal(parseSshWorkerInput({ version: 1, type: 'host-key-result', sessionId, checkId: requestId, accepted: true, reason: 'ignored' }), undefined);
});

test('SSH worker events reject invalid error categories and oversized terminal chunks', () => {
  const failure = { version: 1, type: 'event', event: { kind: 'failure', sessionId,
    error: { code: 'AUTHENTICATION_FAILED', target: 'terminal', retryable: true } } };
  assert.equal(parseSshWorkerMessage(failure)?.type, 'event');
  assert.equal(parseSshWorkerMessage({ ...failure, event: { ...failure.event, error: { code: 'RAW_ERROR', target: 'terminal', retryable: false } } }), undefined);
  const data = { version: 1, type: 'event', event: { kind: 'data', sessionId, sequence: 1, data: 'x'.repeat(16_385) } };
  assert.equal(parseSshWorkerMessage(data), undefined);
});

test('SSH worker validates bounded remote-directory requests and listing replies', () => {
  const list = { version: 1, type: 'request', requestId, command: 'files.list', sessionId, path: '/home/alice' };
  assert.equal(parseSshWorkerInput(list)?.type, 'request');
  assert.equal(parseSshWorkerInput({ ...list, path: 'x'.repeat(4_097) }), undefined);
  assert.equal(parseSshWorkerInput({ ...list, path: '/home/alice', secret: 'private' }), undefined);
  const cancel = { version: 1, type: 'request', requestId, command: 'files.cancel', sessionId, operationId: '33333333-3333-4333-8333-333333333333' };
  assert.equal(parseSshWorkerInput(cancel)?.type, 'request');
  const result = { path: '/home/alice', entries: [{ name: 'docs', path: '/home/alice/docs', kind: 'directory', size: 0, modifiedAt: 1_800_000_000 }], truncated: false };
  assert.equal(parseSshWorkerMessage({ version: 1, type: 'reply', requestId, ok: true, result })?.type, 'reply');
  assert.equal(parseSshWorkerMessage({ version: 1, type: 'reply', requestId, ok: true, result: { ...result, secret: 'private' } }), undefined);
});
