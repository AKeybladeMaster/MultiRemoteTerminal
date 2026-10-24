import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { UtilityProcess } from 'electron';
import { SshTerminalWorkerHost } from '../../apps/desktop/src/adapters/ssh-terminal-worker-host.ts';

class FakeUtilityProcess extends EventEmitter {
  readonly requests: Array<Record<string, unknown>> = [];
  killed = false;

  postMessage(input: unknown): void {
    const request = input as Record<string, unknown>;
    this.requests.push(request);
    queueMicrotask(() => this.emit('message', {
      version: 1, type: 'reply', requestId: request.requestId, ok: true, result: {}
    }));
  }

  kill(): boolean {
    this.killed = true;
    queueMicrotask(() => this.emit('exit', 0));
    return true;
  }
}

class CancellationUtilityProcess extends FakeUtilityProcess {
  private listRequest: Record<string, unknown> | undefined;

  override postMessage(input: unknown): void {
    const request = input as Record<string, unknown>;
    this.requests.push(request);
    if (request.command === 'files.list') { this.listRequest = request; return; }
    if (request.command === 'files.cancel') {
      const listRequest = this.listRequest;
      queueMicrotask(() => {
        this.emit('message', { version: 1, type: 'reply', requestId: request.requestId, ok: true, result: {} });
        if (listRequest) this.emit('message', { version: 1, type: 'reply', requestId: listRequest.requestId, ok: false, errorCode: 'CANCELLED' });
      });
      return;
    }
    queueMicrotask(() => this.emit('message', { version: 1, type: 'reply', requestId: request.requestId, ok: true, result: {} }));
  }
}

test('worker host consumes the raw message payload emitted by Electron utilityProcess', async () => {
  const worker = new FakeUtilityProcess();
  const host = new SshTerminalWorkerHost('ssh-worker.js', 'desktop-app', () => worker as unknown as UtilityProcess);
  const sessionId = '11111111-1111-4111-8111-111111111111';

  await host.open(sessionId, { host: 'server.example.net', port: 22 }, { username: 'alice', password: 'secret' },
    { columns: 80, rows: 24 }, async () => true);
  assert.equal(worker.requests[0]?.command, 'open');
  await host.shutdown();
  assert.equal(worker.requests.at(-1)?.command, 'shutdown');
  assert.equal(worker.killed, true);
});

test('worker host sends cancellation to the matching bounded SFTP operation', async () => {
  const worker = new CancellationUtilityProcess();
  const host = new SshTerminalWorkerHost('ssh-worker.js', 'desktop-app', () => worker as unknown as UtilityProcess);
  const sessionId = '11111111-1111-4111-8111-111111111111';
  await host.open(sessionId, { host: 'server.example.net', port: 22 }, { username: 'alice', password: 'secret' },
    { columns: 80, rows: 24 }, async () => true);

  const cancellation = new AbortController();
  const listing = host.listRemoteDirectory(sessionId, '/home/alice', cancellation.signal);
  await new Promise<void>(resolve => setImmediate(resolve));
  const listRequest = worker.requests.find(request => request.command === 'files.list');
  assert.ok(listRequest);
  cancellation.abort();
  await assert.rejects(listing, error => (error as { code?: string }).code === 'CANCELLED');
  const cancelRequest = worker.requests.find(request => request.command === 'files.cancel');
  assert.equal(cancelRequest?.operationId, listRequest.requestId);
  assert.equal(cancelRequest?.sessionId, sessionId);
  await host.shutdown();
});
