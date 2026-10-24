import test from 'node:test';
import assert from 'node:assert/strict';
import { isSshGatewayProfileIds, normalizeSshGatewayRoute } from '../../packages/domain/src/ssh-route.ts';

test('SSH gateway profile routes accept up to two distinct profile IDs', () => {
  const first = '11111111-1111-4111-8111-111111111111';
  const second = '22222222-2222-4222-8222-222222222222';
  assert.equal(isSshGatewayProfileIds([]), true);
  assert.equal(isSshGatewayProfileIds([first]), true);
  assert.equal(isSshGatewayProfileIds([first, second]), true);
  assert.equal(isSshGatewayProfileIds([first, first]), false);
  assert.equal(isSshGatewayProfileIds([first, second, '33333333-3333-4333-8333-333333333333']), false);
  assert.equal(isSshGatewayProfileIds(['not-a-profile-id']), false);
});

test('SSH gateway endpoints are canonical, ordered, distinct, and cannot repeat the destination', () => {
  const target = { host: 'target.example.net', port: 22 };
  const route = normalizeSshGatewayRoute([
    { host: 'FIRST.example.net', port: 2201 },
    { host: 'second.example.net', port: 2202 }
  ], target);
  assert.deepEqual(route, [
    { host: 'first.example.net', port: 2201 },
    { host: 'second.example.net', port: 2202 }
  ]);
  assert.equal(normalizeSshGatewayRoute([{ host: 'target.example.net', port: 22 }], target), undefined);
  assert.equal(normalizeSshGatewayRoute([
    { host: 'gateway.example.net', port: 2201 }, { host: 'GATEWAY.example.net', port: 2201 }
  ], target), undefined);
  assert.equal(normalizeSshGatewayRoute([{ host: 'gateway.example.net', port: 0 }], target), undefined);
  assert.equal(normalizeSshGatewayRoute([
    { host: 'one.example.net', port: 2201 }, { host: 'two.example.net', port: 2202 }, { host: 'three.example.net', port: 2203 }
  ], target), undefined);
});
