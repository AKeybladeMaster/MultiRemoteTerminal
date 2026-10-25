import { isMacroId } from './macro.ts';

const LETTER_CODES = [
  'KeyA', 'KeyB', 'KeyC', 'KeyD', 'KeyE', 'KeyF', 'KeyG', 'KeyH', 'KeyI', 'KeyJ', 'KeyK', 'KeyL', 'KeyM',
  'KeyN', 'KeyO', 'KeyP', 'KeyQ', 'KeyR', 'KeyS', 'KeyT', 'KeyU', 'KeyV', 'KeyW', 'KeyX', 'KeyY', 'KeyZ'
] as const;
const DIGIT_CODES = ['Digit0', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'] as const;
const NUMPAD_CODES = ['Numpad0', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad5', 'Numpad6', 'Numpad7', 'Numpad8', 'Numpad9'] as const;
const FUNCTION_CODES = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'] as const;

export const MACRO_SHORTCUT_CODES = [...LETTER_CODES, ...DIGIT_CODES, ...NUMPAD_CODES, ...FUNCTION_CODES] as const;
export type MacroShortcutCode = typeof MACRO_SHORTCUT_CODES[number];

export interface MacroShortcutBinding {
  readonly macroId: string;
  readonly code: MacroShortcutCode;
}

const shortcutCodes: ReadonlySet<string> = new Set(MACRO_SHORTCUT_CODES);

export function isMacroShortcutCode(value: unknown): value is MacroShortcutCode {
  return typeof value === 'string' && shortcutCodes.has(value);
}

export function isMacroShortcutBinding(value: unknown): value is MacroShortcutBinding {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['macroId', 'code'])) return false;
  return isMacroId(value.macroId) && isMacroShortcutCode(value.code);
}

export function formatMacroShortcut(code: MacroShortcutCode): string {
  const key = code.startsWith('Key') ? code.slice(3)
    : code.startsWith('Digit') ? code.slice(5)
      : code.startsWith('Numpad') ? `Num ${code.slice(6)}` : code;
  return `Ctrl+Alt+Shift+${key}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
