import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { DEFAULT_WORKBENCH_PREFERENCES, isWorkbenchPreferences, normalizeWorkbenchPreferences,
  LEGACY_WORKBENCH_PREFERENCES_SCHEMA_VERSIONS, MAX_WORKBENCH_PREFERENCES_JSON_LENGTH,
  WORKBENCH_PREFERENCES_SCHEMA_VERSION } from '../../../../packages/domain/src/workbench-preferences.ts';
import type { WorkbenchPreferences } from '../../../../packages/domain/src/workbench-preferences.ts';
import { StorageOperationError } from '../../../../packages/application/src/storage-errors.ts';

const SETTINGS_KEY = 'workbench';

interface StoredPreferencesRow {
  readonly value_json: unknown;
  readonly schema_version: unknown;
}

export class SqliteWorkbenchPreferencesRepository {
  private readonly readStatement: StatementSync;
  private readonly saveStatement: StatementSync;

  constructor(database: DatabaseSync) {
    this.readStatement = database.prepare('SELECT value_json, schema_version FROM settings WHERE key = ?');
    this.saveStatement = database.prepare(`
      INSERT INTO settings (key, value_json, schema_version, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
        schema_version = excluded.schema_version, updated_at = excluded.updated_at
    `);
  }

  read(): WorkbenchPreferences {
    try {
      const row = this.readStatement.get(SETTINGS_KEY) as unknown as StoredPreferencesRow | undefined;
      if (!row) return DEFAULT_WORKBENCH_PREFERENCES;
      if ((!LEGACY_WORKBENCH_PREFERENCES_SCHEMA_VERSIONS.includes(row.schema_version as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8) &&
           row.schema_version !== WORKBENCH_PREFERENCES_SCHEMA_VERSION) ||
          typeof row.value_json !== 'string' || row.value_json.length > MAX_WORKBENCH_PREFERENCES_JSON_LENGTH) {
        throw new StorageOperationError('corrupt');
      }
      let value: unknown;
      try { value = JSON.parse(row.value_json) as unknown; }
      catch { throw new StorageOperationError('corrupt'); }
      const preferences = normalizeWorkbenchPreferences(value, row.schema_version as number);
      if (!preferences) throw new StorageOperationError('corrupt');
      if (row.schema_version !== WORKBENCH_PREFERENCES_SCHEMA_VERSION) {
        this.saveStatement.run(SETTINGS_KEY, JSON.stringify(preferences), WORKBENCH_PREFERENCES_SCHEMA_VERSION, new Date().toISOString());
      }
      return preferences;
    } catch (error) { throw mapStorageError(error); }
  }

  save(input: WorkbenchPreferences): WorkbenchPreferences {
    try {
      if (!isWorkbenchPreferences(input)) throw new StorageOperationError('invalid');
      const preferences = normalizeWorkbenchPreferences(input);
      if (!preferences) throw new StorageOperationError('invalid');
      this.saveStatement.run(SETTINGS_KEY, JSON.stringify(preferences), WORKBENCH_PREFERENCES_SCHEMA_VERSION, new Date().toISOString());
      return preferences;
    } catch (error) { throw mapStorageError(error); }
  }
}

function mapStorageError(error: unknown): StorageOperationError {
  if (error instanceof StorageOperationError) return error;
  const message = error instanceof Error ? error.message : '';
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 5 || code === 6 || /SQLITE_(?:BUSY|LOCKED)|database is (?:locked|busy)/i.test(message)) return new StorageOperationError('busy');
  if (code === 11 || code === 26 || /SQLITE_(?:CORRUPT|NOTADB)|database disk image is malformed|not a database/i.test(message)) {
    return new StorageOperationError('corrupt');
  }
  return new StorageOperationError('unavailable');
}
