import test from 'node:test';
import assert from 'node:assert/strict';
import { awaitWithCancellation, createCancellationSource } from '../../packages/application/src/cancellation.ts';

test('cancelling a barrier wait returns promptly without cancelling the underlying work', async () => {
  let releaseBarrier: (() => void) | undefined;
  const barrier = new Promise<void>(resolve => { releaseBarrier = resolve; });
  let barrierSettled = false;
  void barrier.then(() => { barrierSettled = true; });
  const cancellation = createCancellationSource();
  const waiting = awaitWithCancellation(barrier, cancellation, () => Object.assign(new Error('Cancelled'), { code: 'CANCELLED' }));
  cancellation.abort();

  await assert.rejects(waiting, error => (error as { code?: string }).code === 'CANCELLED');
  assert.equal(barrierSettled, false, 'cancelling the waiter must preserve the older upload barrier');
  releaseBarrier?.();
  await barrier;
  assert.equal(barrierSettled, true);
});
