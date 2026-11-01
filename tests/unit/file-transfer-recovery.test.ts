import test from 'node:test';
import assert from 'node:assert/strict';
import { interruptedUploadArtifactNames, isFileTransferRecoveryCursor, isFileTransferRecoveryFileName, isFileTransferRecoveryPage, isFileTransferRecoveryRecord } from '../../packages/domain/src/file-transfer-recovery.ts';
import { failure } from '../../packages/domain/src/errors.ts';
import type { FileTransferProgress } from '../../packages/domain/src/file-transfer.ts';
import { runTrackedFileTransfer } from '../../packages/application/src/file-transfer-recovery.ts';
import type { FileTransferRecoveryStore } from '../../packages/application/src/file-transfer-recovery.ts';
import { StorageOperationError } from '../../packages/application/src/storage-errors.ts';

const record = {
  operationId: '018f7b8a-6d19-4e0c-8c6a-682f1316f004', transport: 'sftp', direction: 'download', fileName: 'archive.tar',
  state: 'interrupted', bytesTransferred: 128, totalBytes: 256, errorCode: 'UNAVAILABLE',
  createdAt: '2026-10-31T10:00:00.000Z', updatedAt: '2026-10-31T10:00:01.000Z', remoteArtifactNames: []
} as const;

test('file transfer recovery metadata accepts bounded, credential-free display records', () => {
  assert.equal(isFileTransferRecoveryRecord(record), true);
  assert.equal(isFileTransferRecoveryFileName('archive.tar'), true);
  assert.equal(isFileTransferRecoveryRecord({ ...record, remotePath: '/home/alice/archive.tar' }), false);
  assert.equal(isFileTransferRecoveryRecord({ ...record, password: 'secret' }), false);
  assert.equal(isFileTransferRecoveryRecord({ ...record, direction: 'upload', remoteArtifactNames: ['.mrt-safe.partial'] }), true);
  assert.equal(isFileTransferRecoveryRecord({ ...record, remoteArtifactNames: ['.mrt-safe.partial'] }), false);
  assert.equal(isFileTransferRecoveryRecord({ ...record, direction: 'upload', remoteArtifactNames: ['/remote/.mrt-safe.partial'] }), false);
  assert.equal(isFileTransferRecoveryRecord({ ...record, direction: 'upload', remoteArtifactNames: ['a', 'a', 'b'] }), false);
  assert.equal(isFileTransferRecoveryRecord({ ...record, direction: 'upload', remoteArtifactNames: ['x'.repeat(1_024)] }), true);
  assert.equal(isFileTransferRecoveryRecord({ ...record, direction: 'upload', remoteArtifactNames: ['x'.repeat(1_025)] }), false);
  assert.equal(isFileTransferRecoveryRecord({ ...record, direction: 'upload', remoteArtifactNames: ['stage\\name.partial'] }), true);
  assert.equal(isFileTransferRecoveryRecord({ ...record, direction: 'upload', remoteArtifactNames: ['bad\u0085name'] }), false);
  assert.equal(isFileTransferRecoveryPage({ records: [record], nextCursor: null }), true);
  assert.equal(isFileTransferRecoveryCursor({ updatedAt: record.updatedAt, operationId: record.operationId }), true);
  assert.equal(isFileTransferRecoveryPage({ records: [record], nextCursor: { updatedAt: record.updatedAt, operationId: '218f7b8a-6d19-4e0c-8c6a-682f1316f004' } }), false);
});

test('file transfer recovery metadata rejects unsafe names, invalid identifiers and malformed timestamps', () => {
  for (const fileName of ['', '.', '..', '../secret', 'folder\\secret', 'bad\u0000name', 'x'.repeat(256)]) {
    assert.equal(isFileTransferRecoveryFileName(fileName), false, fileName);
    assert.equal(isFileTransferRecoveryRecord({ ...record, fileName }), false, fileName);
  }
  assert.equal(isFileTransferRecoveryRecord({ ...record, operationId: '../secret' }), false);
  assert.equal(isFileTransferRecoveryRecord({ ...record, updatedAt: 'yesterday' }), false);
  assert.equal(isFileTransferRecoveryRecord({ ...record, bytesTransferred: Number.MAX_SAFE_INTEGER + 1 }), false);
  assert.equal(isFileTransferRecoveryRecord({ ...record, fileName: '😀'.repeat(128) }), false);
});

test('interrupted upload artifact names stay transport-scoped and never include download stages', () => {
  assert.deepEqual(interruptedUploadArtifactNames({ ...record, direction: 'upload' }),
    [`.mrt-${record.operationId}.partial`]);
  assert.deepEqual(interruptedUploadArtifactNames({ ...record, direction: 'upload', remoteArtifactNames: ['.mrt-backup.backup'] }),
    [`.mrt-${record.operationId}.partial`, '.mrt-backup.backup']);
  assert.deepEqual(interruptedUploadArtifactNames({ ...record, direction: 'upload', transport: 'ftp', remoteArtifactNames: ['server-name.bin'] }),
    ['server-name.bin']);
  assert.deepEqual(interruptedUploadArtifactNames({ ...record, direction: 'upload', transport: 'ftps', remoteArtifactNames: ['stage.partial', 'backup.bin'] }),
    ['stage.partial', 'backup.bin']);
  assert.deepEqual(interruptedUploadArtifactNames(record), []);
  assert.deepEqual(interruptedUploadArtifactNames({ ...record, state: 'completed', direction: 'upload' }), []);
});

test('application recovery owns tracked-transfer checkpoints and settlement outside the IPC broker', async () => {
  const events: string[] = [];
  let finished: Parameters<FileTransferRecoveryStore['finish']>[0] | undefined;
  const store: FileTransferRecoveryStore = {
    async begin() { events.push('begin'); },
    async updateProgress(_operationId, bytesTransferred) { events.push(`progress:${bytesTransferred}`); },
    async updateRemoteArtifactNames(_operationId, names) { events.push(`artifacts:${names.join(',')}`); },
    async finish(input) { finished = input; events.push(`finish:${input.state}`); },
    async listInterrupted() { return { records: [], nextCursor: null }; },
    async findInterrupted() { return undefined; },
    async dismiss() { return false; }
  };
  const artifactName = '.mrt-operation.partial';
  const progress = { operationId: record.operationId, bytesTransferred: 8, totalBytes: 16, remoteArtifactNames: [artifactName] } as const;
  const outcome = await runTrackedFileTransfer<typeof progress, { readonly state: 'completed' | 'skipped'; readonly bytesTransferred: number }>(store,
    { operationId: record.operationId, transport: 'sftp', direction: 'upload', fileName: record.fileName },
    () => events.push('reported'), async onProgress => {
      onProgress(progress);
      return failure('CANCELLED', 'terminal');
    }, () => events.push('changed'));

  assert.deepEqual(outcome, failure('CANCELLED', 'terminal'));
  assert.deepEqual(events, ['begin', 'reported', 'progress:8', `artifacts:${artifactName}`, 'finish:cancelled', 'changed']);
  assert.deepEqual(finished, { operationId: record.operationId, state: 'cancelled', bytesTransferred: 8, totalBytes: 16, errorCode: 'CANCELLED' });
});

test('cancelled FTP uploads with durable remote artifact names remain visible for recovery', async () => {
  let finished: Parameters<FileTransferRecoveryStore['finish']>[0] | undefined;
  const store: FileTransferRecoveryStore = {
    async begin() {}, async updateProgress() {}, async updateRemoteArtifactNames() {},
    async finish(input) { finished = input; }, async listInterrupted() { return { records: [], nextCursor: null }; },
    async findInterrupted() { return undefined; }, async dismiss() { return false; }
  };
  const artifactName = 'server-assigned.bin';
  const progress = { operationId: record.operationId, bytesTransferred: 8, totalBytes: 16, remoteArtifactNames: [artifactName] } as const;

  await runTrackedFileTransfer<typeof progress, { readonly state: 'completed' | 'skipped'; readonly bytesTransferred: number }>(store,
    { operationId: record.operationId, transport: 'ftp', direction: 'upload', fileName: record.fileName }, () => {},
    async onProgress => { await onProgress(progress); return failure('CANCELLED', 'terminal'); }, () => {});

  assert.deepEqual(finished, { operationId: record.operationId, state: 'interrupted', bytesTransferred: 8, totalBytes: 16, errorCode: 'CANCELLED' });
});

test('failed FTPS uploads retain artifact names when later progress explicitly omits them', async () => {
  let finished: Parameters<FileTransferRecoveryStore['finish']>[0] | undefined;
  const durableArtifacts: string[][] = [];
  const store: FileTransferRecoveryStore = {
    async begin() {}, async updateProgress() {}, async updateRemoteArtifactNames(_operationId, names) { durableArtifacts.push([...names]); },
    async finish(input) { finished = input; }, async listInterrupted() { return { records: [], nextCursor: null }; },
    async findInterrupted() { return undefined; }, async dismiss() { return false; }
  };
  type RecoveryProgress = Pick<FileTransferProgress, 'operationId' | 'bytesTransferred' | 'totalBytes' | 'remoteArtifactNames'>;
  const progress: RecoveryProgress = { operationId: record.operationId, bytesTransferred: 8, totalBytes: 16, remoteArtifactNames: ['.mrt-stage.partial'] };
  const laterProgress = { operationId: record.operationId, bytesTransferred: 12, totalBytes: 16, remoteArtifactNames: undefined } as unknown as RecoveryProgress;

  await runTrackedFileTransfer<RecoveryProgress, { readonly state: 'completed' | 'skipped'; readonly bytesTransferred: number }>(store,
    { operationId: record.operationId, transport: 'ftps', direction: 'upload', fileName: record.fileName }, () => {},
    async onProgress => { await onProgress(progress); await onProgress(laterProgress); return failure('CONFLICT'); }, () => {});

  assert.deepEqual(durableArtifacts, [['.mrt-stage.partial']]);
  assert.deepEqual(finished, { operationId: record.operationId, state: 'interrupted', bytesTransferred: 12, totalBytes: 16, errorCode: 'CONFLICT' });
});

test('SFTP overwrite rollback failure keeps the durable backup name in interrupted recovery', async () => {
  let finished: Parameters<FileTransferRecoveryStore['finish']>[0] | undefined;
  let durableNames: readonly string[] = [];
  const store: FileTransferRecoveryStore = {
    async begin() {}, async updateProgress() {}, async updateRemoteArtifactNames(_operationId, names) { durableNames = [...names]; },
    async finish(input) { finished = input; }, async listInterrupted() { return { records: [], nextCursor: null }; },
    async findInterrupted() { return undefined; }, async dismiss() { return false; }
  };
  const operationId = '55555555-5555-4555-8555-555555555555';
  const backupName = `.mrt-${operationId}.backup`;
  const progress = { operationId, bytesTransferred: 0, totalBytes: 16, remoteArtifactNames: [backupName] } as const;
  type RecoveryProgress = Pick<FileTransferProgress, 'operationId' | 'bytesTransferred' | 'totalBytes' | 'remoteArtifactNames'>;

  const outcome = await runTrackedFileTransfer<RecoveryProgress, { readonly state: 'completed' | 'skipped'; readonly bytesTransferred: number }>(store,
    { operationId, transport: 'sftp', direction: 'upload', fileName: 'report.txt',
      plannedRemoteArtifactNames: [`.mrt-${operationId}.partial`, backupName] }, () => {}, async onProgress => {
      onProgress(progress);
      return failure('UNAVAILABLE', 'terminal');
    }, () => {});

  assert.deepEqual(outcome, failure('UNAVAILABLE', 'terminal'));
  assert.deepEqual(durableNames, [backupName]);
  assert.deepEqual(finished, { operationId, state: 'interrupted', bytesTransferred: 0, totalBytes: 16, errorCode: 'UNAVAILABLE' });
  assert.deepEqual(interruptedUploadArtifactNames({ ...record, operationId, direction: 'upload', state: 'interrupted',
    remoteArtifactNames: durableNames }), [`.mrt-${operationId}.partial`, backupName]);
});

test('planned remote upload artifacts persist before transport start and storage failure prevents the transfer', async () => {
  const events: string[] = [];
  let failArtifactWrite = false;
  const store: FileTransferRecoveryStore = {
    async begin() { events.push('begin'); },
    async updateProgress() {},
    async updateRemoteArtifactNames(_operationId, names) {
      events.push(`artifacts:${names.join(',')}`);
      if (failArtifactWrite) throw new StorageOperationError('busy');
    },
    async finish(input) { events.push(`finish:${input.state}:${input.errorCode ?? 'none'}`); },
    async listInterrupted() { return { records: [], nextCursor: null }; },
    async findInterrupted() { return undefined; },
    async dismiss() { return false; }
  };
  const details = { operationId: record.operationId, transport: 'sftp' as const, direction: 'upload' as const,
    fileName: record.fileName, plannedRemoteArtifactNames: [`.mrt-${record.operationId}.partial`, `.mrt-${record.operationId}.backup`] };
  let operationStarted = false;
  const run = () => runTrackedFileTransfer(store, details, () => {}, async () => {
    operationStarted = true;
    events.push('transport');
    return { ok: true, result: { state: 'completed' as const, bytesTransferred: 8 } };
  }, () => events.push('changed'));

  assert.deepEqual(await run(), { ok: true, result: { state: 'completed', bytesTransferred: 8 } });
  assert.deepEqual(events, ['begin', `artifacts:${details.plannedRemoteArtifactNames.join(',')}`, 'transport', 'finish:completed:none', 'changed']);

  events.length = 0;
  operationStarted = false;
  failArtifactWrite = true;
  assert.deepEqual(await run(), failure('BUSY'));
  assert.equal(operationStarted, false);
  assert.deepEqual(events, ['begin', `artifacts:${details.plannedRemoteArtifactNames.join(',')}`, 'finish:failed:BUSY', 'changed']);
});

test('remote artifact progress waits for its durable checkpoint before transport continues', async () => {
  let releaseArtifactWrite!: () => void;
  const artifactWrite = new Promise<void>(resolve => { releaseArtifactWrite = resolve; });
  const events: string[] = [];
  const store: FileTransferRecoveryStore = {
    async begin() { events.push('begin'); },
    async updateProgress() { events.push('progress'); },
    async updateRemoteArtifactNames(_operationId, names) { events.push(`artifacts:start:${names[0]}`); await artifactWrite; events.push('artifacts:durable'); },
    async finish(input) { events.push(`finish:${input.state}`); },
    async listInterrupted() { return { records: [], nextCursor: null }; },
    async findInterrupted() { return undefined; },
    async dismiss() { return false; }
  };
  const artifactName = 'server-selected.bin';
  const progress = { operationId: record.operationId, bytesTransferred: 0, totalBytes: 8, remoteArtifactNames: [artifactName] } as const;
  let transportContinued = false;
  const run = runTrackedFileTransfer(store, { operationId: record.operationId, transport: 'ftp', direction: 'upload', fileName: record.fileName },
    () => {}, async onProgress => {
      await onProgress(progress);
      transportContinued = true;
      events.push('transport');
      return { ok: true, result: { state: 'completed' as const, bytesTransferred: 8 } };
    }, () => events.push('changed'));

  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(transportContinued, false);
  assert.deepEqual(events, ['begin', 'progress', `artifacts:start:${artifactName}`]);
  releaseArtifactWrite();
  assert.deepEqual(await run, { ok: true, result: { state: 'completed', bytesTransferred: 8 } });
  assert.equal(transportContinued, true);
  assert.deepEqual(events, ['begin', 'progress', `artifacts:start:${artifactName}`, 'artifacts:durable', 'transport', 'finish:completed', 'changed']);
});
