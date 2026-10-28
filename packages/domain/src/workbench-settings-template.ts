import { isCurrentWorkbenchPreferences, normalizeWorkbenchPreferences } from './workbench-preferences.ts';
import type { WorkbenchPreferences } from './workbench-preferences.ts';

export const WORKBENCH_SETTINGS_TEMPLATE_FORMAT = 'multiremote-terminal/workbench-settings';
export const WORKBENCH_SETTINGS_TEMPLATE_VERSION = 1;
export const MAX_WORKBENCH_SETTINGS_TEMPLATE_BYTES = 16 * 1024 * 1024;

export interface WorkbenchSettingsTemplate {
  readonly format: typeof WORKBENCH_SETTINGS_TEMPLATE_FORMAT;
  readonly version: typeof WORKBENCH_SETTINGS_TEMPLATE_VERSION;
  readonly preferences: WorkbenchPreferences;
}

export function createWorkbenchSettingsTemplate(value: unknown): WorkbenchSettingsTemplate | undefined {
  if (!isCurrentWorkbenchPreferences(value)) return undefined;
  const preferences = normalizeWorkbenchPreferences(value);
  return preferences ? Object.freeze({ format: WORKBENCH_SETTINGS_TEMPLATE_FORMAT, version: WORKBENCH_SETTINGS_TEMPLATE_VERSION, preferences }) : undefined;
}

export function serializeWorkbenchSettingsTemplate(value: unknown): string | undefined {
  const template = createWorkbenchSettingsTemplate(value);
  if (!template) return undefined;
  const contents = `${JSON.stringify(template)}\n`;
  return utf8ByteLength(contents) <= MAX_WORKBENCH_SETTINGS_TEMPLATE_BYTES ? contents : undefined;
}

export function parseWorkbenchSettingsTemplate(contents: string): WorkbenchPreferences | undefined {
  if (typeof contents !== 'string' || utf8ByteLength(contents) > MAX_WORKBENCH_SETTINGS_TEMPLATE_BYTES) return undefined;
  try {
    const value: unknown = JSON.parse(contents);
    if (!isRecord(value) || Object.keys(value).length !== 3 || value.format !== WORKBENCH_SETTINGS_TEMPLATE_FORMAT ||
        value.version !== WORKBENCH_SETTINGS_TEMPLATE_VERSION || !Object.hasOwn(value, 'preferences')) return undefined;
    return isCurrentWorkbenchPreferences(value.preferences) ? normalizeWorkbenchPreferences(value.preferences) : undefined;
  } catch { return undefined; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}
