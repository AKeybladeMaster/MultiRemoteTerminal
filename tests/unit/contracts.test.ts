import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_URL, isDescribeReply, isSshTrustEvent, parseCatalogCancellationRequest, parseRequest } from '../../packages/contracts/src/commands.ts';
import { describeWorkbench } from '../../packages/application/src/workbench.ts';

const request = { command: 'app.describe', requestId: '5726a2ee-03cd-4f5a-a28c-bd72784f80a6', contractVersion: 1, payload: {} };

test('accepts only the versioned read-only command', () => {
  assert.deepEqual(parseRequest(request), { ok: true, result: request });
  assert.deepEqual(describeWorkbench({ version: '0.0.0', platform: 'win32' }), {
    name: 'MultiRemoteTerminal', version: '0.0.0', platform: 'win32', stage: 'foundation'
  });
});

test('rejects malformed, extra, oversized, and incompatible request fields', () => {
  for (const input of [null, [], 'app.describe', {}, { ...request, contractVersion: 2 },
    { ...request, requestId: '../secret' }, { ...request, requestId: 'a'.repeat(100000) },
    { ...request, payload: { shell: 'powershell' } }, { ...request, payload: { text: 'x'.repeat(1000000) } },
    { ...request, payload: [] }, { ...request, secret: 'must not pass' }, { ...request, payload: null }]) {
    const result = parseRequest(input);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'INVALID_REQUEST');
  }
  const open = { command: 'terminal.open', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId: request.requestId, shell: 'powershell', columns: 80, rows: 24 } };
  assert.equal(parseRequest(open).ok, true);
  assert.equal(parseRequest({ ...open, payload: { ...open.payload, shell: 'bash' } }).ok, true);
  assert.equal(parseRequest({ ...open, payload: { ...open.payload, sessionId: 'bad' } }).ok, false);
});

test('unknown commands never become privileged capabilities', () => {
  for (const command of ['runtime.open', 'fs.readFile', '__proto__', 'constructor', 'mrt:admin']) {
    assert.deepEqual(parseRequest({ ...request, command }), { ok: false, error: { code: 'UNKNOWN_COMMAND', target: 'application', retryable: false } });
  }
});

test('catalog cancellation accepts an exact request only from the owning app main frame', () => {
  const cancellation = { requestId: request.requestId };
  const context = { ownerWindow: true, mainFrame: true, url: APP_URL };
  assert.equal(parseCatalogCancellationRequest(cancellation, context), request.requestId);
  for (const input of [null, {}, { ...cancellation, extra: true }, { requestId: '../secret' }]) {
    assert.equal(parseCatalogCancellationRequest(input, context), undefined);
  }
  for (const rejectedContext of [
    { ...context, ownerWindow: false },
    { ...context, mainFrame: false },
    { ...context, url: 'https://example.com/' },
    { ...context, url: 'mrt://app/other.html' }
  ]) assert.equal(parseCatalogCancellationRequest(cancellation, rejectedContext), undefined);
});

test('validates reply identity, shape and length; rejects secret-bearing replies', () => {
  const reply = { requestId: request.requestId, ok: true, result: describeWorkbench({ version: '0.0.0', platform: 'win32' }) };
  assert.equal(isDescribeReply(reply, request.requestId), true);
  for (const input of [null, { ...reply, requestId: 'wrong' }, { ...reply, secret: 'hidden' },
    { ...reply, result: { ...reply.result, secret: 'hidden' } }, { ...reply, result: { ...reply.result, version: 'a'.repeat(10000) } },
    { requestId: request.requestId, ok: false, error: { code: 'UNAVAILABLE', target: 'application', retryable: true, stack: 'private' } }]) {
    assert.equal(isDescribeReply(input, request.requestId), false);
  }
});

test('validates SSH connection requests and keeps host approval as a typed event', () => {
  const sessionId = 'c8f87744-bd2c-4c0d-9a18-a4a324dd71fd';
  const open = { command: 'ssh.open', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId, host: 'server.example.com', port: 22, columns: 80, rows: 24 } };
  assert.equal(parseRequest(open).ok, true);
  assert.equal(parseRequest({ ...open, payload: { ...open.payload, password: 'secret' } }).ok, false);
  assert.equal(parseRequest({ ...open, payload: { ...open.payload, port: 65_536 } }).ok, false);

  const challenge = { kind: 'challenge', sessionId, challenge: { token: 'A'.repeat(32), host: 'server.example.com', port: 22,
    algorithm: 'ssh-ed25519', fingerprint: `SHA256:${'A'.repeat(43)}` } };
  assert.equal(isSshTrustEvent(challenge), true);
  assert.equal(isSshTrustEvent({ ...challenge, secret: 'password' }), false);
  assert.equal(isSshTrustEvent({ ...challenge, challenge: { ...challenge.challenge, fingerprint: 'not-a-fingerprint' } }), false);

  const revoke = { command: 'ssh.host.revoke', requestId: request.requestId, contractVersion: 1,
    payload: { host: 'server.example.com', port: 22 } };
  assert.equal(parseRequest(revoke).ok, true);
  assert.equal(parseRequest({ ...revoke, payload: { ...revoke.payload, host: 'Server.example.com' } }).ok, false);
  assert.equal(parseRequest({ ...revoke, payload: { ...revoke.payload, port: 65_536 } }).ok, false);
});

test('saved-session IPC accepts only supported non-secret definitions and validated catalog actions', () => {
  const create = { command: 'session.create', requestId: request.requestId, contractVersion: 1,
    payload: { kind: 'ssh', name: 'Build host', host: 'server.example.com', port: 2222 } };
  assert.equal(parseRequest(create).ok, true);
  assert.equal(parseRequest({ ...create, payload: { ...create.payload, password: 'must-not-pass' } }).ok, false);
  assert.equal(parseRequest({ ...create, payload: { ...create.payload, port: 65_536 } }).ok, false);

  const list = { command: 'session.list', requestId: request.requestId, contractVersion: 1, payload: { query: 'build' } };
  assert.equal(parseRequest(list).ok, true);
  assert.equal(parseRequest({ ...list, payload: { query: 'x'.repeat(257) } }).ok, false);
  assert.equal(parseRequest({ ...list, payload: { query: '', secret: 'hidden' } }).ok, false);

  const folderCreate = { command: 'session.folder.create', requestId: request.requestId, contractVersion: 1,
    payload: { parentId: null, name: 'Work' } };
  assert.equal(parseRequest(folderCreate).ok, true);
  assert.equal(parseRequest({ ...folderCreate, payload: { ...folderCreate.payload, parentId: 'not-a-folder' } }).ok, false);
  assert.equal(parseRequest({ ...folderCreate, payload: { ...folderCreate.payload, secret: 'hidden' } }).ok, false);
  const folderMove = { command: 'session.folder.move', requestId: request.requestId, contractVersion: 1,
    payload: { id: '18f2f903-7b6f-4c8d-9c42-b63a58c4b087', parentId: null } };
  assert.equal(parseRequest(folderMove).ok, true);
  assert.equal(parseRequest({ command: 'session.folder.export', requestId: request.requestId, contractVersion: 1,
    payload: { id: '18f2f903-7b6f-4c8d-9c42-b63a58c4b087' } }).ok, true);
  assert.equal(parseRequest({ command: 'session.folder.import', requestId: request.requestId, contractVersion: 1, payload: {} }).ok, true);
  assert.equal(parseRequest({ command: 'session.folder.import', requestId: request.requestId, contractVersion: 1,
    payload: { path: 'C:\\private.json' } }).ok, false, 'the renderer cannot provide a filesystem path');
});
