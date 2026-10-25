import sodium from 'libsodium-wrappers-sumo';
import { MASTER_PASSWORD_PROFILE } from '../adapters/master-password-profile.ts';

export async function deriveMasterPasswordKey(password: Uint8Array, salt: Uint8Array): Promise<Buffer> {
  if (password.byteLength === 0 || password.byteLength > 1024 || salt.byteLength !== MASTER_PASSWORD_PROFILE.saltLength) {
    throw new TypeError('Invalid master-password KDF input');
  }
  await sodium.ready;
  return Buffer.from(sodium.crypto_pwhash(
    MASTER_PASSWORD_PROFILE.keyLength,
    password,
    salt,
    MASTER_PASSWORD_PROFILE.opsLimit,
    MASTER_PASSWORD_PROFILE.memLimit,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
    'uint8array'
  ));
}
