import test from 'node:test';
import assert from 'node:assert/strict';
import { finishSshSessionLogsOwnedBy, observeSshSessionLogActivity } from '../../apps/desktop/src/main/ssh-session-log-owner.ts';

test('renderer teardown finalizes its pending and active SSH logs only', () => {
  const ownedPending = '11111111-1111-4111-8111-111111111111';
  const ownedActive = '22222222-2222-4222-8222-222222222222';
  const ownedPicker = '33333333-3333-4333-8333-333333333333';
  const ownedConnecting = '44444444-4444-4444-8444-444444444444';
  const otherPending = '55555555-5555-4555-8555-555555555555';
  const pendingTimer = setTimeout(() => {}, 60_000);
  const otherTimer = setTimeout(() => {}, 60_000);
  pendingTimer.unref?.();
  otherTimer.unref?.();
  const pending = new Map([
    [ownedPending, { senderId: 10, timer: pendingTimer }],
    [otherPending, { senderId: 20, timer: otherTimer }]
  ]);
  const owners = new Map([
    [ownedPending, { senderId: 10, phase: 'preflight' as const, opened: false }],
    [ownedActive, { senderId: 10, phase: 'preflight' as const, opened: false }],
    [ownedPicker, { senderId: 10, phase: 'preflight' as const, opened: false }],
    [ownedConnecting, { senderId: 10, phase: 'preflight' as const, opened: false }],
    [otherPending, { senderId: 20, phase: 'preflight' as const, opened: false }]
  ]);
  const activities: unknown[] = [];
  const finishes: Array<{ sessionId: string; reason: string }> = [];

  try {
    observeSshSessionLogActivity({ type: 'transport', sessionId: ownedActive, outcome: 'ready' }, owners);
    observeSshSessionLogActivity({ type: 'transport', sessionId: ownedConnecting, outcome: 'started' }, owners);
    finishSshSessionLogsOwnedBy(10, pending, owners, {
      append(activity) { activities.push(activity); },
      async finish(sessionId, reason) { finishes.push({ sessionId, reason }); }
    });

    assert.deepEqual(activities, [
      { type: 'connection-failed', sessionId: ownedPending, phase: 'preflight', code: 'CANCELLED' },
      { type: 'connection-failed', sessionId: ownedPicker, phase: 'preflight', code: 'CANCELLED' },
      { type: 'connection-failed', sessionId: ownedConnecting, phase: 'transport', code: 'CANCELLED' }
    ]);
    assert.deepEqual(finishes, [
      { sessionId: ownedPending, reason: 'connection-failed' },
      { sessionId: ownedActive, reason: 'session-closed' },
      { sessionId: ownedPicker, reason: 'connection-failed' },
      { sessionId: ownedConnecting, reason: 'connection-failed' }
    ]);
    assert.equal(owners.get(ownedActive)?.opened, true);
    assert.equal(pending.has(ownedPending), false);
    assert.equal(pending.has(otherPending), true);
  } finally {
    clearTimeout(pendingTimer);
    clearTimeout(otherTimer);
  }
});
