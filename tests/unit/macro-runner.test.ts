import assert from 'node:assert/strict';
import test from 'node:test';
import { createMacroRunner } from '../../packages/application/src/macro-runner.ts';
import type { MacroRunProgress, MacroRunnerCallbacks, MacroRunnerRuntime } from '../../packages/application/src/macro-runner.ts';
import { normalizeMacroDraft } from '../../packages/domain/src/macro.ts';
import type { MacroDefinition, MacroStep } from '../../packages/domain/src/macro.ts';

const sessionId = 'terminal-1';

function definition(steps: readonly MacroStep[]): MacroDefinition {
  const draft = normalizeMacroDraft({ name: 'Playback test', steps });
  if (!draft) throw new Error('Test macro was not valid.');
  return {
    ...draft,
    id: '5dc30a2d-8281-4ac3-bca6-a4ecab0f78d7',
    schemaVersion: 1,
    createdAt: '2026-10-25T00:00:00.000Z',
    updatedAt: '2026-10-25T00:00:00.000Z'
  };
}

function callbacks(overrides: Partial<MacroRunnerCallbacks> = {}): MacroRunnerCallbacks {
  return {
    confirm: async () => true,
    ...overrides
  };
}

function runtime(overrides: Partial<MacroRunnerRuntime> = {}): MacroRunnerRuntime {
  return {
    isTargetReady: () => true,
    sendLine: async () => ({ ok: true, result: undefined }),
    scheduleTimeout: (callback, delayMs) => {
      const timer = setTimeout(callback, delayMs);
      return () => clearTimeout(timer);
    },
    ...overrides
  };
}

function waitForProgress(progress: MacroRunProgress[], phase: MacroRunProgress['phase']): Promise<MacroRunProgress> {
  const existing = progress.find(item => item.phase === phase);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Playback did not reach ${phase}.`)), 3_000);
    const check = () => {
      const match = progress.find(item => item.phase === phase);
      if (!match) { setImmediate(check); return; }
      clearTimeout(timeout);
      resolve(match);
    };
    setImmediate(check);
  });
}

test('macro playback sends ordered lines and waits for literal terminal text before confirming', async () => {
  const sent: string[] = [];
  const confirmationMessages: string[] = [];
  const progress: MacroRunProgress[] = [];
  const runner = createMacroRunner(runtime({
    sendLine: async (_target, line) => {
      sent.push(line);
      if (line === "Write-Output 'MRT-RUN-READY'\r") {
        runner.observeOutput(sessionId, '\u001b[32mMRT-RUN-');
        runner.observeOutput(sessionId, 'READY\u001b[0m');
      }
      return { ok: true, result: undefined };
    }
  }));

  const result = await runner.run(definition([
    { kind: 'send', text: "Write-Output 'MRT-RUN-READY'" },
    { kind: 'waitForText', text: 'MRT-RUN-READY', timeoutMs: 1_000 },
    { kind: 'delay', durationMs: 0 },
    { kind: 'confirm', message: 'Continue with the next step?' },
    { kind: 'send', text: "Write-Output 'MRT-RUN-DONE'" }
  ]), sessionId, callbacks({
    onProgress: item => progress.push(item),
    confirm: async message => { confirmationMessages.push(message); return true; }
  }));

  assert.deepEqual(result, { status: 'completed' });
  assert.deepEqual(sent, ["Write-Output 'MRT-RUN-READY'\r", "Write-Output 'MRT-RUN-DONE'\r"]);
  assert.deepEqual(confirmationMessages, ['Continue with the next step?']);
  assert.ok(progress.some(item => item.phase === 'waiting' && item.stepNumber === 2));
  assert.ok(progress.some(item => item.phase === 'confirming' && item.stepNumber === 4));
});

test('macro playback cancellation during a literal wait prevents later commands', async () => {
  const runner = createMacroRunner(runtime());
  const progress: MacroRunProgress[] = [];
  const waiting = waitForProgress(progress, 'waiting');
  const run = runner.run(definition([
    { kind: 'waitForText', text: 'MRT-NEVER-ARRIVES', timeoutMs: 120_000 },
    { kind: 'send', text: 'Write-Output should-not-run' }
  ]), sessionId, callbacks({ onProgress: item => progress.push(item) }));

  await waiting;
  runner.cancel();
  assert.deepEqual(await run, { status: 'cancelled' });
});

test('macro playback stops with a terminal error when its target disconnects during a wait', async () => {
  const runner = createMacroRunner(runtime());
  const progress: MacroRunProgress[] = [];
  const waiting = waitForProgress(progress, 'waiting');
  const run = runner.run(definition([{ kind: 'waitForText', text: 'MRT-NEVER-ARRIVES', timeoutMs: 120_000 }]), sessionId,
    callbacks({ onProgress: item => progress.push(item) }));

  await waiting;
  runner.disconnect(sessionId);
  const result = await run;
  assert.equal(result.status, 'failed');
  if (result.status !== 'failed') return;
  assert.deepEqual(result.error, { code: 'UNAVAILABLE', target: 'terminal', retryable: true });
});

test('macro playback times out a literal wait and does not treat casing as equivalent', async () => {
  const runner = createMacroRunner(runtime());
  const progress: MacroRunProgress[] = [];
  const waiting = waitForProgress(progress, 'waiting');
  const run = runner.run(definition([{ kind: 'waitForText', text: 'READY', timeoutMs: 1_000 }]), sessionId,
    callbacks({ onProgress: item => progress.push(item) }));

  await waiting;
  runner.observeOutput(sessionId, 'ready');
  const result = await run;
  assert.equal(result.status, 'failed');
  if (result.status !== 'failed') return;
  assert.deepEqual(result.error, { code: 'TIMEOUT', target: 'terminal', retryable: true });
});

test('macro playback refuses invalid or unavailable targets and concurrent runs', async () => {
  const runner = createMacroRunner(runtime({ isTargetReady: target => target === sessionId }));
  const valid = definition([{ kind: 'waitForText', text: 'MRT-NEVER-ARRIVES', timeoutMs: 120_000 }]);

  const invalid = await runner.run({ name: 'untyped' }, sessionId, callbacks());
  assert.equal(invalid.status, 'failed');
  if (invalid.status === 'failed') assert.equal(invalid.error.code, 'INVALID_REQUEST');

  const unavailable = await runner.run(valid, 'other-terminal', callbacks());
  assert.equal(unavailable.status, 'failed');
  if (unavailable.status === 'failed') assert.equal(unavailable.error.code, 'UNAVAILABLE');

  const progress: MacroRunProgress[] = [];
  const waiting = waitForProgress(progress, 'waiting');
  const active = runner.run(valid, sessionId, callbacks({ onProgress: item => progress.push(item) }));
  await waiting;
  const concurrent = await runner.run(valid, sessionId, callbacks());
  assert.equal(concurrent.status, 'failed');
  if (concurrent.status === 'failed') assert.equal(concurrent.error.code, 'BUSY');
  runner.cancel();
  assert.deepEqual(await active, { status: 'cancelled' });
});

test('a declined macro confirmation stops playback before later commands', async () => {
  const sent: string[] = [];
  const runner = createMacroRunner(runtime({ sendLine: async (_target, line) => { sent.push(line); return { ok: true, result: undefined }; } }));
  const result = await runner.run(definition([
    { kind: 'confirm', message: 'Continue?' },
    { kind: 'send', text: 'Write-Output should-not-run' }
  ]), sessionId, callbacks({ confirm: async () => false }));

  assert.deepEqual(result, { status: 'cancelled' });
  assert.deepEqual(sent, []);
});

test('cancellation while a confirmation is pending stops before the next command', async () => {
  const sent: string[] = [];
  const runner = createMacroRunner(runtime({ sendLine: async (_target, line) => { sent.push(line); return { ok: true, result: undefined }; } }));
  const progress: MacroRunProgress[] = [];
  const confirming = waitForProgress(progress, 'confirming');
  const run = runner.run(definition([
    { kind: 'confirm', message: 'Continue after reviewing the target?' },
    { kind: 'send', text: 'Write-Output should-not-run' }
  ]), sessionId, callbacks({ onProgress: item => progress.push(item), confirm: async () => new Promise<boolean>(() => {}) }));

  await confirming;
  runner.cancel();
  assert.deepEqual(await run, { status: 'cancelled' });
  assert.deepEqual(sent, []);
});
