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
  const x11Display = { display: 123, cookie: new Uint8Array(16), socatExecutable: String.raw`C:\cygwin64\usr\bin\socat.exe` };
  assert.equal(parseSshWorkerInput(open)?.type, 'request');
  assert.equal(parseSshWorkerInput({ ...open, x11Display })?.type, 'request');
  assert.equal(parseSshWorkerInput({ ...open, x11Display: { ...x11Display, display: 59_536 } }), undefined);
  assert.equal(parseSshWorkerInput({ ...open, x11Display: { ...x11Display, cookie: new Uint8Array(15) } }), undefined);
  assert.equal(parseSshWorkerInput({ ...open, x11Display: { ...x11Display, socatExecutable: 'socat.exe' } }), undefined);
  const gatewayHops = [
    { endpoint: { host: 'gateway-one.example.net', port: 2201 }, credentials: { username: 'gateway-one', password: 'secret-one' } },
    { endpoint: { host: 'gateway-two.example.net', port: 2202 }, credentials: { username: 'gateway-two', password: 'secret-two' } },
    { endpoint: { host: 'gateway-three.example.net', port: 2203 }, credentials: { username: 'gateway-three', password: 'secret-three' } }
  ];
  const firstGateway = gatewayHops[0]!;
  const secondGateway = gatewayHops[1]!;
  const thirdGateway = gatewayHops[2]!;
  assert.equal(parseSshWorkerInput({ ...open, gatewayHops })?.type, 'request');
  assert.equal(parseSshWorkerInput({ ...open, gatewayHops, x11Display })?.type, 'request');
  assert.equal(parseSshWorkerInput({ ...open, gatewayHops: [...gatewayHops, { ...thirdGateway,
    endpoint: { host: 'gateway-four.example.net', port: 2204 } }] }), undefined, 'routes are bounded to three gateways');
  assert.equal(parseSshWorkerInput({ ...open, gatewayHops: [{ ...firstGateway, endpoint: open.endpoint }] }), undefined, 'the target cannot also be a gateway');
  assert.equal(parseSshWorkerInput({ ...open, gatewayHops: [{ ...firstGateway, credentials: { ...firstGateway.credentials, token: 'unexpected' } }] }), undefined);
  assert.equal(parseSshWorkerInput({ ...open, gatewayHops: [firstGateway, { ...secondGateway, endpoint: firstGateway.endpoint }] }), undefined,
    'a route cannot repeat an endpoint');
  assert.equal(parseSshWorkerInput({ ...open, unexpected: true }), undefined);
  assert.equal(parseSshWorkerInput({ ...open, endpoint: { host: 'Server.Example.Net.', port: 22 } }), undefined);
  assert.equal(parseSshWorkerInput({ ...open, credentials: { username: 'alice', password: 'x'.repeat(65_537) } }), undefined);
  assert.equal(parseSshWorkerInput({ ...open, credentials: { username: 'alice', password: 'x', apiKey: 'secret' } }), undefined);
  const privateKeyCredentials = { username: 'alice', privateKey: new Uint8Array([1, 2, 3]), passphrase: 'key passphrase' };
  assert.equal(parseSshWorkerInput({ ...open, credentials: privateKeyCredentials })?.type, 'request');
  assert.equal(parseSshWorkerInput({ ...open, credentials: { ...privateKeyCredentials, privateKey: new Uint8Array(1_048_577) } }), undefined,
    'private-key contents are bounded before use');
  assert.equal(parseSshWorkerInput({ ...open, credentials: { ...privateKeyCredentials, unexpected: 'secret' } }), undefined);
  const agentCredentials = { username: 'alice', method: 'agent' };
  assert.equal(parseSshWorkerInput({ ...open, credentials: agentCredentials })?.type, 'request');
  assert.equal(parseSshWorkerInput({ ...open, credentials: { ...agentCredentials, socketPath: String.raw`C:\agent.sock` } }), undefined);
  assert.equal(parseSshWorkerInput({ ...open, credentials: { username: 'alice', method: 'password' } }), undefined);

  const openFiles = { ...open, command: 'open-files' } as Record<string, unknown>;
  delete openFiles.size;
  assert.equal(parseSshWorkerInput(openFiles)?.type, 'request');
  assert.equal(parseSshWorkerInput({ ...openFiles, credentials: privateKeyCredentials })?.type, 'request');
  assert.equal(parseSshWorkerInput({ ...openFiles, gatewayHops })?.type, 'request');
  assert.equal(parseSshWorkerInput({ ...openFiles, gatewayHops: [...gatewayHops, { ...thirdGateway,
    endpoint: { host: 'gateway-four.example.net', port: 2204 } }] }), undefined,
    'files-only routes are bounded to three gateways');
  assert.equal(parseSshWorkerInput({ ...openFiles, gatewayHops: [{ ...firstGateway, endpoint: openFiles.endpoint }] }), undefined,
    'the files-only target cannot also be a gateway');
  assert.equal(parseSshWorkerInput({ ...openFiles, size: open.size }), undefined, 'file-only requests cannot smuggle terminal configuration');
  assert.equal(parseSshWorkerInput({ ...openFiles, x11Display }), undefined, 'file-only requests cannot enable X11');

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

test('SSH worker error replies accept only normalized network failure categories', () => {
  const failure = { version: 1, type: 'reply', requestId, ok: false, errorCode: 'UNAVAILABLE' };
  assert.deepEqual(parseSshWorkerMessage({ ...failure, networkFailure: 'DNS_LOOKUP_FAILED' }), {
    ...failure, networkFailure: 'DNS_LOOKUP_FAILED'
  });
  assert.equal(parseSshWorkerMessage({ ...failure, networkFailure: 'getaddrinfo ENOTFOUND private-host' }), undefined);
  assert.equal(parseSshWorkerMessage({ ...failure, errorCode: 'AUTHENTICATION_FAILED', networkFailure: 'DNS_LOOKUP_FAILED' }), undefined);
  assert.equal(parseSshWorkerMessage({ ...failure, errorCode: 'TIMEOUT', networkFailure: 'CONNECTION_TIMEOUT' })?.type, 'reply');
  assert.equal(parseSshWorkerMessage({ ...failure, errorCode: 'UNAVAILABLE', networkFailure: 'CONNECTION_TIMEOUT' }), undefined);
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

test('SSH worker bounds remote text edit messages and rejects credential-bearing replies', () => {
  const operationId = '33333333-3333-4333-8333-333333333333';
  const remotePath = '/home/alice/config.txt';
  const content = 'first line\n';
  const revision = 'a'.repeat(64);
  const read = { version: 1, type: 'request', requestId, command: 'files.read-text', sessionId, operationId, remotePath };
  assert.equal(parseSshWorkerInput(read)?.type, 'request');
  assert.equal(parseSshWorkerInput({ ...read, remotePath: '/' }), undefined);
  assert.equal(parseSshWorkerInput({ ...read, localPath: 'C:\\secret.txt' }), undefined);
  const save = { version: 1, type: 'request', requestId, command: 'files.write-text', sessionId, operationId, remotePath, content, expectedRevision: revision };
  assert.equal(parseSshWorkerInput(save)?.type, 'request');
  assert.equal(parseSshWorkerInput({ ...save, content: 'x'.repeat(512 * 1024 + 1) }), undefined);
  assert.equal(parseSshWorkerInput({ ...save, expectedRevision: 'stale' }), undefined);
  const result = { path: remotePath, content, revision, bytes: Buffer.byteLength(content) };
  assert.equal(parseSshWorkerMessage({ version: 1, type: 'reply', requestId, ok: true, result })?.type, 'reply');
  assert.equal(parseSshWorkerMessage({ version: 1, type: 'reply', requestId, ok: true, result: { ...result, password: 'secret' } }), undefined);
});

test('SSH worker accepts only loopback tunnel definitions and bounded assigned-port replies', () => {
  const definition = { id: '33333333-3333-4333-8333-333333333333', sessionId, name: 'Database', mode: 'local', bindHost: '127.0.0.1',
    bindPort: 0, targetHost: 'db.internal', targetPort: 5432, createdAt: '2026-10-24T00:00:00.000Z' };
  const start = { version: 1, type: 'request', requestId, command: 'tunnel.forward.start', sessionId, definition };
  assert.equal(parseSshWorkerInput(start)?.type, 'request');
  assert.equal(parseSshWorkerInput({ ...start, definition: { ...definition, bindHost: '0.0.0.0' } }), undefined);
  assert.equal(parseSshWorkerInput({ ...start, definition: { ...definition, targetPort: 0 } }), undefined);
  assert.equal(parseSshWorkerInput({ ...start, unexpected: true }), undefined);
  assert.equal(parseSshWorkerMessage({ version: 1, type: 'reply', requestId, ok: true, result: { bindPort: 49152 } })?.type, 'reply');
  assert.equal(parseSshWorkerMessage({ version: 1, type: 'reply', requestId, ok: true, result: { bindPort: 0 } }), undefined);
  const stop = { version: 1, type: 'request', requestId, command: 'tunnel.forward.stop', sessionId, tunnelId: definition.id };
  assert.equal(parseSshWorkerInput(stop)?.type, 'request');
  assert.equal(parseSshWorkerInput({ ...stop, tunnelId: 'invalid' }), undefined);
  const remoteStart = { ...start, definition: { ...definition, mode: 'remote', targetHost: '127.0.0.1', targetPort: 3000 } };
  assert.equal(parseSshWorkerInput(remoteStart)?.type, 'request');
  assert.equal(parseSshWorkerInput({ ...remoteStart, definition: { ...remoteStart.definition, bindHost: '0.0.0.0' } }), undefined);
  const dynamicStart = { ...start, definition: { id: definition.id, sessionId, name: 'Proxy', mode: 'dynamic', bindHost: '127.0.0.1', bindPort: 1080,
    createdAt: '2026-10-24T00:00:00.000Z' } };
  assert.equal(parseSshWorkerInput(dynamicStart)?.type, 'request');
  assert.equal(parseSshWorkerInput({ ...dynamicStart, definition: { ...dynamicStart.definition, targetHost: 'public.example', targetPort: 443 } }), undefined);
});
