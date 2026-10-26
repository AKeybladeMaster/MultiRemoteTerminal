// PowerShell text is sent as Windows CRLF terminal input. A worst-case script
// made entirely of line feeds doubles in size, so keep the result inside the
// local terminal controller's single-write bound.
export const MAX_POWERSHELL_PROFILE_SCRIPT_CODE_UNITS = 8_000;
const UNREVIEWABLE_SCRIPT_CHARACTERS = /[\p{Cc}\p{Zl}\p{Zp}\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;

/** Bounds and normalizes user-authored PowerShell text without interpreting it as code. */
export function normalizePowerShellProfileScript(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > MAX_POWERSHELL_PROFILE_SCRIPT_CODE_UNITS) return undefined;
  if (!hasWellFormedSurrogates(value)) return undefined;
  const normalized = value.replace(/\r\n?/gu, '\n');
  if (UNREVIEWABLE_SCRIPT_CHARACTERS.test(normalized.replace(/[\n\t]/gu, ''))) return undefined;
  return normalized;
}

function hasWellFormedSurrogates(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xDC00 || next > 0xDFFF) return false;
      index++;
    } else if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) return false;
  }
  return true;
}
