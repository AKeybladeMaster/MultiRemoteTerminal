import test from 'node:test';
import assert from 'node:assert/strict';
import { isFileTransferConflictPolicy, isFileTransferProgress, isFileTransferResult } from '../../packages/domain/src/file-transfer.ts';
import { isFtpTransferProgress, isFtpTransferResult } from '../../packages/domain/src/ftp.ts';

test('shared transfer contracts validate policy, progress and results while FTP keeps command-safe names', () => {
  const progress = {
    sessionId: '11111111-1111-4111-8111-111111111111', operationId: '22222222-2222-4222-8222-222222222222',
    direction: 'upload', phase: 'transferring', fileName: 'report.csv', bytesTransferred: 4, totalBytes: 10
  } as const;
  const result = { direction: 'download', fileName: 'report.csv', bytesTransferred: 10, state: 'completed' } as const;

  assert.equal(isFileTransferConflictPolicy('rename'), true);
  assert.equal(isFileTransferConflictPolicy('replace'), false);
  assert.equal(isFileTransferProgress(progress), true);
  assert.equal(isFileTransferProgress({ ...progress, bytesTransferred: -1 }), false);
  assert.equal(isFileTransferProgress({ ...progress, unexpected: true }), false);
  assert.equal(isFileTransferResult(result), true);
  assert.equal(isFtpTransferProgress({ ...progress, fileName: 'bad\nname' }), false);
  assert.equal(isFtpTransferResult({ ...result, fileName: 'bad\rname' }), false);
});
