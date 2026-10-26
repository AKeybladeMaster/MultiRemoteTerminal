export interface TftpReadRequest {
  readonly kind: 'read';
  readonly fileName: string;
}

export interface TftpPacketError {
  readonly code: number;
  readonly message: string;
}

export type ParsedTftpRequest = { readonly ok: true; readonly result: TftpReadRequest } | { readonly ok: false; readonly error: TftpPacketError };

const MAX_REQUEST_BYTES = 1_024;
const MAX_OPTION_PAIRS = 8;
const MAX_FILE_NAME_LENGTH = 120;
const MAX_ERROR_MESSAGE_LENGTH = 128;
const RESERVED_WINDOWS_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function error(code: number, message: string): ParsedTftpRequest {
  return { ok: false, error: { code, message } };
}

function readAsciiField(packet: Uint8Array, start: number): { readonly value: string; readonly next: number } | undefined {
  const end = packet.indexOf(0, start);
  if (end < 0 || end === start) return undefined;
  let value = '';
  for (let index = start; index < end; index++) {
    const byte = packet[index] ?? 0;
    if (byte < 0x20 || byte > 0x7e) return undefined;
    value += String.fromCharCode(byte);
  }
  return { value, next: end + 1 };
}

function safeRootFileName(value: string): boolean {
  if (value.length === 0 || value.length > MAX_FILE_NAME_LENGTH || value === '.' || value === '..' || /[. ]$/u.test(value)) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9._ -]*$/u.test(value)) return false;
  const stem = value.split('.')[0] ?? '';
  return !RESERVED_WINDOWS_NAMES.test(stem);
}

export function parseTftpRequest(packet: Uint8Array): ParsedTftpRequest {
  if (packet.byteLength < 4 || packet.byteLength > MAX_REQUEST_BYTES || packet[packet.byteLength - 1] !== 0) {
    return error(4, 'Malformed request');
  }
  const opcode = ((packet[0] ?? 0) << 8) | (packet[1] ?? 0);
  if (opcode === 2) return error(2, 'Uploads are disabled');
  if (opcode !== 1) return error(4, 'Only read requests are supported');

  const fields: string[] = [];
  let cursor = 2;
  while (cursor < packet.byteLength) {
    const field = readAsciiField(packet, cursor);
    if (!field) return error(4, 'Malformed request');
    fields.push(field.value);
    cursor = field.next;
  }
  if (fields.length < 2 || fields.length > 2 + MAX_OPTION_PAIRS * 2 || (fields.length - 2) % 2 !== 0) {
    return error(4, 'Malformed request');
  }
  const fileName = fields[0] ?? '';
  const mode = (fields[1] ?? '').toLowerCase();
  if (mode !== 'octet') return error(4, 'Only octet mode is supported');
  if (!safeRootFileName(fileName)) return error(2, 'Only top-level file names are allowed');

  const optionNames = new Set<string>();
  for (let index = 2; index < fields.length; index += 2) {
    const optionName = (fields[index] ?? '').toLowerCase();
    const optionValue = fields[index + 1] ?? '';
    if (!/^[a-z0-9-]{1,32}$/u.test(optionName) || optionValue.length > 64 || optionNames.has(optionName)) {
      return error(4, 'Malformed option');
    }
    optionNames.add(optionName);
  }
  return { ok: true, result: { kind: 'read', fileName } };
}

export function parseTftpAcknowledgement(packet: Uint8Array): number | undefined {
  if (packet.byteLength !== 4 || packet[0] !== 0 || packet[1] !== 4) return undefined;
  return ((packet[2] ?? 0) << 8) | (packet[3] ?? 0);
}

export function createTftpDataPacket(block: number, data: Uint8Array): Buffer {
  if (!Number.isSafeInteger(block) || block < 0 || block > 65_535 || data.byteLength > 512) throw new Error('Invalid TFTP data packet');
  const packet = Buffer.allocUnsafe(4 + data.byteLength);
  packet.writeUInt16BE(3, 0);
  packet.writeUInt16BE(block, 2);
  Buffer.from(data).copy(packet, 4);
  return packet;
}

export function createTftpErrorPacket(code: number, message: string): Buffer {
  if (!Number.isSafeInteger(code) || code < 0 || code > 8) throw new Error('Invalid TFTP error code');
  const safeMessage = [...message].filter(character => {
    const value = character.codePointAt(0) ?? 0;
    return value >= 0x20 && value <= 0x7e;
  }).join('').slice(0, MAX_ERROR_MESSAGE_LENGTH);
  const text = Buffer.from(safeMessage, 'ascii');
  const packet = Buffer.allocUnsafe(5 + text.byteLength);
  packet.writeUInt16BE(5, 0);
  packet.writeUInt16BE(code, 2);
  text.copy(packet, 4);
  packet[packet.length - 1] = 0;
  return packet;
}
