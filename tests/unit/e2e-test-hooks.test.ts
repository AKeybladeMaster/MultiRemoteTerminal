import test from 'node:test';
import assert from 'node:assert/strict';
import { isE2ETestHookEnabled } from '../../apps/desktop/src/main/e2e-test-hooks.ts';

const delayFlag = '--mrt-e2e-delay-first-terminal-open';
const testArguments = [delayFlag];

test('E2E hooks require an explicit test environment and command-line flag', () => {
  assert.equal(isE2ETestHookEnabled(delayFlag, false, { MRT_E2E: '1' }, testArguments), true);
  assert.equal(isE2ETestHookEnabled(delayFlag, false, {}, testArguments), false);
  assert.equal(isE2ETestHookEnabled(delayFlag, false, { MRT_E2E: '0' }, testArguments), false);
  assert.equal(isE2ETestHookEnabled(delayFlag, false, { MRT_E2E: '1' }, []), false);
});

test('packaged builds never activate E2E hooks, even with explicit flags and environment', () => {
  assert.equal(isE2ETestHookEnabled(delayFlag, true, { MRT_E2E: '1' }, testArguments), false);
});
