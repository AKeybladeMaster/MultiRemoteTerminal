import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SecretVaultError } from '../../packages/application/src/secret-vault.ts';
import { parseCredentialReference } from '../../packages/domain/src/credentials.ts';
import type { AsyncSafeStorage } from '../../apps/desktop/src/adapters/safe-storage-secret-vault.ts';
import { SafeStorageSecretVault } from '../../apps/desktop/src/adapters/safe-storage-secret-vault.ts';

const FIRST_REFERENCE = parseCredentialReference('6f5c51a4-5f41-4b63-a1da-69d17cbf43df')!;
const SECOND_REFERENCE = parseCredentialReference('53d2d7ca-20d4-4d0e-a2bd-155a3d452619')!;

test('stores only ciphertext, resolves per operation, locks and deletes credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-vault-'));
  const path = join(directory, 'credentials.json');
  const safeStorage = new FakeSafeStorage();
  const vault = new SafeStorageSecretVault(path, safeStorage);
  try {
    await vault.initialize();
    assert.equal(vault.state, 'available');
    await vault.store(FIRST_REFERENCE, 'private-password-value');
    const contents = await readFile(path, 'utf8');
    assert.equal(contents.includes('private-password-value'), false);
    assert.equal(await vault.resolveForOperation(FIRST_REFERENCE), 'private-password-value');

    vault.lock();
    await assert.rejects(vault.resolveForOperation(FIRST_REFERENCE), error => isVaultError(error, 'locked'));
    await vault.unlock();
    assert.equal(await vault.resolveForOperation(FIRST_REFERENCE), 'private-password-value');
    assert.equal(await vault.delete(FIRST_REFERENCE), true);
    assert.equal(await vault.delete(FIRST_REFERENCE), false);
    await assert.rejects(vault.resolveForOperation(FIRST_REFERENCE), error => isVaultError(error, 'not-found'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('serial writes preserve entries and a requested key rotation is persisted before returning plaintext', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-vault-'));
  const path = join(directory, 'credentials.json');
  const safeStorage = new FakeSafeStorage();
  const legacy = encryptForTest(encodeSecret(FIRST_REFERENCE, 'legacy-secret'), 'v0');
  await writeFile(path, JSON.stringify({ version: 1, entries: { [FIRST_REFERENCE]: legacy.toString('base64') } }), 'utf8');
  const vault = new SafeStorageSecretVault(path, safeStorage);
  try {
    await vault.initialize();
    assert.equal(await vault.resolveForOperation(FIRST_REFERENCE), 'legacy-secret');
    const afterRotation = JSON.parse(await readFile(path, 'utf8')) as { entries: Record<string, string> };
    assert.notEqual(afterRotation.entries[FIRST_REFERENCE], legacy.toString('base64'));

    await Promise.all([
      vault.store(FIRST_REFERENCE, 'updated-secret'),
      vault.store(SECOND_REFERENCE, 'second-secret')
    ]);
    assert.equal(await vault.resolveForOperation(FIRST_REFERENCE), 'updated-secret');
    assert.equal(await vault.resolveForOperation(SECOND_REFERENCE), 'second-secret');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('corrupt vault data fails closed and remains untouched', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-vault-'));
  const path = join(directory, 'credentials.json');
  const corrupt = '{"version":2,"entries":{}}';
  await writeFile(path, corrupt, 'utf8');
  const vault = new SafeStorageSecretVault(path, new FakeSafeStorage());
  try {
    await assert.rejects(vault.initialize(), error => isVaultError(error, 'corrupt'));
    assert.equal(vault.state, 'unavailable');
    assert.equal(await readFile(path, 'utf8'), corrupt);
    await assert.rejects(vault.store(FIRST_REFERENCE, 'anything'), error => isVaultError(error, 'unavailable'));
    await vault.reset();
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { version: 1, entries: {} });
    assert.equal(vault.state, 'available');
    await vault.store(FIRST_REFERENCE, 'entered-again-after-reset');
    assert.equal(await vault.resolveForOperation(FIRST_REFERENCE), 'entered-again-after-reset');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('unavailable OS encryption fails closed and can be retried when it becomes available', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-vault-'));
  const path = join(directory, 'credentials.json');
  const safeStorage = new SwitchableSafeStorage();
  const vault = new SafeStorageSecretVault(path, safeStorage);
  try {
    safeStorage.available = false;
    await assert.rejects(vault.initialize(), error => isVaultError(error, 'unavailable'));
    assert.equal(vault.state, 'unavailable');
    await assert.rejects(readFile(path, 'utf8'), error => isNodeError(error, 'ENOENT'));

    safeStorage.available = true;
    await vault.initialize();
    assert.equal(vault.state, 'available');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a manual lock remains in force when initialization retries after OS encryption recovers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-vault-'));
  const safeStorage = new SwitchableSafeStorage();
  const vault = new SafeStorageSecretVault(join(directory, 'credentials.json'), safeStorage);
  try {
    safeStorage.available = false;
    await assert.rejects(vault.initialize(), error => isVaultError(error, 'unavailable'));
    vault.lock();

    safeStorage.available = true;
    await vault.initialize();
    assert.equal(vault.state, 'locked');
    await vault.unlock();
    assert.equal(vault.state, 'available');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a failed reset stays fail-closed until the explicit reset succeeds', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-vault-'));
  const path = join(directory, 'credential-target');
  const vault = new SafeStorageSecretVault(path, new FakeSafeStorage());
  try {
    await mkdir(path);
    await assert.rejects(vault.initialize(), error => isVaultError(error, 'corrupt'));
    await assert.rejects(vault.reset(), error => isVaultError(error, 'unavailable'));
    await assert.rejects(vault.initialize(), error => isVaultError(error, 'unavailable'));

    await rm(path, { recursive: true, force: true });
    await vault.reset();
    assert.equal(vault.state, 'available');
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { version: 1, entries: {} });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('locking during asynchronous decryption prevents returning the secret', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-vault-'));
  const path = join(directory, 'credentials.json');
  const safeStorage = new PausingSafeStorage();
  const vault = new SafeStorageSecretVault(path, safeStorage);
  try {
    await vault.initialize();
    await vault.store(FIRST_REFERENCE, 'must-not-escape-after-lock');
    const result = vault.resolveForOperation(FIRST_REFERENCE);
    await safeStorage.decryptStarted;
    vault.lock();
    safeStorage.resumeDecrypt();
    await assert.rejects(result, error => isVaultError(error, 'locked'));
  } finally {
    safeStorage.resumeDecrypt();
    await rm(directory, { recursive: true, force: true });
  }
});

test('a lock during initialization or unlock prevents stale availability from reopening the vault', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-vault-'));
  const safeStorage = new PausingAvailabilitySafeStorage();
  const vault = new SafeStorageSecretVault(join(directory, 'credentials.json'), safeStorage);
  try {
    const initialization = safeStorage.pauseNextAvailability();
    const initializing = vault.initialize();
    await initialization.started;
    vault.lock();
    initialization.resume();
    await initializing;
    assert.equal(vault.state, 'locked');

    await vault.unlock();
    vault.lock();
    const unlocking = safeStorage.pauseNextAvailability();
    const unlock = vault.unlock();
    await unlocking.started;
    vault.lock();
    unlocking.resume();
    await assert.rejects(unlock, error => isVaultError(error, 'locked'));
    assert.equal(vault.state, 'locked');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

class FakeSafeStorage implements AsyncSafeStorage {
  isAsyncEncryptionAvailable(): Promise<boolean> { return Promise.resolve(true); }
  encryptStringAsync(plainText: string): Promise<Buffer> { return Promise.resolve(encryptForTest(plainText, 'v1')); }
  async decryptStringAsync(encrypted: Buffer): Promise<{ readonly result: string; readonly shouldReEncrypt: boolean }> {
    const version = encrypted.toString('utf8').slice(0, 2);
    const value = encrypted.toString('utf8').slice(3);
    return { result: Buffer.from(value, 'base64').toString('utf8'), shouldReEncrypt: version === 'v0' };
  }
}

class SwitchableSafeStorage extends FakeSafeStorage {
  available = true;

  override isAsyncEncryptionAvailable(): Promise<boolean> { return Promise.resolve(this.available); }
}

class PausingSafeStorage extends FakeSafeStorage {
  private begin!: () => void;
  private resume!: () => void;
  readonly decryptStarted = new Promise<void>(resolve => { this.begin = resolve; });
  private readonly decryptGate = new Promise<void>(resolve => { this.resume = resolve; });

  override async decryptStringAsync(encrypted: Buffer): Promise<{ readonly result: string; readonly shouldReEncrypt: boolean }> {
    this.begin();
    await this.decryptGate;
    return super.decryptStringAsync(encrypted);
  }

  resumeDecrypt(): void { this.resume(); }
}

class PausingAvailabilitySafeStorage extends FakeSafeStorage {
  private nextPause: { readonly announce: () => void; readonly gate: Promise<void> } | undefined;

  pauseNextAvailability(): { readonly started: Promise<void>; readonly resume: () => void } {
    let announce!: () => void;
    let resume!: () => void;
    const started = new Promise<void>(resolve => { announce = resolve; });
    const gate = new Promise<void>(resolve => { resume = resolve; });
    this.nextPause = { announce, gate };
    return { started, resume };
  }

  override async isAsyncEncryptionAvailable(): Promise<boolean> {
    const pause = this.nextPause;
    this.nextPause = undefined;
    if (pause) {
      pause.announce();
      await pause.gate;
    }
    return true;
  }
}

function encryptForTest(value: string, version: 'v0' | 'v1'): Buffer {
  return Buffer.from(version + ':' + Buffer.from(value, 'utf8').toString('base64'), 'utf8');
}

function encodeSecret(reference: string, secret: string): string {
  return JSON.stringify({ version: 1, reference, secret });
}

function isVaultError(error: unknown, kind: string): error is SecretVaultError {
  return error instanceof SecretVaultError && error.kind === kind;
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
