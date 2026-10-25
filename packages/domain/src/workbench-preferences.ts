import { normalizeTerminalHighlightRules } from './terminal-highlights.ts';
import type { TerminalHighlightRule } from './terminal-highlights.ts';

export const WORKBENCH_PREFERENCES_SCHEMA_VERSION = 3;
export const LEGACY_WORKBENCH_PREFERENCES_SCHEMA_VERSIONS = Object.freeze([1, 2] as const);
export const MAX_STARTUP_GREETING_CODE_POINTS = 512;

export interface WorkbenchPreferences {
  readonly startupGreeting: string;
  readonly terminalHighlightEnabled: boolean;
  readonly terminalHighlightRules: readonly TerminalHighlightRule[];
  readonly autoSaveSessions: boolean;
}

export const DEFAULT_WORKBENCH_PREFERENCES: WorkbenchPreferences = Object.freeze({
  startupGreeting: '', terminalHighlightEnabled: false, terminalHighlightRules: Object.freeze([]), autoSaveSessions: false
});

export function normalizeWorkbenchPreferences(value: unknown): WorkbenchPreferences | undefined {
  if (!isRecord(value) || !Object.hasOwn(value, 'startupGreeting') || typeof value.startupGreeting !== 'string') return undefined;

  const keys = Object.keys(value);
  const isGreetingOnlyShape = keys.length === 1;
  const isHighlightShape = keys.length === 3 && Object.hasOwn(value, 'terminalHighlightEnabled') &&
    Object.hasOwn(value, 'terminalHighlightRules');
  const isCurrentShape = keys.length === 4 && Object.hasOwn(value, 'terminalHighlightEnabled') &&
    Object.hasOwn(value, 'terminalHighlightRules') && Object.hasOwn(value, 'autoSaveSessions');
  if (!isGreetingOnlyShape && !isHighlightShape && !isCurrentShape) return undefined;

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
    terminalHighlightRules, autoSaveSessions: false });
  if (typeof value.autoSaveSessions !== 'boolean') return undefined;
  return Object.freeze({ startupGreeting, terminalHighlightEnabled: value.terminalHighlightEnabled, terminalHighlightRules,
    autoSaveSessions: value.autoSaveSessions });
}

export function isWorkbenchPreferences(value: unknown): value is WorkbenchPreferences {
  return normalizeWorkbenchPreferences(value) !== undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
