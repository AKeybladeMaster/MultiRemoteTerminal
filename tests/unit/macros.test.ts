import assert from 'node:assert/strict';
import test from 'node:test';
import { createMacroCatalog } from '../../packages/application/src/macros.ts';
import type { MacroCatalogStore } from '../../packages/application/src/macros.ts';
import type { MacroDefinition, MacroDraft } from '../../packages/domain/src/macro.ts';
import type { MacroShortcutBinding, MacroShortcutCode } from '../../packages/domain/src/macro-shortcut.ts';

function memoryStore(): MacroCatalogStore {
  const records = new Map<string, MacroDefinition>();
  const shortcuts = new Map<string, MacroShortcutBinding>();
  return {
    async listMacros() { return [...records.values()]; },
    async createMacro(draft: MacroDraft) {
      const now = '2026-10-25T10:00:00.000Z';
      const macro = { ...draft, id: '7c08b18a-57cc-4b44-a8b3-2d404850e81c', schemaVersion: 1 as const, createdAt: now, updatedAt: now };
      records.set(macro.id, macro);
      return macro;
    },
    async updateMacro(id, draft) {
      const existing = records.get(id);
      if (!existing) return undefined;
      const macro = { ...draft, id, schemaVersion: 1 as const, createdAt: existing.createdAt, updatedAt: '2026-10-25T11:00:00.000Z' };
      records.set(id, macro);
      return macro;
    },
    async removeMacro(id) { const removed = records.delete(id); if (removed) shortcuts.delete(id); return removed; },
    async listMacroShortcuts() { return [...shortcuts.values()]; },
    async setMacroShortcut(macroId, code: MacroShortcutCode) {
      const binding = { macroId, code };
      shortcuts.set(macroId, binding);
      return binding;
    },
    async removeMacroShortcut(macroId) { return shortcuts.delete(macroId); }
  };
}

test('macro catalog validates, persists, updates and removes typed definitions', async () => {
  const catalog = createMacroCatalog(memoryStore());
  const draft = { name: 'Build', steps: [{ kind: 'send', text: 'npm run build' }] };
  const created = await catalog.create(draft);
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.result.name, 'Build');
  assert.equal((await catalog.list()).ok, true);

  const updated = await catalog.update(created.result.id, { name: 'Build and check', steps: [
    { kind: 'send', text: 'npm run build' }, { kind: 'waitForText', text: 'Build complete', timeoutMs: 15_000 }
  ] });
  assert.equal(updated.ok, true);
  assert.equal((await catalog.update('bad-id', draft)).ok, false);
  assert.equal((await catalog.remove(created.result.id)).ok, true);
  const missing = await catalog.remove(created.result.id);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.error.code, 'NOT_FOUND');
});

test('macro catalog rejects extra fields and observes cancellation before storage', async () => {
  let writes = 0;
  const store = memoryStore();
  const catalog = createMacroCatalog({ ...store, async createMacro(draft) { writes++; return store.createMacro(draft); } });
  const invalid = await catalog.create({ name: 'Macro', steps: [], secret: 'must not persist' });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.error.code, 'INVALID_REQUEST');
  const controller = new AbortController();
  controller.abort();
  const cancelled = await catalog.create({ name: 'Macro', steps: [] }, controller.signal);
  assert.equal(cancelled.ok, false);
  if (!cancelled.ok) assert.equal(cancelled.error.code, 'CANCELLED');
  assert.equal(writes, 0);
});
