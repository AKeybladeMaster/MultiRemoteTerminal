const HIDDEN_OR_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2060\u2066-\u2069\ufeff]/gu;

export function escapeRecoveryFileNameForDisplay(fileName: string): string {
  return fileName.replace(HIDDEN_OR_CONTROL_CHARACTERS, character =>
    `[U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}]`);
}
