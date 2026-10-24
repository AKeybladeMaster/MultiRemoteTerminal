import { randomUUID } from 'node:crypto';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { StorageOperationError } from '../../../../packages/application/src/storage-errors.ts';
import { isMacroDefinition, isMacroId, normalizeMacroDraft, MACRO_SCHEMA_VERSION } from '../../../../packages/domain/src/macro.ts';
import type { MacroDefinition, MacroDraft } from '../../../../packages/domain/src/macro.ts';

interface MacroRow {
  readonly id: unknown;
  readonly name: unknown;
  readonly description: unknown;
  readonly steps_json: unknown;
  readonly schema_version: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
}

export class SqliteMacroCatalogRepository {
  private readonly listStatement: StatementSync;
  private readonly findStatement: StatementSync;
  private readonly insertStatement: StatementSync;
  private readonly updateStatement: StatementSync;
  private readonly deleteStatement: StatementSync;

  constructor(database: DatabaseSync) {
    this.listStatement = database.prepare(`
      SELECT id, name, description, steps_json, schema_version, created_at, updated_at
      FROM macro_definitions ORDER BY updated_at DESC, id ASC
    `);
    this.findStatement = database.prepare(`
      SELECT id, name, description, steps_json, schema_version, created_at, updated_at
      FROM macro_definitions WHERE id = ?
    `);
    this.insertStatement = database.prepare(`
      INSERT INTO macro_definitions (id, name, description, steps_json, schema_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    this.updateStatement = database.prepare(`
      UPDATE macro_definitions SET name = ?, description = ?, steps_json = ?, schema_version = ?, updated_at = ? WHERE id = ?
    `);
    this.deleteStatement = database.prepare('DELETE FROM macro_definitions WHERE id = ?');
  }

  listMacros(): readonly MacroDefinition[] {
    try {
      return (this.listStatement.all() as unknown as MacroRow[]).map(decodeMacroRow);
    } catch (error) { throw mapStorageError(error); }
  }

  createMacro(input: MacroDraft): MacroDefinition {
    try {
      const draft = normalizeMacroDraft(input);
      if (!draft) throw new StorageOperationError('invalid');
      const id = randomUUID();
      const now = new Date().toISOString();
      this.insertStatement.run(id, draft.name, draft.description ?? null, JSON.stringify(draft.steps), MACRO_SCHEMA_VERSION, now, now);
      const result = this.findMacro(id);
      if (!result) throw new StorageOperationError('corrupt');
      return result;
    } catch (error) { throw mapStorageError(error); }
  }

  updateMacro(id: string, input: MacroDraft): MacroDefinition | undefined {
    try {
      const draft = normalizeMacroDraft(input);
      if (!isMacroId(id) || !draft) throw new StorageOperationError('invalid');
      const changed = this.updateStatement.run(draft.name, draft.description ?? null, JSON.stringify(draft.steps), MACRO_SCHEMA_VERSION,
        new Date().toISOString(), id);
      if (Number(changed.changes) === 0) return undefined;
      const result = this.findMacro(id);
      if (!result) throw new StorageOperationError('corrupt');
      return result;
    } catch (error) { throw mapStorageError(error); }
  }

  removeMacro(id: string): boolean {
    try {
      if (!isMacroId(id)) throw new StorageOperationError('invalid');
      return Number(this.deleteStatement.run(id).changes) > 0;
    } catch (error) { throw mapStorageError(error); }
  }

  private findMacro(id: string): MacroDefinition | undefined {
    const row = this.findStatement.get(id) as unknown as MacroRow | undefined;
    return row ? decodeMacroRow(row) : undefined;
  }
}

function decodeMacroRow(row: MacroRow): MacroDefinition {
  if (typeof row.steps_json !== 'string' || row.steps_json.length > 65_536 || typeof row.name !== 'string' ||
      (row.description !== null && typeof row.description !== 'string')) throw new StorageOperationError('corrupt');
  let steps: unknown;
  try { steps = JSON.parse(row.steps_json) as unknown; }
  catch { throw new StorageOperationError('corrupt'); }
  const value = { id: row.id, name: row.name, ...(row.description === null ? {} : { description: row.description }), steps,
    schemaVersion: row.schema_version, createdAt: row.created_at, updatedAt: row.updated_at };
  if (!isMacroDefinition(value)) throw new StorageOperationError('corrupt');
  return value;
}

function mapStorageError(error: unknown): StorageOperationError {
  if (error instanceof StorageOperationError) return error;
  const message = error instanceof Error ? error.message : '';
  const code = (error as { code?: unknown } | null)?.code;
  if (/UNIQUE constraint failed|PRIMARY KEY constraint failed/i.test(message)) return new StorageOperationError('conflict');
  if (code === 5 || code === 6 || /SQLITE_(?:BUSY|LOCKED)|database is (?:locked|busy)/i.test(message)) return new StorageOperationError('busy');
  if (code === 11 || code === 26 || /SQLITE_(?:CORRUPT|NOTADB)|database disk image is malformed|not a database/i.test(message)) {
    return new StorageOperationError('corrupt');
  }
  return new StorageOperationError('unavailable');
}
