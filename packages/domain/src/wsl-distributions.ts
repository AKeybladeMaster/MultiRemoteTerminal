export interface WslDistribution {
  readonly name: string;
}

export const MAX_WSL_DISTRIBUTION_NAME_LENGTH = 128;
export const MAX_WSL_DISTRIBUTIONS = 128;
export const MAX_WSL_DISTRIBUTION_LIST_LENGTH = 65_536;
export const MAX_WSL_DISTRIBUTION_OUTPUT_BYTES = MAX_WSL_DISTRIBUTION_LIST_LENGTH * 2;

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index++;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return true;
  }
  return false;
}

export function isWslDistributionName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_WSL_DISTRIBUTION_NAME_LENGTH &&
    value === value.trim() && !hasUnpairedSurrogate(value) && !/[\u0000-\u001f\u007f]/u.test(value);
}

/** Parse the decoded output of `wsl.exe --list --quiet`; malformed or oversized output fails closed. */
export function parseWslDistributionList(output: unknown): readonly WslDistribution[] | undefined {
  if (typeof output !== 'string' || output.length > MAX_WSL_DISTRIBUTION_LIST_LENGTH ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(output)) return undefined;
  const normalized = output.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
  const names: WslDistribution[] = [];
  const seen = new Set<string>();
  for (const name of normalized.split('\n')) {
    if (name.length === 0) continue;
    if (!isWslDistributionName(name)) return undefined;
    const key = name.toLocaleLowerCase('en-US');
    if (seen.has(key)) return undefined;
    seen.add(key);
    names.push(Object.freeze({ name }));
    if (names.length > MAX_WSL_DISTRIBUTIONS) return undefined;
  }
  return Object.freeze(names);
}

export function normalizeWslDistributionList(value: unknown): readonly WslDistribution[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_WSL_DISTRIBUTIONS) return undefined;
  const names: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return undefined;
    const distribution = item as Record<string, unknown>;
    if (Object.keys(distribution).length !== 1 || !Object.hasOwn(distribution, 'name') || !isWslDistributionName(distribution.name)) return undefined;
    const key = distribution.name.toLocaleLowerCase('en-US');
    if (seen.has(key)) return undefined;
    seen.add(key);
    names.push(distribution.name);
  }
  return Object.freeze(names.map(name => Object.freeze({ name })));
}

/** Decode bounded redirected `wsl.exe --list --quiet` bytes before parsing names. */
export function decodeWslDistributionList(bytes: Uint8Array): readonly WslDistribution[] | undefined {
  if (bytes.byteLength > MAX_WSL_DISTRIBUTION_OUTPUT_BYTES || bytes.byteLength % 2 !== 0) return undefined;
  const offset = bytes[0] === 0xff && bytes[1] === 0xfe ? 2 : 0;
  let output = '';
  for (let index = offset; index < bytes.byteLength; index += 2) {
    const codeUnit = (bytes[index] ?? 0) | ((bytes[index + 1] ?? 0) << 8);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = index + 2 < bytes.byteLength
        ? (bytes[index + 2] ?? 0) | ((bytes[index + 3] ?? 0) << 8)
        : 0;
      if (next < 0xdc00 || next > 0xdfff) return undefined;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      const previous = index - 2 >= offset
        ? (bytes[index - 2] ?? 0) | ((bytes[index - 1] ?? 0) << 8)
        : 0;
      if (previous < 0xd800 || previous > 0xdbff) return undefined;
    }
    output += String.fromCharCode(codeUnit);
  }
  return parseWslDistributionList(output);
}
