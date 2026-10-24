import { randomUUID } from 'node:crypto';
import { open, rename, rm } from 'node:fs/promises';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { StorageOperationError } from '../../../../packages/application/src/storage-errors.ts';
import type { SessionCatalogStore } from '../../../../packages/application/src/session-catalog.ts';
import { isSessionDefinitionId, isSessionFolderId, normalizeSavedSessionDraft } from '../../../../packages/domain/src/session-definition.ts';
import type { SavedSessionDefinition, SavedSessionDraft } from '../../../../packages/domain/src/session-definition.ts';
import { normalizeSessionFolderDraft, normalizeSessionFolderName } from '../../../../packages/domain/src/session-folder.ts';
import type { SavedSessionFolder, SavedSessionFolderDraft } from '../../../../packages/domain/src/session-folder.ts';
import { createSessionFolderBundle, MAX_SESSION_FOLDER_BUNDLE_BYTES, MAX_SESSION_FOLDER_BUNDLE_RECORDS, normalizeSessionFolderBundle } from '../../../../packages/domain/src/session-folder-bundle.ts';
import type { SessionFolderBundle, SessionFolderExportResult, SessionFolderImportResult } from '../../../../packages/domain/src/session-folder-bundle.ts';
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
  private readonly listSubtreeFolders: StatementSync;
  private readonly listSubtreeSessions: StatementSync;
  private readonly findSession: StatementSync;
  private readonly insertImportedSession: StatementSync;

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
        UNION SELECT child.id FROM folders child JOIN descendants parent ON child.parent_id = parent.id
      ) SELECT 1 AS found FROM descendants WHERE id = ? LIMIT 1
    `);
    this.listSubtreeFolders = database.prepare(`
      WITH RECURSIVE subtree(id) AS (
        SELECT id FROM folders WHERE id = ?
        UNION SELECT child.id FROM folders child JOIN subtree parent ON child.parent_id = parent.id
      ) SELECT folder.id, folder.parent_id, folder.name FROM folders folder JOIN subtree ON subtree.id = folder.id
      ORDER BY folder.parent_id, folder.name COLLATE NOCASE, folder.id LIMIT ?
    `);
    this.listSubtreeSessions = database.prepare(`
      WITH RECURSIVE subtree(id) AS (
        SELECT id FROM folders WHERE id = ?
        UNION SELECT child.id FROM folders child JOIN subtree parent ON child.parent_id = parent.id
      ) SELECT session.id, session.folder_id, session.kind, session.name, session.host, session.port,
        session.options_json, session.favorite, session.created_at, session.updated_at
      FROM session_definitions session JOIN subtree ON subtree.id = session.folder_id
      WHERE session.kind IN ('local', 'ssh') ORDER BY session.id LIMIT ?
    `);
    this.findSession = database.prepare('SELECT id, folder_id, kind, name, host, port, options_json, favorite, created_at, updated_at FROM session_definitions WHERE id = ?');
    this.insertImportedSession = database.prepare(`
      INSERT INTO session_definitions (id, folder_id, kind, name, host, port, options_json, options_version, favorite, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
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

  async exportFolderToFile(folderId: string, path: string): Promise<SessionFolderExportResult> {
    const temporaryPath = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
    return this.exportFolderToFileUsingTemporaryPath(folderId, path, temporaryPath);
  }

  async exportFolderToFileUsingTemporaryPath(folderId: string, path: string, temporaryPath: string): Promise<SessionFolderExportResult> {
    try {
      if (!isSessionFolderId(folderId) || !isFilePath(path)) throw new StorageOperationError('invalid');
      if (!isExportTemporaryPath(path, temporaryPath)) throw new StorageOperationError('invalid');
      const rows = this.listSubtreeFolders.all(folderId, MAX_SESSION_FOLDER_BUNDLE_RECORDS + 1) as unknown as SessionFolderRow[];
      if (rows.length === 0) throw new StorageOperationError('not-found');
      if (rows.length > MAX_SESSION_FOLDER_BUNDLE_RECORDS) throw new StorageOperationError('invalid');
      const folders = rows.map(decodeFolderRow).map(folder => folder.id === folderId ? { ...folder, parentId: null } : folder);
      const sessionRows = this.listSubtreeSessions.all(folderId, MAX_SESSION_FOLDER_BUNDLE_RECORDS + 1) as unknown as SavedSessionRow[];
      if (folders.length + sessionRows.length > MAX_SESSION_FOLDER_BUNDLE_RECORDS) throw new StorageOperationError('invalid');
      const sessions = sessionRows.map(decodeSessionRow);
      const bundle = createSessionFolderBundle({ rootFolderId: folderId, folders, sessions, exportedAt: new Date().toISOString() });
      if (!bundle) throw new StorageOperationError('corrupt');
      const contents = Buffer.from(JSON.stringify(bundle, null, 2), 'utf8');
      if (contents.byteLength > MAX_SESSION_FOLDER_BUNDLE_BYTES) throw new StorageOperationError('invalid');
      await writeSessionFolderBundle(path, temporaryPath, contents);
      return { folderCount: folders.length, sessionCount: sessions.length };
    } catch (error) { throw mapStorageError(error); }
  }

  async importFolderFromFile(path: string): Promise<SessionFolderImportResult> {
    try {
      if (!isFilePath(path)) throw new StorageOperationError('invalid');
      const bundle = await readSessionFolderBundle(path);
      const result = this.inTransaction(() => this.importBundle(bundle));
      return result;
    } catch (error) { throw mapStorageError(error); }
  }

  private importBundle(bundle: SessionFolderBundle): SessionFolderImportResult {
    let createdFolderCount = 0;
    let createdSessionCount = 0;
    for (const folder of orderBundleFolders(bundle)) {
      const existing = this.getFolder(folder.id);
      if (existing) {
        const rootPlacementMayDiffer = folder.id === bundle.rootFolderId;
        if (existing.name !== folder.name || (!rootPlacementMayDiffer && existing.parentId !== folder.parentId)) {
          throw new StorageOperationError('conflict');
        }
        continue;
      }
      this.requireUniqueFolderName(folder.parentId, folder.name, null);
      this.insertFolder.run(folder.id, folder.parentId, folder.name);
      createdFolderCount += 1;
    }

    for (const session of bundle.sessions) {
      const row = this.findSession.get(session.id) as unknown as SavedSessionRow | undefined;
      if (row) {
        if (!sameSessionDefinition(decodeSessionRow(row), session)) throw new StorageOperationError('conflict');
        continue;
      }
      const local = session.kind === 'local';
      this.insertImportedSession.run(session.id, session.folderId, session.kind, session.name,
        local ? null : session.host, local ? null : session.port, local ? JSON.stringify({ shell: session.shell }) : '{}',
        session.favorite ? 1 : 0, session.createdAt, session.updatedAt);
      createdSessionCount += 1;
    }
    return {
      folderCount: bundle.folders.length,
      sessionCount: bundle.sessions.length,
      createdFolderCount,
      createdSessionCount
    };
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

function orderBundleFolders(bundle: SessionFolderBundle): SavedSessionFolder[] {
  const folders = new Map(bundle.folders.map(folder => [folder.id, folder]));
  const children = new Map<string, SavedSessionFolder[]>();
  for (const folder of bundle.folders) {
    if (folder.parentId === null) continue;
    const siblings = children.get(folder.parentId) ?? [];
    siblings.push(folder);
    children.set(folder.parentId, siblings);
  }
  const ordered: SavedSessionFolder[] = [];
  const pending = [folders.get(bundle.rootFolderId)];
  for (let index = 0; index < pending.length; index += 1) {
    const folder = pending[index];
    if (!folder) throw new StorageOperationError('invalid');
    ordered.push(folder);
    for (const child of children.get(folder.id) ?? []) pending.push(child);
  }
  if (ordered.length !== folders.size) throw new StorageOperationError('invalid');
  return ordered;
}

function sameSessionDefinition(left: SavedSessionDefinition, right: SavedSessionDefinition): boolean {
  if (left.id !== right.id || left.folderId !== right.folderId || left.kind !== right.kind || left.name !== right.name ||
      left.favorite !== right.favorite || left.createdAt !== right.createdAt || left.updatedAt !== right.updatedAt) return false;
  return left.kind === 'local' && right.kind === 'local' ? left.shell === right.shell :
    left.kind === 'ssh' && right.kind === 'ssh' && left.host === right.host && left.port === right.port;
}

async function writeSessionFolderBundle(path: string, temporaryPath: string, contents: Buffer): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let created = false;
  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    created = true;
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, path);
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    if (created) await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function isExportTemporaryPath(destination: string, temporaryPath: string): boolean {
  if (!isFilePath(temporaryPath) || dirname(temporaryPath) !== dirname(destination)) return false;
  const prefix = `.${basename(destination)}.`;
  const filename = basename(temporaryPath);
  if (!filename.startsWith(prefix) || !filename.endsWith('.tmp')) return false;
  const id = filename.slice(prefix.length, -'.tmp'.length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

async function readSessionFolderBundle(path: string): Promise<SessionFolderBundle> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, 'r');
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size < 2 || stats.size > MAX_SESSION_FOLDER_BUNDLE_BYTES) throw new StorageOperationError('invalid');
    const contents = Buffer.alloc(stats.size);
    let offset = 0;
    while (offset < contents.byteLength) {
      const { bytesRead } = await handle.read(contents, offset, contents.byteLength - offset, offset);
      if (bytesRead === 0) throw new StorageOperationError('invalid');
      offset += bytesRead;
    }
    const extraByte = Buffer.alloc(1);
    const extra = await handle.read(extraByte, 0, 1, stats.size);
    if (extra.bytesRead !== 0) throw new StorageOperationError('invalid');
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(contents); }
    catch { throw new StorageOperationError('invalid'); }
    let parsed: unknown;
    try { parsed = JSON.parse(text); }
    catch { throw new StorageOperationError('invalid'); }
    const bundle = normalizeSessionFolderBundle(parsed);
    if (!bundle) throw new StorageOperationError('invalid');
    return bundle;
  } catch (error) {
    if (error instanceof StorageOperationError) throw error;
    if (isFileSystemError(error) && error.code !== undefined && ['ENOENT', 'EISDIR', 'EACCES', 'EPERM'].includes(error.code)) throw new StorageOperationError('invalid');
    throw error;
  } finally {
    if (handle) await handle.close().catch(() => undefined);
  }
}

function isFilePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 32_767 && !value.includes('\0') && isAbsolute(value);
}

function isFileSystemError(value: unknown): value is NodeJS.ErrnoException {
  return typeof value === 'object' && value !== null && 'code' in value && typeof value.code === 'string';
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
