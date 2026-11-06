import test from 'node:test';
import assert from 'node:assert/strict';
import type { SshTunnelDefinition } from '../../packages/domain/src/ssh-tunnel.ts';
import type { SshTunnelExposureConsent, SshTunnelCatalog, SshTunnelForwardProvider, SavedSessionReader, SocksProxyCredentials } from '../../packages/application/src/ssh-tunnels.ts';
import { createSshTunnelController, isSocksProxyCredentials } from '../../packages/application/src/ssh-tunnels.ts';
import type { SshTerminalController } from '../../packages/application/src/ssh-terminals.ts';
import type { LocalTerminalEvent } from '../../packages/application/src/local-terminals.ts';
import type { SavedSessionDefinition } from '../../packages/domain/src/session-definition.ts';
import { failure } from '../../packages/domain/src/errors.ts';
import type { Outcome } from '../../packages/domain/src/errors.ts';

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
  readonly confirmTunnelExposure?: SshTunnelExposureConsent;
  readonly requestSocksCredentials?: Parameters<typeof createSshTunnelController>[6];
} = {}) {
  const saved = new Map<string, SshTunnelDefinition>();
  saved.set(tunnelId, definition);
  const events: TunnelStatusEvent[] = [];
  const sshEvents = new Set<(event: LocalTerminalEvent) => void>();
  const calls = { opened: [] as string[], gatewayRoutes: [] as (readonly { readonly host: string; readonly port: number }[])[],
    closed: [] as string[], forwarded: [] as string[], forwardModes: [] as string[], stopped: [] as string[],
    socksCredentials: [] as (SocksProxyCredentials | undefined)[] };
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
    async openFiles(sessionId, host, port, authentication, gateways) {
      calls.opened.push(sessionId);
      calls.gatewayRoutes.push(gateways ?? []);
      return overrides.open ? overrides.open(sessionId, host, port, authentication, gateways)
        : { ok: true, result: { sessionId, endpoint: { host, port }, state: 'running' } };
    },
    async close(sessionId) { calls.closed.push(sessionId); return { ok: true, result: {} }; },
    subscribe(listener) { sshEvents.add(listener); return () => sshEvents.delete(listener); }
  };
  const forwarding: SshTunnelForwardProvider = {
    async startForward(sessionId, id, tunnel, socksCredentials) {
      calls.forwarded.push(`${sessionId}:${id}`); calls.forwardModes.push(tunnel.mode); calls.socksCredentials.push(socksCredentials);
      return overrides.startForward ? overrides.startForward() : 51_234;
    },
    async stopForward(sessionId, id) { calls.stopped.push(`${sessionId}:${id}`); }
  };
  const controller = createSshTunnelController(catalog, profiles, ssh, forwarding, overrides.newId ?? (() => runtimeId),
    overrides.confirmTunnelExposure ?? (async () => true), overrides.requestSocksCredentials);
  controller.subscribe(status => events.push(status));
  return { controller, calls, events, sshEvents, saved };
}

type TunnelStatusEvent = { readonly tunnelId: string; readonly state: string };

const dynamicDefinition: SshTunnelDefinition = { id: tunnelId, sessionId: profileId, name: 'SOCKS proxy', mode: 'dynamic',
  bindHost: '127.0.0.1', bindPort: 0, createdAt: definition.createdAt };

test('SOCKS credentials require exact fields and one through 255 UTF-8 bytes per value', () => {
  assert.equal(isSocksProxyCredentials({ username: 'u', password: 'p' }), true);
  assert.equal(isSocksProxyCredentials({ username: 'é'.repeat(127) + 'a', password: 'p'.repeat(255) }), true);
  for (const value of [null, [], { username: '', password: 'p' }, { username: 'u', password: '' },
    { username: 'é'.repeat(128), password: 'p' }, { username: 'u', password: 'p'.repeat(256) },
    { username: 'u\0', password: 'p' }, { username: 'u', password: '\0p' },
    { username: '\ud800', password: 'p' }, { username: 'u', password: '\udfff' },
    { username: 'u', password: null }, { username: 'u', password: 'p', extra: true }]) {
    assert.equal(isSocksProxyCredentials(value), false);
  }
});

test('authenticated SOCKS starts request transient credentials before SSH and never save or publish them', async () => {
  let prompts = 0;
  const credentials = { username: 'proxy-user', password: 'proxy-secret' };
  const { controller, calls, events, saved } = harness({ getTunnel: async () => dynamicDefinition,
    requestSocksCredentials: async signal => {
      assert.equal(signal.aborted, false);
      assert.deepEqual(calls.opened, []);
      prompts++;
      return { ok: true, result: credentials };
    }
  });
  assert.equal((await controller.start(tunnelId, undefined, undefined, true)).ok, true);
  assert.deepEqual(calls.socksCredentials, [credentials]);
  assert.doesNotMatch(JSON.stringify([await controller.list(), events, [...saved.values()]]), /proxy-user|proxy-secret/u);
  await controller.stop(tunnelId);

  assert.equal((await controller.start(tunnelId)).ok, true);
  assert.deepEqual(calls.socksCredentials, [credentials, undefined]);
  assert.equal(prompts, 1, 'an authenticated start must not change the default for a later start');
  await controller.dispose();
});

test('required SOCKS authentication never falls back on unsupported mode, missing prompt, malformed credentials or prompt failure', async () => {
  const requestCredentials = async () => ({ ok: true as const, result: { username: 'u', password: 'p' } });
  const scenarios = [
    { getTunnel: async () => definition, requestSocksCredentials: requestCredentials, code: 'INVALID_REQUEST' },
    { getTunnel: async () => dynamicDefinition, code: 'NOT_SUPPORTED' },
    { getTunnel: async () => dynamicDefinition,
      requestSocksCredentials: async () => ({ ok: true as const, result: { username: 'u', password: '' } }), code: 'INVALID_REQUEST' },
    { getTunnel: async () => dynamicDefinition, requestSocksCredentials: async () => failure('CANCELLED'), code: 'CANCELLED' },
    { getTunnel: async () => dynamicDefinition, requestSocksCredentials: async () => { throw new Error('native prompt unavailable'); }, code: 'UNAVAILABLE' }
  ];
  for (const scenario of scenarios) {
    const { controller, calls } = harness(scenario);
    const result = await controller.start(tunnelId, undefined, undefined, true);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, scenario.code);
    assert.deepEqual(calls.opened, []);
    assert.deepEqual(calls.forwarded, []);
    await controller.dispose();
  }
});

test('cancellation, stop, closeAll and dispose cancel a pending SOCKS credential request before SSH opens', async () => {
  for (const action of ['cancel', 'stop', 'closeAll', 'dispose'] as const) {
    let requested!: () => void;
    const promptRequested = new Promise<void>(resolve => { requested = resolve; });
    let cancelled = false;
    const { controller, calls } = harness({ getTunnel: async () => dynamicDefinition,
      requestSocksCredentials: signal => new Promise<Outcome<SocksProxyCredentials>>(resolve => {
        signal.addEventListener('abort', () => { cancelled = true; resolve(failure('CANCELLED')); });
        requested();
      })
    });
    const cancellation = new AbortController();
    const starting = controller.start(tunnelId, cancellation.signal, undefined, true);
    await promptRequested;
    if (action === 'cancel') cancellation.abort();
    else if (action === 'stop') assert.deepEqual(await controller.stop(tunnelId), { ok: true, result: { tunnelId, state: 'stopped' } });
    else await controller[action]();
    assert.equal(cancelled, true, action);
    const result = await starting;
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'CANCELLED');
    assert.deepEqual(calls.opened, []);
    assert.deepEqual(calls.forwarded, []);
    await controller.dispose();
  }
});

test('concurrent authenticated starts share one prompt while a different authentication policy is busy', async () => {
  let requested!: () => void;
  const promptRequested = new Promise<void>(resolve => { requested = resolve; });
  let finishPrompt!: (value: Outcome<SocksProxyCredentials>) => void;
  const prompt = new Promise<Outcome<SocksProxyCredentials>>(resolve => { finishPrompt = resolve; });
  let prompts = 0;
  const { controller, calls } = harness({ getTunnel: async () => dynamicDefinition,
    requestSocksCredentials: async () => { prompts++; requested(); return prompt; }
  });
  const first = controller.start(tunnelId, undefined, undefined, true);
  await promptRequested;
  const second = controller.start(tunnelId, undefined, undefined, true);
  const anonymous = await controller.start(tunnelId);
  assert.equal(anonymous.ok, false);
  if (!anonymous.ok) assert.equal(anonymous.error.code, 'BUSY');
  finishPrompt({ ok: true, result: { username: 'u', password: 'p' } });
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.ok, true);
  assert.deepEqual(secondResult, firstResult);
  assert.equal(prompts, 1);
  assert.equal(calls.forwarded.length, 1);
  await controller.dispose();
});

test('tunnel controller reads one saved definition without listing the catalog', async () => {
  const { controller } = harness();
  assert.deepEqual(await controller.get(tunnelId), { ok: true, result: definition });
  assert.deepEqual(await controller.get('not-a-tunnel-id'), { ok: false, error: { code: 'INVALID_REQUEST', target: 'application', retryable: false } });
  await controller.dispose();
});

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

test('remote tunnel start reserves its definition while main-process exposure consent is pending', async () => {
  const remote: SshTunnelDefinition = { ...definition, name: 'Reverse API', mode: 'remote', bindPort: 8080,
    targetHost: '127.0.0.1', targetPort: 3000 };
  let approve!: (value: boolean) => void;
  let requested!: () => void;
  const confirmationRequested = new Promise<void>(resolve => { requested = resolve; });
  const confirmation = new Promise<boolean>(resolve => { approve = resolve; });
  const { controller, calls } = harness({ getTunnel: async () => remote,
    confirmTunnelExposure: async (definition, server) => {
      assert.deepEqual(definition, remote);
      assert.deepEqual(server, { host: profile.host, port: profile.port });
      requested();
      return confirmation;
    }
  });

  const starting = controller.start(tunnelId);
  await confirmationRequested;
  assert.deepEqual(calls.opened, []);
  const edited = await controller.save({ id: remote.id, sessionId: remote.sessionId, name: 'Changed while confirming', mode: remote.mode,
    bindHost: remote.bindHost, bindPort: remote.bindPort, targetHost: remote.targetHost, targetPort: remote.targetPort });
  assert.equal(edited.ok, false);
  if (!edited.ok) assert.equal(edited.error.code, 'BUSY');
  const removed = await controller.remove(tunnelId);
  assert.equal(removed.ok, false);
  if (!removed.ok) assert.equal(removed.error.code, 'BUSY');

  approve(false);
  const denied = await starting;
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.error.code, 'CANCELLED');
  assert.deepEqual(calls.opened, []);
  await controller.dispose();
});

test('canceling a pending exposure prompt keeps the definition reserved until consent settles', async () => {
  const remote: SshTunnelDefinition = { ...definition, name: 'Reverse API', mode: 'remote', bindPort: 8080,
    targetHost: '127.0.0.1', targetPort: 3000 };
  let approve!: (value: boolean) => void;
  let requested!: () => void;
  const confirmationRequested = new Promise<void>(resolve => { requested = resolve; });
  const confirmation = new Promise<boolean>(resolve => { approve = resolve; });
  const { controller, calls } = harness({ getTunnel: async () => remote,
    confirmTunnelExposure: async () => { requested(); return confirmation; }
  });
  const cancellation = new AbortController();
  const starting = controller.start(tunnelId, cancellation.signal);
  await confirmationRequested;

  cancellation.abort();
  const edited = await controller.save({ id: remote.id, sessionId: remote.sessionId, name: 'Changed during canceled prompt', mode: remote.mode,
    bindHost: remote.bindHost, bindPort: remote.bindPort, targetHost: remote.targetHost, targetPort: remote.targetPort });
  assert.equal(edited.ok, false);
  if (!edited.ok) assert.equal(edited.error.code, 'BUSY');
  const removed = await controller.remove(tunnelId);
  assert.equal(removed.ok, false);
  if (!removed.ok) assert.equal(removed.error.code, 'BUSY');

  approve(true);
  const cancelled = await starting;
  assert.equal(cancelled.ok, false);
  if (!cancelled.ok) assert.equal(cancelled.error.code, 'CANCELLED');
  assert.deepEqual(calls.opened, []);
  await controller.dispose();
});

test('remote tunnel requires fresh exposure consent for each accepted start', async () => {
  const remote: SshTunnelDefinition = { ...definition, name: 'Reverse API', mode: 'remote', bindPort: 8080,
    targetHost: '127.0.0.1', targetPort: 3000 };
  let confirmations = 0;
  const { controller } = harness({ getTunnel: async () => remote,
    confirmTunnelExposure: async () => { confirmations++; return true; }
  });

  assert.equal((await controller.start(tunnelId)).ok, true);
  assert.equal((await controller.stop(tunnelId)).ok, true);
  assert.equal((await controller.start(tunnelId)).ok, true);
  assert.equal(confirmations, 2);
  await controller.dispose();
});

test('public local tunnel binds all IPv4 interfaces only after exposure consent', async () => {
  const publicLocal: SshTunnelDefinition = { ...definition, bindHost: '0.0.0.0' };
  let approved = false;
  let confirmations = 0;
  const { controller, calls } = harness({ getTunnel: async () => publicLocal,
    confirmTunnelExposure: async (candidate, server) => {
      assert.deepEqual(candidate, publicLocal);
      assert.deepEqual(server, { host: profile.host, port: profile.port });
      confirmations++;
      return approved;
    }
  });

  const denied = await controller.start(tunnelId);
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.error.code, 'CANCELLED');
  assert.deepEqual(calls.opened, []);

  approved = true;
  const started = await controller.start(tunnelId);
  assert.deepEqual(started, { ok: true, result: { tunnelId, state: 'active', bindHost: '0.0.0.0', bindPort: 51_234 } });
  assert.equal(confirmations, 2);
  await controller.dispose();
});

test('saved tunnel eight-gateway routes reach the files-only SSH open in route order', async () => {
  const target = { ...profile, host: 'target.test', port: 2222 };
  const gateways = Array.from({ length: 8 }, (_, index) => ({ host: `jump-${index + 1}.test`, port: 2201 + index }));
  const { controller, calls } = harness({ getProfile: async () => target });

  const result = await controller.start(tunnelId, undefined, gateways);

  assert.equal(result.ok, true);
  assert.deepEqual(calls.gatewayRoutes, [gateways]);
  assert.equal(calls.forwarded.length, 1);
  await controller.stop(tunnelId);
  await controller.dispose();
});

test('saved tunnel gateway routes reject a ninth hop before opening SSH', async () => {
  const target = { ...profile, host: 'target.test', port: 2222 };
  const { controller, calls } = harness({ getProfile: async () => target });
  const result = await controller.start(tunnelId, undefined,
    Array.from({ length: 9 }, (_, index) => ({ host: `jump-${index + 1}.test`, port: 2201 + index })));

  assert.equal(result.ok, false);
  assert.deepEqual(calls.opened, []);
  await controller.dispose();
});

test('tunnel gateway routes reject endpoint overlap before opening SSH', async () => {
  const { controller, calls } = harness();

  const result = await controller.start(tunnelId, undefined, [{ host: 'GATEWAY.TEST.', port: 22 }]);

  assert.deepEqual(result, { ok: false, error: { code: 'INVALID_REQUEST', target: 'application', retryable: false } });
  assert.deepEqual(calls.opened, []);
  await controller.dispose();
});

test('same-route concurrent tunnel starts coalesce while a different route is busy', async () => {
  let releaseOpen!: (value: Awaited<ReturnType<SshTerminalController['openFiles']>>) => void;
  const target = { ...profile, host: 'target.test', port: 2222 };
  const open: SshTerminalController['openFiles'] = (sessionId, host, port) => new Promise(resolve => {
    assert.equal(sessionId, runtimeId);
    assert.equal(host, target.host);
    assert.equal(port, target.port);
    releaseOpen = resolve;
  });
  const { controller, calls } = harness({ getProfile: async () => target, open });
  const firstRoute = [{ host: 'JUMP-ONE.TEST.', port: 2201 }];
  const first = controller.start(tunnelId, undefined, firstRoute);
  await new Promise(resolve => setImmediate(resolve));
  const same = controller.start(tunnelId, undefined, [{ host: 'jump-one.test', port: 2201 }]);
  const different = await controller.start(tunnelId, undefined, [{ host: 'jump-two.test', port: 2202 }]);
  assert.deepEqual(different, { ok: false, error: { code: 'BUSY', target: 'terminal', retryable: true } });

  releaseOpen({ ok: true, result: { sessionId: runtimeId, endpoint: { host: target.host, port: target.port }, state: 'running' } });
  const [firstResult, sameResult] = await Promise.all([first, same]);
  assert.deepEqual(sameResult, firstResult);
  assert.equal(calls.opened.length, 1);
  await controller.stop(tunnelId);
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
