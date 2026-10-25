export const MAX_MULTI_EXEC_LINE_CHARS = 4_096;
export const MAX_MULTI_EXEC_TARGETS = 256;

export interface MultiExecRequest {
  readonly line: string;
  readonly targetSessionIds: readonly string[];
}

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_OR_BIDI = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/u;

/** Validates a single exact terminal line and a bounded, duplicate-free target set. */
export function normalizeMultiExecRequest(value: unknown): MultiExecRequest | undefined {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['line', 'targetSessionIds']) ||
      typeof value.line !== 'string' || value.line.length === 0 || value.line.length > MAX_MULTI_EXEC_LINE_CHARS ||
      value.line.trim().length === 0 || CONTROL_OR_BIDI.test(value.line) || !Array.isArray(value.targetSessionIds) ||
      value.targetSessionIds.length < 2 || value.targetSessionIds.length > MAX_MULTI_EXEC_TARGETS) return undefined;

  const seen = new Set<string>();
  for (const sessionId of value.targetSessionIds) {
    if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId) || seen.has(sessionId)) return undefined;
    seen.add(sessionId);
  }

  return { line: value.line, targetSessionIds: [...value.targetSessionIds] };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
