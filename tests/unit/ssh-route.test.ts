import test from 'node:test';
import assert from 'node:assert/strict';
import { isSshGatewayProfileIds, MAX_SSH_GATEWAY_HOPS, normalizeSshGatewayRoute } from '../../packages/domain/src/ssh-route.ts';

const profileIds = Array.from({ length: 9 }, (_, index) => `${String(index + 1).padStart(8, '0')}-1111-4111-8111-111111111111`);
const gateways = Array.from({ length: 9 }, (_, index) => ({ host: `gateway-${index + 1}.example.net`, port: 2201 + index }));

test('SSH gateway routes accept up to eight distinct profile IDs', () => {
  assert.equal(MAX_SSH_GATEWAY_HOPS, 8);
  assert.equal(isSshGatewayProfileIds([]), true);
  assert.equal(isSshGatewayProfileIds(profileIds.slice(0, 1)), true);
  assert.equal(isSshGatewayProfileIds(profileIds.slice(0, 2)), true);
  assert.equal(isSshGatewayProfileIds(profileIds.slice(0, 8)), true);
  assert.equal(isSshGatewayProfileIds(profileIds), false);
  assert.equal(isSshGatewayProfileIds([profileIds[0], profileIds[0]]), false);
  assert.equal(isSshGatewayProfileIds(['not-a-profile-id']), false);
});

test('SSH gateway endpoints are canonical, ordered, distinct, and cannot repeat the destination', () => {
  const target = { host: 'target.example.net', port: 22 };
  const route = normalizeSshGatewayRoute([
    { host: 'FIRST.example.net', port: 2201 },
    { host: 'second.example.net', port: 2202 },
    { host: 'third.example.net', port: 2203 }
  ], target);
  assert.deepEqual(route, [
    { host: 'first.example.net', port: 2201 },
    { host: 'second.example.net', port: 2202 },
    { host: 'third.example.net', port: 2203 }
  ]);
  assert.equal(normalizeSshGatewayRoute([target], target), undefined);
  assert.equal(normalizeSshGatewayRoute([
    { host: 'gateway.example.net', port: 2201 }, { host: 'GATEWAY.example.net', port: 2201 }
  ], target), undefined);
  assert.equal(normalizeSshGatewayRoute([{ host: 'gateway.example.net', port: 0 }], target), undefined);
  assert.equal(normalizeSshGatewayRoute(gateways.slice(0, 8), target)?.length, 8);
  assert.equal(normalizeSshGatewayRoute(gateways, target), undefined);
});
