export const MACRO_SCHEMA_VERSION = 1;
export const MAX_MACRO_STEPS = 64;
export const MAX_MACRO_TEXT_CHARS = 16_384;
export const MAX_MACRO_SEND_CHARS = 4_096;
export const MAX_MACRO_WAIT_TEXT_CHARS = 512;

export type MacroStep =
  | { readonly kind: 'send'; readonly text: string }
  | { readonly kind: 'waitForText'; readonly text: string; readonly timeoutMs: number }
  | { readonly kind: 'delay'; readonly durationMs: number }
  | { readonly kind: 'confirm'; readonly message: string };

export interface MacroDraft {
  readonly name: string;
  readonly description?: string;
  readonly steps: readonly MacroStep[];
}

export interface MacroDefinition extends MacroDraft {
  readonly id: string;
  readonly schemaVersion: typeof MACRO_SCHEMA_VERSION;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL = /[\u0000-\u001f\u007f]/u;

export function isMacroId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export function normalizeMacroDraft(value: unknown): MacroDraft | undefined {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ['name', 'description', 'steps']) ||
      !Object.hasOwn(value, 'name') || !Object.hasOwn(value, 'steps')) return undefined;
  const name = normalizeText(value.name, 256);
  const description = value.description === undefined ? undefined : normalizeText(value.description, 1024, true);
  if (!name || (value.description !== undefined && description === undefined) || !Array.isArray(value.steps) || value.steps.length > MAX_MACRO_STEPS) return undefined;
  const steps: MacroStep[] = [];
  let textChars = name.length + (description?.length ?? 0);
  for (const input of value.steps) {
    const step = normalizeMacroStep(input);
    if (!step) return undefined;
    if (step.kind === 'send' || step.kind === 'waitForText') textChars += step.text.length;
    else if (step.kind === 'confirm') textChars += step.message.length;
    if (textChars > MAX_MACRO_TEXT_CHARS) return undefined;
    steps.push(step);
  }
  return { name, ...(description ? { description } : {}), steps };
}

export function isMacroDefinition(value: unknown): value is MacroDefinition {
  if (!isPlainRecord(value) || !hasExactKeys(value, value.description === undefined
    ? ['id', 'schemaVersion', 'name', 'steps', 'createdAt', 'updatedAt']
    : ['id', 'schemaVersion', 'name', 'description', 'steps', 'createdAt', 'updatedAt']) ||
      !isMacroId(value.id) || value.schemaVersion !== MACRO_SCHEMA_VERSION ||
      !isCanonicalTimestamp(value.createdAt) || !isCanonicalTimestamp(value.updatedAt)) return false;
  const normalized = normalizeMacroDraft({ name: value.name, ...(value.description === undefined ? {} : { description: value.description }), steps: value.steps });
  return normalized !== undefined && normalized.name === value.name && normalized.description === value.description &&
    JSON.stringify(normalized.steps) === JSON.stringify(value.steps);
}

function normalizeMacroStep(value: unknown): MacroStep | undefined {
  if (!isPlainRecord(value) || typeof value.kind !== 'string') return undefined;
  if (value.kind === 'send' && hasExactKeys(value, ['kind', 'text'])) {
    const text = normalizeStepText(value.text, MAX_MACRO_SEND_CHARS);
    return text ? { kind: 'send', text } : undefined;
  }
  if (value.kind === 'waitForText' && hasExactKeys(value, ['kind', 'text', 'timeoutMs'])) {
    const text = normalizeStepText(value.text, MAX_MACRO_WAIT_TEXT_CHARS);
    if (!text || !Number.isSafeInteger(value.timeoutMs) || (value.timeoutMs as number) < 1_000 || (value.timeoutMs as number) > 120_000) return undefined;
    return { kind: 'waitForText', text, timeoutMs: value.timeoutMs as number };
  }
  if (value.kind === 'delay' && hasExactKeys(value, ['kind', 'durationMs']) &&
      Number.isSafeInteger(value.durationMs) && (value.durationMs as number) >= 0 && (value.durationMs as number) <= 120_000) {
    return { kind: 'delay', durationMs: value.durationMs as number };
  }
  if (value.kind === 'confirm' && hasExactKeys(value, ['kind', 'message'])) {
    const message = normalizeText(value.message, 256);
    return message ? { kind: 'confirm', message } : undefined;
  }
  return undefined;
}

function normalizeText(value: unknown, maxLength: number, allowEmpty = false): string | undefined {
  if (typeof value !== 'string' || value.length > maxLength || CONTROL.test(value)) return undefined;
  const normalized = value.trim();
  return allowEmpty || normalized.length > 0 ? normalized : undefined;
}

function normalizeStepText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string' || value.length > maxLength || CONTROL.test(value) || value.trim().length === 0) return undefined;
  return value;
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const epoch = Date.parse(value);
  return Number.isSafeInteger(epoch) && new Date(epoch).toISOString() === value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}
