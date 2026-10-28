import test from 'node:test';
import assert from 'node:assert/strict';
import { createSshCredentialBundleManager } from '../../packages/application/src/ssh-credential-bundle.ts';
import type { ImportedSshCredentialReference, SshCredentialBundleCodec, SshCredentialBundleProfile, SshCredentialBundleStore } from '../../packages/application/src/ssh-credential-bundle.ts';
import type { CredentialPrompt } from '../../packages/application/src/credential-prompt.ts';
import { StorageOperationError } from '../../packages/application/src/storage-errors.ts';
import type { SecretVault } from '../../packages/application/src/secret-vault.ts';
import type { CredentialReference } from '../../packages/domain/src/credentials.ts';
import type { SavedSessionDefinition } from '../../packages/domain/src/session-definition.ts';

const sshProfile: Extract<SavedSessionDefinition, { readonly kind: 'ssh' }> = {
  id: 'fc11e919-33de-4228-b39a-78d0dcae1e2d', folderId: null, kind: 'ssh', name: 'Build server', host: 'build.example.net', port: 2222,
  favorite: false, createdAt: '2026-10-25T00:00:00.000Z', updatedAt: '2026-10-25T00:00:00.000Z'
};
const savedReference = 'b64504d8-9bbc-4e11-a4e2-345fcc039841' as CredentialReference;
const importedReference = 'a9a58812-27f6-49ad-b68f-afed445eb329' as CredentialReference;
const entry = { sessionId: sshProfile.id, host: sshProfile.host, port: sshProfile.port, username: 'alice', password: 'saved-password-test' };

function setup(options: { readonly imported?: string; readonly attach?: boolean | Error; readonly confirmPassphrase?: string } = {}) {
  const secrets = new Map<string, string>([[savedReference, JSON.stringify({ username: 'alice', password: 'saved-password-test' })]]);
  const writes: Uint8Array[] = [];
  const attachments: ImportedSshCredentialReference[][] = [];
  const promptContexts: string[] = [];
  const promptPurposes: string[] = [];
  let prompts = 0;
  let exportedPlaintext = '';
  let selectedExports = 0;
  let selectedImports = 0;
  const profileReferences: readonly SshCredentialBundleProfile[] = [{ profile: sshProfile, reference: savedReference }];
  const store: SshCredentialBundleStore = {
    async listSshCredentials() { return profileReferences; },
    async attachImportedSshCredentials(credentials) {
      attachments.push([...credentials]);
      if (options.attach instanceof Error) throw options.attach;
      return options.attach ?? true;
    },
    async readEncryptedSshCredentialBundle() { return new Uint8Array([9, 8, 7]); },
    async writeEncryptedSshCredentialBundle(_path, contents) { writes.push(new Uint8Array(contents)); }
  };
  const dialog = {
    async selectExportPath() { selectedExports += 1; return 'C:\\safe\\credentials.mrtcred'; },
    async selectImportPath() { selectedImports += 1; return 'C:\\safe\\credentials.mrtcred'; }
  };
  const prompt: CredentialPrompt = {
    async prompt(purpose, _signal, context) {
      promptPurposes.push(purpose);
      promptContexts.push(context ?? '');
      prompts += 1;
      return { kind: 'provided', username: '', secret: prompts === 2 ? options.confirmPassphrase ?? 'different-passphrase' : 'strong-test-passphrase' };
    }
  };
  const vault: SecretVault = {
    state: 'available', mode: 'windows-account',
    async initialize() {},
    async store(reference, secret) { secrets.set(reference, secret); },
    async resolveForOperation(reference) {
      const value = secrets.get(reference);
      if (value === undefined) throw new Error('missing secret');
      return value;
    },
    async delete(reference) { return secrets.delete(reference); },
    async reset() { secrets.clear(); },
    lock() {}, async unlock() {}, async enableMasterPassword() {}, async disableMasterPassword() {}
  };
  const codec: SshCredentialBundleCodec = {
    async encrypt(plaintext) { exportedPlaintext = plaintext; return new Uint8Array([1, 2, 3]); },
    async decrypt() { return options.imported ?? JSON.stringify({ version: 1, credentials: [entry] }); }
  };
  const manager = createSshCredentialBundleManager(store, dialog, prompt, vault, codec,
    () => importedReference);
  return { manager, secrets, writes, attachments, promptContexts, promptPurposes,
    get exportedPlaintext() { return exportedPlaintext; }, get selectedExports() { return selectedExports; },
    get selectedImports() { return selectedImports; } };
}

test('export encrypts a complete vault snapshot and writes only codec output', async () => {
  const context = setup({ confirmPassphrase: 'strong-test-passphrase' });
  assert.deepEqual(await context.manager.export(), { ok: true, result: { credentialCount: 1 } });
  assert.deepEqual(context.writes, [new Uint8Array([1, 2, 3])]);
  assert.deepEqual(JSON.parse(context.exportedPlaintext), { version: 1, credentials: [entry] });
  assert.equal(context.promptContexts.length, 2);
  assert.deepEqual(context.promptPurposes, ['credential-bundle-passphrase', 'credential-bundle-passphrase']);
  assert.match(context.promptContexts[0]!, /strong, unique passphrase/);
  assert.equal(context.selectedExports, 1);
});

test('export rejects a mismatched confirmation without writing a file', async () => {
  const context = setup();
  assert.deepEqual(await context.manager.export(), {
    ok: false, error: { code: 'CONFLICT', target: 'application', retryable: false }
  });
  assert.equal(context.writes.length, 0);
});

test('import validates the complete payload, stores secrets in the vault, then attaches references', async () => {
  const context = setup();
  assert.deepEqual(await context.manager.import(), { ok: true, result: { credentialCount: 1 } });
  assert.deepEqual(context.attachments, [[{ sessionId: entry.sessionId, host: entry.host, port: entry.port, reference: importedReference }]]);
  assert.deepEqual(JSON.parse(context.secrets.get(importedReference)!), { username: entry.username, password: entry.password });
  assert.equal(context.selectedImports, 1);
});

test('an import conflict rolls back every newly stored vault entry', async () => {
  const context = setup({ attach: false });
  assert.deepEqual(await context.manager.import(), {
    ok: false, error: { code: 'CONFLICT', target: 'application', retryable: false }
  });
  assert.equal(context.secrets.has(importedReference), false);
});

test('an ambiguous storage failure retains staged vault entries to protect a possibly committed reference', async () => {
  const context = setup({ attach: new StorageOperationError('busy') });
  assert.deepEqual(await context.manager.import(), {
    ok: false, error: { code: 'BUSY', target: 'application', retryable: true }
  });
  assert.equal(context.secrets.has(importedReference), true);
});

test('import rejects duplicate profile entries before writing vault records', async () => {
  const context = setup({ imported: JSON.stringify({ version: 1, credentials: [entry, entry] }) });
  assert.deepEqual(await context.manager.import(), {
    ok: false, error: { code: 'CORRUPT', target: 'application', retryable: false }
  });
  assert.equal(context.secrets.has(importedReference), false);
  assert.equal(context.attachments.length, 0);
});
