import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SshCredentialBundleCryptoAdapter } from '../../apps/desktop/src/adapters/ssh-credential-bundle-crypto.ts';
import type { MasterPasswordKeyDeriver } from '../../apps/desktop/src/adapters/master-password-key-deriver.ts';
import { MAX_SSH_CREDENTIAL_BUNDLE_BYTES } from '../../packages/application/src/ssh-credential-bundle.ts';
import { SshCredentialBundleError } from '../../packages/application/src/ssh-credential-bundle.ts';

function createCodec() {
  let derivations = 0;
  const keyDeriver: MasterPasswordKeyDeriver = {
    async derive(password, salt, signal) {
      derivations += 1;
      if (signal.aborted) throw new Error('cancelled');
      assert.equal(salt.byteLength, 16);
      return createHash('sha256').update(password).update(salt).digest();
    }
  };
  return { codec: new SshCredentialBundleCryptoAdapter(keyDeriver), get derivations() { return derivations; } };
}

test('credential bundle crypto authenticates and round-trips with fresh salt and nonce', async () => {
  const { codec } = createCodec();
  const plaintext = JSON.stringify({ version: 1, credentials: [{ sessionId: '11111111-1111-4111-8111-111111111111',
    host: 'server.example.net', port: 22, username: 'alice', password: 'secret' }] });
  const first = await codec.encrypt(plaintext, 'a strong bundle passphrase');
  const second = await codec.encrypt(plaintext, 'a strong bundle passphrase');
  assert.notDeepEqual(first, second, 'salt and nonce make repeated exports distinct');
  assert.equal(await codec.decrypt(first, 'a strong bundle passphrase'), plaintext);
  await assert.rejects(codec.decrypt(first, 'wrong passphrase'), (error: unknown) =>
    error instanceof SshCredentialBundleError && error.kind === 'corrupt');
});

test('credential bundle crypto rejects tampering and unknown KDF profiles before derivation', async () => {
  const context = createCodec();
  const { codec } = context;
  const encrypted = await codec.encrypt('{"version":1,"credentials":[]}', 'a strong bundle passphrase');
  const envelope = JSON.parse(new TextDecoder().decode(encrypted)) as Record<string, unknown>;
  const ciphertext = Buffer.from(envelope.ciphertext as string, 'base64');
  ciphertext[0] = ciphertext[0]! ^ 1;
  envelope.ciphertext = ciphertext.toString('base64');
  await assert.rejects(codec.decrypt(Buffer.from(JSON.stringify(envelope)), 'a strong bundle passphrase'), (error: unknown) =>
    error instanceof SshCredentialBundleError && error.kind === 'corrupt');

  envelope.profile = { ...(envelope.profile as Record<string, unknown>), memLimit: 1 };
  const derivationsBeforeUnsupportedProfile = context.derivations;
  await assert.rejects(codec.decrypt(Buffer.from(JSON.stringify(envelope)), 'a strong bundle passphrase'), (error: unknown) =>
    error instanceof SshCredentialBundleError && error.kind === 'corrupt');
  assert.equal(context.derivations, derivationsBeforeUnsupportedProfile, 'unsupported resource parameters never reach Argon2id');
});

test('credential bundle crypto rejects a non-profile salt length before derivation', async () => {
  const context = createCodec();
  const { codec } = context;
  const encrypted = await codec.encrypt('{"version":1,"credentials":[]}', 'a strong bundle passphrase');
  const envelope = JSON.parse(new TextDecoder().decode(encrypted)) as Record<string, unknown>;
  envelope.salt = Buffer.alloc(17, 1).toString('base64');
  const derivationsBeforeMalformedSalt = context.derivations;

  await assert.rejects(codec.decrypt(Buffer.from(JSON.stringify(envelope)), 'a strong bundle passphrase'), (error: unknown) =>
    error instanceof SshCredentialBundleError && error.kind === 'corrupt');
  assert.equal(context.derivations, derivationsBeforeMalformedSalt, 'malformed salt never reaches Argon2id');
});

test('credential bundle crypto rejects malformed and oversized input before key derivation', async () => {
  const context = createCodec();
  const { codec } = context;
  await assert.rejects(codec.decrypt(new Uint8Array(MAX_SSH_CREDENTIAL_BUNDLE_BYTES + 1), 'a strong bundle passphrase'), (error: unknown) =>
    error instanceof SshCredentialBundleError && error.kind === 'invalid');
  await assert.rejects(codec.encrypt('x', '\ud800'), (error: unknown) =>
    error instanceof SshCredentialBundleError && error.kind === 'invalid');
  assert.equal(context.derivations, 0);
});
