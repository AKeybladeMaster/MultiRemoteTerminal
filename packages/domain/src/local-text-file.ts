import { isRemoteTextRevision, remoteTextByteLength, MAX_REMOTE_TEXT_FILE_BYTES } from './remote-text-file.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface LocalTextFile {
  readonly selectionId: string;
  readonly fileName: string;
  readonly content: string;
  readonly revision: string;
  readonly bytes: number;
}

export interface LocalTextFileSaveResult {
  readonly revision: string;
  readonly bytesSaved: number;
}

export function isLocalTextFile(value: unknown): value is LocalTextFile {
  if (!isRecord(value) || Object.keys(value).length !== 5 || !Object.hasOwn(value, 'selectionId') ||
      !Object.hasOwn(value, 'fileName') || !Object.hasOwn(value, 'content') || !Object.hasOwn(value, 'revision') || !Object.hasOwn(value, 'bytes')) return false;
  const file = value as Record<string, unknown>;
  if (typeof file.selectionId !== 'string' || !UUID.test(file.selectionId) || typeof file.fileName !== 'string' ||
      file.fileName.length === 0 || file.fileName.length > 255 || /[\\/\0\r\n]/u.test(file.fileName) ||
      typeof file.content !== 'string' || !isRemoteTextRevision(file.revision)) return false;
  const bytes = remoteTextByteLength(file.content);
  return bytes !== undefined && file.bytes === bytes;
}

export function isLocalTextFileSaveResult(value: unknown): value is LocalTextFileSaveResult {
  if (!isRecord(value) || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'revision') || !Object.hasOwn(value, 'bytesSaved')) return false;
  const result = value as Record<string, unknown>;
  return isRemoteTextRevision(result.revision) && Number.isSafeInteger(result.bytesSaved) &&
    (result.bytesSaved as number) >= 0 && (result.bytesSaved as number) <= MAX_REMOTE_TEXT_FILE_BYTES;
}

export function isLocalTextSelectionId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
