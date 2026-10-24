import { canonicalizeRemoteEndpoint, canonicalizeRemoteHost } from './remote-endpoint.ts';

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

const HOST_KEY_ALGORITHM = /^[A-Za-z0-9][A-Za-z0-9@._+-]{0,127}$/;

export function canonicalizeSshHostEndpoint(input: unknown): SshHostEndpoint | undefined {
  return canonicalizeRemoteEndpoint(input);
}

export function canonicalizeSshHost(input: string): string | undefined {
  return canonicalizeRemoteHost(input);
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
