import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import type { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { truncateSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFtpFilesController, FtpFilesProviderError } from '../../packages/application/src/ftp-files.ts';
import type { FtpFilesProvider } from '../../packages/application/src/ftp-files.ts';
import type { CredentialPrompt, CredentialPromptPurpose, CredentialPromptResult } from '../../packages/application/src/credential-prompt.ts';
import { canonicalizeFtpEndpoint, isCanonicalFtpEndpoint, isFtpCommandArgument, isFtpRemotePath } from '../../packages/domain/src/ftp.ts';
import { isRemotePath } from '../../packages/domain/src/remote-files.ts';
import { createFtpTransportProvider } from '../../apps/desktop/src/workers/ftp-transport-provider.ts';
import type { FtpLibraryClient, FtpLibraryFileInfo } from '../../apps/desktop/src/workers/ftp-transport-provider.ts';
import { mapLocalTransferTargetError, prepareLocalTransferTarget } from '../../apps/desktop/src/workers/local-transfer-target.ts';
import { parseFtpWorkerInput, parseFtpWorkerMessage } from '../../apps/desktop/src/workers/ftp-worker-protocol.ts';

const sessionId = '18f2f903-7b6f-4c8d-9c42-b63a58c4b087';
const requestId = '11111111-1111-4111-8111-111111111111';
const ftpTransferDefaults = {
  async uploadFile() { return { direction: 'upload' as const, fileName: 'x', bytesTransferred: 0, state: 'completed' as const }; },
  async downloadFile() { return { direction: 'download' as const, fileName: 'x', bytesTransferred: 0, state: 'completed' as const }; }
};

test('FTP controller validates endpoints, prompts separately, wipes credential references, and owns lifecycle', async () => {
  let purpose: CredentialPromptPurpose | undefined;
  let providerCredentials: { username: string; password: string } | undefined;
  const calls: string[] = [];
  const provider: FtpFilesProvider = {
    ...ftpTransferDefaults,
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
    ...ftpTransferDefaults,
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

test('local FTP skip policy preserves a destination created during the staged download commit', async () => {
  const transferRoot = await mkdtemp(join(tmpdir(), 'mrt-ftp-skip-race-'));
  const destination = join(transferRoot, 'raced.txt');
  try {
    const target = await prepareLocalTransferTarget(destination, 'skip');
    await pipeline(Readable.from(['incoming']), target.stream!);
    const result = await target.complete(() => {
      writeFileSync(destination, 'another process won');
      return true;
    });
    assert.deepEqual(result, { fileName: 'raced.txt', bytes: 0, state: 'skipped' });
    assert.equal(await readFile(destination, 'utf8'), 'another process won');
    assert.equal((await readdir(transferRoot)).some(name => name.endsWith('.partial')), false);
  } finally {
    await rm(transferRoot, { recursive: true, force: true });
  }
});

test('local download filesystem errors retain actionable categories without retiring the FTP session', () => {
  assert.equal(mapLocalTransferTargetError(Object.assign(new Error('denied'), { code: 'EACCES' })).code, 'FORBIDDEN');
  assert.equal(mapLocalTransferTargetError(Object.assign(new Error('denied'), { code: 'EPERM' })).code, 'FORBIDDEN');
  assert.equal(mapLocalTransferTargetError(Object.assign(new Error('missing parent'), { code: 'ENOENT' })).code, 'NOT_FOUND');
  assert.equal(mapLocalTransferTargetError(Object.assign(new Error('disk error'), { code: 'EIO' })).code, 'UNAVAILABLE');
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
    ...ftpTransferDefaults,
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
    ...ftpTransferDefaults,
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

test('FTP controller preserves local-file failures and invalidates a connection closed by cancellation', async () => {
  let closes = 0;
  let uploadError = new FtpFilesProviderError('UNAVAILABLE', true);
  const provider: FtpFilesProvider = {
    ...ftpTransferDefaults,
    async open() {},
    async listDirectory(_id, path) { return { path, entries: [], truncated: false }; },
    async uploadFile() { throw uploadError; },
    async close() { closes++; }, async shutdown() {}
  };
  const prompt: CredentialPrompt = { async prompt() { return { kind: 'provided', username: 'alice', secret: 'secret' }; } };
  const controller = createFtpFilesController(provider, prompt);
  assert.equal((await controller.open(sessionId, 'ftp.example.net', 21, true)).ok, true);
  const localFailure = await controller.uploadFile(sessionId, '22222222-2222-4222-8222-222222222222', 'C:\\files\\archive.bin', '.', 'archive.bin', 'rename');
  assert.deepEqual(localFailure, { ok: false, error: { code: 'UNAVAILABLE', target: 'terminal', retryable: true } });
  assert.equal((await controller.listDirectory(sessionId, '/')).ok, true, 'a local error can be retried without reconnecting');
  uploadError = new FtpFilesProviderError('CANCELLED', false);
  const cancelled = await controller.uploadFile(sessionId, '22222222-2222-4222-8222-222222222222', 'C:\\files\\archive.bin', '.', 'archive.bin', 'rename');
  assert.deepEqual(cancelled, { ok: false, error: { code: 'CANCELLED', target: 'terminal', retryable: false } });
  assert.deepEqual(await controller.listDirectory(sessionId, '/'), {
    ok: false, error: { code: 'NOT_FOUND', target: 'terminal', retryable: false }
  });
  assert.equal(closes, 1);
  assert.equal((await controller.open(sessionId, 'ftp.example.net', 21, true)).ok, true);
  uploadError = new FtpFilesProviderError('NOT_SUPPORTED', false);
  const unsupported = await controller.uploadFile(sessionId, '22222222-2222-4222-8222-222222222227', 'C:\\files\\archive.bin', '.', 'archive.bin', 'rename');
  assert.deepEqual(unsupported, { ok: false, error: { code: 'NOT_SUPPORTED', target: 'terminal', retryable: false } });
  assert.equal((await controller.listDirectory(sessionId, '/')).ok, false, 'an unusable STOU connection is retired too');
  assert.equal(closes, 2);
  await controller.dispose();
});

test('FTP cancellation is rejected once a transfer enters its commit phase', async () => {
  let finishUpload!: () => void;
  let transferStarted!: () => void;
  const started = new Promise<void>(resolve => { transferStarted = resolve; });
  let aborted = false;
  const provider: FtpFilesProvider = {
    ...ftpTransferDefaults,
    async open() {}, async listDirectory(_id, path) { return { path, entries: [], truncated: false }; },
    async uploadFile(id, operationId, _path, _directory, fileName, _policy, cancellation, onProgress) {
      transferStarted();
      onProgress?.({ sessionId: id, operationId, direction: 'upload', phase: 'committing', fileName, bytesTransferred: 1, totalBytes: 1 });
      cancellation?.addEventListener('abort', () => { aborted = true; }, { once: true });
      await new Promise<void>(resolve => { finishUpload = resolve; });
      return { direction: 'upload', fileName, bytesTransferred: 1, state: 'completed' };
    },
    async close() {}, async shutdown() {}
  };
  const prompt: CredentialPrompt = { async prompt() { return { kind: 'provided', username: 'alice', secret: 'secret' }; } };
  const controller = createFtpFilesController(provider, prompt);
  assert.equal((await controller.open(sessionId, 'ftp.example.net', 21, true)).ok, true);
  const operationId = '22222222-2222-4222-8222-222222222226';
  const upload = controller.uploadFile(sessionId, operationId, 'C:\\files\\archive.bin', '.', 'archive.bin', 'overwrite');
  await started;
  assert.deepEqual(await controller.cancelTransfer(sessionId, operationId), {
    ok: false, error: { code: 'CONFLICT', target: 'terminal', retryable: false }
  });
  assert.equal(aborted, false);
  finishUpload();
  assert.equal((await upload).ok, true);
  await controller.dispose();
});

test('FTP closeAll blocks new sessions while it drains canceled transfers', async () => {
  const secondSessionId = '28f2f903-7b6f-4c8d-9c42-b63a58c4b087';
  let transferStarted!: () => void;
  const started = new Promise<void>(resolve => { transferStarted = resolve; });
  const provider: FtpFilesProvider = {
    ...ftpTransferDefaults,
    async open() {}, async listDirectory(_id, path) { return { path, entries: [], truncated: false }; },
    async uploadFile(_id, _operationId, _localPath, _directory, _fileName, _policy, cancellation) {
      transferStarted();
      await new Promise<void>((_resolve, reject) => {
        const abort = () => setTimeout(() => reject(new FtpFilesProviderError('CANCELLED', true)), 20);
        cancellation?.addEventListener('abort', abort, { once: true });
      });
      return { direction: 'upload', fileName: 'x', bytesTransferred: 0, state: 'completed' };
    },
    async close() {}, async shutdown() {}
  };
  const prompt: CredentialPrompt = { async prompt() { return { kind: 'provided', username: 'alice', secret: 'secret' }; } };
  const controller = createFtpFilesController(provider, prompt);
  assert.equal((await controller.open(sessionId, 'ftp.example.net', 21, true)).ok, true);
  const operation = controller.uploadFile(sessionId, '22222222-2222-4222-8222-222222222222', 'C:\\files\\archive.bin', '.', 'archive.bin', 'rename');
  await started;
  const closing = controller.closeAll();
  assert.deepEqual(await controller.open(secondSessionId, 'ftp.example.net', 21, true), {
    ok: false, error: { code: 'BUSY', target: 'application', retryable: true }
  });
  await closing;
  assert.equal((await operation).ok, false);
  await controller.dispose();
});

test('FTP transport bounds directory listings, maps metadata, and closes a cancelled operation', async () => {
  class FakeFtpClient implements FtpLibraryClient {
    readonly ftp = { verbose: true, log: (message: string) => { void message; } };
    closed = false;
    readonly files = new Map<string, Buffer>();
    cwd = '/';
    progress: ((info: { readonly name: string; readonly type: string; readonly bytes: number }) => void) | undefined;
    uploadDelayMs = 0;
    renameHook: (() => void) | undefined;
    renameFailDestination: string | undefined;
    uniqueStoreNameOverride: string | undefined;
    uniqueStoreHook: ((remotePath: string) => void) | undefined;
    uploadCount = 0;
    listing: { name: unknown; type: unknown; size: unknown; modifiedAt?: unknown }[] = [];
    accessOptions: unknown;
    pendingList: ((value: never) => void) | undefined;
    async access(options: unknown): Promise<void> { this.accessOptions = options; }
    async pwd(): Promise<string> { return this.cwd; }
    async cd(path: string): Promise<void> { this.cwd = path === '.' ? '/' : path; }
    list(): Promise<typeof this.listing> {
      if (!this.pendingList) return Promise.resolve(this.listing);
      return new Promise(resolve => { this.pendingList = resolve as (value: never) => void; });
    }
    async size(path: string): Promise<number> { return this.files.get(path)?.length ?? 0; }
    async rename(source: string, destination: string): Promise<void> {
      this.renameHook?.();
      this.renameHook = undefined;
      if (this.renameFailDestination === destination) {
        this.renameFailDestination = undefined;
        throw new Error('simulated RNTO failure');
      }
      const contents = this.files.get(source);
      if (!contents) throw new Error('missing source');
      this.files.delete(source);
      this.files.set(destination, contents);
    }
    async remove(path: string): Promise<void> {
      if (this.closed) throw new Error('connection closed');
      this.files.delete(path);
    }
    async uploadFrom(source: NodeJS.ReadableStream | string, remotePath: string): Promise<void> {
      this.uploadCount++;
      if (typeof source === 'string') throw new Error('test expects a stream');
      const chunks: Buffer[] = [];
      for await (const value of source as AsyncIterable<Buffer | string>) {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        chunks.push(chunk);
        this.files.set(remotePath, Buffer.concat(chunks));
        this.progress?.({ name: remotePath, type: 'upload', bytes: Buffer.concat(chunks).length });
        if (this.uploadDelayMs) await new Promise(resolveDelay => setTimeout(resolveDelay, this.uploadDelayMs));
      }
    }
    async uploadUniqueFrom(source: Readable, remotePath: string, onUniquePath: (path: string) => void): Promise<string> {
      this.uploadCount++;
      if (this.closed) throw new Error('connection closed');
      this.uniqueStoreHook?.(remotePath);
      const separator = remotePath.lastIndexOf('/');
      const requestedName = remotePath.slice(separator + 1);
      const dot = requestedName.lastIndexOf('.');
      const extension = dot > 0 ? requestedName.slice(dot) : '';
      const stem = extension ? requestedName.slice(0, -extension.length) : requestedName;
      let actualPath = this.uniqueStoreNameOverride ?? remotePath;
      this.uniqueStoreNameOverride = undefined;
      for (let ordinal = 1; this.files.has(actualPath); ordinal++) {
        const actualSeparator = actualPath.lastIndexOf('/');
        const actualDirectory = actualSeparator < 0 ? '' : actualPath.slice(0, actualSeparator + 1);
        actualPath = `${actualDirectory}${stem} (${ordinal})${extension}`;
      }
      const chunks: Buffer[] = [];
      this.files.set(actualPath, Buffer.alloc(0));
      onUniquePath(actualPath);
      for await (const value of source) {
        if (this.closed) throw new Error('connection closed');
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        chunks.push(chunk);
        this.files.set(actualPath, Buffer.concat(chunks));
        this.progress?.({ name: actualPath, type: 'upload', bytes: Buffer.concat(chunks).length });
        if (this.uploadDelayMs) await new Promise(resolveDelay => setTimeout(resolveDelay, this.uploadDelayMs));
      }
      return actualPath;
    }
    async downloadTo(destination: NodeJS.WritableStream | string, remotePath: string): Promise<void> {
      if (typeof destination === 'string') throw new Error('test expects a stream');
      const contents = this.files.get(remotePath);
      if (!contents) throw new Error('missing source');
      await pipeline(Readable.from([contents]), destination as Writable);
    }
    trackProgress(handler?: (info: { readonly name: string; readonly type: string; readonly bytes: number }) => void): void {
      this.progress = handler;
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

  const transferRoot = await mkdtemp(join(tmpdir(), 'mrt-ftp-transfer-test-'));
  try {
    const uploadPath = join(transferRoot, 'report.bin');
    await writeFile(uploadPath, Buffer.from('new upload'));
    await assert.rejects(provider.uploadFile(sessionId, '11111111-1111-4111-8111-111111111112', join(transferRoot, 'missing.bin'), '.', 'missing.bin', 'rename'),
      error => (error as { code?: string }).code === 'NOT_FOUND');
    assert.equal(clients[0]!.closed, false, 'a missing local source does not retire a healthy FTP connection');
    clients[0]!.listing = [{ name: 'report.bin', type: 1, size: 3 }];
    clients[0]!.files.set('report.bin', Buffer.from('old'));
    const uploadProgress: number[] = [];
    const uploaded = await provider.uploadFile(sessionId, '22222222-2222-4222-8222-222222222222', uploadPath, '.', 'report.bin', 'rename', undefined,
      event => uploadProgress.push(event.bytesTransferred));
    assert.deepEqual(uploaded, { direction: 'upload', fileName: 'report (1).bin', bytesTransferred: 10, state: 'completed' });
    assert.equal(clients[0]!.files.get('report.bin')?.toString(), 'old');
    assert.equal(clients[0]!.files.get('report (1).bin')?.toString(), 'new upload');
    assert.deepEqual(uploadProgress, [0, 10]);

    const committedDespiteLateCancelPath = join(transferRoot, 'late-cancel.bin');
    await writeFile(committedDespiteLateCancelPath, 'commit wins');
    clients[0]!.listing = [{ name: 'late-cancel.bin', type: 1, size: 9 }];
    clients[0]!.files.set('late-cancel.bin', Buffer.from('old value'));
    const lateCommitAbort = new AbortController();
    clients[0]!.renameHook = () => lateCommitAbort.abort();
    const committed = await provider.uploadFile(sessionId, '22222222-2222-4222-8222-222222222224', committedDespiteLateCancelPath, '.', 'late-cancel.bin',
      'overwrite', lateCommitAbort.signal);
    assert.equal(committed.state, 'completed', 'a cancellation after the commit point reports the committed result');
    assert.equal(clients[0]!.files.get('late-cancel.bin')?.toString(), 'commit wins');

    const rollbackPath = join(transferRoot, 'rollback.bin');
    await writeFile(rollbackPath, 'replacement');
    clients[0]!.listing = [{ name: 'rollback.bin', type: 1, size: 6 }];
    clients[0]!.files.set('rollback.bin', Buffer.from('original'));
    clients[0]!.renameFailDestination = 'rollback.bin';
    await assert.rejects(provider.uploadFile(sessionId, '22222222-2222-4222-8222-222222222226', rollbackPath, '.', 'rollback.bin', 'overwrite'),
      error => (error as { code?: string }).code === 'CONFLICT');
    assert.equal(clients[0]!.files.get('rollback.bin')?.toString(), 'original', 'failed replacement restores the previous remote file');
    assert.equal([...clients[0]!.files.keys()].some(path => path.includes('.backup') || path.includes('.partial')), false,
      'successful rollback and cleanup leave no recovery files');

    const changingPath = join(transferRoot, 'changing.bin');
    await writeFile(changingPath, Buffer.alloc(2 * 1024 * 1024, 66));
    let truncatedDuringUpload = false;
    await assert.rejects(provider.uploadFile(sessionId, '22222222-2222-4222-8222-222222222223', changingPath, '.', 'changing.bin', 'rename', undefined,
      event => {
        if (!truncatedDuringUpload && event.bytesTransferred > 0) {
          truncatedDuringUpload = true;
          truncateSync(changingPath, 0);
        }
      }), error => (error as { code?: string }).code === 'CONFLICT');
    assert.equal(truncatedDuringUpload, true);
    assert.equal(clients[0]!.files.has('changing.bin'), false, 'a changing source is never renamed into its final remote path');
    assert.equal([...clients[0]!.files.keys()].some(path => path.includes('.partial')), false, 'the uncommitted upload stage is cleaned');

    const racedPath = join(transferRoot, 'race.txt');
    await writeFile(racedPath, 'new data');
    clients[0]!.listing = [];
    clients[0]!.uniqueStoreHook = target => {
      clients[0]!.files.set(target, Buffer.from('other client data'));
      clients[0]!.listing = [{ name: 'race.txt', type: 1, size: 17 }];
    };
    const raced = await provider.uploadFile(sessionId, '22222222-2222-4222-8222-222222222225', racedPath, '.', 'race.txt', 'skip');
    clients[0]!.uniqueStoreHook = undefined;
    assert.deepEqual(raced, { direction: 'upload', fileName: 'race.txt', bytesTransferred: 0, state: 'skipped' });
    assert.equal(clients[0]!.files.get('race.txt')?.toString(), 'other client data', 'a competing remote file is not replaced');
    assert.equal(clients[0]!.files.has('race (1).txt'), false, 'the unique collision copy is removed for skip policy');

    for (const [policy, actualName] of [['skip', 'server-selected-skip.bin'], ['overwrite', 'server-selected-overwrite.bin']] as const) {
      const localPath = join(transferRoot, `requested-${policy}.bin`);
      await writeFile(localPath, `server name under ${policy}`);
      clients[0]!.listing = [];
      clients[0]!.uniqueStoreNameOverride = actualName;
      const result = await provider.uploadFile(sessionId,
        policy === 'skip' ? '22222222-2222-4222-8222-222222222227' : '22222222-2222-4222-8222-222222222228',
        localPath, '.', basename(localPath), policy);
      assert.deepEqual(result, { direction: 'upload', fileName: actualName, bytesTransferred: Buffer.byteLength(`server name under ${policy}`), state: 'completed' },
        `a server-assigned STOU name is accepted for ${policy} when no competing requested name appeared`);
      assert.equal(clients[0]!.files.get(actualName)?.toString(), `server name under ${policy}`);
    }

    clients[0]!.listing = [{ name: 'server.txt', type: 1, size: 12 }];
    clients[0]!.files.set('server.txt', Buffer.from('remote data'));
    const downloadPath = join(transferRoot, 'download.txt');
    await writeFile(downloadPath, 'keep existing');
    const downloaded = await provider.downloadFile(sessionId, '33333333-3333-4333-8333-333333333333', 'server.txt', downloadPath, 'rename');
    assert.deepEqual(downloaded, { direction: 'download', fileName: 'download (1).txt', bytesTransferred: 11, state: 'completed' });
    assert.equal((await readFile(downloadPath)).toString(), 'keep existing');
    assert.equal((await readFile(join(transferRoot, 'download (1).txt'))).toString(), 'remote data');
    const overwritten = await provider.downloadFile(sessionId, '33333333-3333-4333-8333-333333333334', 'server.txt', downloadPath, 'overwrite');
    assert.deepEqual(overwritten, { direction: 'download', fileName: 'download.txt', bytesTransferred: 11, state: 'completed' });
    assert.equal((await readFile(downloadPath)).toString(), 'remote data');
    const skipped = await provider.downloadFile(sessionId, '44444444-4444-4444-8444-444444444444', 'server.txt', downloadPath, 'skip');
    assert.deepEqual(skipped, { direction: 'download', fileName: 'download.txt', bytesTransferred: 0, state: 'skipped' });

    const slowUploadPath = join(transferRoot, 'slow.bin');
    await writeFile(slowUploadPath, Buffer.alloc(2 * 1024 * 1024, 65));
    clients[0]!.uploadDelayMs = 10;
    const transferAbort = new AbortController();
    let cancelledAfterProgress = false;
    const interrupted = provider.uploadFile(sessionId, '55555555-5555-4555-8555-555555555555', slowUploadPath, '.', 'slow.bin', 'rename',
      transferAbort.signal, event => {
        if (!cancelledAfterProgress && event.bytesTransferred > 0) {
          cancelledAfterProgress = true;
          transferAbort.abort();
        }
      });
    await assert.rejects(interrupted, error => (error as { code?: string }).code === 'CANCELLED');
    assert.equal(cancelledAfterProgress, true);
    assert.equal(clients[0]!.files.has('slow.bin'), false, 'the captured STOU path is removed after a graceful cancellation');
    assert.equal(clients[0]!.closed, false, 'an upload cancellation keeps the control channel open long enough for best-effort DELE');

    const downloadSessionId = '28f2f903-7b6f-4c8d-9c42-b63a58c4b087';
    await provider.open(downloadSessionId, { host: 'ftp.example.net', port: 21, secure: false }, credentials);
    clients[1]!.listing = [{ name: 'server.txt', type: 1, size: 12 }];
    clients[1]!.files.set('server.txt', Buffer.from('remote data'));
    const interruptedDownloadPath = join(transferRoot, 'cancelled-download.txt');
    const downloadAbort = new AbortController();
    const interruptedDownload = provider.downloadFile(downloadSessionId, '44444444-4444-4444-8444-444444444445', 'server.txt', interruptedDownloadPath, 'rename',
      downloadAbort.signal, event => { if (event.bytesTransferred === 0) downloadAbort.abort(); });
    await assert.rejects(interruptedDownload, error => (error as { code?: string }).code === 'CANCELLED');
    assert.equal(await readdir(transferRoot).then(names => names.some(name => name.endsWith('.partial'))), false, 'cancel removes the local partial download');
    assert.equal(clients[1]!.closed, true, 'cancelling an active RETR closes the FTP control connection');
  } finally {
    await rm(transferRoot, { recursive: true, force: true });
  }
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
  assert.equal(parseFtpWorkerMessage({ version: 1, type: 'reply', requestId, ok: false, errorCode: 'NOT_FOUND' })?.type, 'reply');
  assert.equal(parseFtpWorkerMessage({ version: 1, type: 'reply', requestId, ok: false, errorCode: 'FORBIDDEN' })?.type, 'reply');
  assert.equal(parseFtpWorkerMessage({ version: 1, type: 'reply', requestId, ok: false, errorCode: 'NOT_SUPPORTED' })?.type, 'reply');
  assert.equal(parseFtpWorkerMessage({ version: 1, type: 'reply', requestId, ok: false, errorCode: 'CANCELLED', sessionUsable: false })?.type, 'reply');
  assert.equal(parseFtpWorkerMessage({ version: 1, type: 'reply', requestId, ok: false, errorCode: 'UNAVAILABLE', sessionUsable: true })?.type, 'reply');
  assert.equal(parseFtpWorkerMessage({ version: 1, type: 'reply', requestId, ok: false, errorCode: 'CANCELLED', sessionUsable: 'no' }), undefined);
  assert.equal(parseFtpWorkerMessage({ version: 1, type: 'reply', requestId, ok: false, errorCode: 'CANCELLED', sessionUsable: false, secret: 'unexpected' }), undefined);
  assert.equal(parseFtpWorkerMessage({ version: 1, type: 'progress', requestId, progress: {
    sessionId, operationId: requestId, direction: 'upload', phase: 'committing', fileName: 'archive.bin', bytesTransferred: 1, totalBytes: 1
  } })?.type, 'progress');
});

test('FTP cancellation during preflight closes its pending control request before STOR starts', async () => {
  const transferRoot = await mkdtemp(join(tmpdir(), 'mrt-ftp-preflight-cancel-'));
  const localPath = join(transferRoot, 'upload.bin');
  await writeFile(localPath, 'not sent');
  let finishListing: ((entries: FtpLibraryFileInfo[]) => void) | undefined;
  let listingStarted!: () => void;
  const started = new Promise<void>(resolve => { listingStarted = resolve; });
  let closed = false;
  let uploadCount = 0;
  const client: FtpLibraryClient = {
    ftp: { verbose: false, log() {} },
    get closed() { return closed; },
    async access() {},
    async pwd() { return '/'; }, async cd() {},
    list() {
      listingStarted();
      return new Promise(resolve => { finishListing = resolve; });
    },
    async size() { return 0; }, async rename() {}, async remove() {},
    async uploadFrom() { uploadCount++; }, async downloadTo() {}, trackProgress() {},
    async uploadUniqueFrom(_source, path, onUniquePath) { uploadCount++; onUniquePath(path); return path; },
    close() { closed = true; finishListing?.([]); }
  };
  const provider = createFtpTransportProvider(() => client, () => false, { directory: 2, file: 1, symbolicLink: 3 });
  try {
    await provider.open(sessionId, { host: 'ftp.example.net', port: 21, secure: true }, { username: 'alice', password: 'secret' });
    const cancellation = new AbortController();
    const pending = provider.uploadFile(sessionId, '55555555-5555-4555-8555-555555555556', localPath, '.', 'upload.bin', 'rename', cancellation.signal);
    await started;
    cancellation.abort();
    await assert.rejects(pending, error => (error as { code?: string }).code === 'CANCELLED');
    assert.equal(uploadCount, 0, 'preflight cancellation never starts STOR');
    assert.equal(closed, true, 'cancelling a pending FTP command retires its control connection');
  } finally {
    await provider.shutdown();
    await rm(transferRoot, { recursive: true, force: true });
  }
});

test('FTP controller retires unusable sessions after transport failures so they can be reopened', async () => {
  let closeCount = 0;
  let openCount = 0;
  const provider: FtpFilesProvider = {
    ...ftpTransferDefaults,
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
