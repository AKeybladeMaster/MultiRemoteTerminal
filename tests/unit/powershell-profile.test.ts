import assert from 'node:assert/strict';
import test from 'node:test';
import { createPowerShellProfileScriptController } from '../../packages/application/src/powershell-profile.ts';
import type { WorkbenchPreferences } from '../../packages/domain/src/workbench-preferences.ts';
import { DEFAULT_WORKBENCH_PREFERENCES } from '../../packages/domain/src/workbench-preferences.ts';
import { failure } from '../../packages/domain/src/errors.ts';

const sessionId = '5726a2ee-03cd-4f5a-a28c-bd72784f80a6';
const otherSessionId = 'c8f87744-bd2c-4c0d-9a18-a4a324dd71fd';
test('profile preview is bound to the target session and applies only the exact saved script once', async () => {
  const stored: WorkbenchPreferences = { ...DEFAULT_WORKBENCH_PREFERENCES, powerShellProfileScript: 'Write-Output "ready"' };
  const applied: Array<{ sessionId: string; script: string }> = [];
  const controller = createPowerShellProfileScriptController(
    { async read() { return { ok: true, result: stored }; } },
    { async applyPowerShellProfileScript(targetSessionId, script) {
      applied.push({ sessionId: targetSessionId, script });
      return { ok: true, result: {} };
    } },
    (() => {
      const ids = ['18f2f903-7b6f-4c8d-9c42-b63a58c4b087', 'c1f3ace8-9464-449b-9459-a41b642dc2a7'];
      return () => ids.shift() ?? '';
    })()
  );

  const preview = await controller.preview(sessionId);
  assert.deepEqual(preview, { ok: true, result: { previewId: '18f2f903-7b6f-4c8d-9c42-b63a58c4b087', script: 'Write-Output "ready"' } });
  if (!preview.ok) return;
  assert.equal((await controller.apply(otherSessionId, preview.result.previewId)).ok, false, 'preview cannot be reused on another tab');
  assert.deepEqual(await controller.apply(sessionId, preview.result.previewId), {
    ok: false, error: { code: 'FORBIDDEN', target: 'application', retryable: false }
  }, 'a mismatched target consumes its token');
  assert.deepEqual(applied, []);

  const secondPreview = await controller.preview(sessionId);
  assert.equal(secondPreview.ok, true);
  if (!secondPreview.ok) return;
  assert.deepEqual(await controller.apply(sessionId, secondPreview.result.previewId), { ok: true, result: {} });
  assert.deepEqual(applied, [{ sessionId, script: 'Write-Output "ready"' }]);
  assert.equal((await controller.apply(sessionId, secondPreview.result.previewId)).ok, false, 'preview token is one-shot');
  controller.clear();
});

test('profile apply rejects a changed saved script, expired preview, and empty profile', async () => {
  let now = 100;
  let stored: WorkbenchPreferences = { ...DEFAULT_WORKBENCH_PREFERENCES, powerShellProfileScript: 'Write-Output "before"' };
  const ids = ['18f2f903-7b6f-4c8d-9c42-b63a58c4b087', 'c1f3ace8-9464-449b-9459-a41b642dc2a7'];
  let idIndex = 0;
  let applied = 0;
  const controller = createPowerShellProfileScriptController(
    { async read() { return { ok: true, result: stored }; } },
    { async applyPowerShellProfileScript() { applied++; return { ok: true, result: {} }; } },
    () => ids[idIndex++] ?? '',
    () => now
  );

  const changed = await controller.preview(sessionId);
  assert.equal(changed.ok, true);
  if (!changed.ok) return;
  stored = { ...stored, powerShellProfileScript: 'Write-Output "after"' };
  assert.deepEqual(await controller.apply(sessionId, changed.result.previewId), {
    ok: false, error: { code: 'CONFLICT', target: 'application', retryable: false }
  });

  stored = { ...stored, powerShellProfileScript: 'Write-Output "before"' };
  const expired = await controller.preview(sessionId);
  assert.equal(expired.ok, true);
  if (!expired.ok) return;
  now += 5 * 60_000 + 1;
  assert.equal((await controller.apply(sessionId, expired.result.previewId)).ok, false);
  assert.equal(applied, 0);

  stored = { ...stored, powerShellProfileScript: '' };
  assert.deepEqual(await controller.preview(sessionId), failure('INVALID_REQUEST'));
});
