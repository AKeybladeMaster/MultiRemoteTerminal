import { normalizeTerminalHighlightRules } from './terminal-highlights.ts';
import type { TerminalHighlightRule } from './terminal-highlights.ts';
import { DEFAULT_ENABLED_LOCAL_SHELLS, DEFAULT_VISIBLE_LOCAL_SHELLS, normalizeEnabledLocalShells, normalizeVisibleLocalShells } from './local-shell-tools.ts';
import type { LocalShell } from './local-terminal.ts';
import { isCustomLogoDataUrl, MAX_CUSTOM_LOGO_DATA_URL_LENGTH } from './custom-logo.ts';
import { MAX_POWERSHELL_PROFILE_SCRIPT_CODE_UNITS, normalizePowerShellProfileScript } from './powershell-profile.ts';
import { DEFAULT_ENABLED_OPTIONAL_CONNECTIONS, normalizeEnabledOptionalConnections } from './optional-connection-tools.ts';
import type { OptionalConnectionId } from './optional-connection-tools.ts';

export const WORKBENCH_PREFERENCES_SCHEMA_VERSION = 11;
export const LEGACY_WORKBENCH_PREFERENCES_SCHEMA_VERSIONS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const);
export const MAX_STARTUP_GREETING_CODE_POINTS = 512;
export const MAX_WORKBENCH_PREFERENCES_JSON_LENGTH = MAX_CUSTOM_LOGO_DATA_URL_LENGTH +
  MAX_POWERSHELL_PROFILE_SCRIPT_CODE_UNITS * 2 + 32_768;

export interface WorkbenchPreferences {
  readonly startupGreeting: string;
  readonly terminalHighlightEnabled: boolean;
  readonly terminalHighlightRules: readonly TerminalHighlightRule[];
  readonly autoSaveSessions: boolean;
  readonly terminalShellSyntaxEnabled: boolean;
  readonly showSftpBrowserBesideSsh: boolean;
  readonly visibleLocalShells: readonly LocalShell[];
  readonly enabledLocalShells: readonly LocalShell[];
  readonly enabledOptionalConnections: readonly OptionalConnectionId[];
  readonly customLogoDataUrl: string | null;
  readonly powerShellProfileScript: string;
}

export type WorkbenchStartupPreferences = Omit<WorkbenchPreferences, 'powerShellProfileScript'>;

export const DEFAULT_WORKBENCH_PREFERENCES: WorkbenchPreferences = Object.freeze({
  startupGreeting: '', terminalHighlightEnabled: false, terminalHighlightRules: Object.freeze([]), autoSaveSessions: false,
  terminalShellSyntaxEnabled: false, showSftpBrowserBesideSsh: true, visibleLocalShells: DEFAULT_VISIBLE_LOCAL_SHELLS,
  enabledLocalShells: DEFAULT_ENABLED_LOCAL_SHELLS,
  enabledOptionalConnections: DEFAULT_ENABLED_OPTIONAL_CONNECTIONS, customLogoDataUrl: null, powerShellProfileScript: ''
});

export function normalizeWorkbenchPreferences(value: unknown, sourceSchemaVersion?: number): WorkbenchPreferences | undefined {
  if (!isRecord(value) || !Object.hasOwn(value, 'startupGreeting') || typeof value.startupGreeting !== 'string') return undefined;

  const keys = Object.keys(value);
  const isGreetingOnlyShape = keys.length === 1;
  const isHighlightShape = keys.length === 3 && Object.hasOwn(value, 'terminalHighlightEnabled') &&
    Object.hasOwn(value, 'terminalHighlightRules');
  const isSessionSaveShape = keys.length === 4 && Object.hasOwn(value, 'terminalHighlightEnabled') &&
    Object.hasOwn(value, 'terminalHighlightRules') && Object.hasOwn(value, 'autoSaveSessions');
  const isShellSyntaxShape = keys.length === 5 && Object.hasOwn(value, 'terminalHighlightEnabled') &&
    Object.hasOwn(value, 'terminalHighlightRules') && Object.hasOwn(value, 'autoSaveSessions') &&
    Object.hasOwn(value, 'terminalShellSyntaxEnabled');
  const isSftpPaneShape = keys.length === 6 && Object.hasOwn(value, 'terminalHighlightEnabled') &&
    Object.hasOwn(value, 'terminalHighlightRules') && Object.hasOwn(value, 'autoSaveSessions') &&
    Object.hasOwn(value, 'terminalShellSyntaxEnabled') && Object.hasOwn(value, 'showSftpBrowserBesideSsh');
  const isPreviousSchemaShape = keys.length === 7 && Object.hasOwn(value, 'terminalHighlightEnabled') &&
    Object.hasOwn(value, 'terminalHighlightRules') && Object.hasOwn(value, 'autoSaveSessions') &&
    Object.hasOwn(value, 'terminalShellSyntaxEnabled') && Object.hasOwn(value, 'showSftpBrowserBesideSsh') &&
    Object.hasOwn(value, 'visibleLocalShells');
  const isCustomLogoShape = keys.length === 8 && Object.hasOwn(value, 'terminalHighlightEnabled') &&
    Object.hasOwn(value, 'terminalHighlightRules') && Object.hasOwn(value, 'autoSaveSessions') &&
    Object.hasOwn(value, 'terminalShellSyntaxEnabled') && Object.hasOwn(value, 'showSftpBrowserBesideSsh') &&
    Object.hasOwn(value, 'visibleLocalShells') && Object.hasOwn(value, 'customLogoDataUrl');
  const isPowerShellProfileShape = keys.length === 9 && Object.hasOwn(value, 'terminalHighlightEnabled') &&
    Object.hasOwn(value, 'terminalHighlightRules') && Object.hasOwn(value, 'autoSaveSessions') &&
    Object.hasOwn(value, 'terminalShellSyntaxEnabled') && Object.hasOwn(value, 'showSftpBrowserBesideSsh') &&
    Object.hasOwn(value, 'visibleLocalShells') && Object.hasOwn(value, 'customLogoDataUrl') &&
    Object.hasOwn(value, 'powerShellProfileScript');
  const isOptionalConnectionsShape = keys.length === 10 && Object.hasOwn(value, 'terminalHighlightEnabled') &&
    Object.hasOwn(value, 'terminalHighlightRules') && Object.hasOwn(value, 'autoSaveSessions') &&
    Object.hasOwn(value, 'terminalShellSyntaxEnabled') && Object.hasOwn(value, 'showSftpBrowserBesideSsh') &&
    Object.hasOwn(value, 'visibleLocalShells') && Object.hasOwn(value, 'customLogoDataUrl') &&
    Object.hasOwn(value, 'powerShellProfileScript') && Object.hasOwn(value, 'enabledOptionalConnections');
  const isLocalShellAvailabilityShape = keys.length === 11 && Object.hasOwn(value, 'terminalHighlightEnabled') &&
    Object.hasOwn(value, 'terminalHighlightRules') && Object.hasOwn(value, 'autoSaveSessions') &&
    Object.hasOwn(value, 'terminalShellSyntaxEnabled') && Object.hasOwn(value, 'showSftpBrowserBesideSsh') &&
    Object.hasOwn(value, 'visibleLocalShells') && Object.hasOwn(value, 'customLogoDataUrl') &&
    Object.hasOwn(value, 'powerShellProfileScript') && Object.hasOwn(value, 'enabledOptionalConnections') &&
    Object.hasOwn(value, 'enabledLocalShells');
  if (!isGreetingOnlyShape && !isHighlightShape && !isSessionSaveShape && !isShellSyntaxShape && !isSftpPaneShape &&
      !isPreviousSchemaShape && !isCustomLogoShape && !isPowerShellProfileShape && !isOptionalConnectionsShape &&
      !isLocalShellAvailabilityShape) return undefined;

  const inputGreeting = value.startupGreeting;
  if (inputGreeting.length > MAX_STARTUP_GREETING_CODE_POINTS * 2) return undefined;

  const startupGreeting = inputGreeting.replace(/\r\n?/gu, '\n');
  if (Array.from(startupGreeting).length > MAX_STARTUP_GREETING_CODE_POINTS ||
      /\p{Cc}/u.test(startupGreeting.replace(/[\n\t]/gu, ''))) return undefined;

  if (isGreetingOnlyShape) return Object.freeze({ ...DEFAULT_WORKBENCH_PREFERENCES, startupGreeting });
  if (typeof value.terminalHighlightEnabled !== 'boolean') return undefined;
  const terminalHighlightRules = normalizeTerminalHighlightRules(value.terminalHighlightRules);
  if (!terminalHighlightRules) return undefined;
  if (isHighlightShape) return Object.freeze({ startupGreeting, terminalHighlightEnabled: value.terminalHighlightEnabled,
    terminalHighlightRules, autoSaveSessions: false, terminalShellSyntaxEnabled: false, showSftpBrowserBesideSsh: true,
    visibleLocalShells: DEFAULT_VISIBLE_LOCAL_SHELLS, enabledOptionalConnections: DEFAULT_ENABLED_OPTIONAL_CONNECTIONS,
    enabledLocalShells: DEFAULT_ENABLED_LOCAL_SHELLS, customLogoDataUrl: null, powerShellProfileScript: '' });
  if (typeof value.autoSaveSessions !== 'boolean') return undefined;
  if (isSessionSaveShape) return Object.freeze({ startupGreeting, terminalHighlightEnabled: value.terminalHighlightEnabled,
    terminalHighlightRules, autoSaveSessions: value.autoSaveSessions, terminalShellSyntaxEnabled: false,
    showSftpBrowserBesideSsh: true, visibleLocalShells: DEFAULT_VISIBLE_LOCAL_SHELLS,
    enabledLocalShells: DEFAULT_ENABLED_LOCAL_SHELLS, enabledOptionalConnections: DEFAULT_ENABLED_OPTIONAL_CONNECTIONS,
    customLogoDataUrl: null, powerShellProfileScript: '' });
  if (typeof value.terminalShellSyntaxEnabled !== 'boolean') return undefined;
  if (isShellSyntaxShape) return Object.freeze({ startupGreeting, terminalHighlightEnabled: value.terminalHighlightEnabled,
    terminalHighlightRules, autoSaveSessions: value.autoSaveSessions, terminalShellSyntaxEnabled: value.terminalShellSyntaxEnabled,
    showSftpBrowserBesideSsh: true, visibleLocalShells: DEFAULT_VISIBLE_LOCAL_SHELLS,
    enabledLocalShells: DEFAULT_ENABLED_LOCAL_SHELLS, enabledOptionalConnections: DEFAULT_ENABLED_OPTIONAL_CONNECTIONS,
    customLogoDataUrl: null, powerShellProfileScript: '' });
  if (!isSftpPaneShape && !isPreviousSchemaShape && !isCustomLogoShape && !isPowerShellProfileShape &&
      !isOptionalConnectionsShape && !isLocalShellAvailabilityShape) return undefined;
  if (typeof value.showSftpBrowserBesideSsh !== 'boolean') return undefined;
  if (isSftpPaneShape) return Object.freeze({ startupGreeting, terminalHighlightEnabled: value.terminalHighlightEnabled,
    terminalHighlightRules, autoSaveSessions: value.autoSaveSessions, terminalShellSyntaxEnabled: value.terminalShellSyntaxEnabled,
    showSftpBrowserBesideSsh: value.showSftpBrowserBesideSsh, visibleLocalShells: DEFAULT_VISIBLE_LOCAL_SHELLS, customLogoDataUrl: null,
    enabledLocalShells: DEFAULT_ENABLED_LOCAL_SHELLS, enabledOptionalConnections: DEFAULT_ENABLED_OPTIONAL_CONNECTIONS,
    powerShellProfileScript: '' });
  let visibleLocalShells: readonly LocalShell[] | undefined;
  if (sourceSchemaVersion === 6) {
    const previousShells = normalizeVisibleLocalShells(value.visibleLocalShells, false);
    if (!previousShells) return undefined;
    visibleLocalShells = Object.freeze([...previousShells, 'wsl']);
  } else {
    visibleLocalShells = normalizeVisibleLocalShells(value.visibleLocalShells);
  }
  if (!visibleLocalShells) return undefined;
  const customLogoDataUrl = isCustomLogoShape || isPowerShellProfileShape || isOptionalConnectionsShape || isLocalShellAvailabilityShape
    ? value.customLogoDataUrl === null ? null : isCustomLogoDataUrl(value.customLogoDataUrl) ? value.customLogoDataUrl : undefined
    : null;
  if (customLogoDataUrl === undefined) return undefined;
  const powerShellProfileScript = isPowerShellProfileShape || isOptionalConnectionsShape || isLocalShellAvailabilityShape
    ? normalizePowerShellProfileScript(value.powerShellProfileScript)
    : '';
  if (powerShellProfileScript === undefined) return undefined;
  const enabledOptionalConnections = isOptionalConnectionsShape || isLocalShellAvailabilityShape
    ? normalizeEnabledOptionalConnections(value.enabledOptionalConnections)
    : DEFAULT_ENABLED_OPTIONAL_CONNECTIONS;
  if (!enabledOptionalConnections) return undefined;
  const enabledLocalShells = isLocalShellAvailabilityShape
    ? normalizeEnabledLocalShells(value.enabledLocalShells)
    : DEFAULT_ENABLED_LOCAL_SHELLS;
  if (!enabledLocalShells) return undefined;
  return Object.freeze({ startupGreeting, terminalHighlightEnabled: value.terminalHighlightEnabled, terminalHighlightRules,
    autoSaveSessions: value.autoSaveSessions, terminalShellSyntaxEnabled: value.terminalShellSyntaxEnabled,
    showSftpBrowserBesideSsh: value.showSftpBrowserBesideSsh, visibleLocalShells, enabledLocalShells, enabledOptionalConnections,
    customLogoDataUrl, powerShellProfileScript });
}

export function isWorkbenchPreferences(value: unknown): value is WorkbenchPreferences {
  return normalizeWorkbenchPreferences(value) !== undefined;
}

export function isCurrentWorkbenchPreferences(value: unknown): value is WorkbenchPreferences {
  return isRecord(value) && Object.hasOwn(value, 'powerShellProfileScript') && Object.hasOwn(value, 'enabledOptionalConnections') &&
    Object.hasOwn(value, 'enabledLocalShells') &&
    isWorkbenchPreferences(value);
}

export function toWorkbenchStartupPreferences(preferences: WorkbenchPreferences): WorkbenchStartupPreferences {
  return Object.freeze({
    startupGreeting: preferences.startupGreeting,
    terminalHighlightEnabled: preferences.terminalHighlightEnabled,
    terminalHighlightRules: preferences.terminalHighlightRules,
    autoSaveSessions: preferences.autoSaveSessions,
    terminalShellSyntaxEnabled: preferences.terminalShellSyntaxEnabled,
    showSftpBrowserBesideSsh: preferences.showSftpBrowserBesideSsh,
    visibleLocalShells: preferences.visibleLocalShells,
    enabledLocalShells: preferences.enabledLocalShells,
    enabledOptionalConnections: preferences.enabledOptionalConnections,
    customLogoDataUrl: preferences.customLogoDataUrl
  });
}

export function isWorkbenchStartupPreferences(value: unknown): value is WorkbenchStartupPreferences {
  if (!isRecord(value) || Object.hasOwn(value, 'powerShellProfileScript')) return false;
  const expectedKeys = ['startupGreeting', 'terminalHighlightEnabled', 'terminalHighlightRules', 'autoSaveSessions',
    'terminalShellSyntaxEnabled', 'showSftpBrowserBesideSsh', 'visibleLocalShells', 'enabledLocalShells',
    'enabledOptionalConnections', 'customLogoDataUrl'];
  return Object.keys(value).length === expectedKeys.length && expectedKeys.every(key => Object.hasOwn(value, key)) &&
    normalizeWorkbenchPreferences({ ...value, powerShellProfileScript: '' }) !== undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
