const MIT_COOKIE_NAME = 'MIT-MAGIC-COOKIE-1';
const MIT_COOKIE_BYTES = asciiBytes(MIT_COOKIE_NAME);
const MIT_COOKIE_LENGTH = 16;
const MAX_SETUP_PACKET_BYTES = 2_048;
const MAX_SETUP_RESPONSE_BYTES = 262_144;
const X11_EXTENSION_NAMES = ['GLX', 'Composite', 'RANDR'] as const;

export interface X11ExtensionCapabilities {
  readonly glx: boolean;
  readonly composite: boolean;
  readonly randr: boolean;
}

export type X11SetupParseResult =
  | { readonly kind: 'incomplete' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'complete'; readonly packetLength: number; readonly cookieOffset: number };

export type X11SetupResponseParseResult =
  | { readonly kind: 'incomplete' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'complete'; readonly packetLength: number };

export type X11ExtensionReplyParseResult =
  | { readonly kind: 'incomplete' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'complete'; readonly capabilities: X11ExtensionCapabilities };

export function parseX11SetupResponse(value: Uint8Array): X11SetupResponseParseResult {
  if (value.byteLength < 8) return { kind: 'incomplete' };
  if (value[0] !== 1) return { kind: 'invalid' };
  const majorVersion = value[2]! | (value[3]! << 8);
  const additionalLength = value[6]! | (value[7]! << 8);
  const packetLength = 8 + additionalLength * 4;
  if (majorVersion !== 11 || packetLength > MAX_SETUP_RESPONSE_BYTES) return { kind: 'invalid' };
  return value.byteLength < packetLength ? { kind: 'incomplete' } : { kind: 'complete', packetLength };
}

export function createX11ExtensionQueryRequests(): Uint8Array {
  const requests: Uint8Array[] = [];
  for (const extension of X11_EXTENSION_NAMES) {
    const name = asciiBytes(extension);
    const nameLength = (name.length + 3) & ~3;
    const request = new Uint8Array(8 + nameLength);
    request[0] = 98;
    request[2] = request.byteLength / 4;
    request[4] = name.length;
    request.set(name, 8);
    requests.push(request);
  }
  const combined = new Uint8Array(requests.reduce((length, request) => length + request.length, 0));
  let offset = 0;
  for (const request of requests) { combined.set(request, offset); offset += request.length; request.fill(0); }
  return combined;
}

export function parseX11ExtensionReplies(value: Uint8Array): X11ExtensionReplyParseResult {
  const replySize = 32;
  const expectedLength = replySize * X11_EXTENSION_NAMES.length;
  if (value.byteLength < expectedLength) return { kind: 'incomplete' };
  if (value.byteLength > expectedLength) return { kind: 'invalid' };
  const present: boolean[] = [];
  for (let index = 0; index < X11_EXTENSION_NAMES.length; index += 1) {
    const offset = index * replySize;
    const sequence = value[offset + 2]! | (value[offset + 3]! << 8);
    if (value[offset] !== 1 || sequence !== index + 1 || value[offset + 1]! > 1 ||
        value[offset + 4] !== 0 || value[offset + 5] !== 0 || value[offset + 6] !== 0 || value[offset + 7] !== 0 ||
        (value[offset + 1] === 1 ? value[offset + 8] === 0 : value[offset + 8] !== 0)) return { kind: 'invalid' };
    present.push(value[offset + 1] === 1);
  }
  return { kind: 'complete', capabilities: { glx: present[0]!, composite: present[1]!, randr: present[2]! } };
}

export function parseX11SetupRequest(value: Uint8Array): X11SetupParseResult {
  if (value.byteLength < 12) return { kind: 'incomplete' };
  const littleEndian = value[0] === 0x6c;
  if (!littleEndian && value[0] !== 0x42) return { kind: 'invalid' };
  const readUInt16 = (offset: number): number => littleEndian
    ? value[offset]! | (value[offset + 1]! << 8)
    : (value[offset]! << 8) | value[offset + 1]!;
  if (readUInt16(2) !== 11) return { kind: 'invalid' };
  const nameLength = readUInt16(6);
  const cookieLength = readUInt16(8);
  if (nameLength !== MIT_COOKIE_BYTES.length || cookieLength !== MIT_COOKIE_LENGTH) return { kind: 'invalid' };
  const cookieOffset = 12 + ((nameLength + 3) & ~3);
  const packetLength = cookieOffset + ((cookieLength + 3) & ~3);
  if (packetLength > MAX_SETUP_PACKET_BYTES) return { kind: 'invalid' };
  if (value.byteLength < packetLength) return { kind: 'incomplete' };
  for (let index = 0; index < MIT_COOKIE_BYTES.length; index += 1) {
    if (value[12 + index] !== MIT_COOKIE_BYTES[index]) return { kind: 'invalid' };
  }
  return { kind: 'complete', packetLength, cookieOffset };
}

export function rewriteX11SetupCookie(packet: Uint8Array, fakeCookie: Uint8Array, realCookie: Uint8Array): Uint8Array | undefined {
  if (fakeCookie.byteLength !== MIT_COOKIE_LENGTH || realCookie.byteLength !== MIT_COOKIE_LENGTH) return undefined;
  const parsed = parseX11SetupRequest(packet);
  if (parsed.kind !== 'complete') return undefined;
  let difference = 0;
  for (let index = 0; index < MIT_COOKIE_LENGTH; index += 1) difference |= packet[parsed.cookieOffset + index]! ^ fakeCookie[index]!;
  if (difference !== 0) return undefined;
  const rewritten = new Uint8Array(packet.subarray(0, parsed.packetLength));
  rewritten.set(realCookie, parsed.cookieOffset);
  return rewritten;
}

function asciiBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) bytes[index] = value.charCodeAt(index);
  return bytes;
}
