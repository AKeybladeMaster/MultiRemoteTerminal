export const SERIAL_BAUD_RATE_MIN = 300;
export const SERIAL_BAUD_RATE_MAX = 2_000_000;
export const SERIAL_PORT_LIST_LIMIT = 256;
export const MAX_SERIAL_INPUT_CHARS = 1_024;
export const SERIAL_WRITE_TIMEOUT_MAX_MS = 120_000;

export type SerialParity = 'none' | 'even' | 'odd' | 'mark' | 'space';
export type SerialFlowControl = 'none' | 'rtscts' | 'xonxoff';
export type SerialStopBits = 1 | 1.5 | 2;

export interface SerialConfiguration {
  readonly path: string;
  readonly baudRate: number;
  readonly dataBits: 5 | 6 | 7 | 8;
  readonly parity: SerialParity;
  readonly stopBits: SerialStopBits;
  readonly flowControl: SerialFlowControl;
}

export interface SerialPortInfo {
  readonly path: string;
  readonly manufacturer?: string;
}

/** Bounds terminal-write waits using the slowest-case UTF-8 size and configured line rate. */
export function serialWriteTimeoutMs(configuration: SerialConfiguration, inputChars: number): number {
  const byteUpperBound = Math.max(0, Math.ceil(inputChars)) * 3;
  const transmissionMs = Math.ceil(byteUpperBound * 10_000 / configuration.baudRate);
  return Math.min(SERIAL_WRITE_TIMEOUT_MAX_MS, Math.max(5_000, transmissionMs + 5_000));
}

export function canonicalizeSerialPortPath(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 8 || value !== value.trim()) return undefined;
  const match = /^COM([1-9]\d{0,3})$/i.exec(value);
  if (!match || Number(match[1]) > 4095) return undefined;
  return `COM${Number(match[1])}`;
}

export function normalizeSerialConfiguration(value: unknown): SerialConfiguration | undefined {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['path', 'baudRate', 'dataBits', 'parity', 'stopBits', 'flowControl'])) return undefined;
  const path = canonicalizeSerialPortPath(value.path);
  if (!path || !Number.isInteger(value.baudRate) || (value.baudRate as number) < SERIAL_BAUD_RATE_MIN ||
      (value.baudRate as number) > SERIAL_BAUD_RATE_MAX || ![5, 6, 7, 8].includes(value.dataBits as number) ||
      !isParity(value.parity) || ![1, 1.5, 2].includes(value.stopBits as number) || !isFlowControl(value.flowControl)) return undefined;
  return {
    path,
    baudRate: value.baudRate as number,
    dataBits: value.dataBits as 5 | 6 | 7 | 8,
    parity: value.parity,
    stopBits: value.stopBits as SerialStopBits,
    flowControl: value.flowControl
  };
}

export function isSerialConfiguration(value: unknown): value is SerialConfiguration {
  const normalized = normalizeSerialConfiguration(value);
  return normalized !== undefined && Object.keys(value as object).length === Object.keys(normalized).length &&
    Object.keys(normalized).every(key => (value as Record<string, unknown>)[key] === normalized[key as keyof SerialConfiguration]);
}

export function normalizeSerialPortList(value: unknown): readonly SerialPortInfo[] | undefined {
  if (!Array.isArray(value) || value.length > SERIAL_PORT_LIST_LIMIT) return undefined;
  const ports: SerialPortInfo[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isPlainRecord(entry) || !hasExactKeys(entry, Object.hasOwn(entry, 'manufacturer') ? ['path', 'manufacturer'] : ['path'])) return undefined;
    const path = canonicalizeSerialPortPath(entry.path);
    if (!path || seen.has(path)) return undefined;
    if (Object.hasOwn(entry, 'manufacturer') && (typeof entry.manufacturer !== 'string' || entry.manufacturer.length > 256 || /[\u0000-\u001f\u007f]/.test(entry.manufacturer))) return undefined;
    seen.add(path);
    ports.push(Object.hasOwn(entry, 'manufacturer') ? { path, manufacturer: entry.manufacturer as string } : { path });
  }
  return ports.sort((left, right) => left.path.localeCompare(right.path, undefined, { numeric: true }));
}

function isParity(value: unknown): value is SerialParity {
  return value === 'none' || value === 'even' || value === 'odd' || value === 'mark' || value === 'space';
}

function isFlowControl(value: unknown): value is SerialFlowControl {
  return value === 'none' || value === 'rtscts' || value === 'xonxoff';
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
