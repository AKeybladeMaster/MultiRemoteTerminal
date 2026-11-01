import type { ErrorCode } from './errors.ts';
import { MAX_REMOTE_FILE_NAME_CHARS } from './remote-files.ts';

export type FileTransferRecoveryTransport = 'sftp' | 'ftp' | 'ftps';
export type FileTransferRecoveryState = 'running' | 'interrupted' | 'completed' | 'failed' | 'cancelled' | 'skipped';
export const FILE_TRANSFER_RECOVERY_PAGE_SIZE = 100;

export interface FileTransferRecoveryRecord {
  readonly operationId: string;
  readonly transport: FileTransferRecoveryTransport;
  readonly direction: 'upload' | 'download';
  readonly fileName: string;
  readonly state: FileTransferRecoveryState;
  readonly bytesTransferred: number;
  readonly totalBytes: number | null;
  readonly errorCode: ErrorCode | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly remoteArtifactNames: readonly string[];
}

export interface FileTransferRecoveryCursor {
  readonly updatedAt: string;
  readonly operationId: string;
}

export interface FileTransferRecoveryPage {
  readonly records: readonly FileTransferRecoveryRecord[];
  readonly nextCursor: FileTransferRecoveryCursor | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FILE_NAME = /^(?!\.\.?$)[^/\\\u0000-\u001f\u007f]{1,255}$/u;
const REMOTE_ARTIFACT_NAME = /^(?!\.\.?$)[^/\u0000-\u001f\u007f-\u009f]+$/u;
const ERROR_CODES = new Set<ErrorCode>(['INVALID_REQUEST', 'UNKNOWN_COMMAND', 'FORBIDDEN', 'UNAVAILABLE', 'NOT_SUPPORTED', 'TIMEOUT',
  'BUSY', 'LOCKED', 'NOT_FOUND', 'CONFLICT', 'CORRUPT', 'CANCELLED', 'OUTPUT_LIMIT', 'AUTHENTICATION_FAILED',
  'HOST_KEY_REJECTED', 'HOST_KEY_CHANGED']);

export function isFileTransferRecoveryRecord(value: unknown): value is FileTransferRecoveryRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 11 || !Object.hasOwn(input, 'operationId') || !Object.hasOwn(input, 'transport') ||
      !Object.hasOwn(input, 'direction') || !Object.hasOwn(input, 'fileName') || !Object.hasOwn(input, 'state') ||
      !Object.hasOwn(input, 'bytesTransferred') || !Object.hasOwn(input, 'totalBytes') || !Object.hasOwn(input, 'errorCode') ||
      !Object.hasOwn(input, 'createdAt') || !Object.hasOwn(input, 'updatedAt') || !Object.hasOwn(input, 'remoteArtifactNames')) return false;
  return typeof input.operationId === 'string' && UUID.test(input.operationId) &&
    (input.transport === 'sftp' || input.transport === 'ftp' || input.transport === 'ftps') &&
    (input.direction === 'upload' || input.direction === 'download') && isFileTransferRecoveryFileName(input.fileName) &&
    (input.state === 'running' || input.state === 'interrupted' || input.state === 'completed' || input.state === 'failed' ||
      input.state === 'cancelled' || input.state === 'skipped') && Number.isSafeInteger(input.bytesTransferred) &&
    (input.bytesTransferred as number) >= 0 && (input.totalBytes === null ||
      (Number.isSafeInteger(input.totalBytes) && (input.totalBytes as number) >= 0)) &&
    (input.errorCode === null || typeof input.errorCode === 'string' && ERROR_CODES.has(input.errorCode as ErrorCode)) &&
    validIsoTime(input.createdAt) && validIsoTime(input.updatedAt) && isFileTransferRecoveryArtifactNames(input.remoteArtifactNames) &&
    (input.direction === 'upload' || input.remoteArtifactNames.length === 0);
}

export function isFileTransferRecoveryCursor(value: unknown): value is FileTransferRecoveryCursor {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return Object.keys(input).length === 2 && Object.hasOwn(input, 'updatedAt') && Object.hasOwn(input, 'operationId') &&
    typeof input.operationId === 'string' && UUID.test(input.operationId) && validIsoTime(input.updatedAt);
}

export function isFileTransferRecoveryPage(value: unknown): value is FileTransferRecoveryPage {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 2 || !Object.hasOwn(input, 'records') || !Object.hasOwn(input, 'nextCursor') ||
      !Array.isArray(input.records) || input.records.length > FILE_TRANSFER_RECOVERY_PAGE_SIZE ||
      !input.records.every(item => isFileTransferRecoveryRecord(item) && item.state === 'interrupted')) return false;
  if (input.nextCursor === null) return true;
  const last = input.records.at(-1);
  return input.records.length === FILE_TRANSFER_RECOVERY_PAGE_SIZE && isFileTransferRecoveryCursor(input.nextCursor) &&
    input.nextCursor.updatedAt === last?.updatedAt && input.nextCursor.operationId === last?.operationId;
}

export function isFileTransferRecoveryFileName(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 255 && FILE_NAME.test(value);
}

export function isFileTransferRecoveryArtifactNames(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length <= 2 && value.every(isRecoveryRemoteArtifactName) && new Set(value).size === value.length;
}

export function interruptedUploadArtifactNames(record: FileTransferRecoveryRecord): readonly string[] {
  if (record.state !== 'interrupted' || record.direction !== 'upload') return [];
  return record.transport === 'sftp'
    ? [...new Set([`.mrt-${record.operationId}.partial`, ...record.remoteArtifactNames])]
    : record.remoteArtifactNames;
}

function isRecoveryRemoteArtifactName(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_REMOTE_FILE_NAME_CHARS && REMOTE_ARTIFACT_NAME.test(value);
}

function validIsoTime(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const timestamp = Date.parse(value);
  return Number.isSafeInteger(timestamp) && new Date(timestamp).toISOString() === value;
}
