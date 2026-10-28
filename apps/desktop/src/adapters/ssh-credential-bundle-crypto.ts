import sodium from 'libsodium-wrappers-sumo';
import type { CancellationSignal } from '../../../../packages/application/src/cancellation.ts';
import { SshCredentialBundleError } from '../../../../packages/application/src/ssh-credential-bundle.ts';
import { MAX_SSH_CREDENTIAL_BUNDLE_BYTES, MAX_SSH_CREDENTIAL_BUNDLE_PLAINTEXT_BYTES } from '../../../../packages/application/src/ssh-credential-bundle.ts';
import { MASTER_PASSWORD_PROFILE } from './master-password-profile.ts';
import { isMasterPasswordProfile } from './master-password-crypto.ts';
import type { MasterPasswordKeyDeriver } from './master-password-key-deriver.ts';

const FORMAT_NAME = 'MultiRemoteTerminal SSH credential bundle';

export class SshCredentialBundleCryptoAdapter {
  private readonly keyDeriver: MasterPasswordKeyDeriver;

  constructor(keyDeriver: MasterPasswordKeyDeriver) {
    this.keyDeriver = keyDeriver;
  }

  async encrypt(plaintext: string, passphrase: string, cancellation?: CancellationSignal): Promise<Uint8Array> {
    const passphraseBytes = encodePassphrase(passphrase);
    const plaintextBytes = Buffer.from(plaintext, 'utf8');
    if (plaintextBytes.byteLength > MAX_SSH_CREDENTIAL_BUNDLE_PLAINTEXT_BYTES) {
      passphraseBytes.fill(0);
      plaintextBytes.fill(0);
      throw new SshCredentialBundleError('invalid');
    }
    let salt: Uint8Array | undefined;
    let key: Buffer | undefined;
    let nonce: Uint8Array | undefined;
    let ciphertext: Uint8Array | undefined;
    try {
      await sodium.ready;
      salt = sodium.randombytes_buf(MASTER_PASSWORD_PROFILE.saltLength);
      key = await this.deriveKey(passphraseBytes, salt, cancellation);
      if (cancellation?.aborted) throw new SshCredentialBundleError('cancelled');
      nonce = sodium.randombytes_buf(MASTER_PASSWORD_PROFILE.nonceLength);
      ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintextBytes, associatedData(), null, nonce, key, 'uint8array');
      const envelope = Buffer.from(JSON.stringify({ version: 1, profile: MASTER_PASSWORD_PROFILE,
        salt: Buffer.from(salt).toString('base64'), nonce: Buffer.from(nonce).toString('base64'),
        ciphertext: Buffer.from(ciphertext).toString('base64') }), 'utf8');
      if (envelope.byteLength > MAX_SSH_CREDENTIAL_BUNDLE_BYTES) {
        envelope.fill(0);
        throw new SshCredentialBundleError('invalid');
      }
      return envelope;
    } finally {
      plaintextBytes.fill(0);
      passphraseBytes.fill(0);
      salt?.fill(0);
      key?.fill(0);
      nonce?.fill(0);
      ciphertext?.fill(0);
    }
  }

  async decrypt(contents: Uint8Array, passphrase: string, cancellation?: CancellationSignal): Promise<string> {
    if (contents.byteLength > MAX_SSH_CREDENTIAL_BUNDLE_BYTES) throw new SshCredentialBundleError('invalid');
    const envelope = parseEnvelope(contents);
    const passphraseBytes = encodePassphrase(passphrase);
    let salt: Buffer | undefined;
    let nonce: Buffer | undefined;
    let ciphertext: Buffer | undefined;
    let key: Buffer | undefined;
    try {
      salt = decodeBase64(envelope.salt, MASTER_PASSWORD_PROFILE.saltLength);
      nonce = decodeBase64(envelope.nonce, MASTER_PASSWORD_PROFILE.nonceLength);
      ciphertext = decodeBase64(envelope.ciphertext, MASTER_PASSWORD_PROFILE.tagLength, true);
      if (ciphertext.byteLength > MAX_SSH_CREDENTIAL_BUNDLE_PLAINTEXT_BYTES + MASTER_PASSWORD_PROFILE.tagLength) {
        throw new SshCredentialBundleError('invalid');
      }
      await sodium.ready;
      key = await this.deriveKey(passphraseBytes, salt, cancellation);
      if (cancellation?.aborted) throw new SshCredentialBundleError('cancelled');
      try {
        const decoded = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
          null, ciphertext, associatedData(), nonce, key, 'uint8array'
        );
        const plaintext = Buffer.from(decoded);
        decoded.fill(0);
        if (plaintext.byteLength > MAX_SSH_CREDENTIAL_BUNDLE_PLAINTEXT_BYTES) {
          plaintext.fill(0);
          throw new SshCredentialBundleError('invalid');
        }
        try { return new TextDecoder('utf-8', { fatal: true }).decode(plaintext); }
        catch { throw new SshCredentialBundleError('corrupt'); }
        finally { plaintext.fill(0); }
      } catch (error) {
        if (error instanceof SshCredentialBundleError) throw error;
        throw new SshCredentialBundleError('corrupt');
      }
    } finally {
      passphraseBytes.fill(0);
      salt?.fill(0);
      nonce?.fill(0);
      ciphertext?.fill(0);
      key?.fill(0);
    }
  }

  private async deriveKey(passphrase: Uint8Array, salt: Uint8Array, cancellation?: CancellationSignal): Promise<Buffer> {
    if (cancellation?.aborted) throw new SshCredentialBundleError('cancelled');
    const abortController = new AbortController();
    const abort = () => abortController.abort();
    cancellation?.addEventListener('abort', abort, { once: true });
    try { return await this.keyDeriver.derive(passphrase, salt, abortController.signal); }
    catch (error) {
      if (cancellation?.aborted) throw new SshCredentialBundleError('cancelled');
      const kind = isRecord(error) ? error.kind : undefined;
      throw new SshCredentialBundleError(kind === 'timeout' ? 'timeout' : kind === 'cancelled' ? 'cancelled' : 'unavailable');
    } finally { cancellation?.removeEventListener('abort', abort); }
  }
}

function parseEnvelope(bytes: Uint8Array): { readonly salt: string; readonly nonce: string; readonly ciphertext: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new SshCredentialBundleError('corrupt'); }
  if (!isRecord(parsed) || !exactKeys(parsed, ['version', 'profile', 'salt', 'nonce', 'ciphertext']) || parsed.version !== 1 ||
      !isMasterPasswordProfile(parsed.profile) || typeof parsed.salt !== 'string' || typeof parsed.nonce !== 'string' ||
      typeof parsed.ciphertext !== 'string') throw new SshCredentialBundleError('corrupt');
  return { salt: parsed.salt, nonce: parsed.nonce, ciphertext: parsed.ciphertext };
}

function encodePassphrase(value: string): Buffer {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) throw new SshCredentialBundleError('invalid');
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.byteLength > 1024 || new TextDecoder('utf-8', { fatal: true }).decode(bytes) !== value) {
    bytes.fill(0);
    throw new SshCredentialBundleError('invalid');
  }
  return bytes;
}

function decodeBase64(value: string, expectedLength: number, allowLonger = false): Buffer {
  const bytes = Buffer.from(value, 'base64');
  if ((!allowLonger && bytes.byteLength !== expectedLength) || (allowLonger && bytes.byteLength < expectedLength) ||
      bytes.toString('base64') !== value) {
    bytes.fill(0);
    throw new SshCredentialBundleError('corrupt');
  }
  return bytes;
}

function associatedData(): Buffer {
  return Buffer.from(JSON.stringify({ format: FORMAT_NAME, version: 1, profile: MASTER_PASSWORD_PROFILE }), 'utf8');
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
