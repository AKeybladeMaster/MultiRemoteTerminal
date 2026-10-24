import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SqliteHostTrustRepository } from '../../apps/desktop/src/adapters/sqlite-host-trust-repository.ts';
import { SqliteMacroCatalogRepository } from '../../apps/desktop/src/adapters/sqlite-macro-catalog-repository.ts';

test('SQLite stores 100 typed macros without a catalog cap and retains edits after reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mrt-macros-'));
  const path = join(directory, 'catalog.sqlite');
  try {
    const database = new DatabaseSync(path);
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

test('SQLite fails closed if a stored macro has an unknown version or malformed step payload', () => {
  const database = new DatabaseSync(':memory:');
  new SqliteHostTrustRepository(database).migrate();
  const repository = new SqliteMacroCatalogRepository(database);
  const macro = repository.createMacro({ name: 'Inspect', steps: [] });
  database.prepare('UPDATE macro_definitions SET steps_json = ? WHERE id = ?').run('[{"kind":"send","text":"ok","secret":"x"}]', macro.id);
  assert.throws(() => repository.listMacros(), /Storage operation corrupt/u);
  database.close();
});
