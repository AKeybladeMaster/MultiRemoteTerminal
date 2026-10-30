import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { WriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { Writable } from 'node:stream';
import { createSshSessionLogWriter, SSH_SESSION_LOG_MAX_FILE_BYTES } from '../../apps/desktop/src/adapters/ssh-session-log-writer.ts';
import { createSshTerminalController, SshTerminalProviderError } from '../../packages/application/src/ssh-terminals.ts';
import type { SshAuthenticationCredentials, SshPrivateKeySelection, SshTerminalProvider } from '../../packages/application/src/ssh-terminals.ts';
import type { SshX11Display, SshX11DisplayProvider } from '../../packages/application/src/ssh-x11-display.ts';
import type { CredentialPrompt, CredentialPromptCancellation, CredentialPromptResult } from '../../packages/application/src/credential-prompt.ts';
import type { HostTrustManager, HostTrustDecision, HostTrustResolution } from '../../packages/application/src/host-trust.ts';
import type { HostKeyEvidence, SshHostEndpoint } from '../../packages/domain/src/host-trust.ts';
import type { LocalTerminalEvent } from '../../packages/application/src/local-terminals.ts';
import type { CancellationSignal } from '../../packages/application/src/cancellation.ts';
import type { FileTransferProgress, FileTransferResult } from '../../packages/domain/src/file-transfer.ts';

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
  readonly inspected: SshHostEndpoint[] = [];
  cancellationLookup = false;
  inspectionStarted: (() => void) | undefined;
  inspectionCancellation: CredentialPromptCancellation | undefined;
  decision: HostTrustDecision = { kind: 'approval-required', challenge: {
    token: 'ssh-host-approval-token-0001', host: 'server.example.net', port: 22,
    algorithm: evidence.algorithm, fingerprint: evidence.fingerprint
  } };
  private readonly resolvers = new Map<string, (value: HostTrustResolution) => void>();

  async inspect(endpoint: unknown, evidence: unknown, cancellation?: CredentialPromptCancellation) {
    void evidence;
    if (typeof endpoint === 'object' && endpoint !== null && 'host' in endpoint && 'port' in endpoint) {
      this.inspected.push({ host: String(endpoint.host), port: Number(endpoint.port) });
    }
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
  readonly opened: Array<{ readonly sessionId: string; readonly endpoint: SshHostEndpoint; readonly credentials: SshAuthenticationCredentials;
    readonly x11Display?: SshX11Display }> = [];
  readonly privateKeyCopies: Buffer[] = [];
  readonly privateKeyPassphrases: string[] = [];
  readonly agentMethods: string[] = [];
  readonly passwords: string[] = [];
  readonly gatewayRoutes: SshHostEndpoint[][] = [];
  readonly gatewayCredentialRefs: Array<{ username: string; password: string }> = [];
  readonly closed: string[] = [];
  readonly listeners = new Set<(event: LocalTerminalEvent) => void>();
  readonly listedDirectories: Array<{ readonly sessionId: string; readonly path: string; readonly cancellation?: CancellationSignal }> = [];
  openError: Error | undefined;
  waitForDirectoryCancellation = false;
  directoryError: Error | undefined;
  directoryListStarted: (() => void) | undefined;
  waitForTransferCancellation = false;
  transferStarted: (() => void) | undefined;
  readonly transferCancellations: Array<CancellationSignal | undefined> = [];

  async open(session: string, endpoint: SshHostEndpoint, credentials: SshAuthenticationCredentials, _size: { columns: number; rows: number },
    verifyHost: (endpoint: SshHostEndpoint, evidence: HostKeyEvidence) => Promise<boolean>,
    gatewayHops: readonly { readonly endpoint: SshHostEndpoint; readonly credentials: { username: string; password: string } }[] = [],
    x11Display?: SshX11Display) {
    this.opened.push({ sessionId: session, endpoint, credentials, ...(x11Display ? { x11Display } : {}) });
    if ('privateKey' in credentials) {
      this.privateKeyCopies.push(Buffer.from(credentials.privateKey));
      this.privateKeyPassphrases.push(credentials.passphrase);
    } else if ('method' in credentials) this.agentMethods.push(credentials.method);
    else this.passwords.push(credentials.password);
    this.gatewayRoutes.push(gatewayHops.map(hop => ({ ...hop.endpoint })));
    this.gatewayCredentialRefs.push(...gatewayHops.map(hop => hop.credentials));
    for (const hop of gatewayHops) if (!await verifyHost(hop.endpoint, evidence)) throw new Error('Gateway host verification failed');
    if (!await verifyHost(endpoint, evidence)) throw new Error('Host verification failed');
    if (this.openError) throw this.openError;
  }
  async openFiles(session: string, endpoint: SshHostEndpoint, credentials: SshAuthenticationCredentials,
    verifyHost: (endpoint: SshHostEndpoint, evidence: HostKeyEvidence) => Promise<boolean>,
    gatewayHops: readonly { readonly endpoint: SshHostEndpoint; readonly credentials: { username: string; password: string } }[] = []) {
    this.opened.push({ sessionId: session, endpoint, credentials });
    if ('privateKey' in credentials) {
      this.privateKeyCopies.push(Buffer.from(credentials.privateKey));
      this.privateKeyPassphrases.push(credentials.passphrase);
    } else if ('method' in credentials) this.agentMethods.push(credentials.method);
    else this.passwords.push(credentials.password);
    this.gatewayRoutes.push(gatewayHops.map(hop => ({ ...hop.endpoint })));
    this.gatewayCredentialRefs.push(...gatewayHops.map(hop => hop.credentials));
    for (const hop of gatewayHops) if (!await verifyHost(hop.endpoint, evidence)) throw new Error('Gateway host verification failed');
    if (!await verifyHost(endpoint, evidence)) throw new Error('Host verification failed');
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
  async uploadRemoteFile(session: string, operationId: string, _localPath: string, _directory: string, fileName: string,
    _policy: 'overwrite' | 'rename' | 'skip', cancellation?: CancellationSignal, onProgress?: (progress: FileTransferProgress) => void): Promise<FileTransferResult> {
    this.transferCancellations.push(cancellation);
    if (this.waitForTransferCancellation && cancellation) {
      await new Promise<void>((_resolve, reject) => {
        const cancel = () => { cancellation.removeEventListener('abort', cancel); reject(new SshTerminalProviderError('CANCELLED')); };
        cancellation.addEventListener('abort', cancel, { once: true });
        if (cancellation.aborted) cancel();
        this.transferStarted?.();
      });
    }
    onProgress?.({ sessionId: session, operationId, direction: 'upload', phase: 'transferring', fileName, bytesTransferred: 0, totalBytes: 0 });
    return { direction: 'upload' as const, fileName, bytesTransferred: 4, state: 'completed' as const };
  }
  async downloadRemoteFile(_session: string, _operationId: string, remotePath: string): Promise<FileTransferResult> {
    return { direction: 'download' as const, fileName: remotePath.slice(remotePath.lastIndexOf('/') + 1), bytesTransferred: 4, state: 'completed' as const };
  }
  async readRemoteTextFile(session: string, operationId: string, remotePath: string, _cancellation?: CancellationSignal,
    onProgress?: (progress: FileTransferProgress) => void) {
    const content = 'first line\n';
    onProgress?.({ sessionId: session, operationId, direction: 'download', phase: 'transferring',
      fileName: remotePath.slice(remotePath.lastIndexOf('/') + 1), bytesTransferred: Buffer.byteLength(content), totalBytes: Buffer.byteLength(content) });
    return { path: remotePath, content, revision: 'a'.repeat(64), bytes: Buffer.byteLength(content) };
  }
  async saveRemoteTextFile(session: string, operationId: string, remotePath: string, content: string, _expectedRevision: string,
    _cancellation?: CancellationSignal, onProgress?: (progress: FileTransferProgress) => void) {
    onProgress?.({ sessionId: session, operationId, direction: 'upload', phase: 'committing',
      fileName: remotePath.slice(remotePath.lastIndexOf('/') + 1), bytesTransferred: Buffer.byteLength(content), totalBytes: Buffer.byteLength(content) });
    return { path: remotePath, revision: 'b'.repeat(64), bytesSaved: Buffer.byteLength(content) };
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

test('standalone SFTP reuses SSH credentials and host trust without exposing terminal operations', async () => {
  const provider = new FakeProvider();
  const trust = new FakeTrust();
  trust.decision = { kind: 'trusted' };
  const controller = createSshTerminalController(provider, promptWith({ kind: 'provided', username: 'alice', secret: 'temporary' }), trust);

  assert.deepEqual(await controller.openFiles(sessionId, 'Server.Example.Net.', 22), {
    ok: true, result: { sessionId, endpoint: { host: 'server.example.net', port: 22 }, state: 'running' }
  });
  assert.equal(provider.opened.length, 1);
  assert.equal((await controller.listRemoteDirectory(sessionId, '.')).ok, true);
  assert.deepEqual(await controller.write(sessionId, 'id'), { ok: false, error: { code: 'NOT_FOUND', target: 'terminal', retryable: false } });
  assert.deepEqual(await controller.resize(sessionId, { columns: 80, rows: 24 }), { ok: false, error: { code: 'NOT_FOUND', target: 'terminal', retryable: false } });
  assert.equal((await controller.close(sessionId)).ok, true);
  assert.deepEqual(provider.closed, [sessionId]);
  await controller.dispose();
});

test('SFTP text editing uses a bounded cancellable operation on a running trusted session', async () => {
  const provider = new FakeProvider();
  const trust = new FakeTrust();
  trust.decision = { kind: 'trusted' };
  const controller = createSshTerminalController(provider, promptWith({ kind: 'provided', username: 'alice', secret: 'temporary' }), trust);
  const remotePath = '/home/alice/config.txt';
  const operationId = '22222222-2222-4222-8222-222222222222';
  assert.equal((await controller.openFiles(sessionId, 'server.example.net', 22)).ok, true);
  const progress: FileTransferProgress[] = [];
  const read = await controller.readRemoteTextFile(sessionId, operationId, remotePath, undefined, event => progress.push(event));
  assert.deepEqual(read, { ok: true, result: { path: remotePath, content: 'first line\n', revision: 'a'.repeat(64), bytes: 11 } });
  assert.equal(progress[0]?.direction, 'download');
  const saved = await controller.saveRemoteTextFile(sessionId, operationId, remotePath, 'updated\n', 'a'.repeat(64), undefined,
    event => progress.push(event));
  assert.deepEqual(saved, { ok: true, result: { path: remotePath, revision: 'b'.repeat(64), bytesSaved: 8 } });
  assert.equal(progress.at(-1)?.phase, 'committing');
  assert.equal((await controller.readRemoteTextFile(sessionId, '33333333-3333-4333-8333-333333333333', '/', undefined)).ok, false);
  assert.equal((await controller.saveRemoteTextFile(sessionId, '44444444-4444-4444-8444-444444444444', remotePath, 'bad\0text', 'a'.repeat(64))).ok, false);
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

test('SFTP controller scopes cancellation by operation and waits for transfer cleanup before closing SSH', async () => {
  const provider = new FakeProvider();
  provider.waitForTransferCancellation = true;
  const trust = new FakeTrust();
  trust.decision = { kind: 'trusted' };
  const controller = createSshTerminalController(provider, promptWith({ kind: 'provided', username: 'alice', secret: 'temporary' }), trust);
  assert.equal((await controller.open(sessionId, 'server.example.net', 22, { columns: 80, rows: 24 })).ok, true);

  const firstOperation = '22222222-2222-4222-8222-222222222222';
  let signalStarted!: () => void;
  const firstStarted = new Promise<void>(resolve => { signalStarted = resolve; });
  provider.transferStarted = signalStarted;
  const first = controller.uploadRemoteFile(sessionId, firstOperation, 'C:\\private\\report.txt', '/home/alice', 'report.txt', 'rename');
  await firstStarted;
  assert.equal(provider.transferCancellations[0]?.aborted, false);
  const cancelled = await controller.cancelTransfer(sessionId, firstOperation);
  assert.equal(cancelled.ok, true);
  const firstResult = await first;
  assert.equal(firstResult.ok, false);
  if (!firstResult.ok) assert.equal(firstResult.error.code, 'CANCELLED');

  const secondOperation = '33333333-3333-4333-8333-333333333333';
  let closeStarted!: () => void;
  const secondStarted = new Promise<void>(resolve => { closeStarted = resolve; });
  provider.transferStarted = closeStarted;
  const second = controller.uploadRemoteFile(sessionId, secondOperation, 'C:\\private\\report.txt', '/home/alice', 'report.txt', 'rename');
  await secondStarted;
  const closing = controller.close(sessionId);
  const secondResult = await second;
  assert.equal(secondResult.ok, false);
  if (!secondResult.ok) assert.equal(secondResult.error.code, 'CANCELLED');
  assert.equal((await closing).ok, true);
  assert.deepEqual(provider.closed, [sessionId]);
  await controller.dispose();
});

function promptWith(result: CredentialPromptResult, contexts?: string[]): CredentialPrompt {
  return { prompt: async (_purpose, _signal, context) => { if (context) contexts?.push(context); return result; } };
}

test('saved SSH credentials bypass the native prompt and the application clears its credential object', async () => {
  const provider = new FakeProvider();
  const trust = new FakeTrust();
  trust.decision = { kind: 'trusted' };
  const prompts: string[] = [];
  const controller = createSshTerminalController(provider, promptWith({ kind: 'provided', username: 'unexpected', secret: 'unexpected' }, prompts), trust);
  const credential = { username: 'alice', password: 'saved-secret' };

  const result = await controller.open(sessionId, 'server.example.net', 22, { columns: 80, rows: 24 }, [], { method: 'password', savedCredentials: credential });

  assert.equal(result.ok, true);
  assert.deepEqual(prompts, []);
  const savedAuthentication = provider.opened[0]?.credentials;
  assert.ok(savedAuthentication && 'password' in savedAuthentication);
  assert.deepEqual(provider.passwords, ['saved-secret']);
  assert.ok(savedAuthentication && 'password' in savedAuthentication);
  if (savedAuthentication && 'password' in savedAuthentication) assert.equal(savedAuthentication.password, '');
  assert.deepEqual(credential, { username: '', password: '' });
  await controller.dispose();
});

test('SSH private-key auth uses the protected passphrase prompt and clears selected key material after open', async () => {
  const provider = new FakeProvider();
  const trust = new FakeTrust();
  trust.decision = { kind: 'trusted' };
  const prompts: string[] = [];
  const prompt: CredentialPrompt = { async prompt(purpose, _signal, context) {
    prompts.push(`${purpose}:${context ?? ''}`);
    return { kind: 'provided', username: 'alice', secret: 'private-key-passphrase' };
  } };
  const controller = createSshTerminalController(provider, prompt, trust);
  const selectedKey: SshPrivateKeySelection = { data: Buffer.from('temporary-private-key-bytes'), fileName: 'id_ed25519' };
  const expectedKey = Buffer.from(selectedKey.data);

  const result = await controller.open(sessionId, 'server.example.net', 22, { columns: 80, rows: 24 }, [],
    { method: 'private-key', privateKey: selectedKey });

  assert.equal(result.ok, true);
  assert.match(prompts[0] ?? '', /^ssh-key-passphrase:/u);
  assert.match(prompts[0] ?? '', /Selected key: id_ed25519/u);
  assert.deepEqual(provider.privateKeyCopies[0], expectedKey);
  assert.deepEqual(provider.privateKeyPassphrases, ['private-key-passphrase']);
  const credentials = provider.opened[0]?.credentials;
  assert.ok(credentials && 'privateKey' in credentials);
  if (credentials && 'privateKey' in credentials) {
    assert.deepEqual([...credentials.privateKey], new Array(selectedKey.data.length).fill(0));
    assert.equal(credentials.username, '');
    assert.equal(credentials.passphrase, '');
  }
  assert.deepEqual([...selectedKey.data], new Array(selectedKey.data.length).fill(0));
  await controller.dispose();
});

test('standalone SFTP accepts private-key credentials through the protected prompt', async () => {
  const provider = new FakeProvider();
  const trust = new FakeTrust();
  trust.decision = { kind: 'trusted' };
  const controller = createSshTerminalController(provider,
    promptWith({ kind: 'provided', username: 'alice', secret: 'private-key-passphrase' }), trust);
  const selectedKey: SshPrivateKeySelection = { data: Buffer.from('temporary-sftp-private-key'), fileName: 'id_ed25519' };

  const result = await controller.openFiles(sessionId, 'server.example.net', 22, { method: 'private-key', privateKey: selectedKey });

  assert.equal(result.ok, true);
  const credentials = provider.opened[0]?.credentials;
  assert.ok(credentials && 'privateKey' in credentials);
  if (credentials && 'privateKey' in credentials) {
    assert.deepEqual(provider.privateKeyCopies[0], Buffer.from('temporary-sftp-private-key'));
    assert.equal(provider.privateKeyPassphrases[0], 'private-key-passphrase');
    assert.deepEqual([...credentials.privateKey], new Array(selectedKey.data.length).fill(0));
  }
  assert.deepEqual([...selectedKey.data], new Array(selectedKey.data.length).fill(0));
  await controller.dispose();
});

test('SSH private-key bytes are cleared when controller validation rejects the open request', async () => {
  const provider = new FakeProvider();
  const controller = createSshTerminalController(provider,
    promptWith({ kind: 'provided', username: 'alice', secret: 'private-key-passphrase' }), new FakeTrust());
  const selectedKey: SshPrivateKeySelection = { data: Buffer.from('temporary-private-key-bytes'), fileName: 'id_ed25519' };

  const result = await controller.open('invalid-session-id', 'server.example.net', 22,
    { columns: 80, rows: 24 }, [], { method: 'private-key', privateKey: selectedKey });

  assert.deepEqual(result, { ok: false, error: { code: 'INVALID_REQUEST', target: 'application', retryable: false } });
  assert.deepEqual([...selectedKey.data], new Array(selectedKey.data.length).fill(0));
  assert.deepEqual(provider.opened, []);
  await controller.dispose();
});

test('SSH agent authentication asks only for a username and passes an agent credential without OS endpoint details', async () => {
  const provider = new FakeProvider();
  const trust = new FakeTrust();
  trust.decision = { kind: 'trusted' };
  const prompts: string[] = [];
  const controller = createSshTerminalController(provider, {
    async prompt(purpose, _signal, context) {
      prompts.push(`${purpose}:${context ?? ''}`);
      return { kind: 'provided', username: 'alice', secret: '' };
    }
  }, trust);
  const selection = { method: 'agent' as const };

  const opened = await controller.open(sessionId, 'server.example.net', 22, { columns: 80, rows: 24 }, [], selection);

  assert.equal(opened.ok, true);
  assert.deepEqual(prompts, ['ssh-agent-username:SSH destination: server.example.net:22']);
  assert.deepEqual(provider.agentMethods, ['agent']);
  const credentials = provider.opened[0]?.credentials;
  assert.ok(credentials && 'method' in credentials);
  if (credentials && 'method' in credentials) {
    assert.equal(credentials.method, 'agent');
    assert.equal(credentials.username, '');
  }
  const invalidSelection = { method: 'agent' as const, socketPath: String.raw`C:\Users\alice\agent.sock` };
  const invalidPath = await controller.openFiles('22222222-2222-4222-8222-222222222222', 'server.example.net', 22,
    invalidSelection);
  assert.equal(invalidPath.ok, false);
  assert.deepEqual(provider.agentMethods, ['agent']);
  await controller.dispose();
});

test('SSH three-gateway routes prompt and verify every gateway and destination in route order', async () => {
  const gatewayOne = { host: 'gateway-one.example.net', port: 2201 };
  const gatewayTwo = { host: 'gateway-two.example.net', port: 2202 };
  const gatewayThree = { host: 'gateway-three.example.net', port: 2203 };
  const destination = { host: 'target.example.net', port: 22 };
  const prompts: string[] = [];
  const provider = new FakeProvider();
  const trust = new FakeTrust();
  trust.decision = { kind: 'trusted' };
  const controller = createSshTerminalController(provider, promptWith({ kind: 'provided', username: 'alice', secret: 'operation-secret' }, prompts), trust);

  const opened = await controller.open(sessionId, destination.host, destination.port, { columns: 80, rows: 24 },
    [gatewayOne, gatewayTwo, gatewayThree]);

  assert.equal(opened.ok, true);
  assert.deepEqual(prompts, ['Gateway 1: gateway-one.example.net:2201', 'Gateway 2: gateway-two.example.net:2202',
    'Gateway 3: gateway-three.example.net:2203',
    'SSH destination: target.example.net:22']);
  assert.deepEqual(provider.gatewayRoutes, [[gatewayOne, gatewayTwo, gatewayThree]]);
  assert.deepEqual(trust.inspected, [gatewayOne, gatewayTwo, gatewayThree, destination]);
  assert.ok(provider.gatewayCredentialRefs.every(credentials => credentials.username === '' && credentials.password === ''),
    'gateway credentials are cleared after the operation');
  await controller.dispose();
});

test('SFTP-only gateway routes verify each hop without opening a shell and clear hop credentials', async () => {
  const gateway = { host: 'gateway.example.net', port: 2201 };
  const destination = { host: 'files.example.net', port: 22 };
  const prompts: string[] = [];
  const provider = new FakeProvider();
  const trust = new FakeTrust();
  trust.decision = { kind: 'trusted' };
  const controller = createSshTerminalController(provider,
    promptWith({ kind: 'provided', username: 'alice', secret: 'operation-secret' }, prompts), trust);

  const opened = await controller.openFiles(sessionId, destination.host, destination.port, undefined, [gateway]);

  assert.equal(opened.ok, true);
  assert.deepEqual(prompts, ['Gateway 1: gateway.example.net:2201', 'SSH destination: files.example.net:22']);
  assert.deepEqual(provider.gatewayRoutes, [[gateway]]);
  assert.deepEqual(trust.inspected, [gateway, destination]);
  assert.ok(provider.gatewayCredentialRefs.every(credentials => credentials.username === '' && credentials.password === ''),
    'gateway credentials are cleared after the operation');
  await controller.dispose();
});

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
  const authentication = provider.opened[0]?.credentials;
  assert.ok(authentication && 'password' in authentication);
  assert.deepEqual(provider.passwords, ['not-for-renderer']);
  if (authentication && 'password' in authentication) assert.equal(authentication.password, '');
  assert.equal(JSON.stringify({ opened, challenge }).includes('not-for-renderer'), false,
    'SSH credentials stay out of the session result and host-trust challenge');
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

test('SSH activity exposes lifecycle and terminal I/O without credential values', async () => {
  const provider = new FakeProvider();
  const trust = new FakeTrust();
  trust.decision = { kind: 'trusted' };
  const controller = createSshTerminalController(provider, promptWith({ kind: 'provided', username: 'private-user', secret: 'private-password' }), trust);
  const activity: Array<{ type: string; [key: string]: unknown }> = [];
  controller.subscribeActivity(event => activity.push(event));

  assert.equal((await controller.open(sessionId, 'server.example.net', 22, { columns: 80, rows: 24 })).ok, true);
  assert.equal((await controller.write(sessionId, 'id\n')).ok, true);
  assert.equal((await controller.resize(sessionId, { columns: 100, rows: 30 })).ok, true);
  for (const listener of provider.listeners) listener({ kind: 'data', sessionId, sequence: 1, data: 'remote output\n' });
  assert.equal((await controller.close(sessionId)).ok, true);

  assert.deepEqual(activity.map(event => event.type), [
    'credential-prompt-started', 'credential-prompt-finished', 'transport', 'host-trust', 'transport',
    'terminal-input', 'terminal-resize', 'terminal-output', 'session-closed'
  ]);
  assert.equal(activity.some(event => event.data === 'id\n'), true);
  assert.equal(activity.some(event => event.data === 'remote output\n'), true);
  const serialized = JSON.stringify(activity);
  assert.equal(serialized.includes('private-user'), false);
  assert.equal(serialized.includes('private-password'), false);
  await controller.dispose();
});

test('SSH transport activity records only an allowlisted network failure category', async () => {
  const provider = new FakeProvider();
  const privateRawMessage = 'getaddrinfo ENOTFOUND internal-host.private.example';
  provider.openError = Object.assign(new SshTerminalProviderError('UNAVAILABLE'), {
    message: privateRawMessage,
    networkFailure: 'DNS_LOOKUP_FAILED'
  });
  const trust = new FakeTrust();
  trust.decision = { kind: 'trusted' };
  const controller = createSshTerminalController(provider,
    promptWith({ kind: 'provided', username: 'private-user', secret: 'private-password' }), trust);
  const activity: Array<{ type: string; [key: string]: unknown }> = [];
  controller.subscribeActivity(event => activity.push(event));

  const result = await controller.open(sessionId, 'server.example.net', 22, { columns: 80, rows: 24 });

  assert.equal(result.ok, false);
  assert.deepEqual(activity.find(event => event.type === 'transport' && event.outcome === 'failed'), {
    type: 'transport', sessionId, outcome: 'failed', code: 'UNAVAILABLE', networkFailure: 'DNS_LOOKUP_FAILED'
  });
  const serialized = JSON.stringify(activity);
  assert.equal(serialized.includes(privateRawMessage), false);
  assert.equal(serialized.includes('private-user'), false);
  assert.equal(serialized.includes('private-password'), false);
  await controller.dispose();
});

test('SSH worker failure is surfaced as a transport failure and ends that runtime session', async () => {
  const provider = new FakeProvider();
  const trust = new FakeTrust();
  trust.decision = { kind: 'trusted' };
  const controller = createSshTerminalController(provider, promptWith({ kind: 'provided', username: 'alice', secret: 'temporary' }), trust);
  const activity: Array<{ type: string; [key: string]: unknown }> = [];
  const terminalEvents: LocalTerminalEvent[] = [];
  controller.subscribeActivity(event => activity.push(event));
  controller.subscribe(event => terminalEvents.push(event));

  assert.equal((await controller.open(sessionId, 'server.example.net', 22, { columns: 80, rows: 24 })).ok, true);
  for (const listener of provider.listeners) {
    listener({ kind: 'failure', sessionId, error: { code: 'UNAVAILABLE', target: 'terminal', retryable: true } });
  }

  assert.deepEqual(activity.at(-1), { type: 'connection-failed', sessionId, phase: 'transport', code: 'UNAVAILABLE' });
  assert.deepEqual(terminalEvents.at(-1), { kind: 'failure', sessionId, error: { code: 'UNAVAILABLE', target: 'terminal', retryable: true } });
  assert.equal((await controller.write(sessionId, 'echo after crash\n')).ok, false);
  await controller.dispose();
});

test('SSH credential prompt timeout is logged as its own phase', async () => {
  const provider = new FakeProvider();
  const controller = createSshTerminalController(provider, promptWith({ kind: 'timeout' }), new FakeTrust());
  const activity: Array<{ type: string; [key: string]: unknown }> = [];
  controller.subscribeActivity(event => activity.push(event));

  const result = await controller.open(sessionId, 'server.example.net', 22, { columns: 80, rows: 24 });

  assert.equal(result.ok, false);
  assert.deepEqual(activity.slice(-1)[0], {
    type: 'connection-failed', sessionId, phase: 'credential-prompt', code: 'TIMEOUT'
  });
  assert.equal(provider.opened.length, 0);
  await controller.dispose();
});

test('SSH log disk-full error reports stopped recording without closing or blocking the live session', async () => {
  const provider = new FakeProvider();
  const trust = new FakeTrust();
  trust.decision = { kind: 'trusted' };
  let resolveStatus: ((status: unknown) => void) | undefined;
  const stopped = new Promise<unknown>(resolveStatusPromise => { resolveStatus = resolveStatusPromise; });
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      if (chunk.toString().includes('"type":"terminal-output"')) {
        callback(Object.assign(new Error('disk full'), { code: 'ENOSPC' }));
      } else callback();
    }
  }) as unknown as WriteStream;
  queueMicrotask(() => stream.emit('open', 0));
  const logWriter = createSshSessionLogWriter(status => resolveStatus?.(status), SSH_SESSION_LOG_MAX_FILE_BYTES, () => stream);
  const controller = createSshTerminalController(provider, promptWith({ kind: 'provided', username: 'alice', secret: 'temporary' }), trust);
  const terminalEvents: LocalTerminalEvent[] = [];
  controller.subscribe(event => terminalEvents.push(event));
  controller.subscribeActivity(event => logWriter.append(event));

  try {
    assert.equal((await logWriter.start(sessionId, resolve('.tmp', 'ssh-session-log-enospc.log'), [{ host: 'server.example.net', port: 22 }])).ok, true);
    assert.equal((await controller.open(sessionId, 'server.example.net', 22, { columns: 80, rows: 24 })).ok, true);
    for (const listener of provider.listeners) listener({ kind: 'data', sessionId, sequence: 1, data: 'first output' });

    assert.deepEqual(await stopped, { sessionId, status: 'stopped', reason: 'write-error', fileName: 'ssh-session-log-enospc.log' });
    for (const listener of provider.listeners) listener({ kind: 'data', sessionId, sequence: 2, data: 'later output' });
    assert.equal((await controller.write(sessionId, 'echo still-connected\n')).ok, true);
    assert.equal(terminalEvents.filter(event => event.kind === 'data').length, 2);
    assert.deepEqual(provider.closed, []);
  } finally {
    await logWriter.closeAll();
    await controller.dispose();
  }
});

test('SSH X11 display is passed only to opted-in terminal sessions and wiped on close and open failure', async () => {
  const trust = new FakeTrust();
  trust.decision = { kind: 'trusted' };
  const display: SshX11Display = { display: 123, cookie: new Uint8Array(16).fill(7), socatExecutable: String.raw`C:\cygwin64\usr\bin\socat.exe`,
    extensions: { glx: true, composite: false, randr: true } };
  const closed: string[] = [];
  const displayProvider: SshX11DisplayProvider = {
    async open() { return display; },
    async close(id) { closed.push(id); },
    async closeAll() {}
  };
  const provider = new FakeProvider();
  const controller = createSshTerminalController(provider, promptWith({ kind: 'provided', username: 'alice', secret: 'temporary' }), trust, displayProvider);

  const opened = await controller.open(sessionId, 'server.example.net', 22, { columns: 80, rows: 24 }, [], undefined, true);
  assert.equal(opened.ok, true);
  if (opened.ok) assert.deepEqual(opened.result.x11Extensions, display.extensions);
  assert.equal(provider.opened[0]?.x11Display?.display, 123);
  assert.equal(provider.opened[0]?.x11Display?.cookie, display.cookie);
  assert.deepEqual(await controller.close(sessionId), { ok: true, result: {} });
  assert.deepEqual(closed, [sessionId]);
  assert.deepEqual(display.cookie, new Uint8Array(16), 'app-owned cookie bytes are zeroed after close');
  await controller.dispose();

  const failingProvider = new FakeProvider();
  failingProvider.openError = new Error('simulated transport failure');
  const failingDisplay: SshX11Display = { display: 124, cookie: new Uint8Array(16).fill(9), socatExecutable: display.socatExecutable };
  const failedDisplayProvider: SshX11DisplayProvider = {
    async open() { return failingDisplay; },
    async close(id) { closed.push(id); },
    async closeAll() {}
  };
  const failingController = createSshTerminalController(failingProvider, promptWith({ kind: 'provided', username: 'alice', secret: 'temporary' }),
    trust, failedDisplayProvider);
  assert.equal((await failingController.open(sessionId, 'server.example.net', 22, { columns: 80, rows: 24 }, [], undefined, true)).ok, false);
  assert.deepEqual(failingDisplay.cookie, new Uint8Array(16), 'failed SSH startup also clears the cookie');
  assert.deepEqual(closed, [sessionId, sessionId]);
  await failingController.dispose();
});
