export interface RemoteEndpoint {
  readonly host: string;
  readonly port: number;
}

const DNS_LABEL = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/;

export function canonicalizeRemoteEndpoint(input: unknown): RemoteEndpoint | undefined {
  if (!isPlainRecord(input) || Object.keys(input).length !== 2 || !Object.hasOwn(input, 'host') || !Object.hasOwn(input, 'port')) return undefined;
  const value = input as { readonly host?: unknown; readonly port?: unknown };
  if (typeof value.host !== 'string' || !Number.isInteger(value.port) || (value.port as number) < 1 || (value.port as number) > 65_535) return undefined;
  const host = canonicalizeRemoteHost(value.host);
  return host ? { host, port: value.port as number } : undefined;
}

export function canonicalizeRemoteHost(input: string): string | undefined {
  if (input.length === 0 || input.length > 255 || input !== input.trim() || /[\u0000-\u0020\u007f/@?#\\%]/.test(input)) return undefined;

  const bracketed = input.startsWith('[') && input.endsWith(']');
  if ((input.startsWith('[') || input.endsWith(']')) && !bracketed) return undefined;
  const unwrapped = bracketed ? input.slice(1, -1) : input;
  if (unwrapped.includes(':')) return isIpv6Text(unwrapped) ? unwrapped.toLowerCase() : undefined;
  if (bracketed) return undefined;

  const canonical = unwrapped.toLowerCase().replace(/\.$/, '');
  if (canonical.length === 0 || canonical.length > 253) return undefined;
  const labels = canonical.split('.');
  return labels.every(label => DNS_LABEL.test(label)) ? canonical : undefined;
}

function isIpv6Text(host: string): boolean {
  if (host.length > 45 || host.includes(':::') || !/^[0-9a-f:.]+$/i.test(host) || (host.match(/::/g)?.length ?? 0) > 1) return false;
  const compressed = host.includes('::');
  const segments = compressed ? [...host.slice(0, host.indexOf('::')).split(':').filter(Boolean), ...host.slice(host.indexOf('::') + 2).split(':').filter(Boolean)] : host.split(':');
  if (segments.some(segment => segment.length === 0)) return false;
  let groups = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    if (segment.includes('.')) {
      if (index !== segments.length - 1 || !host.endsWith(segment) || !isIpv4Text(segment)) return false;
      groups += 2;
    } else {
      if (segment.length > 4) return false;
      groups += 1;
    }
  }
  return compressed ? groups < 8 : groups === 8;
}

function isIpv4Text(value: string): boolean {
  const parts = value.split('.');
  return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
