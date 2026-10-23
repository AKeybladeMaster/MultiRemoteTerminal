import { failure } from '../../domain/src/errors.ts';
import type { ErrorCode, Outcome } from '../../domain/src/errors.ts';
import type { CancellationSignal } from './cancellation.ts';
import { isSessionDefinitionId, isSessionFolderId, normalizeSavedSessionDraft, normalizeSessionSearch } from '../../domain/src/session-definition.ts';
import type { SavedSessionDefinition, SavedSessionDraft } from '../../domain/src/session-definition.ts';
import { normalizeSessionFolderDraft, normalizeSessionFolderName } from '../../domain/src/session-folder.ts';
import type { SavedSessionFolder, SavedSessionFolderDraft } from '../../domain/src/session-folder.ts';
import { StorageOperationError } from './storage-errors.ts';

export interface SessionCatalogStore {
  listSessions(query: string, cancellation?: CancellationSignal): Promise<readonly SavedSessionDefinition[]>;
  createSession(draft: SavedSessionDraft, cancellation?: CancellationSignal): Promise<SavedSessionDefinition>;
  setFavorite(id: string, favorite: boolean, cancellation?: CancellationSignal): Promise<boolean>;
  removeSession(id: string, cancellation?: CancellationSignal): Promise<boolean>;
  listFolders(cancellation?: CancellationSignal): Promise<readonly SavedSessionFolder[]>;
  createFolder(draft: SavedSessionFolderDraft, cancellation?: CancellationSignal): Promise<SavedSessionFolder>;
  renameFolder(id: string, name: string, cancellation?: CancellationSignal): Promise<boolean>;
  moveFolder(id: string, parentId: string | null, cancellation?: CancellationSignal): Promise<boolean>;
  removeFolder(id: string, cancellation?: CancellationSignal): Promise<boolean>;
  moveSession(id: string, folderId: string | null, cancellation?: CancellationSignal): Promise<boolean>;
}

export interface SessionCatalog {
  list(query: unknown, cancellation?: CancellationSignal): Promise<Outcome<readonly SavedSessionDefinition[]>>;
  create(draft: unknown, cancellation?: CancellationSignal): Promise<Outcome<SavedSessionDefinition>>;
  setFavorite(id: unknown, favorite: unknown, cancellation?: CancellationSignal): Promise<Outcome<Record<string, never>>>;
  remove(id: unknown, cancellation?: CancellationSignal): Promise<Outcome<Record<string, never>>>;
  listFolders(cancellation?: CancellationSignal): Promise<Outcome<readonly SavedSessionFolder[]>>;
  createFolder(draft: unknown, cancellation?: CancellationSignal): Promise<Outcome<SavedSessionFolder>>;
  renameFolder(id: unknown, name: unknown, cancellation?: CancellationSignal): Promise<Outcome<Record<string, never>>>;
  moveFolder(id: unknown, parentId: unknown, cancellation?: CancellationSignal): Promise<Outcome<Record<string, never>>>;
  removeFolder(id: unknown, cancellation?: CancellationSignal): Promise<Outcome<Record<string, never>>>;
  moveSession(id: unknown, folderId: unknown, cancellation?: CancellationSignal): Promise<Outcome<Record<string, never>>>;
}

const EMPTY_RESULT: Record<string, never> = Object.freeze({});

export function createSessionCatalog(store: SessionCatalogStore): SessionCatalog {
  return {
    async list(query: unknown, cancellation?: CancellationSignal): Promise<Outcome<readonly SavedSessionDefinition[]>> {
      const normalized = normalizeSessionSearch(query);
      if (normalized === undefined) return failure('INVALID_REQUEST');
      if (cancellation?.aborted) return failure('CANCELLED');
      try {
        const result = await store.listSessions(normalized, cancellation);
        return { ok: true, result };
      }
      catch (error) { return failure(errorCode(error)); }
    },
    async create(input: unknown, cancellation?: CancellationSignal): Promise<Outcome<SavedSessionDefinition>> {
      const draft = normalizeSavedSessionDraft(input);
      if (!draft) return failure('INVALID_REQUEST');
      if (cancellation?.aborted) return failure('CANCELLED');
      try {
        const result = await store.createSession(draft, cancellation);
        return { ok: true, result };
      }
      catch (error) { return failure(errorCode(error)); }
    },
    async setFavorite(id: unknown, favorite: unknown, cancellation?: CancellationSignal): Promise<Outcome<Record<string, never>>> {
      if (!isSessionDefinitionId(id) || typeof favorite !== 'boolean') return failure('INVALID_REQUEST');
      if (cancellation?.aborted) return failure('CANCELLED');
      try {
        const changed = await store.setFavorite(id, favorite, cancellation);
        return changed ? { ok: true, result: EMPTY_RESULT } : failure('NOT_FOUND');
      }
      catch (error) { return failure(errorCode(error)); }
    },
    async remove(id: unknown, cancellation?: CancellationSignal): Promise<Outcome<Record<string, never>>> {
      if (!isSessionDefinitionId(id)) return failure('INVALID_REQUEST');
      if (cancellation?.aborted) return failure('CANCELLED');
      try {
        const removed = await store.removeSession(id, cancellation);
        return removed ? { ok: true, result: EMPTY_RESULT } : failure('NOT_FOUND');
      }
      catch (error) { return failure(errorCode(error)); }
    },
    async listFolders(cancellation?: CancellationSignal): Promise<Outcome<readonly SavedSessionFolder[]>> {
      if (cancellation?.aborted) return failure('CANCELLED');
      try { return { ok: true, result: await store.listFolders(cancellation) }; }
      catch (error) { return failure(errorCode(error)); }
    },
    async createFolder(input: unknown, cancellation?: CancellationSignal): Promise<Outcome<SavedSessionFolder>> {
      const draft = normalizeSessionFolderDraft(input);
      if (!draft) return failure('INVALID_REQUEST');
      if (cancellation?.aborted) return failure('CANCELLED');
      try { return { ok: true, result: await store.createFolder(draft, cancellation) }; }
      catch (error) { return failure(errorCode(error)); }
    },
    async renameFolder(id: unknown, name: unknown, cancellation?: CancellationSignal): Promise<Outcome<Record<string, never>>> {
      const normalizedName = normalizeSessionFolderName(name);
      if (!isSessionFolderId(id) || !normalizedName) return failure('INVALID_REQUEST');
      if (cancellation?.aborted) return failure('CANCELLED');
      try { return await store.renameFolder(id, normalizedName, cancellation) ? { ok: true, result: EMPTY_RESULT } : failure('NOT_FOUND'); }
      catch (error) { return failure(errorCode(error)); }
    },
    async moveFolder(id: unknown, parentId: unknown, cancellation?: CancellationSignal): Promise<Outcome<Record<string, never>>> {
      if (!isSessionFolderId(id) || !(parentId === null || isSessionFolderId(parentId))) return failure('INVALID_REQUEST');
      if (cancellation?.aborted) return failure('CANCELLED');
      try { return await store.moveFolder(id, parentId, cancellation) ? { ok: true, result: EMPTY_RESULT } : failure('NOT_FOUND'); }
      catch (error) { return failure(errorCode(error)); }
    },
    async removeFolder(id: unknown, cancellation?: CancellationSignal): Promise<Outcome<Record<string, never>>> {
      if (!isSessionFolderId(id)) return failure('INVALID_REQUEST');
      if (cancellation?.aborted) return failure('CANCELLED');
      try { return await store.removeFolder(id, cancellation) ? { ok: true, result: EMPTY_RESULT } : failure('NOT_FOUND'); }
      catch (error) { return failure(errorCode(error)); }
    },
    async moveSession(id: unknown, folderId: unknown, cancellation?: CancellationSignal): Promise<Outcome<Record<string, never>>> {
      if (!isSessionDefinitionId(id) || !(folderId === null || isSessionFolderId(folderId))) return failure('INVALID_REQUEST');
      if (cancellation?.aborted) return failure('CANCELLED');
      try { return await store.moveSession(id, folderId, cancellation) ? { ok: true, result: EMPTY_RESULT } : failure('NOT_FOUND'); }
      catch (error) { return failure(errorCode(error)); }
    }
  };
}

function errorCode(error: unknown): ErrorCode {
  if (error instanceof StorageOperationError) {
    if (error.kind === 'busy') return 'BUSY';
    if (error.kind === 'cancelled') return 'CANCELLED';
    if (error.kind === 'conflict') return 'CONFLICT';
    if (error.kind === 'not-found') return 'NOT_FOUND';
  }
  return 'UNAVAILABLE';
}
