import test from 'node:test';
import assert from 'node:assert/strict';
import { VaultIdleLock, VAULT_IDLE_LOCK_DELAY_MS } from '../../packages/application/src/vault-idle-lock.ts';

test('idle timer resets on activity, ignores stale callbacks and cancels on shutdown', () => {
  const scheduled: { readonly callback: () => void; readonly delay: number; cancelled: boolean }[] = [];
  let lockCount = 0;
  const idleLock = new VaultIdleLock(() => { lockCount += 1; }, (callback, delay) => {
    const task = { callback, delay, cancelled: false };
    scheduled.push(task);
    return () => { task.cancelled = true; };
  });

  idleLock.noteUserActivity();
  assert.equal(scheduled.length, 0);
  idleLock.start();
  assert.equal(scheduled[0]?.delay, VAULT_IDLE_LOCK_DELAY_MS);
  idleLock.noteUserActivity();
  assert.equal(scheduled[0]?.cancelled, true);
  scheduled[0]?.callback();
  assert.equal(lockCount, 0);

  scheduled[1]?.callback();
  assert.equal(lockCount, 1);
  idleLock.noteUserActivity();
  idleLock.stop();
  assert.equal(scheduled[2]?.cancelled, true);
  scheduled[2]?.callback();
  assert.equal(lockCount, 1);
});
