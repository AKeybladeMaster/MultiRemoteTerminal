import { randomUUID } from 'node:crypto';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { StorageOperationError } from '../../../../packages/application/src/storage-errors.ts';
import type { SessionCatalogStore } from '../../../../packages/application/src/session-catalog.ts';
import { isSessionDefinitionId, isSessionFolderId, normalizeSavedSessionDraft } from '../../../../packages/domain/src/session-definition.ts';
import type { SavedSessionDefinition, SavedSessionDraft } from '../../../../packages/domain/src/session-definition.ts';
import { normalizeSessionFolderDraft, normalizeSessionFolderName } from '../../../../packages/domain/src/session-folder.ts';
import type { SavedSessionFolder, SavedSessionFolderDraft } from '../../../../packages/domain/src/session-folder.ts';
import { isLocalShell } from '../../../../packages/domain/src/local-terminal.ts';
import { canonicalizeSshHostEndpoint } from '../../../../packages/domain/src/host-trust.ts';

interface SavedSessionRow {
  readonly id: unknown;
  readonly folder_id: unknown;
  readonly kind: unknown;
  readonly name: unknown;
  readonly host: unknown;
  readonly port: unknown;
  readonly options_json: unknown;
  readonly favorite: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
}

interface SessionFolderRow {
  readonly id: unknown;
  readonly parent_id: unknown;
  readonly name: unknown;
}

export class SqliteSessionCatalogRepository implements SessionCatalogStore {
  private readonly database: DatabaseSync;
  private readonly listByQuery: StatementSync;
  private readonly insertSession: StatementSync;
  private readonly setSessionFavorite: StatementSync;
  private readonly deleteSession: StatementSync;
  private readonly listFoldersStatement: StatementSync;
  private readonly findFolder: StatementSync;
  private readonly findFolderName: StatementSync;
  private readonly insertFolder: StatementSync;
  private readonly renameFolderStatement: StatementSync;
  private readonly updateFolderParent: StatementSync;
  private readonly deleteFolderStatement: StatementSync;
  private readonly updateSessionFolder: StatementSync;
  private readonly isFolderDescendant: StatementSync;

  constructor(database: DatabaseSync) {
    this.database = database;
    this.listByQuery = database.prepare(`
      SELECT id, folder_id, kind, name, host, port, options_json, favorite, created_at, updated_at
      FROM session_definitions
      WHERE kind IN ('local', 'ssh') AND (? = '' OR name LIKE ? ESCAPE '\\' COLLATE NOCASE OR host LIKE ? ESCAPE '\\' COLLATE NOCASE)
      ORDER BY favorite DESC, updated_at DESC, id ASC
    `);
    this.insertSession = database.prepare(`
      INSERT INTO session_definitions (id, kind, name, host, port, options_json, options_version, favorite, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
    `);
    this.setSessionFavorite = database.prepare('UPDATE session_definitions SET favorite = ?, updated_at = ? WHERE id = ? AND kind IN (\'local\', \'ssh\')');
    this.deleteSession = database.prepare('DELETE FROM session_definitions WHERE id = ? AND kind IN (\'local\', \'ssh\')');
    this.listFoldersStatement = database.prepare('SELECT id, parent_id, name FROM folders ORDER BY parent_id, name COLLATE NOCASE, id');
    this.findFolder = database.prepare('SELECT id, parent_id, name FROM folders WHERE id = ?');
    this.findFolderName = database.prepare(`
      SELECT id FROM folders WHERE parent_id IS ? AND name = ? COLLATE NOCASE AND (? IS NULL OR id <> ?) LIMIT 1
    `);
    this.insertFolder = database.prepare('INSERT INTO folders (id, parent_id, name, sort_order) VALUES (?, ?, ?, 0)');
    this.renameFolderStatement = database.prepare('UPDATE folders SET name = ? WHERE id = ?');
    this.updateFolderParent = database.prepare('UPDATE folders SET parent_id = ? WHERE id = ?');
    this.deleteFolderStatement = database.prepare('DELETE FROM folders WHERE id = ?');
    this.updateSessionFolder = database.prepare(`
      UPDATE session_definitions SET folder_id = ?, updated_at = ? WHERE folder_id = ?
    `);
    this.isFolderDescendant = database.prepare(`
      WITH RECURSIVE descendants(id) AS (
        SELECT id FROM folders WHERE id = ?
        UNION ALL SELECT child.id FROM folders child JOIN descendants parent ON child.parent_id = parent.id
      ) SELECT 1 AS found FROM descendants WHERE id = ? LIMIT 1
    `);
  }

  async listSessions(query: string): Promise<readonly SavedSessionDefinition[]> {
    try {
      if (typeof query !== 'string' || query.length > 256) throw new StorageOperationError('unavailable');
      const pattern = `%${escapeLike(query)}%`;
      const rows = this.listByQuery.all(query, pattern, pattern) as unknown as SavedSessionRow[];
      return rows.map(decodeSessionRow);
    } catch (error) { throw mapStorageError(error); }
  }

  async createSession(input: SavedSessionDraft): Promise<SavedSessionDefinition> {
    try {
      const draft = normalizeSavedSessionDraft(input);
      if (!draft) throw new StorageOperationError('unavailable');
      const id = randomUUID();
      const timestamp = new Date().toISOString();
      const local = draft.kind === 'local';
      const options = local ? JSON.stringify({ shell: draft.shell }) : '{}';
      this.insertSession.run(id, draft.kind, draft.name, local ? null : draft.host, local ? null : draft.port, options, timestamp, timestamp);
      return local
        ? { id, folderId: null, kind: 'local', name: draft.name, shell: draft.shell, favorite: false, createdAt: timestamp, updatedAt: timestamp }
        : { id, folderId: null, kind: 'ssh', name: draft.name, host: draft.host, port: draft.port, favorite: false, createdAt: timestamp, updatedAt: timestamp };
    } catch (error) { throw mapStorageError(error); }
  }

  async setFavorite(id: string, favorite: boolean): Promise<boolean> {
    try {
      if (!isSessionDefinitionId(id) || typeof favorite !== 'boolean') throw new StorageOperationError('unavailable');
      return Number(this.setSessionFavorite.run(favorite ? 1 : 0, new Date().toISOString(), id).changes) > 0;
    } catch (error) { throw mapStorageError(error); }
  }

  async removeSession(id: string): Promise<boolean> {
    try {
      if (!isSessionDefinitionId(id)) throw new StorageOperationError('unavailable');
      return Number(this.deleteSession.run(id).changes) > 0;
    } catch (error) { throw mapStorageError(error); }
  }

  async listFolders(): Promise<readonly SavedSessionFolder[]> {
    try {
      const rows = this.listFoldersStatement.all() as unknown as SessionFolderRow[];
      return rows.map(decodeFolderRow);
    } catch (error) { throw mapStorageError(error); }
  }

  async createFolder(input: SavedSessionFolderDraft): Promise<SavedSessionFolder> {
    try {
      const draft = normalizeSessionFolderDraft(input);
      if (!draft) throw new StorageOperationError('unavailable');
      this.requireFolder(draft.parentId);
      this.requireUniqueFolderName(draft.parentId, draft.name, null);
      const folder = { id: randomUUID(), parentId: draft.parentId, name: draft.name };
      this.insertFolder.run(folder.id, folder.parentId, folder.name);
      return folder;
    } catch (error) { throw mapStorageError(error); }
  }

  async renameFolder(id: string, inputName: string): Promise<boolean> {
    try {
      if (!isSessionFolderId(id)) throw new StorageOperationError('unavailable');
      const name = normalizeSessionFolderName(inputName);
      if (!name) throw new StorageOperationError('unavailable');
      const folder = this.getFolder(id);
      if (!folder) return false;
      this.requireUniqueFolderName(folder.parentId, name, id);
      this.renameFolderStatement.run(name, id);
      return true;
    } catch (error) { throw mapStorageError(error); }
  }

  async moveFolder(id: string, parentId: string | null): Promise<boolean> {
    try {
      if (!isSessionFolderId(id) || !(parentId === null || isSessionFolderId(parentId))) throw new StorageOperationError('unavailable');
      const folder = this.getFolder(id);
      if (!folder) return false;
      this.requireFolder(parentId);
      if (parentId !== null && (id === parentId || this.isFolderDescendant.get(id, parentId))) {
        throw new StorageOperationError('conflict');
      }
      if (folder.parentId === parentId) return true;
      this.requireUniqueFolderName(parentId, folder.name, id);
      this.updateFolderParent.run(parentId, id);
      return true;
    } catch (error) { throw mapStorageError(error); }
  }

  async removeFolder(id: string): Promise<boolean> {
    try {
      if (!isSessionFolderId(id)) throw new StorageOperationError('unavailable');
      const folder = this.getFolder(id);
      if (!folder) return false;
      this.inTransaction(() => {
        this.updateSessionFolder.run(folder.parentId, new Date().toISOString(), id);
        const children = this.database.prepare('SELECT id, name FROM folders WHERE parent_id = ? ORDER BY name COLLATE NOCASE, id').all(id) as unknown as SessionFolderRow[];
        for (const child of children) {
          if (!isSessionFolderId(child.id) || typeof child.name !== 'string') throw new StorageOperationError('corrupt');
          this.requireUniqueFolderName(folder.parentId, child.name, child.id);
          this.updateFolderParent.run(folder.parentId, child.id);
        }
        this.deleteFolderStatement.run(id);
      });
      return true;
    } catch (error) { throw mapStorageError(error); }
  }

  async moveSession(id: string, folderId: string | null): Promise<boolean> {
    try {
      if (!isSessionDefinitionId(id) || !(folderId === null || isSessionFolderId(folderId))) throw new StorageOperationError('unavailable');
      this.requireFolder(folderId);
      const current = this.database.prepare('SELECT folder_id FROM session_definitions WHERE id = ?').get(id) as { readonly folder_id: unknown } | undefined;
      if (!current) return false;
      if (current.folder_id === folderId) return true;
      const changed = this.database.prepare(`
        UPDATE session_definitions SET folder_id = ?, updated_at = ? WHERE id = ?
      `).run(folderId, new Date().toISOString(), id);
      return Number(changed.changes) > 0;
    } catch (error) { throw mapStorageError(error); }
  }

  private getFolder(id: string): SavedSessionFolder | undefined {
    const row = this.findFolder.get(id) as unknown as SessionFolderRow | undefined;
    return row ? decodeFolderRow(row) : undefined;
  }

  private requireFolder(id: string | null): void {
    if (id !== null && !this.getFolder(id)) throw new StorageOperationError('not-found');
  }

  private requireUniqueFolderName(parentId: string | null, name: string, exceptId: string | null): void {
    const duplicate = this.findFolderName.get(parentId, name, exceptId, exceptId);
    if (duplicate) throw new StorageOperationError('conflict');
  }

  private inTransaction<T>(work: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      try { this.database.exec('ROLLBACK'); } catch { /* Preserve the transaction's original error. */ }
      throw error;
    }
  }
}

function decodeFolderRow(row: SessionFolderRow): SavedSessionFolder {
  if (!row || !isSessionFolderId(row.id) || !(row.parent_id === null || isSessionFolderId(row.parent_id)) ||
      typeof row.name !== 'string' || normalizeSessionFolderName(row.name) !== row.name) throw new StorageOperationError('corrupt');
  return { id: row.id as string, parentId: row.parent_id as string | null, name: row.name };
}

function decodeSessionRow(row: SavedSessionRow): SavedSessionDefinition {
  if (!row || !isSessionDefinitionId(row.id) || !(row.folder_id === null || isSessionFolderId(row.folder_id)) || typeof row.name !== 'string' || row.name.length < 1 || row.name.length > 256 ||
      typeof row.favorite !== 'number' || (row.favorite !== 0 && row.favorite !== 1) || !isTimestamp(row.created_at) || !isTimestamp(row.updated_at) || typeof row.options_json !== 'string') {
    throw new StorageOperationError('corrupt');
  }
  let options: unknown;
  try { options = JSON.parse(row.options_json); }
  catch { throw new StorageOperationError('corrupt'); }
  if (!isRecord(options)) throw new StorageOperationError('corrupt');

  if (row.kind === 'local') {
    const shell = options.shell;
    if (row.host !== null || row.port !== null || !exactKeys(options, ['shell']) || !isLocalShell(shell)) throw new StorageOperationError('corrupt');
    return { id: row.id as string, folderId: row.folder_id as string | null, kind: 'local', name: row.name, shell, favorite: row.favorite === 1,
      createdAt: row.created_at, updatedAt: row.updated_at };
  }
  if (row.kind === 'ssh') {
    const endpoint = canonicalizeSshHostEndpoint({ host: row.host, port: row.port });
    if (!endpoint || endpoint.host !== row.host || endpoint.port !== row.port || !exactKeys(options, [])) throw new StorageOperationError('corrupt');
    return { id: row.id as string, folderId: row.folder_id as string | null, kind: 'ssh', name: row.name, host: endpoint.host, port: endpoint.port, favorite: row.favorite === 1,
      createdAt: row.created_at, updatedAt: row.updated_at };
  }
  throw new StorageOperationError('corrupt');
}

function mapStorageError(error: unknown): StorageOperationError {
  if (error instanceof StorageOperationError) return error;
  const sqliteCode = isRecord(error) && typeof error.errcode === 'number' ? error.errcode & 0xff : undefined;
  const message = error instanceof Error ? error.message : '';
  if (/UNIQUE constraint failed|PRIMARY KEY constraint failed/i.test(message)) return new StorageOperationError('conflict');
  if (/FOREIGN KEY constraint failed/i.test(message)) return new StorageOperationError('not-found');
  if (sqliteCode === 5 || sqliteCode === 6 || /SQLITE_(?:BUSY|LOCKED)|database is (?:locked|busy)/i.test(message)) return new StorageOperationError('busy');
  if (sqliteCode === 11 || sqliteCode === 26 || /SQLITE_(?:CORRUPT|NOTADB)|database disk image is malformed|not a database/i.test(message)) return new StorageOperationError('corrupt');
  return new StorageOperationError('unavailable');
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const time = Date.parse(value);
  return Number.isSafeInteger(time) && new Date(time).toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
