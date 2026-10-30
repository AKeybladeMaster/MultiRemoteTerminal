import test from 'node:test';
import assert from 'node:assert/strict';
import { transferFailureMessage } from '../../apps/desktop/src/renderer/remote-files-errors.ts';

test('remote upload timeouts tell users to inspect uncertain artifacts', () => {
  assert.equal(transferFailureMessage('TIMEOUT', 'ftp', 'upload'),
    'FTP upload timed out. The server may retain an incomplete or complete file; reconnect and inspect the remote folder before removing anything.');
  assert.equal(transferFailureMessage('TIMEOUT', 'sftp', 'upload'),
    'SFTP upload timed out. The server may retain an incomplete or complete file; reconnect and inspect the remote folder before removing anything.');
});

test('remote transfer failures preserve actionable local-file and FTP artifact guidance', () => {
  assert.equal(transferFailureMessage('NOT_FOUND', 'ftp', 'upload', true),
    'The dropped local file is no longer available. Drop it again.');
  assert.equal(transferFailureMessage('UNAVAILABLE', 'ftp', 'upload'),
    'FTP upload failed. Reconnect and inspect the remote folder for upload or backup files before removing anything.');
});
