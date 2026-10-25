import { normalizeTerminalHighlightRules } from './terminal-highlights.ts';
import type { TerminalHighlightRule } from './terminal-highlights.ts';

export const WORKBENCH_PREFERENCES_SCHEMA_VERSION = 2;
export const LEGACY_WORKBENCH_PREFERENCES_SCHEMA_VERSION = 1;
export const MAX_STARTUP_GREETING_CODE_POINTS = 512;

export interface WorkbenchPreferences {
  readonly startupGreeting: string;
  readonly terminalHighlightEnabled: boolean;
  readonly terminalHighlightRules: readonly TerminalHighlightRule[];
}

export const DEFAULT_WORKBENCH_PREFERENCES: WorkbenchPreferences = Object.freeze({
  startupGreeting: '', terminalHighlightEnabled: false, terminalHighlightRules: Object.freeze([])
});

export function normalizeWorkbenchPreferences(value: unknown): WorkbenchPreferences | undefined {
  if (!isRecord(value) || !Object.hasOwn(value, 'startupGreeting') || typeof value.startupGreeting !== 'string') return undefined;

  const keys = Object.keys(value);
  const isLegacyShape = keys.length === 1;
  const isCurrentShape = keys.length === 3 && Object.hasOwn(value, 'terminalHighlightEnabled') &&
    Object.hasOwn(value, 'terminalHighlightRules');
  if (!isLegacyShape && !isCurrentShape) return undefined;

  const inputGreeting = value.startupGreeting;
  if (inputGreeting.length > MAX_STARTUP_GREETING_CODE_POINTS * 2) return undefined;

  const startupGreeting = inputGreeting.replace(/\r\n?/gu, '\n');
  if (Array.from(startupGreeting).length > MAX_STARTUP_GREETING_CODE_POINTS ||
      /\p{Cc}/u.test(startupGreeting.replace(/[\n\t]/gu, ''))) return undefined;

  if (isLegacyShape) return Object.freeze({ ...DEFAULT_WORKBENCH_PREFERENCES, startupGreeting });
  if (typeof value.terminalHighlightEnabled !== 'boolean') return undefined;
  const terminalHighlightRules = normalizeTerminalHighlightRules(value.terminalHighlightRules);
  if (!terminalHighlightRules) return undefined;
  return Object.freeze({ startupGreeting, terminalHighlightEnabled: value.terminalHighlightEnabled, terminalHighlightRules });
}

export function isWorkbenchPreferences(value: unknown): value is WorkbenchPreferences {
  return normalizeWorkbenchPreferences(value) !== undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
