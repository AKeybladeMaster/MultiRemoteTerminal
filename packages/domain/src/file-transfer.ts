import { isRemoteFileName } from './remote-files.ts';

export type FileTransferConflictPolicy = 'overwrite' | 'rename' | 'skip';
export type FileTransferDirection = 'upload' | 'download';

export interface FileTransferProgress {
  readonly sessionId: string;
  readonly operationId: string;
  readonly direction: FileTransferDirection;
  readonly phase: 'transferring' | 'committing';
  readonly fileName: string;
  readonly bytesTransferred: number;
  readonly totalBytes: number | null;
}

export interface FileTransferResult {
  readonly direction: FileTransferDirection;
  readonly fileName: string;
  readonly bytesTransferred: number;
  readonly state: 'completed' | 'skipped';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isFileTransferConflictPolicy(value: unknown): value is FileTransferConflictPolicy {
  return value === 'overwrite' || value === 'rename' || value === 'skip';
}

export function isFileTransferProgress(value: unknown, validFileName: (value: unknown) => value is string = isRemoteFileName): value is FileTransferProgress {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return Object.keys(input).length === 7 && Object.hasOwn(input, 'sessionId') && Object.hasOwn(input, 'operationId') &&
    Object.hasOwn(input, 'direction') && Object.hasOwn(input, 'phase') && Object.hasOwn(input, 'fileName') &&
    Object.hasOwn(input, 'bytesTransferred') && Object.hasOwn(input, 'totalBytes') &&
    typeof input.sessionId === 'string' && UUID.test(input.sessionId) && typeof input.operationId === 'string' && UUID.test(input.operationId) &&
    (input.direction === 'upload' || input.direction === 'download') && (input.phase === 'transferring' || input.phase === 'committing') &&
    validFileName(input.fileName) && Number.isSafeInteger(input.bytesTransferred) && (input.bytesTransferred as number) >= 0 &&
    (input.totalBytes === null || (Number.isSafeInteger(input.totalBytes) && (input.totalBytes as number) >= 0));
}

export function isFileTransferResult(value: unknown, validFileName: (value: unknown) => value is string = isRemoteFileName): value is FileTransferResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return Object.keys(input).length === 4 && Object.hasOwn(input, 'direction') && Object.hasOwn(input, 'fileName') &&
    Object.hasOwn(input, 'bytesTransferred') && Object.hasOwn(input, 'state') &&
    (input.direction === 'upload' || input.direction === 'download') && validFileName(input.fileName) &&
    Number.isSafeInteger(input.bytesTransferred) && (input.bytesTransferred as number) >= 0 &&
    (input.state === 'completed' || input.state === 'skipped');
}
