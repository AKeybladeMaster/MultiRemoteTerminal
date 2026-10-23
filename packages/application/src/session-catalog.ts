import { failure } from '../../domain/src/errors.ts';
import type { ErrorCode, Outcome } from '../../domain/src/errors.ts';
import { isSessionDefinitionId, normalizeSavedSessionDraft, normalizeSessionSearch } from '../../domain/src/session-definition.ts';
import type { SavedSessionDefinition, SavedSessionDraft } from '../../domain/src/session-definition.ts';
import { StorageOperationError } from './storage-errors.ts';

export interface SessionCatalogStore {
  listSessions(query: string): Promise<readonly SavedSessionDefinition[]>;
  createSession(draft: SavedSessionDraft): Promise<SavedSessionDefinition>;
  setFavorite(id: string, favorite: boolean): Promise<boolean>;
  removeSession(id: string): Promise<boolean>;
}

export interface SessionCatalog {
  list(query: unknown): Promise<Outcome<readonly SavedSessionDefinition[]>>;
  create(draft: unknown): Promise<Outcome<SavedSessionDefinition>>;
  setFavorite(id: unknown, favorite: unknown): Promise<Outcome<Record<string, never>>>;
  remove(id: unknown): Promise<Outcome<Record<string, never>>>;
}

const EMPTY_RESULT: Record<string, never> = Object.freeze({});

export function createSessionCatalog(store: SessionCatalogStore): SessionCatalog {
  return {
    async list(query: unknown): Promise<Outcome<readonly SavedSessionDefinition[]>> {
      const normalized = normalizeSessionSearch(query);
      if (normalized === undefined) return failure('INVALID_REQUEST');
      try { return { ok: true, result: await store.listSessions(normalized) }; }
      catch (error) { return failure(errorCode(error)); }
    },
    async create(input: unknown): Promise<Outcome<SavedSessionDefinition>> {
      const draft = normalizeSavedSessionDraft(input);
      if (!draft) return failure('INVALID_REQUEST');
      try { return { ok: true, result: await store.createSession(draft) }; }
      catch (error) { return failure(errorCode(error)); }
    },
    async setFavorite(id: unknown, favorite: unknown): Promise<Outcome<Record<string, never>>> {
      if (!isSessionDefinitionId(id) || typeof favorite !== 'boolean') return failure('INVALID_REQUEST');
      try { return await store.setFavorite(id, favorite) ? { ok: true, result: EMPTY_RESULT } : failure('NOT_FOUND'); }
      catch (error) { return failure(errorCode(error)); }
    },
    async remove(id: unknown): Promise<Outcome<Record<string, never>>> {
      if (!isSessionDefinitionId(id)) return failure('INVALID_REQUEST');
      try { return await store.removeSession(id) ? { ok: true, result: EMPTY_RESULT } : failure('NOT_FOUND'); }
      catch (error) { return failure(errorCode(error)); }
    }
  };
}

function errorCode(error: unknown): ErrorCode {
  if (error instanceof StorageOperationError) {
    if (error.kind === 'busy') return 'BUSY';
    if (error.kind === 'cancelled') return 'CANCELLED';
  }
  return 'UNAVAILABLE';
}
