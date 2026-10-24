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

  constructor(holdListings = false, exitWhenKilled = false) {
    super();
    this.holdListings = holdListings;
    this.exitWhenKilled = exitWhenKilled;
  }

  postMessage(value: unknown): void {
    const request = value as Record<string, unknown>;
    this.requests.push(request);
    if (request.command === 'files.list' && this.holdListings) return;
    const result = request.command === 'files.list'
      ? { path: request.path, entries: [], truncated: false }
      : {};
    queueMicrotask(() => this.reply(request.requestId as string, result));
  }

  reply(requestId: string, result: unknown): void {
    this.emit('message', { version: 1, type: 'reply', requestId, ok: true, result });
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
