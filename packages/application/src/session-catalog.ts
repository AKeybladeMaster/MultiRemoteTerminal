import { failure } from '../../domain/src/errors.ts';
import type { ErrorCode, Outcome } from '../../domain/src/errors.ts';
import type { CancellationSignal } from './cancellation.ts';
import { isSessionDefinitionId, normalizeSavedSessionDraft, normalizeSessionSearch } from '../../domain/src/session-definition.ts';
import type { SavedSessionDefinition, SavedSessionDraft } from '../../domain/src/session-definition.ts';
import { StorageOperationError } from './storage-errors.ts';

export interface SessionCatalogStore {
  listSessions(query: string, cancellation?: CancellationSignal): Promise<readonly SavedSessionDefinition[]>;
  createSession(draft: SavedSessionDraft, cancellation?: CancellationSignal): Promise<SavedSessionDefinition>;
  setFavorite(id: string, favorite: boolean, cancellation?: CancellationSignal): Promise<boolean>;
  removeSession(id: string, cancellation?: CancellationSignal): Promise<boolean>;
}

export interface SessionCatalog {
  list(query: unknown, cancellation?: CancellationSignal): Promise<Outcome<readonly SavedSessionDefinition[]>>;
  create(draft: unknown, cancellation?: CancellationSignal): Promise<Outcome<SavedSessionDefinition>>;
  setFavorite(id: unknown, favorite: unknown, cancellation?: CancellationSignal): Promise<Outcome<Record<string, never>>>;
  remove(id: unknown, cancellation?: CancellationSignal): Promise<Outcome<Record<string, never>>>;
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
