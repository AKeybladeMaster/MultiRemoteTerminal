import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Outcome } from '../../packages/domain/src/errors.ts';
import type { HostKeyEvidence, TrustedHostKey } from '../../packages/domain/src/host-trust.ts';
import { canonicalizeSshHostEndpoint, sameHostKey } from '../../packages/domain/src/host-trust.ts';
import { HostTrustStoreError, createHostTrustManager } from '../../packages/application/src/host-trust.ts';
import type { HostTrustInsertResult, HostTrustRuntime, HostTrustStore, HostTrustDecision } from '../../packages/application/src/host-trust.ts';
import { HostTrustJsonStore } from '../../apps/desktop/src/adapters/host-trust-json-store.ts';

class FakeRuntime implements HostTrustRuntime {
  private sequence = 0;
  private nextTimer = 0;
  private monotonicTime = 10;
  private readonly timers = new Map<number, { readonly at: number; readonly callback: () => void }>();

  createToken(): string { this.sequence += 1; return `host-approval-token-${this.sequence.toString().padStart(4, '0')}`; }
  monotonicNow(): number { return this.monotonicTime; }
  wallNow(): number { return 1_800_000_000_000 + this.monotonicTime; }
  get timerCount(): number { return this.timers.size; }
  schedule(callback: () => void, delayMs: number): () => void {
    this.nextTimer += 1;
    const id = this.nextTimer;
    this.timers.set(id, { at: this.monotonicTime + delayMs, callback });
    return () => { this.timers.delete(id); };
  }
  advance(milliseconds: number): void {
    this.monotonicTime += milliseconds;
    for (const [id, timer] of [...this.timers]) {
      if (timer.at <= this.monotonicTime) {
        this.timers.delete(id);
        timer.callback();
      }
    }
  }
}

test('unknown host approval is bounded, expires, and never exposes the key blob', async () => {
  assert.equal(canonicalizeSshHostEndpoint({ host: '[2001:DB8::1]', port: 22 })?.host, '2001:db8::1');
  assert.equal(canonicalizeSshHostEndpoint({ host: '2001:::1', port: 22 }), undefined);
  const directory = await mkdtemp(join(tmpdir(), 'mrt-host-trust-'));
  const endpoint = { host: 'EXAMPLE.com.', port: 22 };
  const key = hostKey(1);
  const runtime = new FakeRuntime();
  const manager = createHostTrustManager(new HostTrustJsonStore(join(directory, 'host-trust.json')), runtime);
  try {
    const initial = success(await manager.inspect(endpoint, key));
    assert.equal(initial.kind, 'approval-required');
    if (initial.kind !== 'approval-required') return;
    assert.equal(initial.challenge.host, 'example.com');
    assert.equal('publicKey' in initial.challenge, false);
    const repeated = success(await manager.inspect({ host: 'example.com', port: 22 }, key));
    assert.equal(repeated.kind, 'approval-required');
    if (repeated.kind !== 'approval-required') return;
    assert.equal(repeated.challenge.token, initial.challenge.token);

    assert.equal(success(manager.reject(initial.challenge.token)).kind, 'rejected');
    const expired = success(await manager.inspect(endpoint, key));
    assert.equal(expired.kind, 'approval-required');
    if (expired.kind !== 'approval-required') return;
    runtime.advance(120_000);
    const stale = await manager.approve(expired.challenge.token);
    assert.equal(stale.ok, false);
    if (!stale.ok) assert.equal(stale.error.code, 'NOT_FOUND');

    const renewed = success(await manager.inspect(endpoint, key));
    assert.equal(renewed.kind, 'approval-required');
    if (renewed.kind !== 'approval-required') return;
    assert.notEqual(renewed.challenge.token, expired.challenge.token);
    assert.equal(success(await manager.approve(renewed.challenge.token)).kind, 'approved');
    assert.equal(success(await manager.inspect({ host: 'example.com', port: 22 }, key)).kind, 'trusted');
    assert.equal(success(await manager.inspect(endpoint, hostKey(2))).kind, 'changed');

    await manager.revoke(endpoint);
    assert.equal(success(await manager.inspect(endpoint, hostKey(2))).kind, 'approval-required');
  } finally {
    manager.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test('concurrent host approvals preserve distinct endpoints and never replace a conflicting key', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-host-trust-'));
  const path = join(directory, 'host-trust.json');
  const store = new HostTrustJsonStore(path);
  const secondStore = new HostTrustJsonStore(path);
  const manager = createHostTrustManager(store, new FakeRuntime());
  const secondManager = createHostTrustManager(secondStore, new FakeRuntime());
  const endpoint = { host: 'race.example', port: 22 };
  const firstKey = hostKey(3);
  const competingKey = hostKey(4);
  const otherEndpoint = { host: 'other.example', port: 2222 };
  const otherKey = hostKey(5);
  try {
    const first = approvalToken(success(await manager.inspect(endpoint, firstKey)));
    const competing = approvalToken(success(await secondManager.inspect(endpoint, competingKey)));
    const other = approvalToken(success(await secondManager.inspect(otherEndpoint, otherKey)));
    const decisions = await Promise.all([manager.approve(first), secondManager.approve(competing), secondManager.approve(other)]);
    const kinds = decisions.map(result => success(result).kind);
    assert.deepEqual(kinds.sort(), ['approved', 'approved', 'changed']);

    const raceRecord = await store.find(endpoint);
    const otherRecord = await store.find(otherEndpoint);
    assert.ok(raceRecord && (sameHostKey(raceRecord, firstKey) || sameHostKey(raceRecord, competingKey)));
    assert.ok(otherRecord && sameHostKey(otherRecord, otherKey));
    const document = JSON.parse(await readFile(join(directory, 'host-trust.json'), 'utf8')) as { entries: unknown[] };
    assert.equal(document.entries.length, 2);
  } finally {
    manager.dispose();
    secondManager.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test('pending approvals are capped at 64', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-host-trust-'));
  const manager = createHostTrustManager(new HostTrustJsonStore(join(directory, 'host-trust.json')), new FakeRuntime());
  try {
    for (let index = 0; index < 64; index += 1) {
      assert.equal(success(await manager.inspect({ host: `host-${index}.example`, port: 22 }, hostKey(index + 10))).kind, 'approval-required');
    }
    const overflow = await manager.inspect({ host: 'overflow.example', port: 22 }, hostKey(99));
    assert.equal(overflow.ok, false);
    if (!overflow.ok) assert.equal(overflow.error.code, 'BUSY');
  } finally {
    manager.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test('corrupt, unsupported, and oversized store files fail closed without replacement', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-host-trust-'));
  const path = join(directory, 'host-trust.json');
  const store = new HostTrustJsonStore(path);
  try {
    for (const contents of ['{', '{"version":2,"entries":[]}']) {
      await writeFile(path, contents, 'utf8');
      await assert.rejects(store.find({ host: 'example.com', port: 22 }), (error: unknown) => error instanceof HostTrustStoreError && error.kind === 'corrupt');
      assert.equal(await readFile(path, 'utf8'), contents);
    }
    const oversized = Buffer.alloc(16 * 1024 * 1024 + 1, 0x20);
    await writeFile(path, oversized);
    await assert.rejects(store.find({ host: 'example.com', port: 22 }), (error: unknown) => error instanceof HostTrustStoreError && error.kind === 'corrupt');
    assert.equal((await readFile(path)).byteLength, oversized.byteLength);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the JSON adapter rejects operations beyond its bounded queue', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-host-trust-'));
  const store = new HostTrustJsonStore(join(directory, 'host-trust.json'));
  try {
    const results = await Promise.allSettled(Array.from({ length: 129 }, () => store.find({ host: 'example.com', port: 22 })));
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    assert.equal(rejected.length, 1);
    assert.ok(rejected[0]!.reason instanceof HostTrustStoreError);
    assert.equal((rejected[0]!.reason as HostTrustStoreError).kind, 'busy');
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 128);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('an explicit approval claims its token before storage; later cancellation cannot race the write', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-host-trust-'));
  const endpoint = { host: 'approval-race.example', port: 22 };
  const key = hostKey(101);
  const store = new HostTrustJsonStore(join(directory, 'host-trust.json'));
  let releaseWrite!: () => void;
  let signalWriteStarted!: () => void;
  const writeGate = new Promise<void>(resolve => { releaseWrite = resolve; });
  const writeStarted = new Promise<void>(resolve => { signalWriteStarted = resolve; });
  const gatedStore: HostTrustStore = {
    find: value => store.find(value),
    async trustIfAbsent(identity): Promise<HostTrustInsertResult> {
      signalWriteStarted();
      await writeGate;
      return store.trustIfAbsent(identity);
    },
    remove: value => store.remove(value)
  };
  const manager = createHostTrustManager(gatedStore, new FakeRuntime());
  try {
    const token = approvalToken(success(await manager.inspect(endpoint, key)));
    const approval = manager.approve(token);
    await writeStarted;
    const cancellation = manager.reject(token);
    assert.equal(cancellation.ok, false);
    if (!cancellation.ok) assert.equal(cancellation.error.code, 'NOT_FOUND');
    manager.dispose();
    releaseWrite();
    assert.equal(success(await approval).kind, 'approved');
    const persisted = await store.find(endpoint);
    assert.ok(persisted && sameHostKey(persisted, key));
  } finally {
    manager.dispose();
    releaseWrite();
    await rm(directory, { recursive: true, force: true });
  }
});

test('disposal during a slow trust lookup cannot create a pending challenge afterward', async () => {
  let releaseLookup!: () => void;
  let signalLookupStarted!: () => void;
  const lookupGate = new Promise<void>(resolve => { releaseLookup = resolve; });
  const lookupStarted = new Promise<void>(resolve => { signalLookupStarted = resolve; });
  const delayedStore: HostTrustStore = {
    async find(): Promise<TrustedHostKey | undefined> {
      signalLookupStarted();
      await lookupGate;
      return undefined;
    },
    async trustIfAbsent(): Promise<HostTrustInsertResult> { throw new Error('Unexpected write'); },
    async remove(): Promise<boolean> { return false; }
  };
  const runtime = new FakeRuntime();
  const manager = createHostTrustManager(delayedStore, runtime);
  const lookup = manager.inspect({ host: 'teardown.example', port: 22 }, hostKey(111));
  await lookupStarted;
  manager.dispose();
  releaseLookup();
  const result = await lookup;
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'CANCELLED');
  assert.equal(runtime.timerCount, 0);
});

function success<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw new Error(`Expected success, got ${outcome.error.code}`);
  return outcome.result;
}

function approvalToken(decision: HostTrustDecision): string {
  assert.equal(decision.kind, 'approval-required');
  if (decision.kind !== 'approval-required') throw new Error('Expected an approval challenge');
  return decision.challenge.token;
}

function hostKey(seed: number): HostKeyEvidence {
  const algorithm = 'ssh-ed25519';
  const name = Buffer.from(algorithm, 'utf8');
  const publicValue = Buffer.alloc(32, seed);
  const publicKey = Buffer.alloc(4 + name.length + 4 + publicValue.length);
  publicKey.writeUInt32BE(name.length, 0);
  name.copy(publicKey, 4);
  publicKey.writeUInt32BE(publicValue.length, 4 + name.length);
  publicValue.copy(publicKey, 8 + name.length);
  const fingerprint = `SHA256:${createHash('sha256').update(publicKey).digest('base64').replace(/=+$/, '')}`;
  return { algorithm, fingerprint, publicKey: Uint8Array.from(publicKey) };
}
