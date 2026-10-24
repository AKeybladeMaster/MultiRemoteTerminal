export const MAX_REMOTE_PATH_CHARS = 4_096;
export const MAX_REMOTE_FILE_NAME_CHARS = 1_024;
export const MAX_REMOTE_DIRECTORY_ENTRIES = 500;

export type RemoteFileKind = 'file' | 'directory' | 'symlink' | 'other';

export interface RemoteFileEntry {
  readonly name: string;
  readonly path: string;
  readonly kind: RemoteFileKind;
  readonly size: number;
  /** Unix timestamp in seconds, or null when the server did not provide it. */
  readonly modifiedAt: number | null;
}

export interface RemoteDirectoryListing {
  readonly path: string;
  readonly entries: readonly RemoteFileEntry[];
  readonly truncated: boolean;
}

export function isRemotePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_REMOTE_PATH_CHARS && !value.includes('\0');
}

export function isRemoteFileKind(value: unknown): value is RemoteFileKind {
  return value === 'file' || value === 'directory' || value === 'symlink' || value === 'other';
}

export function isRemoteFileEntry(value: unknown): value is RemoteFileEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return Object.keys(entry).length === 5 && Object.hasOwn(entry, 'name') && Object.hasOwn(entry, 'path') &&
    Object.hasOwn(entry, 'kind') && Object.hasOwn(entry, 'size') && Object.hasOwn(entry, 'modifiedAt') &&
    typeof entry.name === 'string' && entry.name.length > 0 && entry.name.length <= MAX_REMOTE_FILE_NAME_CHARS && !entry.name.includes('\0') &&
    isRemotePath(entry.path) && isRemoteFileKind(entry.kind) && Number.isSafeInteger(entry.size) && (entry.size as number) >= 0 &&
    (entry.modifiedAt === null || (Number.isSafeInteger(entry.modifiedAt) && (entry.modifiedAt as number) >= 0));
}

export function isRemoteDirectoryListing(value: unknown): value is RemoteDirectoryListing {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const listing = value as Record<string, unknown>;
  return Object.keys(listing).length === 3 && Object.hasOwn(listing, 'path') && Object.hasOwn(listing, 'entries') &&
    Object.hasOwn(listing, 'truncated') && isRemotePath(listing.path) && Array.isArray(listing.entries) &&
    listing.entries.length <= MAX_REMOTE_DIRECTORY_ENTRIES && listing.entries.every(entry => isRemoteFileEntry(entry) &&
      remoteChildPath(listing.path as string, entry.name) === entry.path) && typeof listing.truncated === 'boolean';
}

export function remoteParentPath(path: string): string {
  const trimmed = path.replace(/\/+$/u, '');
  if (!trimmed) return '/';
  const separator = trimmed.lastIndexOf('/');
  if (separator < 0) return '.';
  if (separator === 0) return '/';
  return trimmed.slice(0, separator);
}

export function remoteChildPath(parent: string, name: string): string | undefined {
  if (!isRemotePath(parent) || typeof name !== 'string' || name.length === 0 || name.length > MAX_REMOTE_FILE_NAME_CHARS ||
      name === '.' || name === '..' || name.includes('/') || name.includes('\0')) return undefined;
  if (parent === '.' || parent === '') return name;
  if (parent.endsWith('/')) return `${parent}${name}`;
  return `${parent}/${name}`;
}
