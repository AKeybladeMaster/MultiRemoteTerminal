import assert from 'node:assert/strict';
import test from 'node:test';
import { isMacroDefinition, normalizeMacroDraft } from '../../packages/domain/src/macro.ts';

test('macro definitions normalize typed steps and reject secret-shaped or executable multiline data', () => {
  const draft = normalizeMacroDraft({ name: '  Deploy  ', description: 'Review and deploy', steps: [
    { kind: 'send', text: 'npm run build' },
    { kind: 'waitForText', text: 'Build (green)', timeoutMs: 30_000 },
    { kind: 'delay', durationMs: 500 },
    { kind: 'confirm', message: 'Continue with deployment?' }
  ] });
  assert.deepEqual(draft, { name: 'Deploy', description: 'Review and deploy', steps: [
    { kind: 'send', text: 'npm run build' },
    { kind: 'waitForText', text: 'Build (green)', timeoutMs: 30_000 },
    { kind: 'delay', durationMs: 500 },
    { kind: 'confirm', message: 'Continue with deployment?' }
  ] });
  assert.equal(normalizeMacroDraft({ name: 'secret=not-a-macro', steps: [], password: 'forbidden' }), undefined);
  assert.equal(normalizeMacroDraft({ name: 'Build', steps: [{ kind: 'send', text: 'echo safe\nwhoami' }] }), undefined);
  assert.equal(normalizeMacroDraft({ name: 'Wait', steps: [{ kind: 'waitForText', text: 'ready', timeoutMs: 0 }] }), undefined);
});

test('stored macros require a canonical versioned shape with no credential fields', () => {
  const value = { id: '7c08b18a-57cc-4b44-a8b3-2d404850e81c', schemaVersion: 1, name: 'Health check', steps: [],
    createdAt: '2026-10-25T10:00:00.000Z', updatedAt: '2026-10-25T10:00:00.000Z' };
  assert.equal(isMacroDefinition(value), true);
  assert.equal(isMacroDefinition({ ...value, credentials: { password: 'secret' } }), false);
  assert.equal(isMacroDefinition({ ...value, schemaVersion: 2 }), false);
});
