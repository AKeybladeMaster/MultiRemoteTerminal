import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkbenchPreferencesManager } from '../../packages/application/src/workbench-preferences.ts';
import { StorageOperationError } from '../../packages/application/src/storage-errors.ts';
import { DEFAULT_WORKBENCH_PREFERENCES, MAX_STARTUP_GREETING_CODE_POINTS, normalizeWorkbenchPreferences,
  toWorkbenchStartupPreferences } from '../../packages/domain/src/workbench-preferences.ts';
import { DEFAULT_ENABLED_LOCAL_SHELLS, DEFAULT_VISIBLE_LOCAL_SHELLS, normalizeEnabledLocalShells } from '../../packages/domain/src/local-shell-tools.ts';
import { DEFAULT_ENABLED_OPTIONAL_CONNECTIONS, normalizeEnabledOptionalConnections } from '../../packages/domain/src/optional-connection-tools.ts';
import { MAX_POWERSHELL_PROFILE_SCRIPT_CODE_UNITS, normalizePowerShellProfileScript } from '../../packages/domain/src/powershell-profile.ts';

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

test('workbench preferences migrate session-saving schema with terminal shell coloring disabled by default', () => {
  const previous = { startupGreeting: 'Ready', terminalHighlightEnabled: true,
    terminalHighlightRules: [{ pattern: 'error', color: 'red' as const }], autoSaveSessions: true };
  assert.deepEqual(normalizeWorkbenchPreferences(previous), {
    ...DEFAULT_WORKBENCH_PREFERENCES, startupGreeting: 'Ready', terminalHighlightEnabled: true,
    terminalHighlightRules: [{ pattern: 'error', color: 'red' }], autoSaveSessions: true,
    terminalShellSyntaxEnabled: false
  });
  assert.deepEqual(normalizeWorkbenchPreferences({ ...previous, terminalShellSyntaxEnabled: true }), {
    ...DEFAULT_WORKBENCH_PREFERENCES, startupGreeting: 'Ready', terminalHighlightEnabled: true,
    terminalHighlightRules: [{ pattern: 'error', color: 'red' }], autoSaveSessions: true,
    terminalShellSyntaxEnabled: true
  });
  assert.equal(normalizeWorkbenchPreferences({ ...previous, terminalShellSyntaxEnabled: 'yes' }), undefined);
});

test('workbench preferences migrate shell-coloring schema with contextual SFTP pane enabled by default', () => {
  const previous = { startupGreeting: 'Ready', terminalHighlightEnabled: true,
    terminalHighlightRules: [{ pattern: 'error', color: 'red' as const }], autoSaveSessions: true,
    terminalShellSyntaxEnabled: true };
  assert.deepEqual(normalizeWorkbenchPreferences(previous), {
    ...DEFAULT_WORKBENCH_PREFERENCES, startupGreeting: 'Ready', terminalHighlightEnabled: true,
    terminalHighlightRules: [{ pattern: 'error', color: 'red' }], autoSaveSessions: true,
    terminalShellSyntaxEnabled: true, showSftpBrowserBesideSsh: true
  });
  assert.deepEqual(normalizeWorkbenchPreferences({ ...previous, showSftpBrowserBesideSsh: false }), {
    ...DEFAULT_WORKBENCH_PREFERENCES, startupGreeting: 'Ready', terminalHighlightEnabled: true,
    terminalHighlightRules: [{ pattern: 'error', color: 'red' }], autoSaveSessions: true,
    terminalShellSyntaxEnabled: true, showSftpBrowserBesideSsh: false
  });
  assert.equal(normalizeWorkbenchPreferences({ ...previous, showSftpBrowserBesideSsh: 'no' }), undefined);
});

test('workbench preferences migrate shell visibility defaults and reject unknown or duplicate tools', () => {
  const previous = { startupGreeting: 'Ready', terminalHighlightEnabled: true, terminalHighlightRules: [],
    autoSaveSessions: true, terminalShellSyntaxEnabled: true, showSftpBrowserBesideSsh: false };
  assert.deepEqual(normalizeWorkbenchPreferences(previous), {
    ...DEFAULT_WORKBENCH_PREFERENCES, ...previous
  });
  assert.deepEqual(normalizeWorkbenchPreferences({ ...previous, visibleLocalShells: ['bash', 'powershell'] })?.visibleLocalShells,
    ['powershell', 'bash']);
  assert.deepEqual(normalizeWorkbenchPreferences({ ...previous, visibleLocalShells: [] })?.visibleLocalShells, []);
  assert.deepEqual(DEFAULT_VISIBLE_LOCAL_SHELLS, ['powershell', 'cmd', 'bash', 'wsl']);
  assert.equal(normalizeWorkbenchPreferences({ ...previous, visibleLocalShells: ['powershell', 'unknown'] }), undefined);
  assert.equal(normalizeWorkbenchPreferences({ ...previous, visibleLocalShells: ['bash', 'bash'] }), undefined);
  assert.equal(normalizeWorkbenchPreferences({ ...previous, visibleLocalShells: 'bash' }), undefined);
});

test('workbench preferences migrate schema v7 and validate bounded normalized logos', () => {
  const previous = { startupGreeting: 'Ready', terminalHighlightEnabled: false, terminalHighlightRules: [],
    autoSaveSessions: false, terminalShellSyntaxEnabled: false, showSftpBrowserBesideSsh: true,
    visibleLocalShells: ['powershell', 'bash'] };
  assert.deepEqual(normalizeWorkbenchPreferences(previous, 7), {
    ...DEFAULT_WORKBENCH_PREFERENCES, ...previous
  });
  const logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
  assert.deepEqual(normalizeWorkbenchPreferences({ ...previous, customLogoDataUrl: logo }), {
    ...DEFAULT_WORKBENCH_PREFERENCES, ...previous, customLogoDataUrl: logo
  });
  assert.equal(normalizeWorkbenchPreferences({ ...previous, customLogoDataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }), undefined);
  assert.equal(normalizeWorkbenchPreferences({ ...previous, customLogoDataUrl: 'data:image/png;base64,../../bad' }), undefined);
  assert.equal(normalizeWorkbenchPreferences({ ...previous, customLogoDataUrl: 42 }), undefined);
});

test('workbench preferences migrate schema v8 logos with an empty profile script and reject malformed scripts', () => {
  const logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
  const schemaV8 = { startupGreeting: 'Ready', terminalHighlightEnabled: false, terminalHighlightRules: [],
    autoSaveSessions: false, terminalShellSyntaxEnabled: false, showSftpBrowserBesideSsh: true,
    visibleLocalShells: ['powershell', 'bash', 'wsl'], customLogoDataUrl: logo };
  assert.deepEqual(normalizeWorkbenchPreferences(schemaV8, 8), { ...DEFAULT_WORKBENCH_PREFERENCES, ...schemaV8 });
  assert.equal(normalizeWorkbenchPreferences({ ...schemaV8, powerShellProfileScript: 'bad\u0000script' }), undefined);
  assert.equal(normalizeWorkbenchPreferences({ ...schemaV8, powerShellProfileScript: 'x'.repeat(16_001) }), undefined);
});

test('optional connection preferences use a fixed allowlist and migrate schema v9 with providers enabled', () => {
  assert.equal(DEFAULT_ENABLED_OPTIONAL_CONNECTIONS.includes('x11'), false);
  assert.equal(DEFAULT_ENABLED_OPTIONAL_CONNECTIONS.includes('xdmcp'), false);
  assert.deepEqual(normalizeEnabledOptionalConnections(['vnc', 'telnet']), ['telnet', 'vnc']);
  assert.deepEqual(normalizeEnabledOptionalConnections([]), []);
  assert.equal(normalizeEnabledOptionalConnections(['telnet', 'telnet']), undefined);
  assert.equal(normalizeEnabledOptionalConnections(['arbitrary']), undefined);

  const schemaV9 = { startupGreeting: 'Ready', terminalHighlightEnabled: false, terminalHighlightRules: [],
    autoSaveSessions: false, terminalShellSyntaxEnabled: false, showSftpBrowserBesideSsh: true,
    visibleLocalShells: ['powershell', 'bash', 'wsl'],
    customLogoDataUrl: null, powerShellProfileScript: '' };
  assert.deepEqual(normalizeWorkbenchPreferences(schemaV9, 9), {
    ...DEFAULT_WORKBENCH_PREFERENCES, ...schemaV9, enabledOptionalConnections: DEFAULT_ENABLED_OPTIONAL_CONNECTIONS
  });
  assert.deepEqual(normalizeWorkbenchPreferences({ ...schemaV9, enabledOptionalConnections: ['ftp'] })?.enabledOptionalConnections, ['ftp']);
  assert.equal(normalizeWorkbenchPreferences({ ...schemaV9, enabledOptionalConnections: ['unknown'] }), undefined);
});

test('local shell availability is independent from palette visibility and migrates schema v10 enabled', () => {
  const schemaV10 = { startupGreeting: 'Ready', terminalHighlightEnabled: false, terminalHighlightRules: [],
    autoSaveSessions: false, terminalShellSyntaxEnabled: false, showSftpBrowserBesideSsh: true,
    visibleLocalShells: ['powershell', 'bash', 'wsl'], customLogoDataUrl: null, powerShellProfileScript: '',
    enabledOptionalConnections: ['ftp'] };
  assert.deepEqual(DEFAULT_ENABLED_LOCAL_SHELLS, ['powershell', 'cmd', 'bash', 'wsl']);
  assert.deepEqual(normalizeEnabledLocalShells(['wsl', 'bash']), ['bash', 'wsl']);
  assert.deepEqual(normalizeEnabledLocalShells([]), []);
  assert.equal(normalizeEnabledLocalShells(['bash', 'bash']), undefined);
  assert.equal(normalizeEnabledLocalShells(['unknown']), undefined);
  assert.deepEqual(normalizeWorkbenchPreferences(schemaV10, 10), {
    ...DEFAULT_WORKBENCH_PREFERENCES, ...schemaV10, enabledLocalShells: DEFAULT_ENABLED_LOCAL_SHELLS
  });
  const currentSchema = { ...schemaV10, enabledLocalShells: ['cmd'] };
  assert.deepEqual(normalizeWorkbenchPreferences(currentSchema)?.enabledLocalShells, ['cmd']);
  assert.deepEqual(normalizeWorkbenchPreferences(currentSchema)?.enabledOptionalConnections, ['ftp']);
  assert.equal(normalizeWorkbenchPreferences({ ...schemaV10, enabledLocalShells: ['cmd', 'cmd'] }), undefined);
  assert.equal(normalizeWorkbenchPreferences({ ...schemaV10, enabledLocalShells: ['unknown'] }), undefined);
});

test('PowerShell profile text normalizes newlines and rejects unreviewable controls and oversized scripts', () => {
  assert.equal(normalizePowerShellProfileScript('function Say-Hello {\r\n  "hello"\r\n}'),
    'function Say-Hello {\n  "hello"\n}');
  assert.equal(normalizePowerShellProfileScript('Write-Output "bad\u0000text"'), undefined);
  assert.equal(normalizePowerShellProfileScript('Write-Output "bad\u0085text"'), undefined);
  assert.equal(normalizePowerShellProfileScript('Write-Output "safe"\u202E; Remove-Item *'), undefined,
    'bidi overrides must not visually disguise reviewed script text');
  assert.equal(normalizePowerShellProfileScript('Write-Output "safe"\u2066; Remove-Item *\u2069'), undefined,
    'bidi isolates must not visually disguise reviewed script text');
  assert.equal(normalizePowerShellProfileScript('Write-Output "safe"\u2028; Remove-Item *'), undefined,
    'Unicode line separators must not obscure command boundaries');
  assert.equal(normalizePowerShellProfileScript('x'.repeat(MAX_POWERSHELL_PROFILE_SCRIPT_CODE_UNITS + 1)), undefined);
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

test('startup preferences omit the saved PowerShell script while settings retain it', async () => {
  const stored = { ...DEFAULT_WORKBENCH_PREFERENCES, powerShellProfileScript: 'Write-Output "private setting"' };
  const manager = createWorkbenchPreferencesManager({
    async readWorkbenchPreferences() { return stored; },
    async saveWorkbenchPreferences(preferences) { return preferences; }
  });

  const startup = await manager.readStartup();
  assert.deepEqual(startup, { ok: true, result: toWorkbenchStartupPreferences(stored) });
  assert.equal(startup.ok && Object.hasOwn(startup.result, 'powerShellProfileScript'), false);
  assert.deepEqual(await manager.read(), { ok: true, result: stored });
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

test('settings template import returns a draft without persisting it and export requires a selected path', async () => {
  const imported = { ...DEFAULT_WORKBENCH_PREFERENCES, startupGreeting: 'Imported draft' };
  let exported: unknown;
  let saved = false;
  const store = {
    async readWorkbenchPreferences() { return DEFAULT_WORKBENCH_PREFERENCES; },
    async saveWorkbenchPreferences(preferences: typeof DEFAULT_WORKBENCH_PREFERENCES) { saved = true; return preferences; },
    async exportWorkbenchSettingsTemplate(_path: string, preferences: typeof DEFAULT_WORKBENCH_PREFERENCES) {
      exported = preferences;
      return { bytesSaved: 256 };
    },
    async importWorkbenchSettingsTemplate() { return imported; }
  };
  const manager = createWorkbenchPreferencesManager(store, store, {
    async selectExportPath() { return 'C:\\settings.json'; },
    async selectImportPath() { return 'C:\\settings.json'; }
  });

  assert.deepEqual(await manager.exportTemplate(DEFAULT_WORKBENCH_PREFERENCES), { ok: true, result: { bytesSaved: 256 } });
  assert.deepEqual(exported, DEFAULT_WORKBENCH_PREFERENCES);
  assert.deepEqual(await manager.importTemplate(), { ok: true, result: imported });
  assert.equal(saved, false, 'loading a template only prepares the settings draft');

  const cancelled = createWorkbenchPreferencesManager(store, store, {
    async selectExportPath() { return undefined; },
    async selectImportPath() { return undefined; }
  });
  assert.deepEqual(await cancelled.exportTemplate(DEFAULT_WORKBENCH_PREFERENCES), {
    ok: false, error: { code: 'CANCELLED', target: 'application', retryable: false }
  });
});
