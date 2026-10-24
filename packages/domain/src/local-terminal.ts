export type LocalShell = 'powershell' | 'cmd';

export interface TerminalSize {
  readonly columns: number;
  readonly rows: number;
}

export const MAX_TERMINAL_COLUMNS = 500;
export const MAX_TERMINAL_ROWS = 300;
export const MAX_TERMINAL_INPUT_CHARS = 16_384;
export const MAX_QUEUED_TERMINAL_INPUT_CHARS = 65_536;

export function isLocalShell(value: unknown): value is LocalShell {
  return value === 'powershell' || value === 'cmd';
}

export function isTerminalSize(value: unknown): value is TerminalSize {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const size = value as Record<string, unknown>;
  return Number.isInteger(size.columns) && (size.columns as number) >= 2 && (size.columns as number) <= MAX_TERMINAL_COLUMNS &&
    Number.isInteger(size.rows) && (size.rows as number) >= 1 && (size.rows as number) <= MAX_TERMINAL_ROWS;
}
