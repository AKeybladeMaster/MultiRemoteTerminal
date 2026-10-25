import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SecretVaultError } from '../../packages/application/src/secret-vault.ts';
import { parseCredentialReference } from '../../packages/domain/src/credentials.ts';
import type { AsyncSafeStorage } from '../../apps/desktop/src/adapters/safe-storage-secret-vault.ts';
import { SafeStorageSecretVault } from '../../apps/desktop/src/adapters/safe-storage-secret-vault.ts';
import type { MasterPasswordKeyDeriver } from '../../apps/desktop/src/adapters/master-password-key-deriver.ts';

const FIRST_REFERENCE = parseCredentialReference('6f5c51a4-5f41-4b63-a1da-69d17cbf43df')!;
const SECOND_REFERENCE = parseCredentialReference('53d2d7ca-20d4-4d0e-a2bd-155a3d452619')!;

test('stores only ciphertext, resolves per operation, locks and deletes credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-vault-'));
  const path = join(directory, 'credentials.json');
  const safeStorage = new FakeSafeStorage();
  const vault = new SafeStorageSecretVault(path, safeStorage, new TestKeyDeriver());
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
  const vault = new SafeStorageSecretVault(path, safeStorage, new TestKeyDeriver());
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
  const vault = new SafeStorageSecretVault(path, new FakeSafeStorage(), new TestKeyDeriver());
  try {
    await assert.rejects(vault.initialize(), error => isVaultError(error, 'corrupt'));
    assert.equal(vault.state, 'unavailable');
    assert.equal(await readFile(path, 'utf8'), corrupt);
    await assert.rejects(vault.store(FIRST_REFERENCE, 'anything'), error => isVaultError(error, 'unavailable'));
    await vault.reset();
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { version: 2, mode: 'windows-account', entries: {} });
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
  const vault = new SafeStorageSecretVault(path, safeStorage, new TestKeyDeriver());
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
  const vault = new SafeStorageSecretVault(join(directory, 'credentials.json'), safeStorage, new TestKeyDeriver());
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
  const vault = new SafeStorageSecretVault(path, new FakeSafeStorage(), new TestKeyDeriver());
  try {
    await mkdir(path);
    await assert.rejects(vault.initialize(), error => isVaultError(error, 'corrupt'));
    await assert.rejects(vault.reset(), error => isVaultError(error, 'unavailable'));
    await assert.rejects(vault.initialize(), error => isVaultError(error, 'unavailable'));

    await rm(path, { recursive: true, force: true });
    await vault.reset();
    assert.equal(vault.state, 'available');
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { version: 2, mode: 'windows-account', entries: {} });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('locking during asynchronous decryption prevents returning the secret', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-vault-'));
  const path = join(directory, 'credentials.json');
  const safeStorage = new PausingSafeStorage();
  const vault = new SafeStorageSecretVault(path, safeStorage, new TestKeyDeriver());
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
  const vault = new SafeStorageSecretVault(join(directory, 'credentials.json'), safeStorage, new TestKeyDeriver());
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

test('master-password conversion verifies every staged ciphertext without changing credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-master-vault-'));
  const path = join(directory, 'credentials.json');
  const safeStorage = new FakeSafeStorage();
  const deriver = new TestKeyDeriver();
  const vault = new SafeStorageSecretVault(path, safeStorage, deriver);
  try {
    await vault.initialize();
    await vault.store(FIRST_REFERENCE, 'first-private-password');
    await vault.store(SECOND_REFERENCE, 'second-private-password');
    await vault.enableMasterPassword('correct horse battery staple');
    assert.equal(vault.mode, 'master-password');
    assert.equal(vault.state, 'available');
    const encrypted = await readFile(path, 'utf8');
    assert.equal(encrypted.includes('first-private-password'), false);
    assert.equal(encrypted.includes('correct horse battery staple'), false);
    assert.equal(JSON.parse(encrypted).mode, 'master-password');
    assert.equal(await vault.resolveForOperation(FIRST_REFERENCE), 'first-private-password');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('master-password vault starts locked after restart, rejects a wrong password, and round-trips saved entries', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-master-vault-restart-'));
  const path = join(directory, 'credentials.json');
  const safeStorage = new FakeSafeStorage();
  const deriver = new TestKeyDeriver();
  const first = new SafeStorageSecretVault(path, safeStorage, deriver);
  try {
    await first.initialize();
    await first.store(FIRST_REFERENCE, 'saved-private-password');
    await first.enableMasterPassword('correct horse battery staple');

    const reopened = new SafeStorageSecretVault(path, safeStorage, deriver);
    await reopened.initialize();
    assert.equal(reopened.mode, 'master-password');
    assert.equal(reopened.state, 'locked');
    await assert.rejects(reopened.unlock('wrong password'), error => isVaultError(error, 'password-rejected'));
    await assert.rejects(reopened.resolveForOperation(FIRST_REFERENCE), error => isVaultError(error, 'locked'));
    await reopened.unlock('correct horse battery staple');
    assert.equal(await reopened.resolveForOperation(FIRST_REFERENCE), 'saved-private-password');

    const key = (reopened as unknown as { masterKey: Buffer }).masterKey;
    reopened.lock();
    assert.deepEqual([...key], new Array(32).fill(0));
    await reopened.unlock('correct horse battery staple');
    await reopened.disableMasterPassword('correct horse battery staple');
    assert.equal(reopened.mode, 'windows-account');
    assert.equal(reopened.state, 'available');
    assert.equal(await reopened.resolveForOperation(FIRST_REFERENCE), 'saved-private-password');
    assert.equal(JSON.parse(await readFile(path, 'utf8')).mode, 'windows-account');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('master-password mode remains usable when Windows account encryption is unavailable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-master-vault-independent-'));
  const path = join(directory, 'credentials.json');
  const safeStorage = new SwitchableSafeStorage();
  const deriver = new TestKeyDeriver();
  try {
    const first = new SafeStorageSecretVault(path, safeStorage, deriver);
    await first.initialize();
    await first.store(FIRST_REFERENCE, 'master-only-password');
    await first.enableMasterPassword('master password');
    safeStorage.available = false;

    const reopened = new SafeStorageSecretVault(path, safeStorage, deriver);
    await reopened.initialize();
    assert.equal(reopened.state, 'locked');
    await reopened.unlock('master password');
    assert.equal(await reopened.resolveForOperation(FIRST_REFERENCE), 'master-only-password');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('locking during KDF discards and zeroes a late derived key', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-master-vault-kdf-lock-'));
  const path = join(directory, 'credentials.json');
  const safeStorage = new FakeSafeStorage();
  const setupDeriver = new TestKeyDeriver();
  try {
    const first = new SafeStorageSecretVault(path, safeStorage, setupDeriver);
    await first.initialize();
    await first.enableMasterPassword('master password');

    const deriver = new LateKeyDeriver();
    const reopened = new SafeStorageSecretVault(path, safeStorage, deriver);
    await reopened.initialize();
    const unlocking = reopened.unlock('master password');
    await deriver.started;
    reopened.lock();
    deriver.resume();
    await assert.rejects(unlocking, error => isVaultError(error, 'locked'));
    assert.equal(deriver.returnedKey?.every(byte => byte === 0), true);
    assert.equal(reopened.state, 'locked');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('unknown master-password profile fails closed before the KDF worker is called', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-master-vault-profile-'));
  const path = join(directory, 'credentials.json');
  const safeStorage = new FakeSafeStorage();
  const deriver = new TestKeyDeriver();
  try {
    const original = new SafeStorageSecretVault(path, safeStorage, deriver);
    await original.initialize();
    await original.enableMasterPassword('master password');
    const document = JSON.parse(await readFile(path, 'utf8')) as { profile: Record<string, unknown> };
    document.profile.memLimit = 1;
    await writeFile(path, JSON.stringify(document), 'utf8');
    const callsBeforeRead = deriver.calls;
    const corrupt = new SafeStorageSecretVault(path, safeStorage, deriver);
    await assert.rejects(corrupt.initialize(), error => isVaultError(error, 'corrupt'));
    assert.equal(deriver.calls, callsBeforeRead);
    assert.equal(corrupt.state, 'unavailable');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('master-password unlock delays increase, survive restart, cap at fifteen minutes, and clear after success', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-master-vault-cooldown-'));
  const path = join(directory, 'credentials.json');
  const safeStorage = new FakeSafeStorage();
  const deriver = new TestKeyDeriver();
  let now = 1_800_000_000_000;
  try {
    const first = new SafeStorageSecretVault(path, safeStorage, deriver, () => now);
    await first.initialize();
    await first.enableMasterPassword('correct password');
    first.lock();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await assert.rejects(first.unlock('wrong password'), error => isVaultError(error, 'password-rejected'));
    }
    let document = JSON.parse(await readFile(path, 'utf8')) as { failedUnlocks: number; blockedUntil: number };
    assert.equal(document.failedUnlocks, 5);
    assert.equal(document.blockedUntil, now + 30_000);

    const reopened = new SafeStorageSecretVault(path, safeStorage, deriver, () => now);
    await reopened.initialize();
    await assert.rejects(reopened.unlock('correct password'), error => isVaultError(error, 'locked'));
    now += 30_000;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await assert.rejects(reopened.unlock('wrong password'), error => isVaultError(error, 'password-rejected'));
    }
    document = JSON.parse(await readFile(path, 'utf8')) as typeof document;
    assert.equal(document.failedUnlocks, 10);
    assert.equal(document.blockedUntil, now + 60_000);

    now += 60_000;
    await reopened.unlock('correct password');
    document = JSON.parse(await readFile(path, 'utf8')) as typeof document;
    assert.equal(document.failedUnlocks, 0);
    assert.equal(document.blockedUntil, 0);

    document.failedUnlocks = 149;
    document.blockedUntil = 0;
    await writeFile(path, JSON.stringify({ ...JSON.parse(await readFile(path, 'utf8')), ...document }), 'utf8');
    const capped = new SafeStorageSecretVault(path, safeStorage, deriver, () => now);
    await capped.initialize();
    await assert.rejects(capped.unlock('wrong password'), error => isVaultError(error, 'password-rejected'));
    document = JSON.parse(await readFile(path, 'utf8')) as typeof document;
    assert.equal(document.failedUnlocks, 150);
    assert.equal(document.blockedUntil, now + 15 * 60_000);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('vault conversion excludes queued writes and preserves the prior document when source decryption fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-master-vault-conversion-'));
  const path = join(directory, 'credentials.json');
  const safeStorage = new ConversionGateSafeStorage();
  const vault = new SafeStorageSecretVault(path, safeStorage, new TestKeyDeriver());
  try {
    await vault.initialize();
    await vault.store(FIRST_REFERENCE, 'before-conversion');
    const pause = safeStorage.pauseNextDecrypt();
    const converting = vault.enableMasterPassword('master password');
    await pause.started;
    const queuedStore = vault.store(SECOND_REFERENCE, 'queued-during-conversion');
    pause.resume();
    await converting;
    await queuedStore;
    assert.equal(await vault.resolveForOperation(FIRST_REFERENCE), 'before-conversion');
    assert.equal(await vault.resolveForOperation(SECOND_REFERENCE), 'queued-during-conversion');

    await vault.disableMasterPassword('master password');
    const beforeFailure = await readFile(path, 'utf8');
    safeStorage.failDecryption = true;
    await assert.rejects(vault.enableMasterPassword('another master password'), error => isVaultError(error, 'unavailable'));
    assert.equal(await readFile(path, 'utf8'), beforeFailure);
    assert.equal(vault.mode, 'windows-account');
    safeStorage.failDecryption = false;
    assert.equal(await vault.resolveForOperation(FIRST_REFERENCE), 'before-conversion');
    assert.equal((await readdir(directory)).some(name => name.endsWith('.credential-vault.tmp')), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

class TestKeyDeriver implements MasterPasswordKeyDeriver {
  calls = 0;
  async derive(password: Uint8Array, salt: Uint8Array, signal: AbortSignal): Promise<Buffer> {
    if (signal.aborted) throw new Error('cancelled');
    this.calls += 1;
    return createHash('sha256').update(password).update(salt).digest();
  }
}

class LateKeyDeriver implements MasterPasswordKeyDeriver {
  private announce!: () => void;
  private resumeGate!: () => void;
  readonly started = new Promise<void>(resolve => { this.announce = resolve; });
  private readonly gate = new Promise<void>(resolve => { this.resumeGate = resolve; });
  returnedKey: Buffer | undefined;
  async derive(): Promise<Buffer> {
    this.announce();
    await this.gate;
    this.returnedKey = Buffer.alloc(32, 0xa5);
    return this.returnedKey;
  }
  resume(): void { this.resumeGate(); }
}

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

class ConversionGateSafeStorage extends FakeSafeStorage {
  failDecryption = false;
  private pendingPause: { announce: () => void; gate: Promise<void>; resume: () => void } | undefined;

  pauseNextDecrypt(): { readonly started: Promise<void>; readonly resume: () => void } {
    let announce!: () => void;
    let resume!: () => void;
    const started = new Promise<void>(resolve => { announce = resolve; });
    const gate = new Promise<void>(resolve => { resume = resolve; });
    this.pendingPause = { announce, gate, resume };
    return { started, resume };
  }

  override async decryptStringAsync(encrypted: Buffer): Promise<{ readonly result: string; readonly shouldReEncrypt: boolean }> {
    if (this.failDecryption) throw new Error('injected source decryption failure');
    const pause = this.pendingPause;
    this.pendingPause = undefined;
    if (pause) { pause.announce(); await pause.gate; }
    return super.decryptStringAsync(encrypted);
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
