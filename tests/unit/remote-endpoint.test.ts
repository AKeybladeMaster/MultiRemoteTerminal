import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeRemoteEndpoint, canonicalizeRemoteHost } from '../../packages/domain/src/remote-endpoint.ts';
import { canonicalizeSshHost, canonicalizeSshHostEndpoint } from '../../packages/domain/src/host-trust.ts';

test('shared remote endpoint validation keeps SSH host rules and supports Telnet session endpoints', () => {
  assert.deepEqual(canonicalizeRemoteEndpoint({ host: 'TELNET.Example.com.', port: 23 }), { host: 'telnet.example.com', port: 23 });
  assert.deepEqual(canonicalizeRemoteEndpoint({ host: '[2001:DB8::1]', port: 2323 }), { host: '2001:db8::1', port: 2323 });
  assert.equal(canonicalizeRemoteEndpoint({ host: 'example.com', port: 0 }), undefined);
  assert.equal(canonicalizeRemoteEndpoint({ host: 'example.com', port: 65_536 }), undefined);
  assert.equal(canonicalizeRemoteEndpoint({ host: 'example.com', port: 23, password: 'secret' }), undefined);
  assert.equal(canonicalizeRemoteHost('not a host'), undefined);

  assert.equal(canonicalizeSshHost('EXAMPLE.com.'), canonicalizeRemoteHost('EXAMPLE.com.'));
  assert.deepEqual(canonicalizeSshHostEndpoint({ host: '[2001:DB8::1]', port: 22 }),
    canonicalizeRemoteEndpoint({ host: '[2001:DB8::1]', port: 22 }));
});
