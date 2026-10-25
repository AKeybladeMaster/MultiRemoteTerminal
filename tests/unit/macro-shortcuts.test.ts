import assert from 'node:assert/strict';
import test from 'node:test';
import { createMacroCatalog } from '../../packages/application/src/macros.ts';
import type { MacroCatalogStore } from '../../packages/application/src/macros.ts';
import type { MacroDefinition, MacroDraft } from '../../packages/domain/src/macro.ts';
import type { MacroShortcutBinding, MacroShortcutCode } from '../../packages/domain/src/macro-shortcut.ts';
import { StorageOperationError } from '../../packages/application/src/storage-errors.ts';

function memoryStore(): MacroCatalogStore {
  const macros = new Map<string, MacroDefinition>();
  const bindings = new Map<string, MacroShortcutBinding>();
  return {
    async listMacros() { return [...macros.values()]; },
    async createMacro(draft: MacroDraft) {
      const now = '2026-10-25T00:00:00.000Z';
      const macro = { ...draft, id: `00000000-0000-4000-8000-${String(macros.size + 1).padStart(12, '0')}`,
        schemaVersion: 1 as const, createdAt: now, updatedAt: now };
      macros.set(macro.id, macro);
      return macro;
    },
    async updateMacro() { return undefined; },
    async removeMacro(id) {
      const removed = macros.delete(id);
      if (removed) bindings.delete(id);
      return removed;
    },
    async listMacroShortcuts() { return [...bindings.values()]; },
    async setMacroShortcut(macroId, code) {
      if (!macros.has(macroId)) throw new StorageOperationError('not-found');
      if ([...bindings.values()].some(binding => binding.code === code && binding.macroId !== macroId)) {
        throw new StorageOperationError('conflict');
      }
      const binding = { macroId, code };
      bindings.set(macroId, binding);
      return binding;
    },
    async removeMacroShortcut(macroId) { return bindings.delete(macroId); }
  };
}

test('macro catalog validates, stores and clears persistent shortcut bindings with conflict isolation', async () => {
  const store = memoryStore();
  const catalog = createMacroCatalog(store);
  const first = await catalog.create({ name: 'First', steps: [] });
  const second = await catalog.create({ name: 'Second', steps: [] });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;

  const setFirst = await catalog.setShortcut(first.result.id, 'F2');
  assert.deepEqual(setFirst, { ok: true, result: { macroId: first.result.id, code: 'F2' } });
  assert.deepEqual(await catalog.listShortcuts(), { ok: true, result: [{ macroId: first.result.id, code: 'F2' }] });
  assert.deepEqual(await catalog.setShortcut(first.result.id, 'F3'), { ok: true, result: { macroId: first.result.id, code: 'F3' } });
  assert.deepEqual(await catalog.setShortcut(second.result.id, 'F3'), { ok: false, error: { code: 'CONFLICT', target: 'application', retryable: false } });
  assert.deepEqual(await catalog.setShortcut(first.result.id, 'Ctrl+F1'), { ok: false, error: { code: 'INVALID_REQUEST', target: 'application', retryable: false } });
  assert.deepEqual(await catalog.removeShortcut(first.result.id), { ok: true, result: {} });
  assert.deepEqual(await catalog.removeShortcut(first.result.id), { ok: false, error: { code: 'NOT_FOUND', target: 'application', retryable: false } });
  assert.deepEqual(await catalog.setShortcut('missing', 'F1' as MacroShortcutCode), { ok: false, error: { code: 'INVALID_REQUEST', target: 'application', retryable: false } });
});
