import { isSessionFolderId } from './session-definition.ts';

export interface SavedSessionFolder {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
}

export interface SavedSessionFolderDraft {
  readonly parentId: string | null;
  readonly name: string;
}

export function normalizeSessionFolderName(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) return undefined;
  const name = value.trim();
  return name.length > 0 ? name : undefined;
}

export function normalizeSessionFolderDraft(value: unknown): SavedSessionFolderDraft | undefined {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['name', 'parentId'])) return undefined;
  const name = normalizeSessionFolderName(value.name);
  const parentId = value.parentId;
  if (!name || !(parentId === null || isSessionFolderId(parentId))) return undefined;
  return { name, parentId };
}

export function isSavedSessionFolder(value: unknown): value is SavedSessionFolder {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['id', 'parentId', 'name']) || !isSessionFolderId(value.id) ||
      !(value.parentId === null || isSessionFolderId(value.parentId)) || normalizeSessionFolderName(value.name) !== value.name) return false;
  return true;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
