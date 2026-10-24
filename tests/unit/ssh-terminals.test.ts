import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSshTerminalController, SshTerminalProviderError } from '../../packages/application/src/ssh-terminals.ts';
import type { SshTerminalCredentials, SshTerminalProvider } from '../../packages/application/src/ssh-terminals.ts';
import type { CredentialPrompt, CredentialPromptCancellation, CredentialPromptResult } from '../../packages/application/src/credential-prompt.ts';
import type { HostTrustManager, HostTrustDecision, HostTrustResolution } from '../../packages/application/src/host-trust.ts';
import type { HostKeyEvidence, SshHostEndpoint } from '../../packages/domain/src/host-trust.ts';
import type { LocalTerminalEvent } from '../../packages/application/src/local-terminals.ts';
import type { CancellationSignal } from '../../packages/application/src/cancellation.ts';

const sessionId = '11111111-1111-4111-8111-111111111111';
const keyBytes = hostKey();
const evidence: HostKeyEvidence = {
  algorithm: 'ssh-ed25519',
  fingerprint: `SHA256:${createHash('sha256').update(keyBytes).digest('base64').replace(/=+$/, '')}`,
  publicKey: keyBytes
};

function hostKey(): Uint8Array {
  const algorithm = Buffer.from('ssh-ed25519', 'ascii');
  const result = Buffer.alloc(4 + algorithm.length + 32);
  result.writeUInt32BE(algorithm.length, 0);
  algorithm.copy(result, 4);
  for (let index = 4 + algorithm.length; index < result.length; index += 1) result[index] = index & 0xff;
  return result;
}

class FakeTrust implements HostTrustManager {
  readonly revoked: SshHostEndpoint[] = [];
  cancellationLookup = false;
  inspectionStarted: (() => void) | undefined;
  inspectionCancellation: CredentialPromptCancellation | undefined;
  decision: HostTrustDecision = { kind: 'approval-required', challenge: {
    token: 'ssh-host-approval-token-0001', host: 'server.example.net', port: 22,
    algorithm: evidence.algorithm, fingerprint: evidence.fingerprint
  } };
  private readonly resolvers = new Map<string, (value: HostTrustResolution) => void>();

  async inspect(endpoint: unknown, evidence: unknown, cancellation?: CredentialPromptCancellation) {
    void endpoint;
    void evidence;
    this.inspectionCancellation = cancellation;
    this.inspectionStarted?.();
    if (this.cancellationLookup) {
      return new Promise<Awaited<ReturnType<HostTrustManager['inspect']>>>(resolve => {
        const cancelled = () => resolve({ ok: false, error: { code: 'CANCELLED', target: 'application', retryable: false } });
        if (cancellation?.aborted) cancelled();
        else cancellation?.addEventListener('abort', cancelled, { once: true });
      });
    }
    return { ok: true as const, result: this.decision };
  }
  waitForResolution(token: unknown): Promise<HostTrustResolution> {
    if (typeof token !== 'string') return Promise.resolve('not-found');
    return new Promise(resolve => this.resolvers.set(token, resolve));
  }
  async approve(token: unknown) {
    if (typeof token !== 'string' || this.decision.kind !== 'approval-required' || token !== this.decision.challenge.token) {
      return { ok: false as const, error: { code: 'NOT_FOUND' as const, target: 'application' as const, retryable: false } };
    }
    this.resolvers.get(token)?.('approved');
    return { ok: true as const, result: { kind: 'approved' as const } };
  }
  reject(token: unknown) {
    if (typeof token === 'string') this.resolvers.get(token)?.('rejected');
    return { ok: true as const, result: { kind: 'rejected' as const } };
  }
  async revoke(endpoint: SshHostEndpoint) { this.revoked.push(endpoint); return { ok: true as const, result: {} }; }
  dispose(): void {}
}

class FakeProvider implements SshTerminalProvider {
  readonly opened: Array<{ readonly sessionId: string; readonly endpoint: SshHostEndpoint; readonly credentials: SshTerminalCredentials }> = [];
  readonly closed: string[] = [];
  readonly listeners = new Set<(event: LocalTerminalEvent) => void>();
  readonly listedDirectories: Array<{ readonly sessionId: string; readonly path: string; readonly cancellation?: CancellationSignal }> = [];
  waitForDirectoryCancellation = false;
  directoryError: Error | undefined;
  directoryListStarted: (() => void) | undefined;

  async open(session: string, endpoint: SshHostEndpoint, credentials: SshTerminalCredentials, _size: { columns: number; rows: number }, verifyHost: (evidence: HostKeyEvidence) => Promise<boolean>) {
    this.opened.push({ sessionId: session, endpoint, credentials });
    if (!await verifyHost(evidence)) throw new Error('Host verification failed');
  }
  async write(): Promise<void> {}
  async resize(): Promise<void> {}
  async acknowledgeOutput(): Promise<void> {}
  async listRemoteDirectory(session: string, path: string, cancellation?: CancellationSignal) {
    this.listedDirectories.push({ sessionId: session, path, ...(cancellation ? { cancellation } : {}) });
    if (this.directoryError) throw this.directoryError;
    if (this.waitForDirectoryCancellation && cancellation) {
      await new Promise<never>((_resolve, reject) => {
        const cancel = () => { cancellation.removeEventListener('abort', cancel); reject(new SshTerminalProviderError('CANCELLED')); };
        cancellation.addEventListener('abort', cancel, { once: true });
        if (cancellation.aborted) cancel();
        this.directoryListStarted?.();
      });
    }
    if (cancellation?.aborted) throw new SshTerminalProviderError('CANCELLED');
    return { path: path === '.' ? '/home/alice' : path, entries: [], truncated: false };
  }
  async close(session: string): Promise<void> { this.closed.push(session); }
  async shutdown(): Promise<void> {}
  subscribe(listener: (event: LocalTerminalEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
}

test('SFTP directory listing is available only on a running trusted SSH session and validates provider output', async () => {
  const provider = new FakeProvider();
  const trust = new FakeTrust();
  trust.decision = { kind: 'trusted' };
  const controller = createSshTerminalController(provider, promptWith({ kind: 'provided', username: 'alice', secret: 'temporary' }), trust);

  assert.deepEqual(await controller.listRemoteDirectory(sessionId, '.'), {
    ok: false, error: { code: 'NOT_FOUND', target: 'terminal', retryable: false }
  });
  assert.equal((await controller.open(sessionId, 'server.example.net', 22, { columns: 80, rows: 24 })).ok, true);
  const listing = await controller.listRemoteDirectory(sessionId, '.');
  assert.deepEqual(listing, { ok: true, result: { path: '/home/alice', entries: [], truncated: false } });
  provider.directoryError = new SshTerminalProviderError('OUTPUT_LIMIT');
  const oversized = await controller.listRemoteDirectory(sessionId, '.');
  assert.deepEqual(oversized, { ok: false, error: { code: 'OUTPUT_LIMIT', target: 'terminal', retryable: false } });
  provider.directoryError = undefined;
  assert.deepEqual(await controller.listRemoteDirectory(sessionId, 'bad\0path'), {
    ok: false, error: { code: 'INVALID_REQUEST', target: 'application', retryable: false }
  });
  assert.equal(provider.listedDirectories.length, 2);
  assert.equal((await controller.close(sessionId)).ok, true);
  await controller.dispose();
});

test('SFTP controller forwards teardown cancellation and returns a stable CANCELLED result', async () => {
  const provider = new FakeProvider();
  provider.waitForDirectoryCancellation = true;
  const trust = new FakeTrust();
  trust.decision = { kind: 'trusted' };
  const controller = createSshTerminalController(provider, promptWith({ kind: 'provided', username: 'alice', secret: 'temporary' }), trust);
  assert.equal((await controller.open(sessionId, 'server.example.net', 22, { columns: 80, rows: 24 })).ok, true);
  let markStarted!: () => void;
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  provider.directoryListStarted = markStarted;
  const cancellation = new AbortController();
  const pending = controller.listRemoteDirectory(sessionId, '.', cancellation.signal);
  await started;
  cancellation.abort();
  const reply = await pending;
  assert.equal(reply.ok, false);
  if (!reply.ok) assert.equal(reply.error.code, 'CANCELLED');
  assert.equal(provider.listedDirectories[0]?.cancellation?.aborted, true);
  await controller.dispose();
});

function promptWith(result: CredentialPromptResult): CredentialPrompt {
  return { prompt: async () => result };
}

test('SSH open prompts only on explicit action and blocks on unknown host until exact approval', async () => {
  const provider = new FakeProvider();
  const trust = new FakeTrust();
  const controller = createSshTerminalController(provider, promptWith({ kind: 'provided', username: 'alice', secret: 'not-for-renderer' }), trust);
  let promptEvents = 0;
  let resolveChallenge!: (event: Extract<Parameters<Parameters<typeof controller.subscribeTrust>[0]>[0], { kind: 'challenge' }>) => void;
  const challengeEvent = new Promise<Extract<Parameters<Parameters<typeof controller.subscribeTrust>[0]>[0], { kind: 'challenge' }>>(resolve => { resolveChallenge = resolve; });
  controller.subscribeTrust(event => { if (event.kind === 'challenge') { promptEvents += 1; resolveChallenge(event); } });

  const pending = controller.open(sessionId, 'Server.Example.Net.', 22, { columns: 80, rows: 24 });
  const challenge = await challengeEvent;
  assert.equal(promptEvents, 1);
  assert.equal(challenge.challenge.host, 'server.example.net');
  assert.equal('publicKey' in challenge.challenge, false);
  assert.equal(provider.opened.length, 1);
  assert.equal((await controller.approveHostKey(challenge.challenge.token)).ok, true);
  const opened = await pending;
  assert.equal(opened.ok, true);
  assert.equal(provider.opened[0]?.credentials.password, 'not-for-renderer');
  await controller.dispose();
});

test('closing during native credential entry cancels the helper and never starts SSH', async () => {
  const provider = new FakeProvider();
  const trust = new FakeTrust();
  let promptStarted!: () => void;
  const started = new Promise<void>(resolve => { promptStarted = resolve; });
  const prompt: CredentialPrompt = {
    prompt: (_purpose, signal?: CredentialPromptCancellation) => new Promise(resolve => {
      promptStarted();
      if (signal?.aborted) { resolve({ kind: 'cancelled' }); return; }
      signal?.addEventListener('abort', () => resolve({ kind: 'cancelled' }), { once: true });
    })
  };
  const controller = createSshTerminalController(provider, prompt, trust);
  const pending = controller.open(sessionId, 'server.example.net', 22, { columns: 80, rows: 24 });
  await started;
  assert.equal((await controller.close(sessionId)).ok, true);
  assert.equal((await pending).ok, false);
  assert.equal(provider.opened.length, 0);
  assert.deepEqual(provider.closed, [sessionId]);
  await controller.dispose();
});

test('closing during a host-trust lookup cancels the storage operation', async () => {
  const provider = new FakeProvider();
  const trust = new FakeTrust();
  trust.cancellationLookup = true;
  let signalInspectionStarted!: () => void;
  const inspectionStarted = new Promise<void>(resolve => { signalInspectionStarted = resolve; });
  trust.inspectionStarted = signalInspectionStarted;
  const controller = createSshTerminalController(provider, promptWith({ kind: 'provided', username: 'alice', secret: 'temporary-secret' }), trust);
  const pending = controller.open(sessionId, 'server.example.net', 22, { columns: 80, rows: 24 });
  await inspectionStarted;
  assert.ok(trust.inspectionCancellation);
  assert.equal((await controller.close(sessionId)).ok, true);
  assert.equal((await pending).ok, false);
  assert.equal(trust.inspectionCancellation?.aborted, true);
  assert.deepEqual(provider.closed, [sessionId]);
  await controller.dispose();
});

test('closing while host approval holds the handshake rejects the token and releases the provider session', async () => {
  const provider = new FakeProvider();
  const trust = new FakeTrust();
  const controller = createSshTerminalController(provider, promptWith({ kind: 'provided', username: 'alice', secret: 'temporary-secret' }), trust);
  let resolveChallenge!: () => void;
  const challengeEvent = new Promise<void>(resolve => { resolveChallenge = resolve; });
  controller.subscribeTrust(event => { if (event.kind === 'challenge') resolveChallenge(); });
  const pendingOpen = controller.open(sessionId, 'server.example.net', 22, { columns: 80, rows: 24 });
  await challengeEvent;
  assert.equal((await controller.close(sessionId)).ok, true);
  assert.equal((await pendingOpen).ok, false);
  assert.deepEqual(provider.closed, [sessionId]);
  assert.equal(provider.opened.length, 1);
  await controller.dispose();
});

test('changed host keys block SSH and produce a non-secret warning event', async () => {
  const provider = new FakeProvider();
  const trust = new FakeTrust();
  trust.decision = { kind: 'changed', host: 'server.example.net', port: 22, algorithm: evidence.algorithm, fingerprint: evidence.fingerprint };
  const controller = createSshTerminalController(provider, promptWith({ kind: 'provided', username: 'alice', secret: 'not-for-renderer' }), trust);
  let resolveChanged!: (event: Extract<Parameters<Parameters<typeof controller.subscribeTrust>[0]>[0], { kind: 'changed' }>) => void;
  const changedEvent = new Promise<Extract<Parameters<Parameters<typeof controller.subscribeTrust>[0]>[0], { kind: 'changed' }>>(resolve => { resolveChanged = resolve; });
  controller.subscribeTrust(event => { if (event.kind === 'changed') resolveChanged(event); });
  const result = await controller.open(sessionId, 'server.example.net', 22, { columns: 80, rows: 24 });
  assert.equal(result.ok, false);
  const warning = await changedEvent;
  assert.equal(warning.host, 'server.example.net');
  assert.equal('publicKey' in warning, false);
  assert.equal((await controller.revokeHostKey(warning.host, warning.port)).ok, true);
  assert.deepEqual(trust.revoked, [{ host: 'server.example.net', port: 22 }]);
  await controller.dispose();
});
