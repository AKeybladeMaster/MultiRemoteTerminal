import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionCredentialManager } from '../../packages/application/src/session-credentials.ts';
import type { SessionCredentialStore } from '../../packages/application/src/session-credentials.ts';
import { SecretVaultError } from '../../packages/application/src/secret-vault.ts';
import type { SecretVault, SecretVaultState } from '../../packages/application/src/secret-vault.ts';
import type { SavedSessionDefinition } from '../../packages/domain/src/session-definition.ts';
import type { CredentialReference } from '../../packages/domain/src/credentials.ts';
import { parseCredentialReference } from '../../packages/domain/src/credentials.ts';

const sshProfile: SavedSessionDefinition = {
  id: 'fc11e919-33de-4228-b39a-78d0dcae1e2d', folderId: null, kind: 'ssh', name: 'Build server', host: 'build.example.net', port: 2222,
  favorite: false, createdAt: '2026-10-25T00:00:00.000Z', updatedAt: '2026-10-25T00:00:00.000Z'
};
const generatedReference = 'b64504d8-9bbc-4e11-a4e2-345fcc039841';
const replacementReference = 'a9a58812-27f6-49ad-b68f-afed445eb329';

function setup(initialState: SecretVaultState = 'available') {
  let reference: CredentialReference | undefined;
  let staleNextReference: CredentialReference | undefined;
  let profile: SavedSessionDefinition | undefined = sshProfile;
  let nextReference = 0;
  const references = [generatedReference, replacementReference];
  const secrets = new Map<string, string>();
  let state = initialState;
  const store: SessionCredentialStore = {
    async getSessionDefinition(id) { return profile?.id === id ? profile : undefined; },
    async getSessionCredentialReference() {
      if (staleNextReference) {
        const stale = staleNextReference;
        staleNextReference = undefined;
        return stale;
      }
      return reference;
    },
    async setSessionCredentialReference(id, next, expected) {
      if (profile?.id !== id || (reference ?? null) !== expected) return false;
      reference = next ?? undefined;
      return true;
    }
  };
  const vault: SecretVault = {
    get state() { return state; },
    async initialize() {},
    async store(key, secret) { if (state !== 'available') throw new SecretVaultError('locked'); secrets.set(key, secret); },
    async resolveForOperation(key) {
      if (state === 'locked') throw new SecretVaultError('locked');
      const secret = secrets.get(key);
      if (secret === undefined) throw new SecretVaultError('not-found');
      return secret;
    },
    async delete(key) {
      if (state !== 'available') throw new SecretVaultError('locked');
      return secrets.delete(key);
    },
    async reset() { secrets.clear(); },
    lock() { state = 'locked'; },
    async unlock() { state = 'available'; }
  };
  const prompt = { async prompt() { return { kind: 'provided' as const, username: 'alice', secret: 'saved-password-test' }; } };
  return { manager: createSessionCredentialManager(store, prompt, vault, () => references[nextReference++] ?? replacementReference), secrets,
    get reference() { return reference; }, set profile(value: SavedSessionDefinition | undefined) { profile = value; },
    set state(value: SecretVaultState) { state = value; }, set staleNextReference(value: CredentialReference | undefined) { staleNextReference = value; } };
}

test('saved SSH credentials are serialized only into the vault and resolve only for their exact profile endpoint', async () => {
  const context = setup();
  const saved = await context.manager.saveSshCredential(sshProfile.id);
  assert.deepEqual(saved, { ok: true, result: {} });
  assert.equal(context.reference, generatedReference);
  assert.deepEqual([...context.secrets.keys()], [generatedReference]);
  assert.deepEqual(JSON.parse(context.secrets.get(generatedReference)!), { username: 'alice', password: 'saved-password-test' });

  assert.deepEqual(await context.manager.resolveSshCredential(sshProfile.id, 'BUILD.EXAMPLE.NET.', 2222), {
    ok: true, result: { username: 'alice', password: 'saved-password-test' }
  });
  assert.deepEqual(await context.manager.resolveSshCredential(sshProfile.id, 'other.example.net', 2222), {
    ok: false, error: { code: 'INVALID_REQUEST', target: 'application', retryable: false }
  });
});

test('credential removal deletes the vault entry and detaches the profile reference', async () => {
  const context = setup();
  await context.manager.saveSshCredential(sshProfile.id);
  assert.equal((await context.manager.hasSshCredential(sshProfile.id)).ok, true);
  assert.deepEqual(await context.manager.forgetSshProfile(sshProfile.id), { ok: true, result: {} });
  assert.equal(context.reference, undefined);
  assert.equal(context.secrets.size, 0);
});

test('replacing a saved SSH password atomically rotates its reference and removes the prior vault entry', async () => {
  const context = setup();
  assert.equal((await context.manager.saveSshCredential(sshProfile.id)).ok, true);
  assert.equal((await context.manager.saveSshCredential(sshProfile.id)).ok, true);
  assert.equal(context.reference, replacementReference);
  assert.deepEqual([...context.secrets.keys()], [replacementReference]);
});

test('saved SSH resolution follows a profile reference replaced after its initial lookup', async () => {
  const context = setup();
  await context.manager.saveSshCredential(sshProfile.id);
  const oldReference = context.reference;
  await context.manager.saveSshCredential(sshProfile.id);
  context.staleNextReference = oldReference;
  assert.deepEqual(await context.manager.resolveSshCredential(sshProfile.id, sshProfile.host, sshProfile.port), {
    ok: true, result: { username: 'alice', password: 'saved-password-test' }
  });
});

test('concurrent SSH credential saves attach at most one vault reference', async () => {
  const context = setup();
  const results = await Promise.all([
    context.manager.saveSshCredential(sshProfile.id),
    context.manager.saveSshCredential(sshProfile.id)
  ]);
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(results.filter(result => !result.ok && result.error.code === 'CONFLICT').length, 1);
  assert.equal(context.secrets.size, 1);
  assert.equal(context.secrets.has(context.reference ?? ''), true);
});

test('locked vault fails closed when saved credentials are resolved or changed', async () => {
  const context = setup();
  await context.manager.saveSshCredential(sshProfile.id);
  context.state = 'locked';
  assert.deepEqual(await context.manager.resolveSshCredential(sshProfile.id, sshProfile.host, sshProfile.port), {
    ok: false, error: { code: 'LOCKED', target: 'application', retryable: false }
  });
  assert.deepEqual(await context.manager.forgetSshProfile(sshProfile.id), {
    ok: false, error: { code: 'LOCKED', target: 'application', retryable: false }
  });
});

test('saved credential references must be valid UUIDs before vault access', async () => {
  assert.equal(parseCredentialReference(generatedReference), generatedReference);
  assert.equal(parseCredentialReference('../credentials.json'), undefined);
});
