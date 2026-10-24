import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_URL, isCommandReply, isDescribeReply, isSshTransferEvent, isSshTrustEvent, parseCatalogCancellationRequest, parseRequest } from '../../packages/contracts/src/commands.ts';
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
  const paste = { command: 'terminal.paste', requestId: request.requestId, contractVersion: 1, payload: { sessionId: request.requestId } };
  assert.equal(parseRequest(paste).ok, true);
  assert.equal(parseRequest({ ...paste, payload: { ...paste.payload, data: 'clipboard content' } }).ok, false);
  assert.equal(parseRequest({ ...paste, command: 'ssh.paste', payload: { sessionId: 'bad' } }).ok, false);
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

test('SFTP open and close commands share SSH endpoint validation without terminal dimensions', () => {
  const sessionId = 'c8f87744-bd2c-4c0d-9a18-a4a324dd71fd';
  const open = { command: 'sftp.open', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId, host: 'Server.Example.com.', port: 22 } };
  const parsed = parseRequest(open);
  assert.equal(parsed.ok, true);
  assert.equal(parseRequest({ ...open, payload: { ...open.payload, password: 'secret' } }).ok, false);
  assert.equal(parseRequest({ ...open, payload: { ...open.payload, port: 65_536 } }).ok, false);
  if (parsed.ok) assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result: {
    sessionId, endpoint: { host: 'server.example.com', port: 22 }, state: 'running'
  } }, parsed.result), true);
  const close = { command: 'sftp.close', requestId: request.requestId, contractVersion: 1, payload: { sessionId } };
  assert.equal(parseRequest(close).ok, true);
  assert.equal(parseRequest({ ...close, payload: { ...close.payload, force: true } }).ok, false);
});

test('SSH directory browsing accepts bounded paths and exact credential-free listing replies', () => {
  const sessionId = 'c8f87744-bd2c-4c0d-9a18-a4a324dd71fd';
  const list = { command: 'ssh.files.list', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId, path: '/home/alice' } };
  const parsed = parseRequest(list);
  assert.equal(parsed.ok, true);
  assert.equal(parseRequest({ ...list, payload: { sessionId, path: 'x'.repeat(4_097) } }).ok, false);
  assert.equal(parseRequest({ ...list, payload: { sessionId, path: '../outside' } }).ok, false);
  assert.equal(parseRequest({ ...list, payload: { sessionId, path: '/home/alice/../outside' } }).ok, false);
  assert.equal(parseRequest({ ...list, payload: { sessionId, path: '/home/alice', credential: 'secret' } }).ok, false);
  if (!parsed.ok) return;
  const reply = { requestId: request.requestId, ok: true, result: { path: '/home/alice', entries: [
    { name: 'docs', path: '/home/alice/docs', kind: 'directory', size: 0, modifiedAt: null }
  ], truncated: false } };
  assert.equal(isCommandReply(reply, parsed.result), true);
  assert.equal(isCommandReply({ ...reply, result: { ...reply.result, secret: 'must not pass' } }, parsed.result), false);
});

test('SFTP transfer requests keep local paths private and validate direction-bound results and progress', () => {
  const sessionId = 'c8f87744-bd2c-4c0d-9a18-a4a324dd71fd';
  const operationId = 'f43d82ce-551e-4b4d-8f0d-8a14ae0326bd';
  const upload = { command: 'ssh.files.upload', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId, operationId, remoteDirectory: '/home/alice' } };
  const parsedUpload = parseRequest(upload);
  assert.equal(parsedUpload.ok, true);
  assert.equal(parseRequest({ ...upload, payload: { ...upload.payload, localPath: 'C:\\private\\secret.txt' } }).ok, false);
  const download = { command: 'ssh.files.download', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId, operationId, remotePath: '/home/alice/report.txt' } };
  const parsedDownload = parseRequest(download);
  assert.equal(parsedDownload.ok, true);
  assert.equal(parseRequest({ ...download, payload: { ...download.payload, localPath: 'C:\\private\\secret.txt' } }).ok, false);
  assert.equal(parseRequest({ command: 'ssh.files.cancel', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId, operationId, extra: true } }).ok, false);
  const uploadResult = { requestId: request.requestId, ok: true, result: { direction: 'upload', fileName: 'report.txt', bytesTransferred: 16, state: 'completed' } };
  const downloadResult = { requestId: request.requestId, ok: true, result: { direction: 'download', fileName: 'report.txt', bytesTransferred: 16, state: 'completed' } };
  if (parsedUpload.ok) {
    assert.equal(isCommandReply(uploadResult, parsedUpload.result), true);
    assert.equal(isCommandReply(downloadResult, parsedUpload.result), false);
  }
  if (parsedDownload.ok) assert.equal(isCommandReply(downloadResult, parsedDownload.result), true);
  const progress = { sessionId, operationId, direction: 'download', phase: 'transferring', fileName: 'report.txt', bytesTransferred: 8, totalBytes: 16 };
  assert.equal(isSshTransferEvent(progress), true);
  assert.equal(isSshTransferEvent({ ...progress, localPath: 'C:\\private\\secret.txt' }), false);
});

test('Telnet terminal IPC bounds endpoint and stream commands and validates the open reply', () => {
  const sessionId = 'c8f87744-bd2c-4c0d-9a18-a4a324dd71fd';
  const open = { command: 'telnet.open', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId, host: 'Console.Example.com.', port: 23, columns: 80, rows: 24 } };
  const parsed = parseRequest(open);
  assert.equal(parsed.ok, true);
  assert.equal(parseRequest({ ...open, payload: { ...open.payload, password: 'must-not-pass' } }).ok, false);
  assert.equal(parseRequest({ ...open, payload: { ...open.payload, port: 65_536 } }).ok, false);
  assert.equal(parseRequest({ ...open, payload: { ...open.payload, host: ' bad host ' } }).ok, false);
  if (!parsed.ok) return;
  assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result: {
    sessionId, endpoint: { host: 'console.example.com', port: 23 }, state: 'running'
  } }, parsed.result), true);
  assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result: {
    sessionId, endpoint: { host: 'console.example.com', port: 23 }, state: 'running', password: 'secret'
  } }, parsed.result), false);
  assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result: {
    sessionId, endpoint: { host: 'attacker.example', port: 23 }, state: 'running'
  } }, parsed.result), false);
  assert.equal(parseRequest({ command: 'telnet.write', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId, data: 'hello\r' } }).ok, true);
  assert.equal(parseRequest({ command: 'telnet.paste', requestId: request.requestId, contractVersion: 1, payload: { sessionId } }).ok, true);
});

test('FTP commands accept exact endpoints and safe directory replies without returning credentials', () => {
  const sessionId = 'c8f87744-bd2c-4c0d-9a18-a4a324dd71fd';
  const open = { command: 'ftp.open', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId, host: 'Files.Example.com.', port: 21, secure: true } };
  const parsed = parseRequest(open);
  assert.equal(parsed.ok, true);
  assert.equal(parseRequest({ ...open, payload: { ...open.payload, password: 'secret' } }).ok, false);
  assert.equal(parseRequest({ ...open, payload: { ...open.payload, port: 65_536 } }).ok, false);
  assert.equal(parseRequest({ ...open, payload: { ...open.payload, secure: 'true' } }).ok, false);
  if (!parsed.ok) return;
  assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result: {
    sessionId, endpoint: { host: 'files.example.com', port: 21, secure: true }, state: 'running'
  } }, parsed.result), true);
  assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result: {
    sessionId, endpoint: { host: 'files.example.com', port: 21, secure: true, password: 'secret' }, state: 'running'
  } }, parsed.result), false);
  const list = { command: 'ftp.files.list', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId, path: '/home/alice' } };
  const parsedList = parseRequest(list);
  assert.equal(parsedList.ok, true);
  assert.equal(parseRequest({ ...list, payload: { sessionId, path: '../outside' } }).ok, false);
  assert.equal(parseRequest({ ...list, payload: { sessionId, path: '/home\r\nDELE important' } }).ok, false);
  if (parsedList.ok) assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result: {
    path: '/home/alice', entries: [{ name: 'bad\nDELE file', path: '/home/alice/bad\nDELE file', kind: 'file', size: 1, modifiedAt: null }], truncated: false
  } }, parsedList.result), false);
  const operationId = 'f43d82ce-551e-4b4d-8f0d-8a14ae0326bd';
  const upload = { command: 'ftp.files.upload', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId, operationId, remoteDirectory: '/incoming' } };
  const parsedUpload = parseRequest(upload);
  assert.equal(parsedUpload.ok, true);
  assert.equal(parseRequest({ ...upload, payload: { ...upload.payload, localPath: 'C:\\secret\\file.txt' } }).ok, false,
    'the renderer cannot choose a local source path');
  const transferResult = { direction: 'upload', fileName: 'archive.bin', bytesTransferred: 12, state: 'completed' };
  if (parsedUpload.ok) assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result: transferResult }, parsedUpload.result), true);
  assert.equal(parseRequest({ command: 'ftp.files.cancel', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId, operationId, reason: 'anything' } }).ok, false);
});

test('saved-session IPC accepts only supported non-secret definitions and validated catalog actions', () => {
  const create = { command: 'session.create', requestId: request.requestId, contractVersion: 1,
    payload: { kind: 'ssh', name: 'Build host', host: 'server.example.com', port: 2222 } };
  assert.equal(parseRequest(create).ok, true);
  assert.equal(parseRequest({ ...create, payload: { ...create.payload, password: 'must-not-pass' } }).ok, false);
  assert.equal(parseRequest({ ...create, payload: { ...create.payload, port: 65_536 } }).ok, false);
  assert.equal(parseRequest({ ...create, payload: { kind: 'telnet', name: 'Lab console', host: 'console.example.com', port: 23 } }).ok, true);
  assert.equal(parseRequest({ ...create, payload: { kind: 'telnet', name: 'Lab console', host: 'console.example.com', port: 23, password: 'must-not-pass' } }).ok, false);

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
