import { randomUUID } from 'node:crypto';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { StorageOperationError } from '../../../../packages/application/src/storage-errors.ts';
import type { SessionCatalogStore } from '../../../../packages/application/src/session-catalog.ts';
import { isSessionDefinitionId, normalizeSavedSessionDraft } from '../../../../packages/domain/src/session-definition.ts';
import type { SavedSessionDefinition, SavedSessionDraft } from '../../../../packages/domain/src/session-definition.ts';
import { isLocalShell } from '../../../../packages/domain/src/local-terminal.ts';
import { canonicalizeSshHostEndpoint } from '../../../../packages/domain/src/host-trust.ts';

interface SavedSessionRow {
  readonly id: unknown;
  readonly kind: unknown;
  readonly name: unknown;
  readonly host: unknown;
  readonly port: unknown;
  readonly options_json: unknown;
  readonly favorite: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
}

export class SqliteSessionCatalogRepository implements SessionCatalogStore {
  private readonly listByQuery: StatementSync;
  private readonly insertSession: StatementSync;
  private readonly setSessionFavorite: StatementSync;
  private readonly deleteSession: StatementSync;

  constructor(database: DatabaseSync) {
    this.listByQuery = database.prepare(`
      SELECT id, kind, name, host, port, options_json, favorite, created_at, updated_at
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
        ? { id, kind: 'local', name: draft.name, shell: draft.shell, favorite: false, createdAt: timestamp, updatedAt: timestamp }
        : { id, kind: 'ssh', name: draft.name, host: draft.host, port: draft.port, favorite: false, createdAt: timestamp, updatedAt: timestamp };
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
}

function decodeSessionRow(row: SavedSessionRow): SavedSessionDefinition {
  if (!row || !isSessionDefinitionId(row.id) || typeof row.name !== 'string' || row.name.length < 1 || row.name.length > 256 ||
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
    return { id: row.id, kind: 'local', name: row.name, shell, favorite: row.favorite === 1,
      createdAt: row.created_at, updatedAt: row.updated_at };
  }
  if (row.kind === 'ssh') {
    const endpoint = canonicalizeSshHostEndpoint({ host: row.host, port: row.port });
    if (!endpoint || endpoint.host !== row.host || endpoint.port !== row.port || !exactKeys(options, [])) throw new StorageOperationError('corrupt');
    return { id: row.id, kind: 'ssh', name: row.name, host: endpoint.host, port: endpoint.port, favorite: row.favorite === 1,
      createdAt: row.created_at, updatedAt: row.updated_at };
  }
  throw new StorageOperationError('corrupt');
}

function mapStorageError(error: unknown): StorageOperationError {
  if (error instanceof StorageOperationError) return error;
  const sqliteCode = isRecord(error) && typeof error.errcode === 'number' ? error.errcode & 0xff : undefined;
  const message = error instanceof Error ? error.message : '';
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
