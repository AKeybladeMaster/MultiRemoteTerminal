import { normalizeTerminalHighlightRules } from './terminal-highlights.ts';
import type { TerminalHighlightRule } from './terminal-highlights.ts';
import { DEFAULT_VISIBLE_LOCAL_SHELLS, normalizeVisibleLocalShells } from './local-shell-tools.ts';
import type { LocalShell } from './local-terminal.ts';

export const WORKBENCH_PREFERENCES_SCHEMA_VERSION = 6;
export const LEGACY_WORKBENCH_PREFERENCES_SCHEMA_VERSIONS = Object.freeze([1, 2, 3, 4, 5] as const);
export const MAX_STARTUP_GREETING_CODE_POINTS = 512;

export interface WorkbenchPreferences {
  readonly startupGreeting: string;
  readonly terminalHighlightEnabled: boolean;
  readonly terminalHighlightRules: readonly TerminalHighlightRule[];
  readonly autoSaveSessions: boolean;
  readonly terminalShellSyntaxEnabled: boolean;
  readonly showSftpBrowserBesideSsh: boolean;
  readonly visibleLocalShells: readonly LocalShell[];
}

export const DEFAULT_WORKBENCH_PREFERENCES: WorkbenchPreferences = Object.freeze({
  startupGreeting: '', terminalHighlightEnabled: false, terminalHighlightRules: Object.freeze([]), autoSaveSessions: false,
  terminalShellSyntaxEnabled: false, showSftpBrowserBesideSsh: true, visibleLocalShells: DEFAULT_VISIBLE_LOCAL_SHELLS
});

export function normalizeWorkbenchPreferences(value: unknown): WorkbenchPreferences | undefined {
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
  const isCurrentShape = keys.length === 7 && Object.hasOwn(value, 'terminalHighlightEnabled') &&
    Object.hasOwn(value, 'terminalHighlightRules') && Object.hasOwn(value, 'autoSaveSessions') &&
    Object.hasOwn(value, 'terminalShellSyntaxEnabled') && Object.hasOwn(value, 'showSftpBrowserBesideSsh') &&
    Object.hasOwn(value, 'visibleLocalShells');
  if (!isGreetingOnlyShape && !isHighlightShape && !isSessionSaveShape && !isShellSyntaxShape && !isSftpPaneShape && !isCurrentShape) return undefined;

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
    visibleLocalShells: DEFAULT_VISIBLE_LOCAL_SHELLS });
  if (typeof value.autoSaveSessions !== 'boolean') return undefined;
  if (isSessionSaveShape) return Object.freeze({ startupGreeting, terminalHighlightEnabled: value.terminalHighlightEnabled,
    terminalHighlightRules, autoSaveSessions: value.autoSaveSessions, terminalShellSyntaxEnabled: false,
    showSftpBrowserBesideSsh: true, visibleLocalShells: DEFAULT_VISIBLE_LOCAL_SHELLS });
  if (typeof value.terminalShellSyntaxEnabled !== 'boolean') return undefined;
  if (isShellSyntaxShape) return Object.freeze({ startupGreeting, terminalHighlightEnabled: value.terminalHighlightEnabled,
    terminalHighlightRules, autoSaveSessions: value.autoSaveSessions, terminalShellSyntaxEnabled: value.terminalShellSyntaxEnabled,
    showSftpBrowserBesideSsh: true, visibleLocalShells: DEFAULT_VISIBLE_LOCAL_SHELLS });
  if (!isSftpPaneShape && !isCurrentShape) return undefined;
  if (typeof value.showSftpBrowserBesideSsh !== 'boolean') return undefined;
  if (isSftpPaneShape) return Object.freeze({ startupGreeting, terminalHighlightEnabled: value.terminalHighlightEnabled,
    terminalHighlightRules, autoSaveSessions: value.autoSaveSessions, terminalShellSyntaxEnabled: value.terminalShellSyntaxEnabled,
    showSftpBrowserBesideSsh: value.showSftpBrowserBesideSsh, visibleLocalShells: DEFAULT_VISIBLE_LOCAL_SHELLS });
  const visibleLocalShells = normalizeVisibleLocalShells(value.visibleLocalShells);
  if (!visibleLocalShells) return undefined;
  return Object.freeze({ startupGreeting, terminalHighlightEnabled: value.terminalHighlightEnabled, terminalHighlightRules,
    autoSaveSessions: value.autoSaveSessions, terminalShellSyntaxEnabled: value.terminalShellSyntaxEnabled,
    showSftpBrowserBesideSsh: value.showSftpBrowserBesideSsh, visibleLocalShells });
}

export function isWorkbenchPreferences(value: unknown): value is WorkbenchPreferences {
  return normalizeWorkbenchPreferences(value) !== undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
