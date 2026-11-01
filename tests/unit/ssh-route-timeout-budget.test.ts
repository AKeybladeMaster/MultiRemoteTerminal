import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sshRoutedOpenPreloadTimeoutMs,
  sshRoutedOpenProviderTimeoutMs,
  sshRoutedOpenWorkerTimeoutMs
} from '../../packages/application/src/ssh-route-timeout-budget.ts';

test('eight-hop SSH route deadlines include every bounded handshake, channel, prompt, and reply margin', () => {
  assert.equal(sshRoutedOpenProviderTimeoutMs(8), 1_310_000);
  assert.equal(sshRoutedOpenWorkerTimeoutMs(8), 1_320_000);
  assert.equal(sshRoutedOpenPreloadTimeoutMs(8, 120_000, 40_000), 2_440_000);
});

test('SSH route timeout budgets scale with the selected hop count and cap at the supported depth', () => {
  assert.equal(sshRoutedOpenProviderTimeoutMs(1), 295_000);
  assert.equal(sshRoutedOpenWorkerTimeoutMs(1), 305_000);
  assert.equal(sshRoutedOpenPreloadTimeoutMs(1, 120_000, 40_000), 585_000);
  assert.equal(sshRoutedOpenPreloadTimeoutMs(99, 120_000, 40_000), 2_440_000);
});
