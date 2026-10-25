import sodium from 'libsodium-wrappers-sumo';
import { MASTER_PASSWORD_PROFILE } from './master-password-profile.ts';

export { MASTER_PASSWORD_PROFILE } from './master-password-profile.ts';

export const MASTER_PASSWORD_SENTINEL = Buffer.from('MultiRemoteTerminal credential vault v1', 'utf8');
const SENTINEL_REFERENCE = 'mrt-vault-unlock-sentinel-v1';

export interface MasterPasswordEnvelope {
  readonly version: 1;
  readonly profile: 1;
  readonly nonce: string;
  readonly ciphertext: string;
}

export async function sealMasterPasswordEnvelope(plaintext: Uint8Array, key: Uint8Array, reference: string,
  nonceOverride?: Uint8Array): Promise<MasterPasswordEnvelope> {
  if (key.byteLength !== MASTER_PASSWORD_PROFILE.keyLength) throw new TypeError('Invalid master-password key length');
  await sodium.ready;
  const nonce = nonceOverride ? new Uint8Array(nonceOverride) : sodium.randombytes_buf(MASTER_PASSWORD_PROFILE.nonceLength);
  if (nonce.byteLength !== MASTER_PASSWORD_PROFILE.nonceLength) throw new TypeError('Invalid master-password nonce length');
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext, associatedData(reference), null, nonce, key, 'uint8array'
  );
  try {
    return { version: 1, profile: 1, nonce: Buffer.from(nonce).toString('base64'), ciphertext: Buffer.from(ciphertext).toString('base64') };
  } finally {
    nonce.fill(0);
    ciphertext.fill(0);
  }
}

export async function openMasterPasswordEnvelope(envelope: MasterPasswordEnvelope, key: Uint8Array, reference: string): Promise<Buffer> {
  if (key.byteLength !== MASTER_PASSWORD_PROFILE.keyLength) throw new TypeError('Invalid master-password key length');
  const nonce = decodeCanonicalBase64(envelope.nonce, MASTER_PASSWORD_PROFILE.nonceLength);
  const ciphertext = decodeCanonicalBase64(envelope.ciphertext, MASTER_PASSWORD_PROFILE.tagLength);
  await sodium.ready;
  try {
    return Buffer.from(sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null, ciphertext, associatedData(reference), nonce, key, 'uint8array'
    ));
  } finally {
    nonce.fill(0);
    ciphertext.fill(0);
  }
}

export function sealMasterSentinel(key: Uint8Array): Promise<MasterPasswordEnvelope> {
  return sealMasterPasswordEnvelope(MASTER_PASSWORD_SENTINEL, key, SENTINEL_REFERENCE);
}

export async function verifyMasterSentinel(envelope: MasterPasswordEnvelope, key: Uint8Array): Promise<boolean> {
  const plaintext = await openMasterPasswordEnvelope(envelope, key, SENTINEL_REFERENCE);
  try { return plaintext.equals(MASTER_PASSWORD_SENTINEL); }
  finally { plaintext.fill(0); }
}

export function isMasterPasswordEnvelope(value: unknown): value is MasterPasswordEnvelope {
  if (!isRecord(value) || Object.keys(value).length !== 4 || value.version !== 1 || value.profile !== 1 ||
      typeof value.nonce !== 'string' || typeof value.ciphertext !== 'string') return false;
  const nonce = tryDecodeCanonicalBase64(value.nonce, MASTER_PASSWORD_PROFILE.nonceLength);
  const ciphertext = tryDecodeCanonicalBase64(value.ciphertext, MASTER_PASSWORD_PROFILE.tagLength);
  const valid = nonce !== undefined && ciphertext !== undefined && ciphertext.length <= 512 * 1024;
  nonce?.fill(0);
  ciphertext?.fill(0);
  return valid;
}

export function isMasterPasswordProfile(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length === Object.keys(MASTER_PASSWORD_PROFILE).length &&
    value.id === MASTER_PASSWORD_PROFILE.id && value.kdf === MASTER_PASSWORD_PROFILE.kdf &&
    value.opsLimit === MASTER_PASSWORD_PROFILE.opsLimit && value.memLimit === MASTER_PASSWORD_PROFILE.memLimit &&
    value.keyLength === MASTER_PASSWORD_PROFILE.keyLength && value.saltLength === MASTER_PASSWORD_PROFILE.saltLength &&
    value.cipher === MASTER_PASSWORD_PROFILE.cipher && value.nonceLength === MASTER_PASSWORD_PROFILE.nonceLength &&
    value.tagLength === MASTER_PASSWORD_PROFILE.tagLength;
}

export function isCanonicalBase64(value: unknown, expectedLength: number): value is string {
  if (typeof value !== 'string') return false;
  const decoded = tryDecodeCanonicalBase64(value, expectedLength);
  if (!decoded) return false;
  decoded.fill(0);
  return true;
}

function associatedData(reference: string): Buffer {
  return Buffer.from(JSON.stringify({ envelopeVersion: 1, profile: 1, credentialReference: reference }), 'utf8');
}

function decodeCanonicalBase64(value: string, minLength: number): Buffer {
  const decoded = tryDecodeCanonicalBase64(value, minLength);
  if (!decoded) throw new TypeError('Invalid master-password envelope');
  return decoded;
}

function tryDecodeCanonicalBase64(value: string, minLength: number): Buffer | undefined {
  if (!Number.isSafeInteger(minLength) || minLength < 0) return undefined;
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length < minLength || decoded.toString('base64') !== value) {
    decoded.fill(0);
    return undefined;
  }
  return decoded;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
