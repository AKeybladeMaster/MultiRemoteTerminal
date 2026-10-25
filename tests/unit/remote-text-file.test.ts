import test from 'node:test';
import assert from 'node:assert/strict';
import { isRemoteTextFile, isRemoteTextFileSaveResult, MAX_REMOTE_TEXT_FILE_BYTES, remoteTextByteLength } from '../../packages/domain/src/remote-text-file.ts';

test('remote text files accept bounded valid Unicode and exact revision records', () => {
  const content = 'server says café\r\n';
  const bytes = Buffer.byteLength(content, 'utf8');
  const revision = 'a'.repeat(64);
  assert.equal(remoteTextByteLength(content), bytes);
  assert.equal(isRemoteTextFile({ path: '/home/config.txt', content, revision, bytes }), true);
  assert.equal(isRemoteTextFileSaveResult({ path: '/home/config.txt', revision, bytesSaved: bytes }), true);
  assert.equal(isRemoteTextFile({ path: '/home/config.txt', content, revision, bytes: bytes + 1 }), false);
  assert.equal(isRemoteTextFile({ path: '/home/config.txt', content, revision: 'sha256:' + revision, bytes }), false);
  assert.equal(isRemoteTextFile({ path: '/home/../secret.txt', content, revision, bytes }), false);
  assert.equal(remoteTextByteLength('binary\0text'), undefined);
  assert.equal(remoteTextByteLength('\ud800'), undefined);
  assert.equal(remoteTextByteLength('🙂'.repeat(MAX_REMOTE_TEXT_FILE_BYTES / 4)), MAX_REMOTE_TEXT_FILE_BYTES);
  assert.equal(remoteTextByteLength('🙂'.repeat(MAX_REMOTE_TEXT_FILE_BYTES / 4 + 1)), undefined);
  assert.equal(remoteTextByteLength('x'.repeat(512 * 1024 + 1)), undefined);
});
