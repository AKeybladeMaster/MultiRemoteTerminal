import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkbenchPreferencesManager } from '../../packages/application/src/workbench-preferences.ts';
import { StorageOperationError } from '../../packages/application/src/storage-errors.ts';
import { DEFAULT_WORKBENCH_PREFERENCES, MAX_STARTUP_GREETING_CODE_POINTS, normalizeWorkbenchPreferences } from '../../packages/domain/src/workbench-preferences.ts';

test('workbench greeting validation preserves Unicode, normalizes newlines, and accepts clearing the greeting', () => {
  assert.deepEqual(normalizeWorkbenchPreferences({ startupGreeting: 'Привет 👋\r\nこんにちは' }), {
    ...DEFAULT_WORKBENCH_PREFERENCES, startupGreeting: 'Привет 👋\nこんにちは'
  });
  assert.deepEqual(normalizeWorkbenchPreferences({ startupGreeting: '' }), DEFAULT_WORKBENCH_PREFERENCES);
  assert.equal(normalizeWorkbenchPreferences({ startupGreeting: '👋'.repeat(MAX_STARTUP_GREETING_CODE_POINTS + 1) }), undefined);
  assert.equal(normalizeWorkbenchPreferences({ startupGreeting: 'hello\u0000world' }), undefined);
  assert.equal(normalizeWorkbenchPreferences({ startupGreeting: 'hello\u0085world' }), undefined);
  assert.equal(normalizeWorkbenchPreferences({ startupGreeting: 'safe', credential: 'secret' }), undefined);
});

test('workbench preferences migrate the prior highlight schema and validate opt-in session saving', () => {
  const previous = { startupGreeting: 'Ready', terminalHighlightEnabled: true,
    terminalHighlightRules: [{ pattern: 'error', color: 'red' }] };
  assert.deepEqual(normalizeWorkbenchPreferences(previous), {
    ...DEFAULT_WORKBENCH_PREFERENCES, startupGreeting: 'Ready', terminalHighlightEnabled: true,
    terminalHighlightRules: [{ pattern: 'error', color: 'red' }]
  });
  assert.deepEqual(normalizeWorkbenchPreferences({ ...previous, autoSaveSessions: true }), {
    ...DEFAULT_WORKBENCH_PREFERENCES, startupGreeting: 'Ready', terminalHighlightEnabled: true,
    terminalHighlightRules: [{ pattern: 'error', color: 'red' }], autoSaveSessions: true
  });
  assert.equal(normalizeWorkbenchPreferences({ ...previous, autoSaveSessions: 'yes' }), undefined);
  assert.equal(normalizeWorkbenchPreferences({ ...previous, autoSaveSessions: true, credential: 'secret' }), undefined);
});

test('workbench greeting validation rejects oversized input before normalization scans it', () => {
  const originalReplace = String.prototype.replace;
  let scannedOversizedInput = false;
  let normalized: ReturnType<typeof normalizeWorkbenchPreferences>;
  String.prototype.replace = function (searchValue, replaceValue) {
    if (this.length > MAX_STARTUP_GREETING_CODE_POINTS * 2) scannedOversizedInput = true;
    return Reflect.apply(originalReplace, this, [searchValue, replaceValue]) as string;
  };
  try {
    normalized = normalizeWorkbenchPreferences({ startupGreeting: 'x'.repeat(MAX_STARTUP_GREETING_CODE_POINTS * 2 + 1) });
  } finally {
    String.prototype.replace = originalReplace;
  }
  assert.equal(normalized, undefined);
  assert.equal(scannedOversizedInput, false);
});

test('preferences manager validates before storage and returns saved values', async () => {
  const writes: string[] = [];
  const manager = createWorkbenchPreferencesManager({
    async readWorkbenchPreferences() { return { ...DEFAULT_WORKBENCH_PREFERENCES, startupGreeting: 'Original' }; },
    async saveWorkbenchPreferences(preferences) { writes.push(preferences.startupGreeting); return preferences; }
  });

  assert.deepEqual(await manager.read(), { ok: true, result: { ...DEFAULT_WORKBENCH_PREFERENCES, startupGreeting: 'Original' } });
  assert.deepEqual(await manager.save({ startupGreeting: 'Terminal ready — こんにちは' }),
    { ok: true, result: { ...DEFAULT_WORKBENCH_PREFERENCES, startupGreeting: 'Terminal ready — こんにちは' } });
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
