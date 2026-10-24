import test from 'node:test';
import assert from 'node:assert/strict';
import { isLocalTunnelDefinition, isTunnelRunStatus, normalizeLocalTunnelDraft } from '../../packages/domain/src/ssh-tunnel.ts';

const sessionId = '00000000-0000-4000-8000-000000000001';
const tunnelId = '00000000-0000-4000-8000-000000000002';

test('local SSH tunnel definitions normalize endpoint data and allow OS-selected ports', () => {
  const draft = normalizeLocalTunnelDraft({ sessionId, name: '  Database  ', mode: 'local', bindHost: '127.0.0.1', bindPort: 0,
    targetHost: 'DB.INTERNAL.', targetPort: 5432 });
  assert.deepEqual(draft, { sessionId, name: 'Database', mode: 'local', bindHost: '127.0.0.1', bindPort: 0,
    targetHost: 'db.internal', targetPort: 5432 });
  assert.equal(normalizeLocalTunnelDraft({ ...draft, id: tunnelId })?.id, tunnelId);
  assert.equal(normalizeLocalTunnelDraft({ ...draft, bindHost: '0.0.0.0' }), undefined);
  assert.equal(normalizeLocalTunnelDraft({ ...draft, bindPort: 65_536 }), undefined);
  assert.equal(normalizeLocalTunnelDraft({ ...draft, targetHost: 'bad host' }), undefined);
  assert.equal(normalizeLocalTunnelDraft({ ...draft, password: 'must not persist' }), undefined);
});

test('local tunnel persisted rows and runtime status accept only exact bounded shapes', () => {
  const definition = { id: tunnelId, sessionId, name: 'Database', mode: 'local', bindHost: '127.0.0.1', bindPort: 0,
    targetHost: 'db.internal', targetPort: 5432, createdAt: '2026-10-24T00:00:00.000Z' } as const;
  assert.equal(isLocalTunnelDefinition(definition), true);
  assert.equal(isLocalTunnelDefinition({ ...definition, extra: true }), false);
  assert.equal(isTunnelRunStatus({ tunnelId, state: 'active', bindHost: '127.0.0.1', bindPort: 50124 }), true);
  assert.equal(isTunnelRunStatus({ tunnelId, state: 'active', bindHost: '0.0.0.0', bindPort: 50124 }), false);
  assert.equal(isTunnelRunStatus({ tunnelId, state: 'failed', errorCode: 'HOST_KEY_CHANGED' }), true);
  assert.equal(isTunnelRunStatus({ tunnelId, state: 'failed', errorCode: 'secret' }), false);
});
