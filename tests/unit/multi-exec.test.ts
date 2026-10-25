import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMultiExecRunner } from '../../packages/application/src/multi-exec.ts';
import { failure } from '../../packages/domain/src/errors.ts';
import { MAX_MULTI_EXEC_LINE_CHARS, normalizeMultiExecRequest } from '../../packages/domain/src/multi-exec.ts';

const targets = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555',
  '66666666-6666-4666-8666-666666666666'
] as const;

test('MultiExec accepts an exact one-line request and rejects unsafe or ambiguous targets', () => {
  const line = "Get-Service -Name 'Spooler'";
  assert.deepEqual(normalizeMultiExecRequest({ line, targetSessionIds: targets.slice(0, 3) }), {
    line, targetSessionIds: targets.slice(0, 3)
  });
  assert.equal(normalizeMultiExecRequest({ line: '  ', targetSessionIds: targets.slice(0, 2) }), undefined);
  assert.equal(normalizeMultiExecRequest({ line: 'first\nsecond', targetSessionIds: targets.slice(0, 2) }), undefined);
  assert.equal(normalizeMultiExecRequest({ line: 'first\u2028second', targetSessionIds: targets.slice(0, 2) }), undefined);
  assert.equal(normalizeMultiExecRequest({ line: 'echo safe\u202e', targetSessionIds: targets.slice(0, 2) }), undefined);
  assert.equal(normalizeMultiExecRequest({ line: 'one', targetSessionIds: [targets[0], targets[0]] }), undefined);
  assert.equal(normalizeMultiExecRequest({ line: 'one', targetSessionIds: [targets[0]] }), undefined);
  assert.equal(normalizeMultiExecRequest({ line: 'x'.repeat(MAX_MULTI_EXEC_LINE_CHARS + 1), targetSessionIds: targets.slice(0, 2) }), undefined);
  assert.equal(normalizeMultiExecRequest({ line, targetSessionIds: targets.slice(0, 2), command: 'unexpected' }), undefined);
});

test('MultiExec waits for exact preview approval before sending to selected targets', async () => {
  const writes: string[] = [];
  const runner = createMultiExecRunner({
    isTargetReady: () => true,
    async sendLine(sessionId, line) { writes.push(`${sessionId}:${line}`); return { ok: true, result: undefined }; }
  });
  const result = await runner.run({ line: 'hostname', targetSessionIds: targets.slice(0, 2) }, {
    async confirm(review) {
      assert.equal(review.line, 'hostname');
      assert.deepEqual(review.targetSessionIds, targets.slice(0, 2));
      return false;
    }
  });

  assert.equal(result.status, 'cancelled');
  assert.equal(writes.length, 0);
  if (result.status === 'cancelled') assert.ok(result.targets.every(target => target.status === 'not-sent'));
});

test('MultiExec sends once per target and isolates a failed write from other targets', async () => {
  const calls = new Map<string, number>();
  const runner = createMultiExecRunner({
    isTargetReady: () => true,
    async sendLine(sessionId, line) {
      calls.set(sessionId, (calls.get(sessionId) ?? 0) + 1);
      assert.equal(line, "Get-Service -Name 'Spooler'\r");
      return sessionId === targets[1]
        ? failure('BUSY', 'terminal')
        : { ok: true, result: undefined };
    }
  });
  const progress: string[][] = [];
  const result = await runner.run({ line: "Get-Service -Name 'Spooler'", targetSessionIds: targets.slice(0, 3) }, {
    async confirm() { return true; },
    onTargetsChanged(current) { progress.push(current.map(target => target.status)); }
  });

  assert.equal(result.status, 'completed');
  assert.deepEqual([...calls.values()], [1, 1, 1]);
  if (result.status === 'completed') {
    assert.deepEqual(result.targets.map(target => target.status), ['sent', 'failed', 'sent']);
    assert.equal(result.targets[1]?.error?.code, 'BUSY');
  }
  assert.ok(progress.some(statuses => statuses.includes('sending')));
});

test('MultiExec marks timeout delivery uncertain and cancellation leaves queued targets unsent', async () => {
  const uncertainRunner = createMultiExecRunner({
    isTargetReady: () => true,
    async sendLine() { return failure('TIMEOUT', 'terminal'); }
  });
  const uncertain = await uncertainRunner.run({ line: 'hostname', targetSessionIds: targets.slice(0, 2) }, {
    async confirm() { return true; }
  });
  assert.equal(uncertain.status, 'completed');
  if (uncertain.status === 'completed') assert.ok(uncertain.targets.every(target => target.status === 'uncertain'));

  const releaseWrites: (() => void)[] = [];
  let notifyFourStarted: (() => void) | undefined;
  const fourStarted = new Promise<void>(resolve => { notifyFourStarted = resolve; });
  let started = 0;
  const runner = createMultiExecRunner({
    isTargetReady: () => true,
    sendLine() {
      started++;
      if (started === 4) notifyFourStarted?.();
      return new Promise(resolve => releaseWrites.push(() => resolve({ ok: true, result: undefined })));
    }
  });
  const running = runner.run({ line: 'hostname', targetSessionIds: targets }, { async confirm() { return true; } });
  await fourStarted;
  runner.cancel();
  for (const release of releaseWrites) release();
  const cancelled = await running;
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(started, 4);
  if (cancelled.status === 'cancelled') {
    assert.deepEqual(cancelled.targets.slice(4).map(target => target.status), ['not-sent', 'not-sent']);
  }
});
