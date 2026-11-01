import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { StorageOperationError } from '../../packages/application/src/storage-errors.ts';
import { SqliteHostTrustRepository } from '../../apps/desktop/src/adapters/sqlite-host-trust-repository.ts';
import { MAX_OPEN_FILE_TRANSFER_RECOVERY_JOBS, SqliteTransferRecoveryRepository } from '../../apps/desktop/src/adapters/sqlite-transfer-recovery-repository.ts';

const operationId = '018f7b8a-6d19-4e0c-8c6a-682f1316f004';
const firstRunId = '118f7b8a-6d19-4e0c-8c6a-682f1316f004';
const nextRunId = '218f7b8a-6d19-4e0c-8c6a-682f1316f004';

function createRecoveryRepository(database: DatabaseSync): SqliteTransferRecoveryRepository {
  new SqliteHostTrustRepository(database).migrate();
  return new SqliteTransferRecoveryRepository(database);
}

test('SQLite transfer recovery persists progress, detects a prior app run, and settles its live operation', () => {
  const database = new DatabaseSync(':memory:');
  try {
    const recovery = createRecoveryRepository(database);
    recovery.begin({ operationId, runId: firstRunId, transport: 'ftps', direction: 'download', fileName: 'archive.tar' });
    recovery.updateProgress(operationId, 128, 256);
    recovery.begin({ operationId: '318f7b8a-6d19-4e0c-8c6a-682f1316f004', runId: firstRunId, transport: 'ftp', direction: 'upload', fileName: 'upload.bin' });
    recovery.updateRemoteArtifactNames('318f7b8a-6d19-4e0c-8c6a-682f1316f004', ['server-assigned.bin', '.mrt-stage.partial']);
    recovery.markPreviousRunsInterrupted(firstRunId);
    assert.deepEqual(recovery.listInterrupted(null).records, [], 'replacing a storage worker in the same app run must preserve an active record');
    recovery.markPreviousRunsInterrupted(nextRunId);

    const interrupted = recovery.findInterrupted(operationId);
    assert.equal(interrupted?.state, 'interrupted');
    assert.equal(interrupted?.transport, 'ftps');
    assert.equal(interrupted?.bytesTransferred, 128);
    assert.equal(interrupted?.totalBytes, 256);
    assert.equal(interrupted?.errorCode, 'UNAVAILABLE');
    assert.equal(Object.hasOwn(interrupted ?? {}, 'remotePath'), false);
    const interruptedUpload = recovery.findInterrupted('318f7b8a-6d19-4e0c-8c6a-682f1316f004');
    assert.deepEqual(interruptedUpload?.remoteArtifactNames, ['server-assigned.bin', '.mrt-stage.partial']);
    assert.equal(Object.hasOwn(interruptedUpload ?? {}, 'remoteDirectory'), false);

    recovery.finish({ operationId: '318f7b8a-6d19-4e0c-8c6a-682f1316f004', state: 'failed', bytesTransferred: 0, totalBytes: null, errorCode: 'UNAVAILABLE' });
    recovery.updateProgress(operationId, 192, 256);
    recovery.finish({ operationId, state: 'completed', bytesTransferred: 256, totalBytes: 256, errorCode: null });
    assert.deepEqual(recovery.listInterrupted(null).records, []);
  } finally { database.close(); }
});

test('finishing an interrupted transfer preserves its highest durable progress checkpoint', () => {
  const database = new DatabaseSync(':memory:');
  try {
    const recovery = createRecoveryRepository(database);
    recovery.begin({ operationId, runId: firstRunId, transport: 'sftp', direction: 'download', fileName: 'archive.tar' });
    recovery.updateProgress(operationId, 192, 256);
    recovery.finish({ operationId, state: 'interrupted', bytesTransferred: 128, totalBytes: null, errorCode: 'UNAVAILABLE' });
    const interrupted = recovery.findInterrupted(operationId);
    assert.equal(interrupted?.bytesTransferred, 192);
    assert.equal(interrupted?.totalBytes, 256);
    assert.equal(interrupted?.state, 'interrupted');
  } finally { database.close(); }
});

test('SQLite transfer recovery pages through every interrupted record with a stable keyset cursor', () => {
  const database = new DatabaseSync(':memory:');
  try {
    const recovery = createRecoveryRepository(database);
    const ids = Array.from({ length: 205 }, (_, index) => `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`);
    for (const id of ids) recovery.begin({ operationId: id, runId: firstRunId, transport: 'sftp', direction: 'download', fileName: 'archive.tar' });
    recovery.markPreviousRunsInterrupted(nextRunId);

    const first = recovery.listInterrupted(null);
    const second = recovery.listInterrupted(first.nextCursor);
    const third = recovery.listInterrupted(second.nextCursor);
    const records = [...first.records, ...second.records, ...third.records];
    assert.deepEqual([first.records.length, second.records.length, third.records.length], [100, 100, 5]);
    assert.ok(first.nextCursor);
    assert.ok(second.nextCursor);
    assert.equal(third.nextCursor, null);
    assert.equal(new Set(records.map(record => record.operationId)).size, ids.length);
    assert.deepEqual(new Set(records.map(record => record.operationId)), new Set(ids));
    const firstId = ids[0]!;
    assert.equal(recovery.findInterrupted(firstId)?.direction, 'download');
    assert.throws(() => recovery.listInterrupted({ updatedAt: 'invalid', operationId: firstId }),
      error => error instanceof StorageOperationError && error.kind === 'invalid');
  } finally { database.close(); }
});

test('SQLite transfer recovery bounds nonterminal rows without deleting undismissed interruptions', () => {
  const database = new DatabaseSync(':memory:');
  try {
    const recovery = createRecoveryRepository(database);
    const insert = database.prepare(`INSERT INTO file_transfer_recovery_jobs
      (operation_id, run_id, transport, direction, file_name, state, created_at, updated_at)
      VALUES (?, ?, 'sftp', 'download', 'file.bin', 'interrupted', ?, ?)`);
    const now = new Date().toISOString();
    database.exec('BEGIN');
    try {
      for (let index = 1; index <= MAX_OPEN_FILE_TRANSFER_RECOVERY_JOBS; index += 1) {
        insert.run(`00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`, firstRunId, now, now);
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }

    assert.throws(() => recovery.begin({ operationId: '718f7b8a-6d19-4e0c-8c6a-682f1316f004', runId: nextRunId,
      transport: 'sftp', direction: 'download', fileName: 'new.bin' }),
    error => error instanceof StorageOperationError && error.kind === 'busy');
    const count = database.prepare("SELECT COUNT(*) AS count FROM file_transfer_recovery_jobs WHERE state = 'interrupted'")
      .get() as { readonly count: number };
    assert.equal(count.count, MAX_OPEN_FILE_TRANSFER_RECOVERY_JOBS);
  } finally { database.close(); }
});

test('SQLite transfer recovery requires explicit dismissal and rejects unsafe or duplicate starts', () => {
  const database = new DatabaseSync(':memory:');
  try {
    const recovery = createRecoveryRepository(database);
    recovery.begin({ operationId, runId: firstRunId, transport: 'sftp', direction: 'upload', fileName: 'safe.txt' });
    assert.throws(() => recovery.updateRemoteArtifactNames(operationId, ['../unsafe']),
      error => error instanceof StorageOperationError && error.kind === 'invalid');
    recovery.begin({ operationId: '418f7b8a-6d19-4e0c-8c6a-682f1316f004', runId: firstRunId, transport: 'ftp', direction: 'download', fileName: 'download.bin' });
    assert.throws(() => recovery.updateRemoteArtifactNames('418f7b8a-6d19-4e0c-8c6a-682f1316f004', ['server-name.bin']),
      error => error instanceof StorageOperationError && error.kind === 'not-found');
    recovery.markPreviousRunsInterrupted(nextRunId);
    assert.equal(recovery.dismiss(operationId), true);
    assert.equal(recovery.dismiss(operationId), false);
    assert.throws(() => recovery.begin({ operationId, runId: nextRunId, transport: 'sftp', direction: 'upload', fileName: '../unsafe' }),
      error => error instanceof StorageOperationError && error.kind === 'invalid');
    recovery.begin({ operationId, runId: firstRunId, transport: 'sftp', direction: 'upload', fileName: 'safe.txt' });
    assert.throws(() => recovery.begin({ operationId, runId: nextRunId, transport: 'sftp', direction: 'upload', fileName: 'safe.txt' }),
      error => error instanceof StorageOperationError && error.kind === 'conflict');
  } finally { database.close(); }
});

test('SQLite transfer recovery rejects oversized persisted artifact metadata as corrupt', () => {
  const database = new DatabaseSync(':memory:');
  try {
    const recovery = createRecoveryRepository(database);
    recovery.begin({ operationId, runId: firstRunId, transport: 'ftp', direction: 'upload', fileName: 'archive.bin' });
    recovery.markPreviousRunsInterrupted(nextRunId);
    database.prepare('UPDATE file_transfer_recovery_jobs SET remote_artifact_names_json = ? WHERE operation_id = ?')
      .run(JSON.stringify(['x'.repeat(9 * 1024)]), operationId);

    assert.throws(() => recovery.findInterrupted(operationId),
      error => error instanceof StorageOperationError && error.kind === 'corrupt');
  } finally { database.close(); }
});

test('SQLite v4 recovery migration preserves interrupted rows and defaults their artifact list', () => {
  const database = new DatabaseSync(':memory:');
  try {
    const recovery = createRecoveryRepository(database);
    recovery.begin({ operationId, runId: firstRunId, transport: 'ftp', direction: 'upload', fileName: 'archive.bin' });
    recovery.updateProgress(operationId, 12, 24);
    recovery.markPreviousRunsInterrupted(nextRunId);
    database.exec('ALTER TABLE file_transfer_recovery_jobs DROP COLUMN remote_artifact_names_json; PRAGMA user_version = 4;');

    new SqliteHostTrustRepository(database).migrate();
    const [recovered] = new SqliteTransferRecoveryRepository(database).listInterrupted(null).records;
    assert.deepEqual({ operationId: recovered?.operationId, fileName: recovered?.fileName, state: recovered?.state,
      bytesTransferred: recovered?.bytesTransferred, totalBytes: recovered?.totalBytes, remoteArtifactNames: recovered?.remoteArtifactNames },
    { operationId, fileName: 'archive.bin', state: 'interrupted', bytesTransferred: 12, totalBytes: 24, remoteArtifactNames: [] });
  } finally { database.close(); }
});

