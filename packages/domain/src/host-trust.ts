export interface SshHostEndpoint {
  readonly host: string;
  readonly port: number;
}

export interface HostKeyEvidence {
  readonly algorithm: string;
  readonly fingerprint: string;
  readonly publicKey: Uint8Array;
}

export interface TrustedHostKey extends HostKeyEvidence {
  readonly endpoint: SshHostEndpoint;
  readonly fingerprint: string;
  readonly trustedAt: number;
  readonly approvalSource: 'user';
}

export const MAX_HOST_KEY_BYTES = 64 * 1024;

const DNS_LABEL = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/;
const HOST_KEY_ALGORITHM = /^[A-Za-z0-9][A-Za-z0-9@._+-]{0,127}$/;

export function canonicalizeSshHostEndpoint(input: unknown): SshHostEndpoint | undefined {
  if (!isPlainRecord(input) || Object.keys(input).length !== 2 || !Object.hasOwn(input, 'host') || !Object.hasOwn(input, 'port')) return undefined;
  const value = input as { readonly host?: unknown; readonly port?: unknown };
  if (typeof value.host !== 'string' || !Number.isInteger(value.port) || (value.port as number) < 1 || (value.port as number) > 65_535) return undefined;
  const host = canonicalizeSshHost(value.host);
  if (!host) return undefined;
  return { host, port: value.port as number };
}

export function canonicalizeSshHost(input: string): string | undefined {
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

export function isHostKeyEvidence(input: unknown): input is HostKeyEvidence {
  if (!isPlainRecord(input) || Object.keys(input).length !== 3 || !Object.hasOwn(input, 'algorithm') || !Object.hasOwn(input, 'fingerprint') || !Object.hasOwn(input, 'publicKey')) return false;
  const evidence = input as { readonly algorithm?: unknown; readonly publicKey?: unknown };
  const fingerprint = (input as { readonly fingerprint?: unknown }).fingerprint;
  if (typeof evidence.algorithm !== 'string' || !HOST_KEY_ALGORITHM.test(evidence.algorithm) ||
      typeof fingerprint !== 'string' || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(fingerprint) ||
      !(evidence.publicKey instanceof Uint8Array) || evidence.publicKey.byteLength < 5 || evidence.publicKey.byteLength > MAX_HOST_KEY_BYTES) return false;
  return sshPublicKeyAlgorithm(evidence.publicKey) === evidence.algorithm;
}

export function sshPublicKeyAlgorithm(publicKey: unknown): string | undefined {
  if (!(publicKey instanceof Uint8Array) || publicKey.byteLength < 5 || publicKey.byteLength > MAX_HOST_KEY_BYTES) return undefined;
  const algorithmLength = ((publicKey[0]! << 24) | (publicKey[1]! << 16) | (publicKey[2]! << 8) | publicKey[3]!) >>> 0;
  if (algorithmLength === 0 || algorithmLength > 128 || 4 + algorithmLength > publicKey.byteLength) return undefined;
  let algorithm = '';
  for (const byte of publicKey.subarray(4, 4 + algorithmLength)) {
    if (byte > 0x7f) return undefined;
    algorithm += String.fromCharCode(byte);
  }
  return HOST_KEY_ALGORITHM.test(algorithm) ? algorithm : undefined;
}

export function hostEndpointKey(endpoint: SshHostEndpoint): string {
  return `${endpoint.host.length}:${endpoint.host}:${endpoint.port}`;
}

export function sameHostKey(left: HostKeyEvidence, right: HostKeyEvidence): boolean {
  if (left.algorithm !== right.algorithm || left.fingerprint !== right.fingerprint || left.publicKey.byteLength !== right.publicKey.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.publicKey.byteLength; index += 1) difference |= left.publicKey[index]! ^ right.publicKey[index]!;
  return difference === 0;
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
