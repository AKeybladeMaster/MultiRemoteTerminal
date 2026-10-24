import test from 'node:test';
import assert from 'node:assert/strict';
import type { SshTunnelDefinition } from '../../packages/domain/src/ssh-tunnel.ts';
import type { SshTunnelCatalog, SshTunnelForwardProvider, SavedSessionReader } from '../../packages/application/src/ssh-tunnels.ts';
import { createSshTunnelController } from '../../packages/application/src/ssh-tunnels.ts';
import type { SshTerminalController } from '../../packages/application/src/ssh-terminals.ts';
import type { LocalTerminalEvent } from '../../packages/application/src/local-terminals.ts';
import type { SavedSessionDefinition } from '../../packages/domain/src/session-definition.ts';

const profileId = '00000000-0000-4000-8000-000000000001';
const tunnelId = '00000000-0000-4000-8000-000000000002';
const runtimeId = '00000000-0000-4000-8000-000000000003';
const definition: SshTunnelDefinition = { id: tunnelId, sessionId: profileId, name: 'Database', mode: 'local', bindHost: '127.0.0.1',
  bindPort: 0, targetHost: 'db.internal', targetPort: 5432, createdAt: '2026-10-24T00:00:00.000Z' };
const profile: SavedSessionDefinition = { id: profileId, folderId: null, kind: 'ssh', name: 'SSH gateway', host: 'gateway.test', port: 22,
  favorite: false, createdAt: definition.createdAt, updatedAt: definition.createdAt };

function harness(overrides: {
  readonly startForward?: () => Promise<number>;
  readonly open?: SshTerminalController['openFiles'];
  readonly newId?: () => string;
  readonly getTunnel?: (id: string) => Promise<SshTunnelDefinition | undefined>;
  readonly getProfile?: (id: string) => Promise<SavedSessionDefinition | undefined>;
} = {}) {
  const saved = new Map<string, SshTunnelDefinition>();
  saved.set(tunnelId, definition);
  const events: TunnelStatusEvent[] = [];
  const sshEvents = new Set<(event: LocalTerminalEvent) => void>();
  const calls = { opened: [] as string[], closed: [] as string[], forwarded: [] as string[], forwardModes: [] as string[], stopped: [] as string[] };
  const catalog: SshTunnelCatalog = {
    async listSshTunnels() { return [...saved.values()]; },
    async getSshTunnel(id) { return overrides.getTunnel ? overrides.getTunnel(id) : saved.get(id); },
    async saveSshTunnel(draft) {
      const result: SshTunnelDefinition = { ...draft, id: draft.id ?? tunnelId, createdAt: definition.createdAt };
      saved.set(result.id, result);
      return result;
    },
    async removeSshTunnel(id) { return saved.delete(id); }
  };
  const profiles: SavedSessionReader = { async getSessionDefinition(id) {
    return overrides.getProfile ? overrides.getProfile(id) : id === profileId ? profile : undefined;
  } };
  const ssh: Pick<SshTerminalController, 'openFiles' | 'close' | 'subscribe'> = {
    async openFiles(sessionId) {
      calls.opened.push(sessionId);
      return overrides.open ? overrides.open(sessionId, 'gateway.test', 22) : { ok: true, result: { sessionId, endpoint: { host: 'gateway.test', port: 22 }, state: 'running' } };
    },
    async close(sessionId) { calls.closed.push(sessionId); return { ok: true, result: {} }; },
    subscribe(listener) { sshEvents.add(listener); return () => sshEvents.delete(listener); }
  };
  const forwarding: SshTunnelForwardProvider = {
    async startForward(sessionId, id, tunnel) { calls.forwarded.push(`${sessionId}:${id}`); calls.forwardModes.push(tunnel.mode); return overrides.startForward ? overrides.startForward() : 51_234; },
    async stopForward(sessionId, id) { calls.stopped.push(`${sessionId}:${id}`); }
  };
  const controller = createSshTunnelController(catalog, profiles, ssh, forwarding, overrides.newId ?? (() => runtimeId));
  controller.subscribe(status => events.push(status));
  return { controller, calls, events, sshEvents, saved };
}

type TunnelStatusEvent = { readonly tunnelId: string; readonly state: string };

test('local tunnel starts through a files-only SSH runtime and closes both listener and connection on stop', async () => {
  const { controller, calls, events } = harness();
  const result = await controller.start(tunnelId);
  assert.deepEqual(result, { ok: true, result: { tunnelId, state: 'active', bindHost: '127.0.0.1', bindPort: 51_234 } });
  assert.deepEqual(calls.opened, [runtimeId]);
  assert.deepEqual(calls.forwarded, [`${runtimeId}:${tunnelId}`]);
  assert.deepEqual(events.map(event => event.state), ['starting', 'active']);

  const stopped = await controller.stop(tunnelId);
  assert.deepEqual(stopped, { ok: true, result: { tunnelId, state: 'stopped' } });
  assert.deepEqual(calls.stopped, [`${runtimeId}:${tunnelId}`]);
  assert.deepEqual(calls.closed, [runtimeId]);
  assert.deepEqual(events.map(event => event.state), ['starting', 'active', 'stopping', 'stopped']);
  assert.equal((await controller.list()).ok, true);
  await controller.dispose();
});

test('remote tunnel uses the saved SSH profile and publishes the assigned server loopback port', async () => {
  const remote = { ...definition, name: 'Reverse API', mode: 'remote' as const, targetHost: '127.0.0.1', targetPort: 3000 };
  const { controller, calls } = harness({ getTunnel: async () => remote });

  const started = await controller.start(tunnelId);

  assert.deepEqual(started, { ok: true, result: { tunnelId, state: 'active', bindHost: '127.0.0.1', bindPort: 51_234 } });
  assert.deepEqual(calls.forwardModes, ['remote']);
  const stopped = await controller.stop(tunnelId);
  assert.deepEqual(stopped, { ok: true, result: { tunnelId, state: 'stopped' } });
  await controller.dispose();
});

test('concurrent starts for the same tunnel share one runtime and listener', async () => {
  let nextRuntime = 0;
  const { controller, calls } = harness({ newId: () => `00000000-0000-4000-8000-00000000000${++nextRuntime}` });

  const [first, second] = await Promise.all([controller.start(tunnelId), controller.start(tunnelId)]);

  assert.deepEqual(first, second);
  assert.equal(calls.opened.length, 1);
  assert.equal(calls.forwarded.length, 1);
  await controller.stop(tunnelId);
  assert.equal(calls.stopped.length, 1);
  assert.equal(calls.closed.length, 1);
  await controller.dispose();
});

test('controller allows twenty active saved tunnels without an application cap', async () => {
  let nextRuntime = 100;
  const { controller, calls, saved } = harness({ newId: () => `00000000-0000-4000-8000-${String(++nextRuntime).padStart(12, '0')}` });
  const tunnelIds = Array.from({ length: 20 }, (_, index) => `00000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`);
  for (const [index, id] of tunnelIds.entries()) saved.set(id, { ...definition, id, name: `Tunnel ${index + 1}` });

  const results = await Promise.all(tunnelIds.map(id => controller.start(id)));

  assert.ok(results.every(result => result.ok));
  assert.equal(calls.opened.length, 20);
  await controller.closeAll();
  assert.equal(calls.closed.length, 20);
  await controller.dispose();
});

test('closeAll cancels startup waiting on profile lookup before it opens SSH', async () => {
  let releaseProfile!: (value: SavedSessionDefinition | undefined) => void;
  const { controller, calls } = harness({ getProfile: () => new Promise(resolve => { releaseProfile = resolve; }) });
  const starting = controller.start(tunnelId);
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(await controller.remove(tunnelId), { ok: false, error: { code: 'BUSY', target: 'terminal', retryable: true } });
  assert.deepEqual(await controller.save({ id: tunnelId, sessionId: profileId, name: 'Changed', mode: 'local', bindHost: '127.0.0.1', bindPort: 0,
    targetHost: 'db.internal', targetPort: 5432 }), { ok: false, error: { code: 'BUSY', target: 'terminal', retryable: true } });
  await controller.closeAll();
  releaseProfile(profile);

  assert.deepEqual(await starting, { ok: false, error: { code: 'CANCELLED', target: 'terminal', retryable: false } });
  assert.deepEqual(calls.opened, []);
  await controller.dispose();
});

test('profile removal reservation blocks tunnel startup and active tunnel profile deletion', async () => {
  const { controller } = harness();
  assert.equal(controller.beginSessionRemoval(profileId), true);
  assert.deepEqual(await controller.start(tunnelId), { ok: false, error: { code: 'BUSY', target: 'application', retryable: true } });
  controller.endSessionRemoval(profileId);

  assert.equal((await controller.start(tunnelId)).ok, true);
  assert.equal(controller.beginSessionRemoval(profileId), false);
  await controller.stop(tunnelId);
  assert.equal(controller.beginSessionRemoval(profileId), true);
  controller.endSessionRemoval(profileId);
  await controller.dispose();
});

test('a bind conflict leaves a failed saved definition and closes its SSH session', async () => {
  const { controller, calls } = harness({ startForward: async () => { throw Object.assign(new Error('port conflict'), { code: 'CONFLICT' }); } });
  const result = await controller.start(tunnelId);
  assert.deepEqual(result, { ok: false, error: { code: 'CONFLICT', target: 'terminal', retryable: false } });
  assert.deepEqual(calls.closed, [runtimeId]);
  const listing = await controller.list();
  assert.equal(listing.ok, true);
  if (listing.ok) assert.deepEqual(listing.result[0]?.status, { tunnelId, state: 'failed', errorCode: 'CONFLICT' });
  await controller.dispose();
});

test('stopping a tunnel while its credential prompt is open cancels startup and does not bind', async () => {
  let releaseOpen!: (value: Awaited<ReturnType<SshTerminalController['openFiles']>>) => void;
  const open: SshTerminalController['openFiles'] = (sessionId, host, port) => {
    assert.equal(sessionId, runtimeId);
    assert.equal(host, profile.host);
    assert.equal(port, profile.port);
    return new Promise(resolve => { releaseOpen = resolve; });
  };
  const { controller, calls } = harness({ open });
  const starting = controller.start(tunnelId);
  await new Promise(resolve => setImmediate(resolve));
  const stopping = controller.stop(tunnelId);
  releaseOpen({ ok: false, error: { code: 'CANCELLED', target: 'terminal', retryable: false } });
  const [startResult, stopResult] = await Promise.all([starting, stopping]);
  assert.equal(startResult.ok, false);
  assert.deepEqual(stopResult, { ok: true, result: { tunnelId, state: 'stopped' } });
  assert.deepEqual(calls.forwarded, []);
  assert.ok(calls.closed.includes(runtimeId));
  await controller.dispose();
});

test('saving a local tunnel accepts only an SSH-backed saved profile', async () => {
  const { controller } = harness();
  const result = await controller.save({ sessionId: profileId, name: 'New database', mode: 'local', bindHost: '127.0.0.1', bindPort: 0,
    targetHost: 'db.internal', targetPort: 5432 });
  assert.equal(result.ok, true);
  assert.deepEqual(await controller.save({ sessionId: '00000000-0000-4000-8000-000000000099', name: 'Missing profile', mode: 'local',
    bindHost: '127.0.0.1', bindPort: 0, targetHost: 'db.internal', targetPort: 5432 }),
  { ok: false, error: { code: 'NOT_FOUND', target: 'application', retryable: false } });
  await controller.dispose();
});
