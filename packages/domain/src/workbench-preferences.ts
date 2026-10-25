export const WORKBENCH_PREFERENCES_SCHEMA_VERSION = 1;
export const MAX_STARTUP_GREETING_CODE_POINTS = 512;

export interface WorkbenchPreferences {
  readonly startupGreeting: string;
}

export const DEFAULT_WORKBENCH_PREFERENCES: WorkbenchPreferences = Object.freeze({ startupGreeting: '' });

export function normalizeWorkbenchPreferences(value: unknown): WorkbenchPreferences | undefined {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, 'startupGreeting') ||
      typeof value.startupGreeting !== 'string') return undefined;

  const inputGreeting = value.startupGreeting;
  if (inputGreeting.length > MAX_STARTUP_GREETING_CODE_POINTS * 2) return undefined;

  const startupGreeting = inputGreeting.replace(/\r\n?/gu, '\n');
  if (Array.from(startupGreeting).length > MAX_STARTUP_GREETING_CODE_POINTS ||
      /\p{Cc}/u.test(startupGreeting.replace(/[\n\t]/gu, ''))) return undefined;

  return Object.freeze({ startupGreeting });
}

export function isWorkbenchPreferences(value: unknown): value is WorkbenchPreferences {
  return normalizeWorkbenchPreferences(value) !== undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
