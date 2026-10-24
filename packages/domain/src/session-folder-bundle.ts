import { isSavedSessionDefinition, isSessionFolderId } from './session-definition.ts';
import type { SavedSessionDefinition } from './session-definition.ts';
import { isSavedSessionFolder } from './session-folder.ts';
import type { SavedSessionFolder } from './session-folder.ts';

export const SESSION_FOLDER_BUNDLE_FORMAT = 'multiremote-terminal/session-folder';
export const SESSION_FOLDER_BUNDLE_VERSION = 3;
const LEGACY_SESSION_FOLDER_BUNDLE_VERSION = 1;
const SESSION_FOLDER_BUNDLE_VERSION_WITH_FTP = 2;
export const MAX_SESSION_FOLDER_BUNDLE_RECORDS = 100_000;
export const MAX_SESSION_FOLDER_BUNDLE_BYTES = 16 * 1024 * 1024;

export interface SessionFolderBundle {
  readonly format: typeof SESSION_FOLDER_BUNDLE_FORMAT;
  readonly version: typeof SESSION_FOLDER_BUNDLE_VERSION;
  readonly rootFolderId: string;
  readonly exportedAt: string;
  readonly folders: readonly SavedSessionFolder[];
  readonly sessions: readonly SavedSessionDefinition[];
}

export interface SessionFolderExportResult {
  readonly folderCount: number;
  readonly sessionCount: number;
}

export interface SessionFolderImportResult extends SessionFolderExportResult {
  readonly createdFolderCount: number;
  readonly createdSessionCount: number;
}

export function createSessionFolderBundle(input: {
  readonly rootFolderId: string;
  readonly folders: readonly SavedSessionFolder[];
  readonly sessions: readonly SavedSessionDefinition[];
  readonly exportedAt: string;
}): SessionFolderBundle | undefined {
  return normalizeSessionFolderBundle({ format: SESSION_FOLDER_BUNDLE_FORMAT, version: SESSION_FOLDER_BUNDLE_VERSION, ...input });
}

export function normalizeSessionFolderBundle(value: unknown): SessionFolderBundle | undefined {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['format', 'version', 'rootFolderId', 'exportedAt', 'folders', 'sessions']) ||
      value.format !== SESSION_FOLDER_BUNDLE_FORMAT || (value.version !== LEGACY_SESSION_FOLDER_BUNDLE_VERSION &&
        value.version !== SESSION_FOLDER_BUNDLE_VERSION_WITH_FTP && value.version !== SESSION_FOLDER_BUNDLE_VERSION) || !isSessionFolderId(value.rootFolderId) ||
      !isIsoTimestamp(value.exportedAt) || !Array.isArray(value.folders) || !Array.isArray(value.sessions) ||
      value.folders.length < 1 || value.folders.length + value.sessions.length > MAX_SESSION_FOLDER_BUNDLE_RECORDS ||
      !value.folders.every(isSavedSessionFolder) ||
      !value.sessions.every(value.version === LEGACY_SESSION_FOLDER_BUNDLE_VERSION
        ? isLegacySavedSessionDefinition
        : value.version === SESSION_FOLDER_BUNDLE_VERSION_WITH_FTP ? isPreSftpSavedSessionDefinition : isSavedSessionDefinition)) return undefined;

  const folders = value.folders as SavedSessionFolder[];
  const sessions = value.sessions as SavedSessionDefinition[];
  const folderById = new Map<string, SavedSessionFolder>();
  const siblingNames = new Set<string>();
  let rootCount = 0;
  for (const folder of folders) {
    if (folderById.has(folder.id)) return undefined;
    folderById.set(folder.id, folder);
    if (folder.parentId === null) {
      rootCount += 1;
      if (folder.id !== value.rootFolderId) return undefined;
    } else if (!isSessionFolderId(folder.parentId)) return undefined;
    const siblingKey = `${folder.parentId ?? ''}\u0000${sqliteNoCase(folder.name)}`;
    if (siblingNames.has(siblingKey)) return undefined;
    siblingNames.add(siblingKey);
  }
  if (rootCount !== 1 || !folderById.has(value.rootFolderId)) return undefined;
  for (const folder of folders) if (folder.parentId !== null && !folderById.has(folder.parentId)) return undefined;

  const childIds = new Map<string, string[]>();
  for (const folder of folders) {
    if (folder.parentId === null) continue;
    const children = childIds.get(folder.parentId) ?? [];
    children.push(folder.id);
    childIds.set(folder.parentId, children);
  }
  const reachable = new Set<string>();
  const pending = [value.rootFolderId];
  while (pending.length > 0) {
    const id = pending.pop();
    if (!id || reachable.has(id)) continue;
    reachable.add(id);
    for (const childId of childIds.get(id) ?? []) pending.push(childId);
  }
  if (reachable.size !== folders.length) return undefined;
  if (new Set(sessions.map(session => session.id)).size !== sessions.length ||
      sessions.some(session => session.folderId === null || !folderById.has(session.folderId))) return undefined;

  return {
    format: SESSION_FOLDER_BUNDLE_FORMAT,
    version: SESSION_FOLDER_BUNDLE_VERSION,
    rootFolderId: value.rootFolderId,
    exportedAt: value.exportedAt,
    folders,
    sessions
  };
}

function isLegacySavedSessionDefinition(value: unknown): value is SavedSessionDefinition {
  return isSavedSessionDefinition(value) && value.kind !== 'ftp' && value.kind !== 'sftp';
}

function isPreSftpSavedSessionDefinition(value: unknown): value is SavedSessionDefinition {
  return isSavedSessionDefinition(value) && value.kind !== 'sftp';
}

export function isSessionFolderBundle(value: unknown): value is SessionFolderBundle {
  return isPlainRecord(value) && value.version === SESSION_FOLDER_BUNDLE_VERSION && normalizeSessionFolderBundle(value) !== undefined;
}

// SQLite's built-in NOCASE collation folds ASCII letters only. Keep bundle validation
// aligned with the catalog so accepted Unicode sibling names still round-trip.
function sqliteNoCase(value: string): string {
  return value.replace(/[A-Z]/g, character => String.fromCharCode(character.charCodeAt(0) + 32));
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isSafeInteger(parsed) && new Date(parsed).toISOString() === value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
