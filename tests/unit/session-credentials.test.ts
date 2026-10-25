import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionCredentialManager } from '../../packages/application/src/session-credentials.ts';
import type { SessionCredentialStore } from '../../packages/application/src/session-credentials.ts';
import { SecretVaultError } from '../../packages/application/src/secret-vault.ts';
import type { SecretVault, SecretVaultMode, SecretVaultState } from '../../packages/application/src/secret-vault.ts';
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
  let failReferenceClear = false;
  const references = [generatedReference, replacementReference];
  const secrets = new Map<string, string>();
  let state = initialState;
  let mode: SecretVaultMode = 'windows-account';
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
    },
    async clearAllSessionCredentialReferences() {
      if (failReferenceClear) throw new Error('storage unavailable');
      reference = undefined;
    }
  };
  const vault: SecretVault = {
    get state() { return state; },
    get mode() { return mode; },
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
    async reset() { secrets.clear(); mode = 'windows-account'; state = 'available'; },
    lock() { state = 'locked'; },
    async unlock() { state = 'available'; },
    async enableMasterPassword() { mode = 'master-password'; state = 'available'; },
    async disableMasterPassword() { mode = 'windows-account'; state = 'available'; }
  };
  const prompt = { async prompt() { return { kind: 'provided' as const, username: 'alice', secret: 'saved-password-test' }; } };
  return { manager: createSessionCredentialManager(store, prompt, vault, () => references[nextReference++] ?? replacementReference), secrets,
    get reference() { return reference; }, get profile() { return profile; }, set profile(value: SavedSessionDefinition | undefined) { profile = value; },
    set failReferenceClear(value: boolean) { failReferenceClear = value; },
    set state(value: SecretVaultState) { state = value; }, set mode(value: SecretVaultMode) { mode = value; },
    set staleNextReference(value: CredentialReference | undefined) { staleNextReference = value; } };
}

test('master-password management uses private prompts and reports only vault mode and status', async () => {
  const context = setup();
  assert.deepEqual(await context.manager.enableMasterPassword(), {
    ok: true, result: { state: 'available', mode: 'master-password' }
  });
  context.state = 'locked';
  assert.deepEqual(await context.manager.unlock(), {
    ok: true, result: { state: 'available', mode: 'master-password' }
  });
  assert.deepEqual(await context.manager.disableMasterPassword(), {
    ok: true, result: { state: 'available', mode: 'windows-account' }
  });
});

test('vault reset clears SSH credential references but leaves saved session definitions intact', async () => {
  const context = setup();
  await context.manager.saveSshCredential(sshProfile.id);
  assert.equal(context.reference, generatedReference);
  const reset = await context.manager.resetVault();
  assert.deepEqual(reset, { ok: true, result: { state: 'available', mode: 'windows-account' } });
  assert.equal(context.reference, undefined);
  assert.deepEqual(context.profile, sshProfile);
  assert.deepEqual(await context.manager.hasSshCredential(sshProfile.id), { ok: true, result: false });
});

test('vault reset reports partial reference cleanup after encrypted passwords are already deleted', async () => {
  const context = setup();
  await context.manager.saveSshCredential(sshProfile.id);
  context.failReferenceClear = true;

  assert.deepEqual(await context.manager.resetVault(), {
    ok: false, error: { code: 'CONFLICT', target: 'application', retryable: false }
  });
  assert.equal(context.secrets.size, 0);
  assert.equal(context.reference, generatedReference, 'the failed store cleanup is visible for status refresh and stale-reference recovery');
  assert.deepEqual(context.profile, sshProfile, 'partial reset preserves the saved definition');
});

test('a stale credential reference is detached when an explicit vault reset removed its entry', async () => {
  const context = setup();
  await context.manager.saveSshCredential(sshProfile.id);
  context.secrets.clear();
  assert.deepEqual(await context.manager.resolveSshCredential(sshProfile.id, sshProfile.host, sshProfile.port), {
    ok: true, result: undefined
  });
  assert.equal(context.reference, undefined);
});

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
  assert.deepEqual(await context.manager.forgetSshCredential(sshProfile.id), { ok: true, result: {} });
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
  assert.deepEqual(await context.manager.forgetSshCredential(sshProfile.id), {
    ok: false, error: { code: 'LOCKED', target: 'application', retryable: false }
  });
});

test('saved credential references must be valid UUIDs before vault access', async () => {
  assert.equal(parseCredentialReference(generatedReference), generatedReference);
  assert.equal(parseCredentialReference('../credentials.json'), undefined);
});
