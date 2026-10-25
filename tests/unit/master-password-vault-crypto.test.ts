import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveMasterPasswordKey } from '../../apps/desktop/src/workers/master-password-kdf.ts';
import { isMasterPasswordEnvelope, isMasterPasswordProfile, MASTER_PASSWORD_PROFILE,
  openMasterPasswordEnvelope, sealMasterPasswordEnvelope } from '../../apps/desktop/src/adapters/master-password-crypto.ts';

const REFERENCE = '6f5c51a4-5f41-4b63-a1da-69d17cbf43df';

test('Argon2id v1.3 uses the pinned version-1 profile known-answer vector', async () => {
  const password = Buffer.from('mrt-kat-password', 'utf8');
  const salt = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  const key = await deriveMasterPasswordKey(password, salt);
  try { assert.equal(key.toString('hex'), 'c2d87d456ae11f0e2289eae0dc8dda41951cfddcd6379128d804857633c563c4'); }
  finally { key.fill(0); password.fill(0); salt.fill(0); }
});

test('XChaCha20-Poly1305 binds profile and credential reference to authenticated ciphertext', async () => {
  const key = new Uint8Array(32).fill(7);
  const nonce = Uint8Array.from({ length: 24 }, (_, index) => index);
  const plaintext = Buffer.from('mrt master vault known answer', 'utf8');
  const envelope = await sealMasterPasswordEnvelope(plaintext, key, REFERENCE, nonce);
  assert.deepEqual(envelope, {
    version: 1,
    profile: 1,
    nonce: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYX',
    ciphertext: 'xWXfpZd9KNFAtaExh5fD2H+9VnhjmRcQnW7A5Oj5w2a5eaEiKqAwNCglzTYA'
  });
  assert.equal(isMasterPasswordEnvelope(envelope), true);
  const opened = await openMasterPasswordEnvelope(envelope, key, REFERENCE);
  try { assert.deepEqual(opened, plaintext); }
  finally { opened.fill(0); plaintext.fill(0); key.fill(0); nonce.fill(0); }

  const tampered = { ...envelope, ciphertext: envelope.ciphertext.slice(0, -2) + 'AA' };
  assert.equal(isMasterPasswordEnvelope(tampered), true);
  await assert.rejects(openMasterPasswordEnvelope(tampered, new Uint8Array(32).fill(7), REFERENCE));
  await assert.rejects(openMasterPasswordEnvelope(envelope, new Uint8Array(32).fill(7), `${REFERENCE.slice(0, -1)}0`));
});

test('unsupported Argon2id or XChaCha profile parameters are rejected before deriving a key', () => {
  assert.equal(isMasterPasswordProfile(MASTER_PASSWORD_PROFILE), true);
  assert.equal(isMasterPasswordProfile({ ...MASTER_PASSWORD_PROFILE, memLimit: 1 }), false);
  assert.equal(isMasterPasswordEnvelope({ version: 1, profile: 2, nonce: 'AA==', ciphertext: 'AA==' }), false);
});
