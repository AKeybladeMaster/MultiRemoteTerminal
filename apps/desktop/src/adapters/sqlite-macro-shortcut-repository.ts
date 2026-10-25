import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { StorageOperationError } from '../../../../packages/application/src/storage-errors.ts';
import { isMacroId } from '../../../../packages/domain/src/macro.ts';
import { isMacroShortcutBinding, isMacroShortcutCode } from '../../../../packages/domain/src/macro-shortcut.ts';
import type { MacroShortcutBinding, MacroShortcutCode } from '../../../../packages/domain/src/macro-shortcut.ts';

interface MacroShortcutRow {
  readonly macro_id: unknown;
  readonly code: unknown;
}

export class SqliteMacroShortcutRepository {
  private readonly listStatement: StatementSync;
  private readonly setStatement: StatementSync;
  private readonly removeStatement: StatementSync;

  constructor(database: DatabaseSync) {
    this.listStatement = database.prepare('SELECT macro_id, code FROM macro_shortcuts ORDER BY code ASC');
    this.setStatement = database.prepare(`
      INSERT INTO macro_shortcuts (macro_id, code) VALUES (?, ?)
      ON CONFLICT(macro_id) DO UPDATE SET code = excluded.code
    `);
    this.removeStatement = database.prepare('DELETE FROM macro_shortcuts WHERE macro_id = ?');
  }

  list(): readonly MacroShortcutBinding[] {
    try { return (this.listStatement.all() as unknown as MacroShortcutRow[]).map(decodeBinding); }
    catch (error) { throw mapStorageError(error); }
  }

  set(macroId: string, code: MacroShortcutCode): MacroShortcutBinding {
    try {
      if (!isMacroId(macroId) || !isMacroShortcutCode(code)) throw new StorageOperationError('invalid');
      this.setStatement.run(macroId, code);
      return { macroId, code };
    } catch (error) { throw mapStorageError(error); }
  }

  remove(macroId: string): boolean {
    try {
      if (!isMacroId(macroId)) throw new StorageOperationError('invalid');
      return Number(this.removeStatement.run(macroId).changes) > 0;
    } catch (error) { throw mapStorageError(error); }
  }
}

function decodeBinding(row: MacroShortcutRow): MacroShortcutBinding {
  const value = { macroId: row.macro_id, code: row.code };
  if (!isMacroShortcutBinding(value)) throw new StorageOperationError('corrupt');
  return value;
}

function mapStorageError(error: unknown): StorageOperationError {
  if (error instanceof StorageOperationError) return error;
  const message = error instanceof Error ? error.message : '';
  const code = (error as { code?: unknown } | null)?.code;
  if (/UNIQUE constraint failed|PRIMARY KEY constraint failed/i.test(message)) return new StorageOperationError('conflict');
  if (code === 787 || /FOREIGN KEY constraint failed/i.test(message)) return new StorageOperationError('not-found');
  if (code === 5 || code === 6 || /SQLITE_(?:BUSY|LOCKED)|database is (?:locked|busy)/i.test(message)) return new StorageOperationError('busy');
  if (code === 11 || code === 26 || /SQLITE_(?:CORRUPT|NOTADB)|database disk image is malformed|not a database/i.test(message)) {
    return new StorageOperationError('corrupt');
  }
  return new StorageOperationError('unavailable');
}
