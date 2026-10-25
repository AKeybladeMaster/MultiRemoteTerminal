import { isRemotePath } from './remote-files.ts';

export const MAX_REMOTE_TEXT_FILE_BYTES = 512 * 1024;
const CONTENT_REVISION = /^[0-9a-f]{64}$/;

export interface RemoteTextFile {
  readonly path: string;
  readonly content: string;
  readonly revision: string;
  readonly bytes: number;
}

export interface RemoteTextFileSaveResult {
  readonly path: string;
  readonly revision: string;
  readonly bytesSaved: number;
}

export function remoteTextByteLength(content: string): number | undefined {
  if (content.includes('\0')) return undefined;
  let bytes = 0;
  for (const character of content) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return undefined;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (bytes > MAX_REMOTE_TEXT_FILE_BYTES) return undefined;
  }
  return bytes;
}

export function isRemoteTextRevision(value: unknown): value is string {
  return typeof value === 'string' && CONTENT_REVISION.test(value);
}

export function isRemoteTextFile(value: unknown): value is RemoteTextFile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const file = value as Record<string, unknown>;
  if (Object.keys(file).length !== 4 || !Object.hasOwn(file, 'path') || !Object.hasOwn(file, 'content') ||
      !Object.hasOwn(file, 'revision') || !Object.hasOwn(file, 'bytes') || !isRemotePath(file.path) ||
      file.path === '.' || file.path === '/' || typeof file.content !== 'string' || !isRemoteTextRevision(file.revision)) return false;
  const bytes = remoteTextByteLength(file.content);
  return bytes !== undefined && file.bytes === bytes;
}

export function isRemoteTextFileSaveResult(value: unknown): value is RemoteTextFileSaveResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return Object.keys(result).length === 3 && Object.hasOwn(result, 'path') && Object.hasOwn(result, 'revision') &&
    Object.hasOwn(result, 'bytesSaved') && isRemotePath(result.path) && result.path !== '.' && result.path !== '/' &&
    isRemoteTextRevision(result.revision) && Number.isSafeInteger(result.bytesSaved) &&
    (result.bytesSaved as number) >= 0 && (result.bytesSaved as number) <= MAX_REMOTE_TEXT_FILE_BYTES;
}
