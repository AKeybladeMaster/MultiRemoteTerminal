import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { MasterPasswordKdfError, MasterPasswordKeyDeriverAdapter } from '../../apps/desktop/src/adapters/master-password-key-deriver.ts';
import type { KdfUtilityProcess } from '../../apps/desktop/src/adapters/master-password-key-deriver.ts';

test('one-shot KDF process receives only password and salt and returns a bounded derived key', async () => {
  const worker = new FakeKdfProcess(true);
  const deriver = new MasterPasswordKeyDeriverAdapter('worker.js', 'app-root', () => worker, 100);
  const password = Buffer.from('one-shot-password');
  const salt = Buffer.alloc(16, 4);
  const key = await deriver.derive(password, salt, new AbortController().signal);
  assert.deepEqual(worker.received, { version: 1, type: 'derive', requestId: worker.received?.requestId,
    password: new Uint8Array(Buffer.from('one-shot-password')), salt: new Uint8Array(Buffer.alloc(16, 4)) });
  assert.equal(key.length, 32);
  assert.equal(worker.killed, 1);
  assert.equal(worker.postedPassword?.every(byte => byte === 0), true);
  key.fill(0);
  salt.fill(0);
});

test('KDF timeout kills its utility process and returns a timeout category', async () => {
  const worker = new FakeKdfProcess(false);
  const deriver = new MasterPasswordKeyDeriverAdapter('worker.js', 'app-root', () => worker, 10);
  await assert.rejects(deriver.derive(Buffer.from('password'), Buffer.alloc(16), new AbortController().signal), error =>
    error instanceof MasterPasswordKdfError && error.kind === 'timeout');
  assert.equal(worker.killed, 1);
});

test('locking aborts KDF and terminates its utility process', async () => {
  const worker = new FakeKdfProcess(false);
  const deriver = new MasterPasswordKeyDeriverAdapter('worker.js', 'app-root', () => worker, 100);
  const controller = new AbortController();
  const result = deriver.derive(Buffer.from('password'), Buffer.alloc(16), controller.signal);
  controller.abort();
  await assert.rejects(result, error => error instanceof MasterPasswordKdfError && error.kind === 'cancelled');
  assert.equal(worker.killed, 1);
});

class FakeKdfProcess extends EventEmitter implements KdfUtilityProcess {
  readonly respond: boolean;
  received: Record<string, unknown> | undefined;
  postedPassword: Uint8Array | undefined;
  killed = 0;
  constructor(respond: boolean) { super(); this.respond = respond; }
  postMessage(message: unknown): void {
    if (!isRecord(message)) return;
    this.postedPassword = message.password as Uint8Array;
    this.received = { ...message, password: new Uint8Array(message.password as Uint8Array), salt: new Uint8Array(message.salt as Uint8Array) };
    if (!this.respond) return;
    setImmediate(() => this.emit('message', { version: 1, type: 'result', requestId: this.received?.requestId, key: new Uint8Array(32).fill(9) }));
  }
  kill(): void { this.killed += 1; setImmediate(() => this.emit('exit', 0)); }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
