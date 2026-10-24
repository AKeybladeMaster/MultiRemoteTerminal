import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { UtilityProcess } from 'electron';
import { FtpFilesWorkerHost, MAX_ACTIVE_FTP_SESSIONS } from '../../apps/desktop/src/adapters/ftp-files-worker-host.ts';

class FakeFtpWorker extends EventEmitter {
  readonly requests: Array<Record<string, unknown>> = [];
  killed = false;
  private readonly holdListings: boolean;
  private readonly exitWhenKilled: boolean;
  private readonly holdTransfers: boolean;

  constructor(holdListings = false, exitWhenKilled = false, holdTransfers = false) {
    super();
    this.holdListings = holdListings;
    this.exitWhenKilled = exitWhenKilled;
    this.holdTransfers = holdTransfers;
  }

  postMessage(value: unknown): void {
    const request = value as Record<string, unknown>;
    this.requests.push(request);
    if (request.command === 'files.cancel') {
      const pendingList = this.requests.find(item => item.command === 'files.list' && item.sessionId === request.sessionId);
      if (pendingList) queueMicrotask(() => this.replyError(pendingList.requestId as string, 'CANCELLED', false));
      queueMicrotask(() => this.reply(request.requestId as string, {}));
      return;
    }
    if (request.command === 'files.list' && this.holdListings) return;
    if ((request.command === 'files.upload' || request.command === 'files.download') && this.holdTransfers) return;
    const result = request.command === 'files.list'
      ? { path: request.path, entries: [], truncated: false }
      : {};
    queueMicrotask(() => this.reply(request.requestId as string, result));
  }

  reply(requestId: string, result: unknown): void {
    this.emit('message', { version: 1, type: 'reply', requestId, ok: true, result });
  }

  replyError(requestId: string, errorCode: string, sessionUsable?: boolean): void {
    this.emit('message', { version: 1, type: 'reply', requestId, ok: false, errorCode,
      ...(sessionUsable === undefined ? {} : { sessionUsable }) });
  }

  progress(requestId: string, progress: Record<string, unknown>): void {
    this.emit('message', { version: 1, type: 'progress', requestId, progress });
  }

  kill(): boolean {
    this.killed = true;
    if (this.exitWhenKilled) queueMicrotask(() => this.emit('exit', 0));
    return true;
  }
}

test('a stale FTP worker exit cannot clear a replacement worker session or request', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const workers: FakeFtpWorker[] = [];
  let firstLaunchOptions: unknown;
  const host = new FtpFilesWorkerHost('ftp-worker.js', 'desktop-app', (_path, _args, options) => {
    if (workers.length === 0) firstLaunchOptions = options;
    const worker = new FakeFtpWorker(workers.length === 1, workers.length > 0);
    workers.push(worker);
    return worker as unknown as UtilityProcess;
  });
  const firstSessionId = '11111111-1111-4111-8111-111111111111';
  const secondSessionId = '22222222-2222-4222-8222-222222222222';

  await host.open(firstSessionId, { host: 'files.example.net', port: 21, secure: true }, { username: 'alice', password: 'secret' });
  assert.deepEqual((firstLaunchOptions as { env: unknown }).env, { MRT_APP_ROOT: 'desktop-app' },
    'worker host passes only the app root before the composition-root runtime allowlist is applied');

  const stopping = host.shutdown();
  await new Promise<void>(resolve => setImmediate(resolve));
  context.mock.timers.tick(2_000);
  await stopping;
  const staleWorker = workers[0];
  assert.ok(staleWorker?.killed);

  await host.open(secondSessionId, { host: 'files.example.net', port: 21, secure: true }, { username: 'alice', password: 'secret' });
  const replacementWorker = workers[1];
  assert.ok(replacementWorker);
  const listing = host.listDirectory(secondSessionId, '/').then(
    value => ({ ok: true as const, value }),
    error => ({ ok: false as const, error })
  );
  await new Promise<void>(resolve => setImmediate(resolve));
  const listRequest = replacementWorker.requests.find(request => request.command === 'files.list');
  assert.ok(listRequest);

  staleWorker.emit('exit', 0);
  replacementWorker.reply(listRequest.requestId as string, { path: '/', entries: [], truncated: false });
  assert.deepEqual(await listing, { ok: true, value: { path: '/', entries: [], truncated: false } });
  await host.shutdown();
});

test('FTP worker host caps active connections and releases capacity after close', async () => {
  const workers: FakeFtpWorker[] = [];
  const host = new FtpFilesWorkerHost('ftp-worker.js', 'desktop-app', () => {
    const worker = new FakeFtpWorker(false, true);
    workers.push(worker);
    return worker as unknown as UtilityProcess;
  });
  const sessionId = (index: number) => `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`;
  const endpoint = { host: 'files.example.net', port: 21, secure: true };
  const credentials = { username: 'alice', password: 'secret' };

  await Promise.all(Array.from({ length: MAX_ACTIVE_FTP_SESSIONS }, (_, index) =>
    host.open(sessionId(index), endpoint, credentials)));
  assert.equal(workers.length, 1);
  const worker = workers[0];
  assert.ok(worker);
  assert.equal(worker.requests.filter(request => request.command === 'open').length, MAX_ACTIVE_FTP_SESSIONS);
  await assert.rejects(host.open(sessionId(MAX_ACTIVE_FTP_SESSIONS), endpoint, credentials), { code: 'BUSY' });

  await host.close(sessionId(0));
  await host.open(sessionId(MAX_ACTIVE_FTP_SESSIONS), endpoint, credentials);
  assert.equal(worker.requests.filter(request => request.command === 'open').length, MAX_ACTIVE_FTP_SESSIONS + 1);
  await host.shutdown();
});

test('FTP worker host preserves transport session usability across utility-process replies', async () => {
  const worker = new FakeFtpWorker(true, true);
  const host = new FtpFilesWorkerHost('ftp-worker.js', 'desktop-app', () => worker as unknown as UtilityProcess);
  const sessionId = '11111111-1111-4111-8111-111111111111';
  await host.open(sessionId, { host: 'files.example.net', port: 21, secure: true }, { username: 'alice', password: 'secret' });

  const listing = host.listDirectory(sessionId, '/').then(() => assert.fail('listing unexpectedly succeeded'), error => error);
  await new Promise<void>(resolve => setImmediate(resolve));
  const request = worker.requests.find(item => item.command === 'files.list');
  assert.ok(request);
  worker.replyError(request.requestId as string, 'CANCELLED', false);
  const error = await listing as { readonly code?: string; readonly sessionUsable?: boolean };
  assert.equal(error.code, 'CANCELLED');
  assert.equal(error.sessionUsable, false);
  await host.shutdown();
});

test('FTP worker host requests bounded operation cleanup before reporting a deadline', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const worker = new FakeFtpWorker(true, true);
  const host = new FtpFilesWorkerHost('ftp-worker.js', 'desktop-app', () => worker as unknown as UtilityProcess);
  const sessionId = '11111111-1111-4111-8111-111111111111';
  await host.open(sessionId, { host: 'files.example.net', port: 21, secure: true }, { username: 'alice', password: 'secret' });
  const listing = host.listDirectory(sessionId, '/').then(() => assert.fail('listing unexpectedly succeeded'), error => error);
  await new Promise<void>(resolve => setImmediate(resolve));
  context.mock.timers.tick(20_000);
  const error = await listing as { readonly code?: string };
  assert.equal(error.code, 'TIMEOUT');
  assert.ok(worker.requests.some(request => request.command === 'files.cancel'), 'the host asks the worker to run transfer cleanup first');
  assert.equal(worker.killed, false, 'a worker that cleans up before the grace deadline remains available');
  await host.shutdown();
});

test('FTP worker host lets an active commit settle before enforcing its bounded deadline', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const worker = new FakeFtpWorker(false, true, true);
  const host = new FtpFilesWorkerHost('ftp-worker.js', 'desktop-app', () => worker as unknown as UtilityProcess);
  const sessionId = '11111111-1111-4111-8111-111111111111';
  const operationId = '22222222-2222-4222-8222-222222222222';
  await host.open(sessionId, { host: 'files.example.net', port: 21, secure: true }, { username: 'alice', password: 'secret' });
  const upload = host.uploadFile(sessionId, operationId, 'C:\\upload.bin', '.', 'upload.bin', 'overwrite').then(
    () => assert.fail('upload unexpectedly completed'), error => error as { readonly code?: string }
  );
  await new Promise<void>(resolve => setImmediate(resolve));
  const request = worker.requests.find(item => item.command === 'files.upload');
  assert.ok(request);
  worker.progress(request.requestId as string, { sessionId, operationId, direction: 'upload', phase: 'committing', fileName: 'upload.bin',
    bytesTransferred: 10, totalBytes: 10 });

  context.mock.timers.tick(60 * 60_000);
  assert.equal(worker.requests.some(item => item.command === 'files.cancel'), false,
    'the host does not cancel once the provider reports a commit in progress');
  assert.equal(worker.killed, false, 'the worker receives the settlement grace window');
  context.mock.timers.tick(2 * 60_000);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal((await upload).code, 'TIMEOUT');
  assert.equal(worker.killed, true, 'a non-settling commit remains bounded');
});
