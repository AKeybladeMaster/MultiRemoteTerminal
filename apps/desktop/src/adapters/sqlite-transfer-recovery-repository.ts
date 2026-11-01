import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { ErrorCode } from '../../../../packages/domain/src/errors.ts';
import type { FileTransferRecoveryCursor, FileTransferRecoveryPage, FileTransferRecoveryRecord, FileTransferRecoveryTransport } from '../../../../packages/domain/src/file-transfer-recovery.ts';
import { FILE_TRANSFER_RECOVERY_PAGE_SIZE, isFileTransferRecoveryArtifactNames, isFileTransferRecoveryCursor, isFileTransferRecoveryFileName,
  isFileTransferRecoveryPage, isFileTransferRecoveryRecord } from '../../../../packages/domain/src/file-transfer-recovery.ts';
import { StorageOperationError } from '../../../../packages/application/src/storage-errors.ts';

const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECENT_TERMINAL_ROWS = 100;
const MAX_RECOVERY_ARTIFACT_NAMES_JSON_BYTES = 8 * 1024;
export const MAX_OPEN_FILE_TRANSFER_RECOVERY_JOBS = 10_000;

interface RecoveryRow {
  readonly operation_id: unknown;
  readonly transport: unknown;
  readonly direction: unknown;
  readonly file_name: unknown;
  readonly state: unknown;
  readonly bytes_transferred: unknown;
  readonly total_bytes: unknown;
  readonly error_code: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
  readonly remote_artifact_names_json: unknown;
}

export class SqliteTransferRecoveryRepository {
  private readonly database: DatabaseSync;
  private readonly insert: StatementSync;
  private readonly outstandingCountStatement: StatementSync;
  private readonly finishStatement: StatementSync;
  private readonly progressStatement: StatementSync;
  private readonly artifactNamesStatement: StatementSync;
  private readonly listInterruptedStatement: StatementSync;
  private readonly listOlderInterruptedStatement: StatementSync;
  private readonly findInterruptedStatement: StatementSync;
  private readonly dismissStatement: StatementSync;
  private readonly recoverPreviousRunsStatement: StatementSync;
  private readonly pruneTerminalStatement: StatementSync;

  constructor(database: DatabaseSync) {
    this.database = database;
    this.insert = database.prepare(`
      INSERT INTO file_transfer_recovery_jobs
        (operation_id, run_id, transport, direction, file_name, state, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'running', ?, ?)
    `);
    this.outstandingCountStatement = database.prepare(`
      SELECT COUNT(*) AS count FROM file_transfer_recovery_jobs WHERE state IN ('running', 'interrupted')
    `);
    this.finishStatement = database.prepare(`
      UPDATE file_transfer_recovery_jobs SET state = ?, bytes_transferred = MAX(bytes_transferred, ?),
        total_bytes = COALESCE(?, total_bytes), error_code = ?, updated_at = ?
      WHERE operation_id = ? AND state IN ('running', 'interrupted')
    `);
    this.progressStatement = database.prepare(`
      UPDATE file_transfer_recovery_jobs SET bytes_transferred = MAX(bytes_transferred, ?),
        total_bytes = COALESCE(?, total_bytes), updated_at = ?
      WHERE operation_id = ? AND state IN ('running', 'interrupted')
    `);
    this.artifactNamesStatement = database.prepare(`
      UPDATE file_transfer_recovery_jobs SET remote_artifact_names_json = ?, updated_at = ?
      WHERE operation_id = ? AND direction = 'upload' AND state IN ('running', 'interrupted')
    `);
    this.listInterruptedStatement = database.prepare(`
      SELECT operation_id, transport, direction, file_name, state, bytes_transferred, total_bytes,
        error_code, created_at, updated_at, remote_artifact_names_json FROM file_transfer_recovery_jobs
      WHERE state = 'interrupted' ORDER BY updated_at DESC, operation_id DESC LIMIT ${FILE_TRANSFER_RECOVERY_PAGE_SIZE + 1}
    `);
    this.listOlderInterruptedStatement = database.prepare(`
      SELECT operation_id, transport, direction, file_name, state, bytes_transferred, total_bytes,
        error_code, created_at, updated_at, remote_artifact_names_json FROM file_transfer_recovery_jobs
      WHERE state = 'interrupted' AND (updated_at < ? OR (updated_at = ? AND operation_id < ?))
      ORDER BY updated_at DESC, operation_id DESC LIMIT ${FILE_TRANSFER_RECOVERY_PAGE_SIZE + 1}
    `);
    this.findInterruptedStatement = database.prepare(`
      SELECT operation_id, transport, direction, file_name, state, bytes_transferred, total_bytes,
        error_code, created_at, updated_at, remote_artifact_names_json FROM file_transfer_recovery_jobs
      WHERE operation_id = ? AND state = 'interrupted'
    `);
    this.dismissStatement = database.prepare("DELETE FROM file_transfer_recovery_jobs WHERE operation_id = ? AND state = 'interrupted'");
    this.recoverPreviousRunsStatement = database.prepare(`
      UPDATE file_transfer_recovery_jobs SET state = 'interrupted', error_code = 'UNAVAILABLE', updated_at = ?
      WHERE state = 'running' AND run_id <> ?
    `);
    this.pruneTerminalStatement = database.prepare(`
      DELETE FROM file_transfer_recovery_jobs WHERE operation_id IN (
        SELECT operation_id FROM file_transfer_recovery_jobs
        WHERE state IN ('completed', 'failed', 'cancelled', 'skipped')
        ORDER BY updated_at DESC LIMIT -1 OFFSET ${RECENT_TERMINAL_ROWS}
      )
    `);
  }

  begin(input: { readonly operationId: string; readonly runId: string; readonly transport: FileTransferRecoveryTransport;
    readonly direction: 'upload' | 'download'; readonly fileName: string }): void {
    if (!OPERATION_ID.test(input.operationId) || !OPERATION_ID.test(input.runId) || !isFileTransferRecoveryFileName(input.fileName) ||
        (input.transport !== 'sftp' && input.transport !== 'ftp' && input.transport !== 'ftps') ||
        (input.direction !== 'upload' && input.direction !== 'download')) throw new StorageOperationError('invalid');
    const now = new Date().toISOString();
    const record = { operationId: input.operationId, transport: input.transport, direction: input.direction, fileName: input.fileName,
      state: 'running', bytesTransferred: 0, totalBytes: null, errorCode: null, createdAt: now, updatedAt: now, remoteArtifactNames: [] };
    if (!isFileTransferRecoveryRecord(record)) throw new StorageOperationError('invalid');
    try {
      this.database.exec('BEGIN IMMEDIATE');
      const outstanding = this.outstandingCountStatement.get() as { readonly count?: unknown } | undefined;
      if (!Number.isSafeInteger(outstanding?.count)) throw new StorageOperationError('corrupt');
      if ((outstanding?.count as number) >= MAX_OPEN_FILE_TRANSFER_RECOVERY_JOBS) throw new StorageOperationError('busy');
      this.insert.run(input.operationId, input.runId, input.transport, input.direction, input.fileName, now, now);
      this.pruneTerminalStatement.run();
      this.database.exec('COMMIT');
    } catch (error) {
      try { this.database.exec('ROLLBACK'); } catch { /* Preserve the original start failure. */ }
      throw mapStorageError(error);
    }
  }

  updateProgress(operationId: string, bytesTransferred: number, totalBytes: number | null): void {
    if (!OPERATION_ID.test(operationId) || !Number.isSafeInteger(bytesTransferred) || bytesTransferred < 0 ||
        totalBytes !== null && (!Number.isSafeInteger(totalBytes) || totalBytes < 0)) throw new StorageOperationError('invalid');
    try {
      const result = this.progressStatement.run(bytesTransferred, totalBytes, new Date().toISOString(), operationId);
      if (result.changes !== 1) throw new StorageOperationError('not-found');
    }
    catch (error) { throw mapStorageError(error); }
  }

  updateRemoteArtifactNames(operationId: string, remoteArtifactNames: readonly string[]): void {
    if (!OPERATION_ID.test(operationId) || !isFileTransferRecoveryArtifactNames(remoteArtifactNames) || remoteArtifactNames.length === 0) {
      throw new StorageOperationError('invalid');
    }
    try {
      const serializedNames = JSON.stringify(remoteArtifactNames);
      if (Buffer.byteLength(serializedNames, 'utf8') > MAX_RECOVERY_ARTIFACT_NAMES_JSON_BYTES) throw new StorageOperationError('invalid');
      const result = this.artifactNamesStatement.run(serializedNames, new Date().toISOString(), operationId);
      if (result.changes !== 1) throw new StorageOperationError('not-found');
    } catch (error) { throw mapStorageError(error); }
  }

  finish(input: { readonly operationId: string; readonly state: 'completed' | 'failed' | 'cancelled' | 'skipped' | 'interrupted';
    readonly bytesTransferred: number; readonly totalBytes: number | null; readonly errorCode: ErrorCode | null }): void {
    if (!OPERATION_ID.test(input.operationId) || !Number.isSafeInteger(input.bytesTransferred) || input.bytesTransferred < 0 ||
        input.totalBytes !== null && (!Number.isSafeInteger(input.totalBytes) || input.totalBytes < 0)) throw new StorageOperationError('invalid');
    try {
      const result = this.finishStatement.run(input.state, input.bytesTransferred, input.totalBytes, input.errorCode, new Date().toISOString(), input.operationId);
      if (result.changes !== 1) throw new StorageOperationError('not-found');
      this.pruneTerminalStatement.run();
    } catch (error) { throw mapStorageError(error); }
  }

  markPreviousRunsInterrupted(runId: string): void {
    if (!OPERATION_ID.test(runId)) throw new StorageOperationError('invalid');
    try { this.recoverPreviousRunsStatement.run(new Date().toISOString(), runId); }
    catch (error) { throw mapStorageError(error); }
  }

  listInterrupted(cursor: FileTransferRecoveryCursor | null): FileTransferRecoveryPage {
    if (cursor !== null && !isFileTransferRecoveryCursor(cursor)) throw new StorageOperationError('invalid');
    try {
      const rows = (cursor === null ? this.listInterruptedStatement.all()
        : this.listOlderInterruptedStatement.all(cursor.updatedAt, cursor.updatedAt, cursor.operationId)) as unknown as RecoveryRow[];
      const pageRows = rows.slice(0, FILE_TRANSFER_RECOVERY_PAGE_SIZE);
      const records = pageRows.map(row => {
        const record = decode(row);
        if (!record) throw new StorageOperationError('corrupt');
        return record;
      });
      const last = records.at(-1);
      const page = { records, nextCursor: rows.length > FILE_TRANSFER_RECOVERY_PAGE_SIZE && last
        ? { updatedAt: last.updatedAt, operationId: last.operationId } : null };
      if (!isFileTransferRecoveryPage(page)) throw new StorageOperationError('corrupt');
      return page;
    } catch (error) { throw mapStorageError(error); }
  }

  findInterrupted(operationId: string): FileTransferRecoveryRecord | undefined {
    if (!OPERATION_ID.test(operationId)) throw new StorageOperationError('invalid');
    try {
      const row = this.findInterruptedStatement.get(operationId) as unknown as RecoveryRow | undefined;
      if (!row) return undefined;
      const record = decode(row);
      if (!record || record.state !== 'interrupted') throw new StorageOperationError('corrupt');
      return record;
    } catch (error) { throw mapStorageError(error); }
  }

  dismiss(operationId: string): boolean {
    if (!OPERATION_ID.test(operationId)) throw new StorageOperationError('invalid');
    try { return this.dismissStatement.run(operationId).changes === 1; }
    catch (error) { throw mapStorageError(error); }
  }
}

function decode(row: RecoveryRow): FileTransferRecoveryRecord | undefined {
  const artifactNamesJson = row.remote_artifact_names_json;
  if (typeof artifactNamesJson !== 'string' || artifactNamesJson.length > MAX_RECOVERY_ARTIFACT_NAMES_JSON_BYTES ||
      Buffer.byteLength(artifactNamesJson, 'utf8') > MAX_RECOVERY_ARTIFACT_NAMES_JSON_BYTES) return undefined;
  let remoteArtifactNames: unknown;
  try { remoteArtifactNames = JSON.parse(artifactNamesJson); }
  catch { return undefined; }
  const record = { operationId: row.operation_id, transport: row.transport, direction: row.direction, fileName: row.file_name,
    state: row.state, bytesTransferred: row.bytes_transferred, totalBytes: row.total_bytes, errorCode: row.error_code,
    createdAt: row.created_at, updatedAt: row.updated_at, remoteArtifactNames };
  return isFileTransferRecoveryRecord(record) ? record : undefined;
}

function mapStorageError(error: unknown): StorageOperationError {
  if (error instanceof StorageOperationError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : '';
  if (code === 5 || code === 6 || /SQLITE_(?:BUSY|LOCKED)|database is (?:locked|busy)/i.test(message)) return new StorageOperationError('busy');
  if (/UNIQUE constraint failed|PRIMARY KEY constraint failed/i.test(message)) return new StorageOperationError('conflict');
  if (code === 11 || code === 26 || /SQLITE_(?:CORRUPT|NOTADB)|database disk image is malformed|not a database/i.test(message)) {
    return new StorageOperationError('corrupt');
  }
  return new StorageOperationError('unavailable');
}
