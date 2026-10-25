import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkbenchPreferencesManager } from '../../packages/application/src/workbench-preferences.ts';
import { StorageOperationError } from '../../packages/application/src/storage-errors.ts';
import { MAX_STARTUP_GREETING_CODE_POINTS, normalizeWorkbenchPreferences } from '../../packages/domain/src/workbench-preferences.ts';

test('workbench greeting validation preserves Unicode, normalizes newlines, and accepts clearing the greeting', () => {
  assert.deepEqual(normalizeWorkbenchPreferences({ startupGreeting: 'Привет 👋\r\nこんにちは' }), { startupGreeting: 'Привет 👋\nこんにちは' });
  assert.deepEqual(normalizeWorkbenchPreferences({ startupGreeting: '' }), { startupGreeting: '' });
  assert.equal(normalizeWorkbenchPreferences({ startupGreeting: '👋'.repeat(MAX_STARTUP_GREETING_CODE_POINTS + 1) }), undefined);
  assert.equal(normalizeWorkbenchPreferences({ startupGreeting: 'hello\u0000world' }), undefined);
  assert.equal(normalizeWorkbenchPreferences({ startupGreeting: 'hello\u0085world' }), undefined);
  assert.equal(normalizeWorkbenchPreferences({ startupGreeting: 'safe', credential: 'secret' }), undefined);
});

test('preferences manager validates before storage and returns saved values', async () => {
  const writes: string[] = [];
  const manager = createWorkbenchPreferencesManager({
    async readWorkbenchPreferences() { return { startupGreeting: 'Original' }; },
    async saveWorkbenchPreferences(preferences) { writes.push(preferences.startupGreeting); return preferences; }
  });

  assert.deepEqual(await manager.read(), { ok: true, result: { startupGreeting: 'Original' } });
  assert.deepEqual(await manager.save({ startupGreeting: 'Terminal ready — こんにちは' }),
    { ok: true, result: { startupGreeting: 'Terminal ready — こんにちは' } });
  assert.deepEqual(await manager.save({ startupGreeting: 'bad\u0007value' }),
    { ok: false, error: { code: 'INVALID_REQUEST', target: 'application', retryable: false } });
  assert.deepEqual(writes, ['Terminal ready — こんにちは']);
});

test('preferences manager preserves the corrupt-storage error category', async () => {
  const manager = createWorkbenchPreferencesManager({
    async readWorkbenchPreferences() { throw new StorageOperationError('corrupt'); },
    async saveWorkbenchPreferences(preferences) { return preferences; }
  });

  assert.deepEqual(await manager.read(), {
    ok: false,
    error: { code: 'CORRUPT', target: 'application', retryable: false }
  });
});
