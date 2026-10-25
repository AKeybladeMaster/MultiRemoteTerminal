import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SqliteHostTrustRepository } from '../../apps/desktop/src/adapters/sqlite-host-trust-repository.ts';
import { SqliteMacroCatalogRepository } from '../../apps/desktop/src/adapters/sqlite-macro-catalog-repository.ts';
import { SqliteMacroShortcutRepository } from '../../apps/desktop/src/adapters/sqlite-macro-shortcut-repository.ts';

test('SQLite stores 100 typed macros without a catalog cap and retains edits after reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mrt-macros-'));
  const path = join(directory, 'catalog.sqlite');
  try {
    const database = new DatabaseSync(path);
    database.exec('PRAGMA foreign_keys = ON');
    new SqliteHostTrustRepository(database).migrate();
    const repository = new SqliteMacroCatalogRepository(database);
    const created = Array.from({ length: 100 }, (_, index) => repository.createMacro({
      name: `Macro ${index + 1}`,
      steps: [{ kind: 'send', text: `echo ${index + 1}` }, { kind: 'waitForText', text: `done-${index + 1}`, timeoutMs: 10_000 }]
    }));
    assert.equal(repository.listMacros().length, 100);
    const updated = repository.updateMacro(created[0]!.id, { name: 'Updated macro', steps: [{ kind: 'delay', durationMs: 100 }] });
    assert.equal(updated?.name, 'Updated macro');
    assert.equal(repository.removeMacro(created[1]!.id), true);
    database.close();

    const restored = new DatabaseSync(path);
    new SqliteHostTrustRepository(restored).migrate();
    const reopened = new SqliteMacroCatalogRepository(restored).listMacros();
    assert.equal(reopened.length, 99);
    assert.equal(reopened.find(macro => macro.id === created[0]!.id)?.steps[0]?.kind, 'delay');
    assert.equal(reopened.some(macro => macro.id === created[1]!.id), false);
    restored.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('SQLite persists unique macro shortcuts and removes them with their macro', () => {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  new SqliteHostTrustRepository(database).migrate();
  const macros = new SqliteMacroCatalogRepository(database);
  const shortcuts = new SqliteMacroShortcutRepository(database);
  const first = macros.createMacro({ name: 'First', steps: [] });
  const second = macros.createMacro({ name: 'Second', steps: [] });

  assert.deepEqual(shortcuts.set(first.id, 'F2'), { macroId: first.id, code: 'F2' });
  assert.deepEqual(shortcuts.list(), [{ macroId: first.id, code: 'F2' }]);
  assert.deepEqual(shortcuts.set(first.id, 'F3'), { macroId: first.id, code: 'F3' });
  assert.throws(() => shortcuts.set(second.id, 'F3'), /Storage operation conflict/u);
  assert.throws(() => shortcuts.set('22222222-2222-4222-8222-222222222222', 'F1'), /Storage operation not-found/u);
  assert.throws(() => shortcuts.set(first.id, 'Ctrl+F1' as never), /Storage operation invalid/u);
  assert.equal(macros.removeMacro(first.id), true);
  assert.deepEqual(shortcuts.list(), []);
  database.close();
});

test('SQLite version 2 databases migrate forward without losing saved macros', () => {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  const migrations = new SqliteHostTrustRepository(database);
  migrations.migrate();
  const macro = new SqliteMacroCatalogRepository(database).createMacro({ name: 'Preserved', steps: [] });
  database.exec('DROP TABLE macro_shortcuts; PRAGMA user_version = 2');

  migrations.migrate();
  const version = database.prepare('PRAGMA user_version').get() as { readonly user_version: number };
  assert.equal(version.user_version, 3);
  assert.equal(new SqliteMacroCatalogRepository(database).listMacros()[0]?.id, macro.id);
  const shortcut = new SqliteMacroShortcutRepository(database).set(macro.id, 'F4');
  assert.deepEqual(shortcut, { macroId: macro.id, code: 'F4' });
  database.close();
});

test('SQLite fails closed if a stored macro has an unknown version or malformed step payload', () => {
  const database = new DatabaseSync(':memory:');
  new SqliteHostTrustRepository(database).migrate();
  const repository = new SqliteMacroCatalogRepository(database);
  const macro = repository.createMacro({ name: 'Inspect', steps: [] });
  database.prepare('UPDATE macro_definitions SET steps_json = ? WHERE id = ?').run('[{"kind":"send","text":"ok","secret":"x"}]', macro.id);
  assert.throws(() => repository.listMacros(), /Storage operation corrupt/u);
  database.close();
});
