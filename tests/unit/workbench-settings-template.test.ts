import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_WORKBENCH_PREFERENCES } from '../../packages/domain/src/workbench-preferences.ts';
import { MAX_WORKBENCH_SETTINGS_TEMPLATE_BYTES, WORKBENCH_SETTINGS_TEMPLATE_FORMAT, parseWorkbenchSettingsTemplate,
  serializeWorkbenchSettingsTemplate } from '../../packages/domain/src/workbench-settings-template.ts';

test('settings template round-trips the complete current preferences shape', () => {
  const preferences = {
    ...DEFAULT_WORKBENCH_PREFERENCES,
    startupGreeting: 'Ready — Привет',
    terminalHighlightEnabled: true,
    terminalHighlightRules: [{ pattern: 'error', color: 'red' as const }],
    autoSaveSessions: true,
    terminalShellSyntaxEnabled: true,
    showSftpBrowserBesideSsh: false,
    powerShellProfileScript: 'Write-Output "review before sharing"'
  };
  const serialized = serializeWorkbenchSettingsTemplate(preferences);
  assert.ok(serialized);
  assert.deepEqual(parseWorkbenchSettingsTemplate(serialized), preferences);
  const template = JSON.parse(serialized) as { format: string; version: number };
  assert.equal(template.format, WORKBENCH_SETTINGS_TEMPLATE_FORMAT);
  assert.equal(template.version, 1);
  assert.doesNotMatch(serialized, /credential|password|privateKey/i);
});

test('settings templates reject unknown fields, stale versions, malformed JSON and oversized input', () => {
  const serialized = serializeWorkbenchSettingsTemplate(DEFAULT_WORKBENCH_PREFERENCES);
  assert.ok(serialized);
  const template = JSON.parse(serialized) as Record<string, unknown>;
  assert.equal(parseWorkbenchSettingsTemplate(JSON.stringify({ ...template, credentials: [] })), undefined);
  assert.equal(parseWorkbenchSettingsTemplate(JSON.stringify({ ...template, version: 2 })), undefined);
  assert.equal(parseWorkbenchSettingsTemplate('{'), undefined);
  assert.equal(parseWorkbenchSettingsTemplate(' '.repeat(MAX_WORKBENCH_SETTINGS_TEMPLATE_BYTES + 1)), undefined);
});
