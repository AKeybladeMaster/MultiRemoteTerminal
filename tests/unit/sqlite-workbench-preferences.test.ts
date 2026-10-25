import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SqliteHostTrustRepository } from '../../apps/desktop/src/adapters/sqlite-host-trust-repository.ts';
import { SqliteWorkbenchPreferencesRepository } from '../../apps/desktop/src/adapters/sqlite-workbench-preferences-repository.ts';

test('SQLite stores and restores the Unicode startup greeting across database reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mrt-preferences-'));
  const path = join(directory, 'settings.sqlite');
  try {
    const database = new DatabaseSync(path);
    new SqliteHostTrustRepository(database).migrate();
    const preferences = new SqliteWorkbenchPreferencesRepository(database);
    assert.deepEqual(preferences.read(), { startupGreeting: '' });
    assert.deepEqual(preferences.save({ startupGreeting: 'Привет 👋\nこんにちは' }), { startupGreeting: 'Привет 👋\nこんにちは' });
    database.close();

    const reopened = new DatabaseSync(path);
    new SqliteHostTrustRepository(reopened).migrate();
    assert.deepEqual(new SqliteWorkbenchPreferencesRepository(reopened).read(), { startupGreeting: 'Привет 👋\nこんにちは' });
    reopened.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('SQLite rejects corrupted or unsupported stored preference records', () => {
  const database = new DatabaseSync(':memory:');
  new SqliteHostTrustRepository(database).migrate();
  const preferences = new SqliteWorkbenchPreferencesRepository(database);
  preferences.save({ startupGreeting: 'Welcome' });
  database.prepare('UPDATE settings SET value_json = ?, schema_version = ? WHERE key = ?').run('{broken', 1, 'workbench');
  assert.throws(() => preferences.read(), /Storage operation corrupt/u);
  database.prepare('UPDATE settings SET value_json = ?, schema_version = ? WHERE key = ?').run('{"startupGreeting":"safe"}', 2, 'workbench');
  assert.throws(() => preferences.read(), /Storage operation corrupt/u);
  database.close();
});
