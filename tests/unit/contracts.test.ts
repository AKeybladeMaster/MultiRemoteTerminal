import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_URL, isCommandReply, isDescribeReply, isSshTransferEvent, isSshTrustEvent, isTunnelStatusEvent, parseCatalogCancellationRequest,
  parseRdpLaunchGestureRequest, parseRequest, parseTftpServerActionGestureRequest } from '../../packages/contracts/src/commands.ts';
import { describeWorkbench } from '../../packages/application/src/workbench.ts';
import { DEFAULT_WORKBENCH_PREFERENCES, MAX_STARTUP_GREETING_CODE_POINTS, toWorkbenchStartupPreferences } from '../../packages/domain/src/workbench-preferences.ts';

const request = { command: 'app.describe', requestId: '5726a2ee-03cd-4f5a-a28c-bd72784f80a6', contractVersion: 1, payload: {} };

test('accepts only the versioned read-only command', () => {
  assert.deepEqual(parseRequest(request), { ok: true, result: request });
  assert.deepEqual(describeWorkbench({ version: '0.0.0', platform: 'win32' }), {
    name: 'MultiRemoteTerminal', version: '0.0.0', platform: 'win32', stage: 'foundation'
  });
});

test('PowerShell profile preview and apply IPC carry only a bounded preview result and opaque IDs', () => {
  const preview = { command: 'powershell.profile.preview', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId: request.requestId } };
  const parsedPreview = parseRequest(preview);
  assert.equal(parsedPreview.ok, true);
  if (!parsedPreview.ok) return;
  const previewReply = { requestId: request.requestId, ok: true,
    result: { previewId: 'c1f3ace8-9464-449b-9459-a41b642dc2a7', script: 'Write-Output "ready"' } };
  assert.equal(isCommandReply(previewReply, parsedPreview.result), true);
  assert.equal(isCommandReply({ ...previewReply, result: { ...previewReply.result, script: 'bad\u0000script' } }, parsedPreview.result), false);
  assert.equal(parseRequest({ ...preview, payload: { ...preview.payload, extra: true } }).ok, false);

  const apply = { command: 'powershell.profile.apply', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId: request.requestId, previewId: previewReply.result.previewId } };
  assert.equal(parseRequest(apply).ok, true);
  assert.equal(parseRequest({ ...apply, payload: { ...apply.payload, script: 'Write-Output "arbitrary"' } }).ok, false);
  const parsedApply = parseRequest(apply);
  if (parsedApply.ok) assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result: {} }, parsedApply.result), true);
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
    payload: { sessionId: request.requestId, launch: { shell: 'powershell' }, columns: 80, rows: 24 } };
  assert.equal(parseRequest(open).ok, true);
  assert.equal(parseRequest({ ...open, payload: { ...open.payload, launch: { shell: 'bash' } } }).ok, true);
  assert.equal(parseRequest({ ...open, payload: { ...open.payload, launch: { shell: 'wsl' } } }).ok, false);
  assert.equal(parseRequest({ ...open, payload: { ...open.payload, launch: { shell: 'wsl', distribution: 'Ubuntu' } } }).ok, true);
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
  assert.equal(parseRequest({ ...open, payload: { ...open.payload, authenticationMethod: 'private-key' } }).ok, true);
  assert.equal(parseRequest({ ...open, payload: { ...open.payload, authenticationMethod: 'agent' } }).ok, true);
  assert.equal(parseRequest({ ...open, payload: { ...open.payload, privateKey: 'must-not-cross-renderer-ipc' } }).ok, false);
  assert.equal(parseRequest({ ...open, payload: { ...open.payload, profileId: '11111111-1111-4111-8111-111111111111' } }).ok, true);
  assert.equal(parseRequest({ ...open, payload: { ...open.payload, profileId: 'not-a-profile' } }).ok, false);
  const gatewayProfileIds = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333'];
  assert.equal(parseRequest({ ...open, payload: { ...open.payload, gatewayProfileIds } }).ok, true);
  assert.equal(parseRequest({ ...open, payload: { ...open.payload,
    gatewayProfileIds: ['11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'] } }).ok, false);
  assert.equal(parseRequest({ ...open, payload: { ...open.payload, gatewayProfileIds: [...gatewayProfileIds, '44444444-4444-4444-8444-444444444444'] } }).ok, false);
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

test('credential and vault commands accept only profile identifiers and safe state replies', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const save = { command: 'session.credential.save', requestId: request.requestId, contractVersion: 1, payload: { id } };
  const has = { ...save, command: 'session.credential.has' };
  const forget = { ...save, command: 'session.credential.forget' };
  const vault = { command: 'vault.state', requestId: request.requestId, contractVersion: 1, payload: {} };
  const enableMaster = { ...vault, command: 'vault.master.enable' };
  const disableMaster = { ...vault, command: 'vault.master.disable' };
  const resetVault = { ...vault, command: 'vault.reset' };
  const locked = { requestId: request.requestId, ok: false, error: { code: 'LOCKED', target: 'application', retryable: false } };
  const parsedSave = parseRequest(save);
  const parsedHas = parseRequest(has);
  const parsedVault = parseRequest(vault);
  assert.equal(parsedSave.ok, true);
  assert.equal(parseRequest({ ...save, payload: { id, password: 'secret' } }).ok, false);
  assert.equal(parseRequest({ ...forget, payload: { id, credentialRef: id } }).ok, false);
  assert.equal(parsedHas.ok && isCommandReply({ requestId: request.requestId, ok: true, result: true }, parsedHas.result), true);
  assert.equal(parsedHas.ok && isCommandReply({ requestId: request.requestId, ok: true, result: { reference: id } }, parsedHas.result), false);
  assert.equal(parsedVault.ok && isCommandReply({ requestId: request.requestId, ok: true,
    result: { state: 'locked', mode: 'master-password' } }, parsedVault.result), true);
  for (const action of [enableMaster, disableMaster, resetVault]) {
    const parsed = parseRequest(action);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.ok && isCommandReply({ requestId: request.requestId, ok: true,
      result: { state: 'available', mode: 'windows-account' } }, parsed.result), true);
    assert.equal(parseRequest({ ...action, payload: { password: 'must-not-cross-renderer-ipc' } }).ok, false);
  }
  assert.equal(parsedSave.ok && isCommandReply(locked, parsedSave.result), true);
});

test('SFTP open and close commands share SSH endpoint validation without terminal dimensions', () => {
  const sessionId = 'c8f87744-bd2c-4c0d-9a18-a4a324dd71fd';
  const gatewayProfileIds = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333'];
  const open = { command: 'sftp.open', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId, host: 'Server.Example.com.', port: 22 } };
  const parsed = parseRequest(open);
  assert.equal(parsed.ok, true);
  assert.equal(parseRequest({ ...open, payload: { ...open.payload, gatewayProfileIds } }).ok, true);
  assert.equal(parseRequest({ ...open, payload: { ...open.payload, gatewayProfileIds: [...gatewayProfileIds, '44444444-4444-4444-8444-444444444444'] } }).ok, false);
  assert.equal(parseRequest({ ...open, payload: { ...open.payload, gatewayProfileIds: [...gatewayProfileIds, gatewayProfileIds[0]] } }).ok, false);
  assert.equal(parseRequest({ ...open, payload: { ...open.payload, gatewayProfileIds: ['not-a-profile-id'] } }).ok, false);
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

test('remote text editing accepts bounded file payloads and exact path-bound replies', () => {
  const sessionId = 'c8f87744-bd2c-4c0d-9a18-a4a324dd71fd';
  const operationId = 'f43d82ce-551e-4b4d-8f0d-8a14ae0326bd';
  const remotePath = '/home/alice/config.txt';
  const content = 'Host example.test\n  User alice\n';
  const revision = 'a'.repeat(64);
  const read = { command: 'ssh.files.read-text', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId, operationId, remotePath } };
  const parsedRead = parseRequest(read);
  assert.equal(parsedRead.ok, true);
  assert.equal(parseRequest({ ...read, payload: { ...read.payload, remotePath: '/' } }).ok, false);
  assert.equal(parseRequest({ ...read, payload: { ...read.payload, localPath: 'C:\\secret.txt' } }).ok, false);
  if (parsedRead.ok) {
    const result = { path: remotePath, content, revision, bytes: Buffer.byteLength(content) };
    assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result }, parsedRead.result), true);
    assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result: { ...result, bytes: result.bytes + 1 } }, parsedRead.result), false);
    assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result: { ...result, path: '/other/file' } }, parsedRead.result), false);
    assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result: { ...result, password: 'secret' } }, parsedRead.result), false);
  }
  const save = { command: 'ssh.files.write-text', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId, operationId, remotePath, content, expectedRevision: revision } };
  const parsedSave = parseRequest(save);
  assert.equal(parsedSave.ok, true);
  assert.equal(parseRequest({ ...save, payload: { ...save.payload, content: 'x'.repeat(512 * 1024 + 1) } }).ok, false);
  assert.equal(parseRequest({ ...save, payload: { ...save.payload, content: 'secret\u0000value' } }).ok, false);
  assert.equal(parseRequest({ ...save, payload: { ...save.payload, expectedRevision: 'bad' } }).ok, false);
  if (parsedSave.ok) {
    const result = { path: remotePath, revision: 'b'.repeat(64), bytesSaved: Buffer.byteLength(content) };
    assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result }, parsedSave.result), true);
    assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result: { ...result, bytesSaved: result.bytesSaved + 1 } }, parsedSave.result), false);
    assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result: { ...result, path: '/other/file' } }, parsedSave.result), false);
  }
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

test('TFTP commands keep selected filesystem paths in main and validate loopback server state', () => {
  const choose = { command: 'tftp.root.choose', requestId: request.requestId, contractVersion: 1, payload: {} };
  const parsedChoose = parseRequest(choose);
  assert.equal(parsedChoose.ok, true);
  assert.equal(parseRequest({ ...choose, payload: { absolutePath: 'C:\\private' } }).ok, false);
  if (parsedChoose.ok) {
    const selected = { selectionId: 'c8f87744-bd2c-4c0d-9a18-a4a324dd71fd', folderName: 'firmware' };
    assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result: selected }, parsedChoose.result), true);
    assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result: { ...selected, absolutePath: 'C:\\private' } }, parsedChoose.result), false);
  }
  const start = { command: 'tftp.start', requestId: request.requestId, contractVersion: 1,
    payload: { selectionId: 'c8f87744-bd2c-4c0d-9a18-a4a324dd71fd', port: 0 } };
  const parsedStart = parseRequest(start);
  assert.equal(parsedStart.ok, true);
  assert.equal(parseRequest({ ...start, payload: { ...start.payload, port: 65_536 } }).ok, false);
  assert.equal(parseRequest({ ...start, payload: { ...start.payload, rootDirectory: 'C:\\private' } }).ok, false);
  if (parsedStart.ok) assert.equal(isCommandReply({ requestId: request.requestId, ok: true,
    result: { state: 'running', address: '127.0.0.1', port: 52_001, folderName: 'firmware' }
  }, parsedStart.result), true);
  const status = { command: 'tftp.status', requestId: request.requestId, contractVersion: 1, payload: {} };
  const parsedStatus = parseRequest(status);
  assert.equal(parsedStatus.ok, true);
  if (parsedStatus.ok) assert.equal(isCommandReply({ requestId: request.requestId, ok: true,
    result: { state: 'running', address: '0.0.0.0', port: 69, folderName: 'firmware' }
  }, parsedStatus.result), false);
  assert.equal(parseRequest({ command: 'tftp.stop', requestId: request.requestId, contractVersion: 1, payload: { force: true } }).ok, false);
});

test('TFTP start gestures accept only a scoped action, opaque selection token, and valid port', () => {
  const token = 'c8f87744-bd2c-4c0d-9a18-a4a324dd71fd';
  assert.deepEqual(parseTftpServerActionGestureRequest({ action: 'choose-root' }), { action: 'choose-root' });
  assert.deepEqual(parseTftpServerActionGestureRequest({ action: 'start', selectionId: token, port: 0 }), { action: 'start', selectionId: token, port: 0 });
  for (const value of [
    { action: 'choose-root', path: 'C:\\private' },
    { action: 'start', selectionId: token, port: 65_536 },
    { action: 'start', selectionId: 'not-a-token', port: 69 },
    { action: 'stop' }
  ]) assert.equal(parseTftpServerActionGestureRequest(value), undefined);
});

test('saved-session IPC accepts only supported non-secret definitions and validated catalog actions', () => {
  const create = { command: 'session.create', requestId: request.requestId, contractVersion: 1,
    payload: { kind: 'ssh', name: 'Build host', host: 'server.example.com', port: 2222 } };
  assert.equal(parseRequest(create).ok, true);
  const remember = { ...create, command: 'session.remember' };
  const parsedRemember = parseRequest(remember);
  assert.equal(parsedRemember.ok, true);
  assert.equal(parseRequest({ ...remember, payload: { ...remember.payload, password: 'must-not-pass' } }).ok, false);
  if (parsedRemember.ok) {
    const session = { id: '8cc8c44e-8660-4232-961b-ff7760afc745', folderId: null, kind: 'ssh', name: 'Build host',
      host: 'server.example.com', port: 2222, favorite: false, createdAt: '2026-10-25T00:00:00.000Z', updatedAt: '2026-10-25T00:00:00.000Z' };
    assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result: session }, parsedRemember.result), true);
  }
  assert.equal(parseRequest({ ...create, payload: { ...create.payload, password: 'must-not-pass' } }).ok, false);
  assert.equal(parseRequest({ ...create, payload: { ...create.payload, port: 65_536 } }).ok, false);
  assert.equal(parseRequest({ ...create, payload: { kind: 'telnet', name: 'Lab console', host: 'console.example.com', port: 23 } }).ok, true);
  assert.equal(parseRequest({ ...create, payload: { kind: 'telnet', name: 'Lab console', host: 'console.example.com', port: 23, password: 'must-not-pass' } }).ok, false);

  const list = { command: 'session.list', requestId: request.requestId, contractVersion: 1, payload: { query: 'build' } };
  assert.equal(parseRequest(list).ok, true);
  assert.equal(parseRequest({ ...list, payload: { query: 'x'.repeat(257) } }).ok, false);
  assert.equal(parseRequest({ ...list, payload: { query: '', secret: 'hidden' } }).ok, false);

  const count = { command: 'session.count', requestId: request.requestId, contractVersion: 1, payload: {} };
  const parsedCount = parseRequest(count);
  assert.equal(parsedCount.ok, true);
  assert.equal(parseRequest({ ...count, payload: { query: '' } }).ok, false);
  if (parsedCount.ok) {
    assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result: 1_000 }, parsedCount.result), true);
    assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result: -1 }, parsedCount.result), false);
    assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result: 1.5 }, parsedCount.result), false);
  }

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

test('RDP IPC validates the external viewer target and its launch-requested result', () => {
  const rdp = { command: 'rdp.launch', requestId: request.requestId, contractVersion: 1,
    payload: { host: 'Desktop.Example.com.', port: 3389 } };
  const parsed = parseRequest(rdp);
  assert.equal(parsed.ok, true);
  assert.equal(parseRequest({ ...rdp, payload: { ...rdp.payload, port: 65_536 } }).ok, false);
  assert.equal(parseRequest({ ...rdp, payload: { ...rdp.payload, password: 'must-not-pass' } }).ok, false);
  if (parsed.ok) {
    assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result: {
      provider: 'external', endpoint: { host: 'desktop.example.com', port: 3389 }, state: 'launch-requested'
    } }, parsed.result), true);
    assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result: {
      provider: 'embedded', endpoint: { host: 'desktop.example.com', port: 3389 }, state: 'connected'
    } }, parsed.result), false);
    assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result: {
      provider: 'external', endpoint: { host: 'other.example.com', port: 3389 }, state: 'launch-requested'
    } }, parsed.result), false);
    assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result: {
      provider: 'external', endpoint: { host: 'desktop.example.com', port: 3389 }, state: 'launch-requested', password: 'secret'
    } }, parsed.result), false);
  }
});

test('VNC IPC validates the external viewer target and rejects credentials in the request', () => {
  const vnc = { command: 'vnc.launch', requestId: request.requestId, contractVersion: 1,
    payload: { host: 'VNC.Example.com.', port: 5901 } };
  const parsed = parseRequest(vnc);
  assert.equal(parsed.ok, true);
  assert.equal(parseRequest({ ...vnc, payload: { ...vnc.payload, port: 0 } }).ok, false);
  assert.equal(parseRequest({ ...vnc, payload: { ...vnc.payload, password: 'must-not-pass' } }).ok, false);
  if (parsed.ok) {
    assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result: {
      provider: 'external', endpoint: { host: 'vnc.example.com', port: 5901 }, state: 'launch-requested'
    } }, parsed.result), true);
    assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result: {
      provider: 'external', endpoint: { host: 'other.example.com', port: 5901 }, state: 'launch-requested'
    } }, parsed.result), false);
    assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result: {
      provider: 'embedded', endpoint: { host: 'vnc.example.com', port: 5901 }, state: 'connected'
    } }, parsed.result), false);
  }
});

test('RDP launch gesture channel accepts only canonicalizable endpoint fields', () => {
  assert.deepEqual(parseRdpLaunchGestureRequest({ host: 'Desktop.Example.com.', port: 3389 }), { host: 'desktop.example.com', port: 3389 });
  assert.equal(parseRdpLaunchGestureRequest({ host: 'desktop.example.com', port: 70000 }), undefined);
  assert.equal(parseRdpLaunchGestureRequest({ host: 'desktop.example.com', port: 3389, password: 'secret' }), undefined);
});

test('tunnel IPC accepts named loopback forwards and matches replies to the requested definition', () => {
  const definition = { id: '33333333-3333-4333-8333-333333333333', sessionId: '44444444-4444-4444-8444-444444444444',
    name: 'Database', mode: 'local', bindHost: '127.0.0.1', bindPort: 0, targetHost: 'db.internal', targetPort: 5432 };
  const save = { command: 'tunnel.save', requestId: request.requestId, contractVersion: 1, payload: definition };
  const parsedSave = parseRequest(save);
  assert.equal(parsedSave.ok, true);
  assert.equal(parseRequest({ ...save, payload: { ...definition, mode: 'remote', targetHost: '127.0.0.1', targetPort: 3000 } }).ok, true);
  assert.equal(parseRequest({ ...save, payload: { id: definition.id, sessionId: definition.sessionId, name: 'Proxy', mode: 'dynamic',
    bindHost: '127.0.0.1', bindPort: 1080 } }).ok, true);
  assert.equal(parseRequest({ ...save, payload: { ...definition, bindHost: '0.0.0.0' } }).ok, false);
  assert.equal(parseRequest({ ...save, payload: { ...definition, password: 'hidden' } }).ok, false);
  if (parsedSave.ok) assert.equal(isCommandReply({ requestId: request.requestId, ok: true,
    result: { ...definition, createdAt: '2026-10-24T00:00:00.000Z' } }, parsedSave.result), true);

  const list = { command: 'tunnel.list', requestId: request.requestId, contractVersion: 1, payload: {} };
  const parsedList = parseRequest(list);
  assert.equal(parsedList.ok, true);
  if (parsedList.ok) assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result: [{
    definition: { ...definition, createdAt: '2026-10-24T00:00:00.000Z' }, status: { tunnelId: definition.id, state: 'stopped' }
  }] }, parsedList.result), true);

  const start = { command: 'tunnel.start', requestId: request.requestId, contractVersion: 1, payload: { id: definition.id } };
  const parsedStart = parseRequest(start);
  assert.equal(parsedStart.ok, true);
  const gatewayIds = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333'];
  const routedStart = { ...start, payload: { id: definition.id, gatewayProfileIds: gatewayIds } };
  assert.equal(parseRequest(routedStart).ok, true);
  assert.equal(parseRequest({ ...start, payload: { ...routedStart.payload, gatewayProfileIds: [...gatewayIds, '44444444-4444-4444-8444-444444444444'] } }).ok, false);
  assert.equal(parseRequest({ ...start, payload: { ...routedStart.payload, gatewayProfileIds: [gatewayIds[0], gatewayIds[0]] } }).ok, false);
  assert.equal(parseRequest({ ...start, payload: { ...start.payload, route: [] } }).ok, false);
  if (parsedStart.ok) {
    assert.equal(isCommandReply({ requestId: request.requestId, ok: true,
      result: { tunnelId: definition.id, state: 'active', bindHost: '127.0.0.1', bindPort: 53_210 } }, parsedStart.result), true);
    assert.equal(isCommandReply({ requestId: request.requestId, ok: true,
      result: { tunnelId: request.requestId, state: 'stopped' } }, parsedStart.result), false);
  }
  assert.equal(isTunnelStatusEvent({ tunnelId: definition.id, state: 'active', bindHost: '127.0.0.1', bindPort: 53_210 }), true);
  assert.equal(isTunnelStatusEvent({ tunnelId: definition.id, state: 'active', bindHost: '0.0.0.0', bindPort: 53_210 }), false);
});

test('macro IPC accepts only typed steps and credential-free replies', () => {
  const macroId = '7c08b18a-57cc-4b44-a8b3-2d404850e81c';
  const draft = { name: 'Health check', steps: [{ kind: 'send', text: 'whoami' }] };
  const create = { command: 'macro.create', requestId: request.requestId, contractVersion: 1, payload: draft };
  const update = { command: 'macro.update', requestId: request.requestId, contractVersion: 1, payload: { id: macroId, ...draft } };
  const list = { command: 'macro.list', requestId: request.requestId, contractVersion: 1, payload: {} };
  assert.equal(parseRequest(create).ok, true);
  assert.equal(parseRequest(update).ok, true);
  assert.equal(parseRequest(list).ok, true);
  assert.equal(parseRequest({ ...create, payload: { ...draft, password: 'must not persist' } }).ok, false);
  assert.equal(parseRequest({ ...create, payload: { name: 'Unsafe', steps: [{ kind: 'send', text: 'whoami\nshutdown' }] } }).ok, false);
  assert.equal(parseRequest({ command: 'macro.delete', requestId: request.requestId, contractVersion: 1, payload: { id: 'bad' } }).ok, false);
  const shortcutList = { command: 'macro.shortcut.list', requestId: request.requestId, contractVersion: 1, payload: {} };
  const shortcutSet = { command: 'macro.shortcut.set', requestId: request.requestId, contractVersion: 1, payload: { macroId, code: 'F2' } };
  const shortcutDelete = { command: 'macro.shortcut.delete', requestId: request.requestId, contractVersion: 1, payload: { macroId } };
  assert.equal(parseRequest(shortcutList).ok, true);
  assert.equal(parseRequest(shortcutSet).ok, true);
  assert.equal(parseRequest(shortcutDelete).ok, true);
  assert.equal(parseRequest({ ...shortcutSet, payload: { ...shortcutSet.payload, code: 'Ctrl+F2' } }).ok, false);
  assert.equal(parseRequest({ ...shortcutSet, payload: { ...shortcutSet.payload, targetSessionId: macroId } }).ok, false);

  const definition = { id: macroId, schemaVersion: 1, ...draft, createdAt: '2026-10-25T10:00:00.000Z', updatedAt: '2026-10-25T10:00:00.000Z' };
  const parsedList = parseRequest(list);
  const parsedCreate = parseRequest(create);
  if (parsedList.ok) {
    assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result: [definition] }, parsedList.result), true);
    assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result: [{ ...definition, password: 'hidden' }] }, parsedList.result), false);
  }
  if (parsedCreate.ok) assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result: definition }, parsedCreate.result), true);
  const parsedShortcutList = parseRequest(shortcutList);
  const parsedShortcutSet = parseRequest(shortcutSet);
  if (parsedShortcutList.ok) {
    assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result: [{ macroId, code: 'F2' }] }, parsedShortcutList.result), true);
    assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result: [{ macroId, code: 'Ctrl+F2' }] }, parsedShortcutList.result), false);
  }
  if (parsedShortcutSet.ok) {
    assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result: { macroId, code: 'F2' } }, parsedShortcutSet.result), true);
    assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result: { macroId, code: 'F3' } }, parsedShortcutSet.result), false);
  }
});

test('workbench preference IPC accepts bounded plain Unicode greeting text only', () => {
  const get = { command: 'preferences.get', requestId: request.requestId, contractVersion: 1, payload: {} };
  const settingsGet = { command: 'preferences.settings.get', requestId: request.requestId, contractVersion: 1, payload: {} };
  const save = { command: 'preferences.save', requestId: request.requestId, contractVersion: 1,
    payload: { preferences: { startupGreeting: 'Terminal ready — こんにちは 👋' } } };
  const normalizedPreferences = { ...DEFAULT_WORKBENCH_PREFERENCES, startupGreeting: 'Terminal ready — こんにちは 👋' };
  assert.equal(parseRequest(get).ok, true);
  assert.equal(parseRequest(settingsGet).ok, true);
  const parsed = parseRequest(save);
  assert.equal(parsed.ok, true);
  assert.equal(parseRequest({ ...save, payload: { preferences: { startupGreeting: 'bad\u0000text' } } }).ok, false);
  assert.equal(parseRequest({ ...save, payload: { preferences: {
    startupGreeting: 'x'.repeat(MAX_STARTUP_GREETING_CODE_POINTS * 2 + 1)
  } } }).ok, false);
  assert.equal(parseRequest({ ...save, payload: { preferences: { startupGreeting: 'safe', code: 'run' } } }).ok, false);
  assert.equal(parseRequest({ ...get, payload: { unexpected: true } }).ok, false);
  if (parsed.ok) {
    assert.equal(isCommandReply({ requestId: request.requestId, ok: true,
      result: normalizedPreferences }, parsed.result), true);
    assert.equal(isCommandReply({ requestId: request.requestId, ok: true,
      result: { startupGreeting: 'safe', command: 'whoami' } }, parsed.result), false);
    assert.equal(isCommandReply({ requestId: request.requestId, ok: false,
      error: { code: 'CORRUPT', target: 'application', retryable: false } }, parsed.result), true);
  }
  const parsedGet = parseRequest(get);
  const parsedSettingsGet = parseRequest(settingsGet);
  const preferences = { ...DEFAULT_WORKBENCH_PREFERENCES, powerShellProfileScript: 'Write-Output "private setting"' };
  if (parsedGet.ok) {
    assert.equal(isCommandReply({ requestId: request.requestId, ok: true,
      result: toWorkbenchStartupPreferences(preferences) }, parsedGet.result), true);
    assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result: preferences }, parsedGet.result), false);
  }
  if (parsedSettingsGet.ok) {
    assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result: preferences }, parsedSettingsGet.result), true);
    assert.equal(isCommandReply({ requestId: request.requestId, ok: true,
      result: toWorkbenchStartupPreferences(preferences) }, parsedSettingsGet.result), false);
  }
});

test('custom logo IPC accepts only the typed selection request and bounded PNG result', () => {
  const choose = { command: 'branding.logo.select', requestId: request.requestId, contractVersion: 1, payload: {} };
  const parsed = parseRequest(choose);
  assert.equal(parsed.ok, true);
  assert.equal(parseRequest({ ...choose, payload: { path: 'C:\\Users\\logo.png' } }).ok, false);
  if (parsed.ok) {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
    assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result: { dataUrl } }, parsed.result), true);
    assert.equal(isCommandReply({ requestId: request.requestId, ok: true, result: { dataUrl, path: 'C:\\logo.png' } }, parsed.result), false);
    assert.equal(isCommandReply({ requestId: request.requestId, ok: true,
      result: { dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' } }, parsed.result), false);
    assert.equal(isCommandReply({ requestId: request.requestId, ok: false,
      error: { code: 'CANCELLED', target: 'application', retryable: false } }, parsed.result), true);
  }
});
