import type { ErrorCode } from '../../domain/src/errors.ts';
import { failure } from '../../domain/src/errors.ts';
import type { Outcome } from '../../domain/src/errors.ts';
import type { FileTransferProgress } from '../../domain/src/file-transfer.ts';
import type { FileTransferRecoveryCursor, FileTransferRecoveryPage, FileTransferRecoveryRecord, FileTransferRecoveryTransport } from '../../domain/src/file-transfer-recovery.ts';
import { storageOperationErrorCode } from './storage-errors.ts';

export interface FileTransferRecoveryStore {
  begin(input: { readonly operationId: string; readonly transport: FileTransferRecoveryTransport; readonly direction: 'upload' | 'download';
    readonly fileName: string }): Promise<void>;
  updateProgress(operationId: string, bytesTransferred: number, totalBytes: number | null): Promise<void>;
  updateRemoteArtifactNames(operationId: string, remoteArtifactNames: readonly string[]): Promise<void>;
  finish(input: { readonly operationId: string; readonly state: 'completed' | 'failed' | 'cancelled' | 'skipped' | 'interrupted';
    readonly bytesTransferred: number; readonly totalBytes: number | null; readonly errorCode: ErrorCode | null }): Promise<void>;
  listInterrupted(cursor: FileTransferRecoveryCursor | null): Promise<FileTransferRecoveryPage>;
  findInterrupted(operationId: string): Promise<FileTransferRecoveryRecord | undefined>;
  dismiss(operationId: string): Promise<boolean>;
}

export async function runTrackedFileTransfer<P extends Pick<FileTransferProgress, 'operationId' | 'bytesTransferred' | 'totalBytes' | 'remoteArtifactNames'>,
  R extends { readonly state: 'completed' | 'skipped'; readonly bytesTransferred: number }>(store: FileTransferRecoveryStore,
  details: { readonly operationId: string; readonly transport: FileTransferRecoveryTransport; readonly direction: 'upload' | 'download';
    readonly fileName: string; readonly plannedRemoteArtifactNames?: readonly string[] },
  reportProgress: (progress: P) => void,
  operation: (onProgress: (progress: P) => void | Promise<void>) => Promise<Outcome<R>>,
  reportChanged: () => void): Promise<Outcome<R>> {
  const { plannedRemoteArtifactNames, ...record } = details;
  try { await store.begin(record); }
  catch (error) { return failure(storageOperationErrorCode(error) ?? 'UNAVAILABLE'); }

  if (plannedRemoteArtifactNames?.length) {
    try { await store.updateRemoteArtifactNames(details.operationId, plannedRemoteArtifactNames); }
    catch (error) {
      const errorCode = storageOperationErrorCode(error) ?? 'UNAVAILABLE';
      await store.finish({ operationId: details.operationId, state: 'failed', bytesTransferred: 0, totalBytes: null, errorCode })
        .catch(() => undefined);
      reportChanged();
      return failure(errorCode);
    }
  }

  let latest: Pick<FileTransferProgress, 'bytesTransferred' | 'totalBytes' | 'remoteArtifactNames'> = { bytesTransferred: 0, totalBytes: null };
  let lastWriteAt = 0;
  let recoveryWrites = Promise.resolve();
  const onProgress = (progress: P): void | Promise<void> => {
    try { reportProgress(progress); } catch { /* UI reporting cannot interrupt transport-owned cleanup. */ }
    const remoteArtifactNames = progress.remoteArtifactNames ?? latest.remoteArtifactNames;
    latest = { bytesTransferred: progress.bytesTransferred, totalBytes: progress.totalBytes,
      ...(remoteArtifactNames === undefined ? {} : { remoteArtifactNames }) };
    const writeProgress = Date.now() - lastWriteAt >= 1_000;
    const writeArtifactNames = progress.remoteArtifactNames !== undefined;
    if (!writeProgress && !writeArtifactNames) return;
    if (writeProgress) lastWriteAt = Date.now();
    const write = recoveryWrites.then(async () => {
      if (writeProgress) await store.updateProgress(details.operationId, progress.bytesTransferred, progress.totalBytes);
      if (writeArtifactNames) await store.updateRemoteArtifactNames(details.operationId, progress.remoteArtifactNames!);
    });
    recoveryWrites = write.catch(() => undefined);
    return writeArtifactNames ? write : undefined;
  };

  let outcome: Outcome<R>;
  try { outcome = await operation(onProgress); }
  catch { outcome = failure('UNAVAILABLE', 'terminal'); }
  await recoveryWrites;
  const failedFtpUploadHasArtifacts = !outcome.ok && details.direction === 'upload' && details.transport !== 'sftp' &&
    (latest.remoteArtifactNames?.length ?? 0) > 0;
  let state: 'completed' | 'failed' | 'cancelled' | 'skipped' | 'interrupted';
  if (outcome.ok) state = outcome.result.state;
  else if (failedFtpUploadHasArtifacts || outcome.error.code === 'TIMEOUT' || outcome.error.code === 'UNAVAILABLE') state = 'interrupted';
  else if (outcome.error.code === 'CANCELLED') state = 'cancelled';
  else state = 'failed';
  const finalBytes = outcome.ok ? outcome.result.bytesTransferred : latest.bytesTransferred;
  const finish = { operationId: details.operationId, state, bytesTransferred: finalBytes, totalBytes: latest.totalBytes,
    errorCode: outcome.ok ? null : outcome.error.code } as const;
  try { await store.finish(finish); }
  catch { await store.finish(finish).catch(() => undefined); }
  reportChanged();
  return outcome;
}
