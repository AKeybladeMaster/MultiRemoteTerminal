import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SqliteHostTrustRepository } from '../../apps/desktop/src/adapters/sqlite-host-trust-repository.ts';
import { SqliteWorkbenchPreferencesRepository } from '../../apps/desktop/src/adapters/sqlite-workbench-preferences-repository.ts';
import { DEFAULT_WORKBENCH_PREFERENCES, WORKBENCH_PREFERENCES_SCHEMA_VERSION } from '../../packages/domain/src/workbench-preferences.ts';

test('SQLite stores and restores the Unicode startup greeting across database reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mrt-preferences-'));
  const path = join(directory, 'settings.sqlite');
  try {
    const database = new DatabaseSync(path);
    new SqliteHostTrustRepository(database).migrate();
    const preferences = new SqliteWorkbenchPreferencesRepository(database);
    assert.deepEqual(preferences.read(), DEFAULT_WORKBENCH_PREFERENCES);
    const updated = { ...DEFAULT_WORKBENCH_PREFERENCES, startupGreeting: 'Привет 👋\nこんにちは',
      terminalHighlightEnabled: true, terminalHighlightRules: [{ pattern: '\\b(git|ssh)\\b', color: 'cyan' as const }],
      terminalShellSyntaxEnabled: true, showSftpBrowserBesideSsh: false };
    assert.deepEqual(preferences.save(updated), updated);
    database.close();

    const reopened = new DatabaseSync(path);
    new SqliteHostTrustRepository(reopened).migrate();
    assert.deepEqual(new SqliteWorkbenchPreferencesRepository(reopened).read(), updated);
    reopened.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('SQLite migrates schema v1 greeting settings to defaults for highlighting', () => {
  const database = new DatabaseSync(':memory:');
  new SqliteHostTrustRepository(database).migrate();
  database.prepare('INSERT INTO settings (key, value_json, schema_version, updated_at) VALUES (?, ?, ?, ?)')
    .run('workbench', JSON.stringify({ startupGreeting: 'Welcome' }), 1, '2026-10-24T00:00:00.000Z');
  const preferences = new SqliteWorkbenchPreferencesRepository(database);
  assert.deepEqual(preferences.read(), { ...DEFAULT_WORKBENCH_PREFERENCES, startupGreeting: 'Welcome' });
  assert.equal(database.prepare('SELECT schema_version FROM settings WHERE key = ?').get('workbench')?.schema_version,
    WORKBENCH_PREFERENCES_SCHEMA_VERSION);
  database.close();
});

test('SQLite migrates schema v2 highlighting settings with session saving disabled by default', () => {
  const database = new DatabaseSync(':memory:');
  new SqliteHostTrustRepository(database).migrate();
  database.prepare('INSERT INTO settings (key, value_json, schema_version, updated_at) VALUES (?, ?, ?, ?)')
    .run('workbench', JSON.stringify({ startupGreeting: 'Ready', terminalHighlightEnabled: true,
      terminalHighlightRules: [{ pattern: 'error', color: 'red' }] }), 2, '2026-10-24T00:00:00.000Z');
  const preferences = new SqliteWorkbenchPreferencesRepository(database);
  assert.deepEqual(preferences.read(), { ...DEFAULT_WORKBENCH_PREFERENCES, startupGreeting: 'Ready',
    terminalHighlightEnabled: true, terminalHighlightRules: [{ pattern: 'error', color: 'red' }] });
  assert.equal(database.prepare('SELECT schema_version FROM settings WHERE key = ?').get('workbench')?.schema_version,
    WORKBENCH_PREFERENCES_SCHEMA_VERSION);
  database.close();
});

test('SQLite migrates schema v3 preferences with terminal shell coloring disabled by default', () => {
  const database = new DatabaseSync(':memory:');
  new SqliteHostTrustRepository(database).migrate();
  database.prepare('INSERT INTO settings (key, value_json, schema_version, updated_at) VALUES (?, ?, ?, ?)')
    .run('workbench', JSON.stringify({ startupGreeting: 'Ready', terminalHighlightEnabled: false,
      terminalHighlightRules: [], autoSaveSessions: true }), 3, '2026-10-26T00:00:00.000Z');
  const preferences = new SqliteWorkbenchPreferencesRepository(database);
  assert.deepEqual(preferences.read(), { ...DEFAULT_WORKBENCH_PREFERENCES, startupGreeting: 'Ready', autoSaveSessions: true });
  assert.equal(database.prepare('SELECT schema_version FROM settings WHERE key = ?').get('workbench')?.schema_version,
    WORKBENCH_PREFERENCES_SCHEMA_VERSION);
  database.close();
});

test('SQLite migrates schema v4 preferences with the contextual SFTP pane enabled by default', () => {
  const database = new DatabaseSync(':memory:');
  new SqliteHostTrustRepository(database).migrate();
  database.prepare('INSERT INTO settings (key, value_json, schema_version, updated_at) VALUES (?, ?, ?, ?)')
    .run('workbench', JSON.stringify({ startupGreeting: 'Ready', terminalHighlightEnabled: true,
      terminalHighlightRules: [], autoSaveSessions: true, terminalShellSyntaxEnabled: true }), 4, '2026-10-26T00:00:00.000Z');
  const preferences = new SqliteWorkbenchPreferencesRepository(database);
  assert.deepEqual(preferences.read(), { ...DEFAULT_WORKBENCH_PREFERENCES, startupGreeting: 'Ready',
    terminalHighlightEnabled: true, autoSaveSessions: true, terminalShellSyntaxEnabled: true });
  assert.equal(database.prepare('SELECT schema_version FROM settings WHERE key = ?').get('workbench')?.schema_version,
    WORKBENCH_PREFERENCES_SCHEMA_VERSION);
  database.close();
});

test('SQLite migrates schema v5 preferences with all registered local shells visible by default', () => {
  const database = new DatabaseSync(':memory:');
  new SqliteHostTrustRepository(database).migrate();
  database.prepare('INSERT INTO settings (key, value_json, schema_version, updated_at) VALUES (?, ?, ?, ?)')
    .run('workbench', JSON.stringify({ startupGreeting: 'Ready', terminalHighlightEnabled: true,
      terminalHighlightRules: [], autoSaveSessions: true, terminalShellSyntaxEnabled: true,
      showSftpBrowserBesideSsh: false }), 5, '2026-10-26T00:00:00.000Z');
  const preferences = new SqliteWorkbenchPreferencesRepository(database);
  assert.deepEqual(preferences.read(), { ...DEFAULT_WORKBENCH_PREFERENCES, startupGreeting: 'Ready',
    terminalHighlightEnabled: true, autoSaveSessions: true, terminalShellSyntaxEnabled: true,
    showSftpBrowserBesideSsh: false });
  assert.equal(database.prepare('SELECT schema_version FROM settings WHERE key = ?').get('workbench')?.schema_version,
    WORKBENCH_PREFERENCES_SCHEMA_VERSION);
  database.close();
});

test('SQLite migrates schema v6 shell visibility and enables the new WSL action by default', () => {
  const database = new DatabaseSync(':memory:');
  new SqliteHostTrustRepository(database).migrate();
  database.prepare('INSERT INTO settings (key, value_json, schema_version, updated_at) VALUES (?, ?, ?, ?)')
    .run('workbench', JSON.stringify({ startupGreeting: 'Ready', terminalHighlightEnabled: false,
      terminalHighlightRules: [], autoSaveSessions: false, terminalShellSyntaxEnabled: false,
      showSftpBrowserBesideSsh: true, visibleLocalShells: ['powershell', 'bash'] }), 6, '2026-10-26T00:00:00.000Z');
  const preferences = new SqliteWorkbenchPreferencesRepository(database);
  assert.deepEqual(preferences.read().visibleLocalShells, ['powershell', 'bash', 'wsl']);
  assert.equal(database.prepare('SELECT schema_version FROM settings WHERE key = ?').get('workbench')?.schema_version,
    WORKBENCH_PREFERENCES_SCHEMA_VERSION);
  database.close();
});

test('SQLite rejects corrupted or unsupported stored preference records', () => {
  const database = new DatabaseSync(':memory:');
  new SqliteHostTrustRepository(database).migrate();
  const preferences = new SqliteWorkbenchPreferencesRepository(database);
  preferences.save({ ...DEFAULT_WORKBENCH_PREFERENCES, startupGreeting: 'Welcome' });
  database.prepare('UPDATE settings SET value_json = ?, schema_version = ? WHERE key = ?').run('{broken', 1, 'workbench');
  assert.throws(() => preferences.read(), /Storage operation corrupt/u);
  database.prepare('UPDATE settings SET value_json = ?, schema_version = ? WHERE key = ?')
    .run('{"startupGreeting":"safe","terminalHighlightEnabled":false,"terminalHighlightRules":[],"extra":true}', 2, 'workbench');
  assert.throws(() => preferences.read(), /Storage operation corrupt/u);
  database.prepare('UPDATE settings SET value_json = ?, schema_version = ? WHERE key = ?')
    .run('{"startupGreeting":"safe"}', 99, 'workbench');
  assert.throws(() => preferences.read(), /Storage operation corrupt/u);
  database.close();
});
