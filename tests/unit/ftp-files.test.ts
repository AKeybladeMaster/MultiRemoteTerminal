import test from 'node:test';
import assert from 'node:assert/strict';
import { createFtpFilesController, FtpFilesProviderError } from '../../packages/application/src/ftp-files.ts';
import type { FtpFilesProvider } from '../../packages/application/src/ftp-files.ts';
import type { CredentialPrompt, CredentialPromptPurpose, CredentialPromptResult } from '../../packages/application/src/credential-prompt.ts';
import { canonicalizeFtpEndpoint, isCanonicalFtpEndpoint, isFtpCommandArgument, isFtpRemotePath } from '../../packages/domain/src/ftp.ts';
import { isRemotePath } from '../../packages/domain/src/remote-files.ts';
import { createFtpTransportProvider } from '../../apps/desktop/src/workers/ftp-transport-provider.ts';
import type { FtpLibraryClient } from '../../apps/desktop/src/workers/ftp-transport-provider.ts';
import { parseFtpWorkerInput, parseFtpWorkerMessage } from '../../apps/desktop/src/workers/ftp-worker-protocol.ts';

const sessionId = '18f2f903-7b6f-4c8d-9c42-b63a58c4b087';
const requestId = '11111111-1111-4111-8111-111111111111';

test('FTP controller validates endpoints, prompts separately, wipes credential references, and owns lifecycle', async () => {
  let purpose: CredentialPromptPurpose | undefined;
  let providerCredentials: { username: string; password: string } | undefined;
  const calls: string[] = [];
  const provider: FtpFilesProvider = {
    async open(id, endpoint, credentials) {
      calls.push(`open:${id}:${endpoint.host}:${endpoint.port}:${endpoint.secure}`);
      providerCredentials = credentials;
    },
    async listDirectory(id, path) { calls.push(`list:${id}:${path}`); return { path, entries: [], truncated: false }; },
    async close(id) { calls.push(`close:${id}`); },
    async shutdown() { calls.push('shutdown'); }
  };
  const prompt: CredentialPrompt = { async prompt(inputPurpose): Promise<CredentialPromptResult> {
    purpose = inputPurpose;
    return { kind: 'provided', username: 'alice', secret: 'temporary-secret' };
  } };
  const controller = createFtpFilesController(provider, prompt);
  assert.deepEqual(canonicalizeFtpEndpoint({ host: 'Files.Example.net.', port: 2121, secure: true }),
    { host: 'files.example.net', port: 2121, secure: true });
  assert.equal(isCanonicalFtpEndpoint({ host: 'Files.Example.net.', port: 2121, secure: true }), false);
  const opened = await controller.open(sessionId, 'Files.Example.net.', 2121, true);
  assert.deepEqual(opened, { ok: true, result: { sessionId, endpoint: { host: 'files.example.net', port: 2121, secure: true }, state: 'running' } });
  assert.equal(purpose, 'ftp-account');
  assert.deepEqual(providerCredentials, { username: '', password: '' }, 'controller clears the provider credential object after login');
  assert.deepEqual(await controller.listDirectory(sessionId, '/home'), { ok: true, result: { path: '/home', entries: [], truncated: false } });
  assert.deepEqual(await controller.close(sessionId), { ok: true, result: {} });
  await controller.dispose();
  assert.deepEqual(calls, [
    `open:${sessionId}:files.example.net:2121:true`, `list:${sessionId}:/home`, `close:${sessionId}`, 'shutdown'
  ]);
});

test('FTP controller cancellation and invalid prompt data never reach the network provider', async () => {
  let opens = 0;
  const provider: FtpFilesProvider = {
    async open() { opens++; }, async listDirectory() { return { path: '/', entries: [], truncated: false }; },
    async close() {}, async shutdown() {}
  };
  const cancelled: CredentialPrompt = { async prompt() { return { kind: 'cancelled' }; } };
  const cancelledController = createFtpFilesController(provider, cancelled);
  assert.equal((await cancelledController.open(sessionId, 'ftp.example.net', 21, false)).ok, false);
  await cancelledController.dispose();

  const malformed: CredentialPrompt = { async prompt() { return { kind: 'provided', username: 7, secret: 'secret' } as unknown as CredentialPromptResult; } };
  const malformedController = createFtpFilesController(provider, malformed);
  assert.deepEqual(await malformedController.open(sessionId, 'ftp.example.net', 21, false), {
    ok: false, error: { code: 'INVALID_REQUEST', target: 'application', retryable: false }
  });
  assert.equal(opens, 0);
  await malformedController.dispose();

  for (const invalidCredentials of [
    { username: 'alice\r\nDELE important', secret: 'secret' },
    { username: 'alice', secret: 'secret\nQUIT' }
  ]) {
    const injected: CredentialPrompt = { async prompt() { return { kind: 'provided', ...invalidCredentials }; } };
    const controller = createFtpFilesController(provider, injected);
    assert.equal((await controller.open(sessionId, 'ftp.example.net', 21, false)).ok, false);
    await controller.dispose();
  }
  assert.equal(opens, 0, 'line breaks in FTP credentials must be rejected before opening a network client');
});

test('FTP protocol arguments reject line and control characters while shared SFTP paths retain their own rules', () => {
  for (const control of ['\r', '\n', '\t', '\u007f', '\u0085']) {
    assert.equal(isFtpCommandArgument(`user${control}QUIT`), false);
    assert.equal(isFtpRemotePath(`/home${control}DELE important`), false);
  }
  assert.equal(isFtpRemotePath('/home/alice'), true);
  assert.equal(isRemotePath('/home\r\nDELE important'), true);
});

test('FTP shutdown cancels an open blocked in the native credential prompt', async () => {
  let providerOpens = 0;
  const provider: FtpFilesProvider = {
    async open() { providerOpens++; }, async listDirectory() { return { path: '/', entries: [], truncated: false }; },
    async close() {}, async shutdown() {}
  };
  const prompt: CredentialPrompt = { async prompt(_purpose, signal) {
    return new Promise<CredentialPromptResult>(resolve => signal?.addEventListener('abort', () => resolve({ kind: 'cancelled' }), { once: true }));
  } };
  const controller = createFtpFilesController(provider, prompt);
  const opening = controller.open(sessionId, 'ftp.example.net', 21, false);
  await new Promise<void>(resolve => setImmediate(resolve));
  await controller.closeAll();
  assert.deepEqual(await opening, { ok: false, error: { code: 'CANCELLED', target: 'application', retryable: false } });
  assert.equal(providerOpens, 0);
  await controller.dispose();
});

test('cancelling an FTP listing releases its now-closed connection from controller and provider state', async () => {
  let closes = 0;
  const provider: FtpFilesProvider = {
    async open() {},
    async listDirectory() { throw new FtpFilesProviderError('CANCELLED'); },
    async close() { closes++; }, async shutdown() {}
  };
  const prompt: CredentialPrompt = { async prompt() { return { kind: 'provided', username: 'alice', secret: 'secret' }; } };
  const controller = createFtpFilesController(provider, prompt);
  assert.equal((await controller.open(sessionId, 'ftp.example.net', 21, false)).ok, true);
  assert.equal((await controller.listDirectory(sessionId, '/')).ok, false);
  assert.equal((await controller.listDirectory(sessionId, '/')).ok, false);
  assert.equal(closes, 1);
  await controller.dispose();
});

test('FTP transport bounds directory listings, maps metadata, and closes a cancelled operation', async () => {
  class FakeFtpClient implements FtpLibraryClient {
    readonly ftp = { verbose: true, log: (message: string) => { void message; } };
    closed = false;
    listing: { name: unknown; type: unknown; size: unknown; modifiedAt?: unknown }[] = [];
    accessOptions: unknown;
    pendingList: ((value: never) => void) | undefined;
    async access(options: unknown): Promise<void> { this.accessOptions = options; }
    list(): Promise<typeof this.listing> {
      if (!this.pendingList) return Promise.resolve(this.listing);
      return new Promise(resolve => { this.pendingList = resolve as (value: never) => void; });
    }
    close(): void {
      this.closed = true;
      this.pendingList?.([] as never);
    }
  }
  const clients: FakeFtpClient[] = [];
  let factoryOptions: unknown;
  const provider = createFtpTransportProvider((timeoutMs, options) => {
    assert.equal(timeoutMs, 30_000);
    factoryOptions = options;
    const client = new FakeFtpClient();
    clients.push(client);
    return client;
  }, () => false, { directory: 2, file: 1, symbolicLink: 3 });
  const credentials = { username: 'alice', password: 'temporary-secret' };
  await assert.rejects(provider.open('28f2f903-7b6f-4c8d-9c42-b63a58c4b087', { host: 'ftp.example.net', port: 21, secure: false },
    { username: 'alice', password: 'secret\r\nQUIT' }), error => (error as { code?: string }).code === 'INVALID_REQUEST');
  assert.equal(clients.length, 0, 'the transport must reject command controls before allocating a client');
  await provider.open(sessionId, { host: 'ftp.example.net', port: 21, secure: false }, credentials);
  assert.equal(clients[0]?.ftp.verbose, false);
  assert.deepEqual(factoryOptions, { allowSeparateTransferHost: false, maxListingBytes: 2 * 1024 * 1024 });
  assert.deepEqual(clients[0]?.accessOptions, { host: 'ftp.example.net', port: 21, user: 'alice', password: 'temporary-secret', secure: false });
  await assert.rejects(provider.listDirectory(sessionId, '/home\r\nDELE important'), error =>
    (error as { code?: string }).code === 'INVALID_REQUEST');
  clients[0]!.listing = Array.from({ length: 501 }, (_, index) => ({ name: `entry-${index}`, type: index === 1 ? 1 : index === 2 ? 3 : 2,
    size: index === 1 ? 17 : 0, modifiedAt: new Date(0) }));
  const listing = await provider.listDirectory(sessionId, '/home');
  assert.equal(listing.entries.length, 500);
  assert.equal(listing.truncated, true);
  assert.equal(listing.entries[0]?.kind, 'directory');
  assert.equal(listing.entries[1]?.kind, 'file');
  assert.equal(listing.entries[1]?.size, 17);
  assert.equal(listing.entries[2]?.kind, 'symlink');
  assert.equal(listing.entries[0]?.modifiedAt, 0);
  clients[0]!.listing = [
    { name: 'safe.txt', type: 1, size: 1 },
    { name: 'bad\r\nDELE important', type: 1, size: 2 }
  ];
  const safeListing = await provider.listDirectory(sessionId, '/home');
  assert.deepEqual(safeListing.entries.map(entry => entry.name), ['safe.txt']);
  await provider.close(sessionId);
  assert.equal(clients[0]?.closed, true);

  const cancellationClient = clients[0]!;
  cancellationClient.closed = false;
  cancellationClient.listing = [];
  // Use a second session/client whose pending listing resolves when close destroys its control/data sockets.
  const pendingProvider = createFtpTransportProvider(() => cancellationClient, () => false,
    { directory: 2, file: 1, symbolicLink: 3 });
  await pendingProvider.open('28f2f903-7b6f-4c8d-9c42-b63a58c4b087', { host: 'ftp.example.net', port: 21, secure: true }, credentials);
  cancellationClient.pendingList = (() => {}) as (value: never) => void;
  const abort = new AbortController();
  const pending = pendingProvider.listDirectory('28f2f903-7b6f-4c8d-9c42-b63a58c4b087', '/', abort.signal);
  abort.abort();
  await assert.rejects(pending, error => (error as { code?: string }).code === 'CANCELLED');
  assert.equal(cancellationClient.closed, true);
  await pendingProvider.shutdown();
});

test('FTP worker IPC rejects noncanonical, secret-bearing, and malformed messages', () => {
  const open = { version: 1, type: 'request', requestId, command: 'open', sessionId,
    endpoint: { host: 'ftp.example.net', port: 21, secure: false }, credentials: { username: 'alice', password: 'temporary-secret' } };
  assert.equal(parseFtpWorkerInput(open)?.type, 'request');
  assert.equal(parseFtpWorkerInput({ ...open, endpoint: { ...open.endpoint, extra: true } }), undefined);
  assert.equal(parseFtpWorkerInput({ ...open, requestId: { toString: () => requestId } }), undefined);
  assert.equal(parseFtpWorkerInput({ ...open, token: 'must not cross worker boundary' }), undefined);
  assert.equal(parseFtpWorkerInput({ ...open, credentials: { username: 'alice\r\nDELE file', password: 'secret' } }), undefined);
  assert.equal(parseFtpWorkerInput({ ...open, credentials: { username: 'alice', password: 'secret\nQUIT' } }), undefined);
  const list = { version: 1, type: 'request', requestId, command: 'files.list', sessionId, path: '/home' };
  assert.equal(parseFtpWorkerInput(list)?.type, 'request');
  assert.equal(parseFtpWorkerInput({ ...list, path: '/home\r\nDELE important' }), undefined);
  const listing = { path: '/', entries: [], truncated: false };
  assert.equal(parseFtpWorkerMessage({ version: 1, type: 'reply', requestId, ok: true, result: listing })?.type, 'reply');
  assert.equal(parseFtpWorkerMessage({ version: 1, type: 'reply', requestId, ok: true, result: {
    path: '/', entries: [{ name: 'safe\r\nDELE file', path: '/safe\r\nDELE file', kind: 'file', size: 1, modifiedAt: null }], truncated: false
  } }), undefined);
  assert.equal(parseFtpWorkerMessage({ version: 1, type: 'reply', requestId, ok: true, result: listing, secret: 'unexpected' }), undefined);
});

test('FTP controller retires unusable sessions after transport failures so they can be reopened', async () => {
  let closeCount = 0;
  let openCount = 0;
  const provider: FtpFilesProvider = {
    async open() { openCount++; },
    async listDirectory() { throw new FtpFilesProviderError('UNAVAILABLE'); },
    async close() { closeCount++; }, async shutdown() {}
  };
  const prompt: CredentialPrompt = { async prompt() { return { kind: 'provided', username: 'alice', secret: 'secret' }; } };
  const controller = createFtpFilesController(provider, prompt);
  assert.equal((await controller.open(sessionId, 'ftp.example.net', 21, true)).ok, true);
  assert.equal((await controller.listDirectory(sessionId, '/')).ok, false);
  assert.equal((await controller.listDirectory(sessionId, '/')).ok, false, 'the stale controller record is removed after a transport failure');
  assert.equal(closeCount, 1);
  assert.equal((await controller.open(sessionId, 'ftp.example.net', 21, true)).ok, true);
  assert.equal(openCount, 2);
  await controller.dispose();
});
