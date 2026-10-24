import test from 'node:test';
import assert from 'node:assert/strict';
import { isSshTunnelDefinition, isTunnelRunStatus, normalizeSshTunnelDraft } from '../../packages/domain/src/ssh-tunnel.ts';

const sessionId = '00000000-0000-4000-8000-000000000001';
const tunnelId = '00000000-0000-4000-8000-000000000002';

test('local SSH tunnel definitions normalize endpoint data and allow OS-selected ports', () => {
  const draft = normalizeSshTunnelDraft({ sessionId, name: '  Database  ', mode: 'local', bindHost: '127.0.0.1', bindPort: 0,
    targetHost: 'DB.INTERNAL.', targetPort: 5432 });
  assert.deepEqual(draft, { sessionId, name: 'Database', mode: 'local', bindHost: '127.0.0.1', bindPort: 0,
    targetHost: 'db.internal', targetPort: 5432 });
  assert.equal(normalizeSshTunnelDraft({ ...draft, id: tunnelId })?.id, tunnelId);
  assert.equal(normalizeSshTunnelDraft({ ...draft, bindHost: '0.0.0.0' }), undefined);
  assert.equal(normalizeSshTunnelDraft({ ...draft, bindPort: 65_536 }), undefined);
  assert.equal(normalizeSshTunnelDraft({ ...draft, targetHost: 'bad host' }), undefined);
  assert.equal(normalizeSshTunnelDraft({ ...draft, password: 'must not persist' }), undefined);
});

test('remote SSH tunnel definitions allow server-selected ports while keeping the remote bind on loopback', () => {
  const draft = normalizeSshTunnelDraft({ sessionId, name: 'Reverse API', mode: 'remote', bindHost: '127.0.0.1', bindPort: 0,
    targetHost: '127.0.0.1', targetPort: 3000 });
  assert.deepEqual(draft, { sessionId, name: 'Reverse API', mode: 'remote', bindHost: '127.0.0.1', bindPort: 0,
    targetHost: '127.0.0.1', targetPort: 3000 });
  assert.equal(normalizeSshTunnelDraft({ ...draft, bindHost: '0.0.0.0' }), undefined);
  assert.equal(normalizeSshTunnelDraft({ ...draft, mode: 'dynamic' }), undefined);
});

test('local tunnel persisted rows and runtime status accept only exact bounded shapes', () => {
  const definition = { id: tunnelId, sessionId, name: 'Database', mode: 'local', bindHost: '127.0.0.1', bindPort: 0,
    targetHost: 'db.internal', targetPort: 5432, createdAt: '2026-10-24T00:00:00.000Z' } as const;
  assert.equal(isSshTunnelDefinition(definition), true);
  assert.equal(isSshTunnelDefinition({ ...definition, extra: true }), false);
  assert.equal(isTunnelRunStatus({ tunnelId, state: 'active', bindHost: '127.0.0.1', bindPort: 50124 }), true);
  assert.equal(isTunnelRunStatus({ tunnelId, state: 'active', bindHost: '0.0.0.0', bindPort: 50124 }), false);
  assert.equal(isTunnelRunStatus({ tunnelId, state: 'failed', errorCode: 'HOST_KEY_CHANGED' }), true);
  assert.equal(isTunnelRunStatus({ tunnelId, state: 'failed', errorCode: 'secret' }), false);
});
