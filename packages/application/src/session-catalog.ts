import { failure } from '../../domain/src/errors.ts';
import type { ErrorCode, Outcome } from '../../domain/src/errors.ts';
import type { CancellationSignal } from './cancellation.ts';
import { isSessionDefinitionId, isSessionFolderId, normalizeSavedSessionDraft, normalizeSessionSearch } from '../../domain/src/session-definition.ts';
import type { SavedSessionDefinition, SavedSessionDraft } from '../../domain/src/session-definition.ts';
import { normalizeSessionFolderDraft, normalizeSessionFolderName } from '../../domain/src/session-folder.ts';
import type { SavedSessionFolder, SavedSessionFolderDraft } from '../../domain/src/session-folder.ts';
import type { SessionFolderExportResult, SessionFolderImportResult } from '../../domain/src/session-folder-bundle.ts';
import { StorageOperationError } from './storage-errors.ts';

export interface SessionCatalogStore {
  listSessions(query: string, cancellation?: CancellationSignal): Promise<readonly SavedSessionDefinition[]>;
  getSessionDefinition(id: string, cancellation?: CancellationSignal): Promise<SavedSessionDefinition | undefined>;
  createSession(draft: SavedSessionDraft, cancellation?: CancellationSignal): Promise<SavedSessionDefinition>;
  rememberSession(draft: SavedSessionDraft, cancellation?: CancellationSignal): Promise<SavedSessionDefinition>;
  setFavorite(id: string, favorite: boolean, cancellation?: CancellationSignal): Promise<boolean>;
  removeSession(id: string, cancellation?: CancellationSignal): Promise<boolean>;
  listFolders(cancellation?: CancellationSignal): Promise<readonly SavedSessionFolder[]>;
  createFolder(draft: SavedSessionFolderDraft, cancellation?: CancellationSignal): Promise<SavedSessionFolder>;
  renameFolder(id: string, name: string, cancellation?: CancellationSignal): Promise<boolean>;
  moveFolder(id: string, parentId: string | null, cancellation?: CancellationSignal): Promise<boolean>;
  removeFolder(id: string, cancellation?: CancellationSignal): Promise<boolean>;
  moveSession(id: string, folderId: string | null, cancellation?: CancellationSignal): Promise<boolean>;
  exportFolderToFile(folderId: string, path: string, cancellation?: CancellationSignal): Promise<SessionFolderExportResult>;
  importFolderFromFile(path: string, cancellation?: CancellationSignal): Promise<SessionFolderImportResult>;
}

export interface SessionFolderBundleFileDialog {
  /**
   * Opens a user-controlled native picker. It settles when the user selects a path or
   * dismisses the picker; platform file dialogs have no app-controlled deadline or
   * abort signal. If the caller is cancelled while it is open, implementations must
   * discard any selected path before starting storage work.
   */
  selectExportPath(folderName: string): Promise<string | undefined>;
  selectImportPath(): Promise<string | undefined>;
}

export interface SessionCatalog {
  list(query: unknown, cancellation?: CancellationSignal): Promise<Outcome<readonly SavedSessionDefinition[]>>;
  get(id: unknown, cancellation?: CancellationSignal): Promise<Outcome<SavedSessionDefinition>>;
  create(draft: unknown, cancellation?: CancellationSignal): Promise<Outcome<SavedSessionDefinition>>;
  remember(draft: unknown, cancellation?: CancellationSignal): Promise<Outcome<SavedSessionDefinition>>;
  setFavorite(id: unknown, favorite: unknown, cancellation?: CancellationSignal): Promise<Outcome<Record<string, never>>>;
  remove(id: unknown, cancellation?: CancellationSignal): Promise<Outcome<Record<string, never>>>;
  listFolders(cancellation?: CancellationSignal): Promise<Outcome<readonly SavedSessionFolder[]>>;
  createFolder(draft: unknown, cancellation?: CancellationSignal): Promise<Outcome<SavedSessionFolder>>;
  renameFolder(id: unknown, name: unknown, cancellation?: CancellationSignal): Promise<Outcome<Record<string, never>>>;
  moveFolder(id: unknown, parentId: unknown, cancellation?: CancellationSignal): Promise<Outcome<Record<string, never>>>;
  removeFolder(id: unknown, cancellation?: CancellationSignal): Promise<Outcome<Record<string, never>>>;
  moveSession(id: unknown, folderId: unknown, cancellation?: CancellationSignal): Promise<Outcome<Record<string, never>>>;
  exportFolder(id: unknown, cancellation?: CancellationSignal): Promise<Outcome<SessionFolderExportResult>>;
  importFolder(cancellation?: CancellationSignal): Promise<Outcome<SessionFolderImportResult>>;
}

export interface SessionRemovalGuard {
  beginSessionRemoval(sessionId: string): boolean;
  endSessionRemoval(sessionId: string): void;
}

const EMPTY_RESULT: Record<string, never> = Object.freeze({});

export function createSessionCatalog(store: SessionCatalogStore, bundleDialog: SessionFolderBundleFileDialog,
  removalGuard?: SessionRemovalGuard): SessionCatalog {
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
    async get(id: unknown, cancellation?: CancellationSignal): Promise<Outcome<SavedSessionDefinition>> {
      if (!isSessionDefinitionId(id)) return failure('INVALID_REQUEST');
      if (cancellation?.aborted) return failure('CANCELLED');
      try {
        const session = await store.getSessionDefinition(id, cancellation);
        return session ? { ok: true, result: session } : failure('NOT_FOUND');
      } catch (error) { return failure(errorCode(error)); }
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
    async remember(input: unknown, cancellation?: CancellationSignal): Promise<Outcome<SavedSessionDefinition>> {
      const draft = normalizeSavedSessionDraft(input);
      if (!draft) return failure('INVALID_REQUEST');
      if (cancellation?.aborted) return failure('CANCELLED');
      try { return { ok: true, result: await store.rememberSession(draft, cancellation) }; }
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
      if (removalGuard && !removalGuard.beginSessionRemoval(id)) return failure('BUSY');
      try {
        const removed = await store.removeSession(id, cancellation);
        return removed ? { ok: true, result: EMPTY_RESULT } : failure('NOT_FOUND');
      }
      catch (error) { return failure(errorCode(error)); }
      finally { removalGuard?.endSessionRemoval(id); }
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
    },
    async exportFolder(id: unknown, cancellation?: CancellationSignal): Promise<Outcome<SessionFolderExportResult>> {
      if (!isSessionFolderId(id)) return failure('INVALID_REQUEST');
      if (cancellation?.aborted) return failure('CANCELLED');
      try {
        const folders = await store.listFolders(cancellation);
        const folder = folders.find(item => item.id === id);
        if (!folder) return failure('NOT_FOUND');
        const path = await bundleDialog.selectExportPath(folder.name);
        if (cancellation?.aborted) return failure('CANCELLED');
        if (path === undefined) return failure('CANCELLED');
        if (!isFilePath(path)) return failure('INVALID_REQUEST');
        return { ok: true, result: await store.exportFolderToFile(id, path, cancellation) };
      } catch (error) { return failure(errorCode(error)); }
    },
    async importFolder(cancellation?: CancellationSignal): Promise<Outcome<SessionFolderImportResult>> {
      if (cancellation?.aborted) return failure('CANCELLED');
      try {
        const path = await bundleDialog.selectImportPath();
        if (cancellation?.aborted) return failure('CANCELLED');
        if (path === undefined) return failure('CANCELLED');
        if (!isFilePath(path)) return failure('INVALID_REQUEST');
        return { ok: true, result: await store.importFolderFromFile(path, cancellation) };
      } catch (error) { return failure(errorCode(error)); }
    }
  };
}

function isFilePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 32_767;
}

function errorCode(error: unknown): ErrorCode {
  if (error instanceof StorageOperationError) {
    if (error.kind === 'busy') return 'BUSY';
    if (error.kind === 'invalid') return 'INVALID_REQUEST';
    if (error.kind === 'cancelled') return 'CANCELLED';
    if (error.kind === 'conflict') return 'CONFLICT';
    if (error.kind === 'not-found') return 'NOT_FOUND';
  }
  return 'UNAVAILABLE';
}
