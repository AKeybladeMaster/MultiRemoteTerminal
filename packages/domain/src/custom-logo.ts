const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';

export const MAX_CUSTOM_LOGO_SOURCE_BYTES = 1_048_576;
export const MAX_CUSTOM_LOGO_PNG_BYTES = 512 * 1024;
export const MAX_CUSTOM_LOGO_DATA_URL_LENGTH = 700_000;
export const MAX_CUSTOM_LOGO_DIMENSION = 512;

export interface PngDimensions {
  readonly width: number;
  readonly height: number;
}

export interface CustomLogoSelection {
  readonly dataUrl: string;
}

/** Read the bounded PNG IHDR before native decoding to reject oversized pixel dimensions. */
export function readCustomLogoPngDimensions(value: unknown): PngDimensions | undefined {
  if (!(value instanceof Uint8Array) || value.byteLength < 33 || value.byteLength > MAX_CUSTOM_LOGO_SOURCE_BYTES) return undefined;
  for (let index = 0; index < PNG_SIGNATURE.length; index++) if (value[index] !== PNG_SIGNATURE[index]) return undefined;
  if (readUint32(value, 8) !== 13 || value[12] !== 0x49 || value[13] !== 0x48 || value[14] !== 0x44 || value[15] !== 0x52) return undefined;
  const width = readUint32(value, 16);
  const height = readUint32(value, 20);
  if (width < 1 || height < 1 || width > MAX_CUSTOM_LOGO_DIMENSION || height > MAX_CUSTOM_LOGO_DIMENSION) return undefined;
  return Object.freeze({ width, height });
}

/** Validate the only renderer-visible logo representation accepted by preference storage. */
export function isCustomLogoDataUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_CUSTOM_LOGO_DATA_URL_LENGTH || !value.startsWith(PNG_DATA_URL_PREFIX)) return false;
  const base64 = value.slice(PNG_DATA_URL_PREFIX.length);
  if (base64.length < 44 || base64.length % 4 !== 0 || !base64.startsWith('iVBORw0KGgo') ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(base64)) return false;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const decodedLength = base64.length / 4 * 3 - padding;
  if (decodedLength < 33 || decodedLength > MAX_CUSTOM_LOGO_PNG_BYTES) return false;
  const header = decodeBase64Prefix(base64, 33);
  return Boolean(header && readCustomLogoPngDimensions(header));
}

function decodeBase64Prefix(base64: string, byteLength: number): Uint8Array | undefined {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes = new Uint8Array(byteLength);
  let bits = 0;
  let value = 0;
  let offset = 0;
  for (let index = 0; index < base64.length && offset < byteLength; index++) {
    const digit = alphabet.indexOf(base64[index] ?? '');
    if (digit < 0) return undefined;
    value = (value << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[offset++] = (value >>> bits) & 0xff;
      value &= (1 << bits) - 1;
    }
  }
  return offset === byteLength ? bytes : undefined;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset] ?? 0) * 0x1000000) + ((bytes[offset + 1] ?? 0) << 16) +
    ((bytes[offset + 2] ?? 0) << 8) + (bytes[offset + 3] ?? 0)) >>> 0;
}
