import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

class CategorizedOpenFailureUtilityProcess extends FakeUtilityProcess {
  override postMessage(input: unknown): void {
    const request = input as Record<string, unknown>;
    this.requests.push(request);
    const failedOpen = request.command === 'open';
    queueMicrotask(() => this.emit('message', {
      version: 1, type: 'reply', requestId: request.requestId, ok: !failedOpen,
      ...(failedOpen ? { errorCode: 'UNAVAILABLE', networkFailure: 'HOST_UNREACHABLE' } : { result: {} })
    }));
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

class UnresponsiveListUtilityProcess extends FakeUtilityProcess {
  override postMessage(input: unknown): void {
    const request = input as Record<string, unknown>;
    this.requests.push(request);
    if (request.command === 'files.list') return;
    queueMicrotask(() => this.emit('message', {
      version: 1, type: 'reply', requestId: request.requestId, ok: true, result: {}
    }));
  }
}

class CommittingTransferUtilityProcess extends FakeUtilityProcess {
  transferRequest: Record<string, unknown> | undefined;

  override postMessage(input: unknown): void {
    const request = input as Record<string, unknown>;
    this.requests.push(request);
    if (request.command === 'files.upload') {
      this.transferRequest = request;
      queueMicrotask(() => this.emit('message', { version: 1, type: 'progress', requestId: request.requestId, progress: {
        sessionId: request.sessionId, operationId: request.operationId, direction: 'upload', phase: 'committing', fileName: 'report.txt',
        bytesTransferred: 10, totalBytes: 10
      } }));
      return;
    }
    queueMicrotask(() => this.emit('message', { version: 1, type: 'reply', requestId: request.requestId, ok: true, result: {} }));
  }

  finishTransfer(): void {
    const request = this.transferRequest;
    if (!request) throw new Error('No transfer request is waiting to settle');
    this.emit('message', { version: 1, type: 'reply', requestId: request.requestId, ok: true,
      result: { direction: 'upload', fileName: 'report.txt', bytesTransferred: 10, state: 'completed' } });
  }
}

class DelayedCommitTransferUtilityProcess extends FakeUtilityProcess {
  transferRequest: Record<string, unknown> | undefined;

  override postMessage(input: unknown): void {
    const request = input as Record<string, unknown>;
    this.requests.push(request);
    if (request.command === 'files.upload') { this.transferRequest = request; return; }
    queueMicrotask(() => this.emit('message', { version: 1, type: 'reply', requestId: request.requestId, ok: true, result: {} }));
  }

  emitCommitProgress(): void {
    const request = this.transferRequest;
    if (!request) throw new Error('No transfer request is waiting to commit');
    this.emit('message', { version: 1, type: 'progress', requestId: request.requestId, progress: {
      sessionId: request.sessionId, operationId: request.operationId, direction: 'upload', phase: 'committing', fileName: 'report.txt',
      bytesTransferred: 10, totalBytes: 10
    } });
  }

  finishTransfer(): void {
    const request = this.transferRequest;
    if (!request) throw new Error('No transfer request is waiting to settle');
    this.emit('message', { version: 1, type: 'reply', requestId: request.requestId, ok: true,
      result: { direction: 'upload', fileName: 'report.txt', bytesTransferred: 10, state: 'completed' } });
  }
}

class RemoteTextUtilityProcess extends FakeUtilityProcess {
  override postMessage(input: unknown): void {
    const request = input as Record<string, unknown>;
    if (request.command === 'files.read-text') {
      this.requests.push(request);
      const content = 'remote contents';
      const revision = request.remotePath === '/home/alice/bad.txt' ? 'b'.repeat(64)
        : createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex');
      queueMicrotask(() => this.emit('message', { version: 1, type: 'reply', requestId: request.requestId, ok: true,
        result: { path: request.remotePath, content, revision, bytes: Buffer.byteLength(content) } }));
      return;
    }
    if (request.command === 'files.write-text') {
      this.requests.push(request);
      const content = request.content as string;
      const bytesSaved = Buffer.byteLength(content) + (request.remotePath === '/home/alice/bad-size.txt' ? 1 : 0);
      queueMicrotask(() => this.emit('message', { version: 1, type: 'reply', requestId: request.requestId, ok: true,
        result: { path: request.remotePath, revision: 'c'.repeat(64), bytesSaved } }));
      return;
    }
    super.postMessage(input);
  }
}

test('worker host consumes the raw message payload emitted by Electron utilityProcess', async () => {
  const worker = new FakeUtilityProcess();
  let workerPipe: string | undefined;
  const host = new SshTerminalWorkerHost('ssh-worker.js', 'desktop-app', (_path, _args, options) => {
    workerPipe = options.env.MRT_OPENSSH_AGENT_PIPE;
    return worker as unknown as UtilityProcess;
  }, String.raw`\\.\pipe\mrt-test-agent`);
  const sessionId = '11111111-1111-4111-8111-111111111111';

  await host.open(sessionId, { host: 'server.example.net', port: 22 }, { username: 'alice', password: 'secret' },
    { columns: 80, rows: 24 }, async () => true);
  assert.equal(workerPipe, String.raw`\\.\pipe\mrt-test-agent`);
  assert.equal(worker.requests[0]?.command, 'open');
  await host.shutdown();
  assert.equal(worker.requests.at(-1)?.command, 'shutdown');
  assert.equal(worker.killed, true);
});

test('worker host preserves only the validated network failure category on an SSH open error', async () => {
  const worker = new CategorizedOpenFailureUtilityProcess();
  const host = new SshTerminalWorkerHost('ssh-worker.js', 'desktop-app', () => worker as unknown as UtilityProcess);
  const sessionId = '11111111-1111-4111-8111-111111111111';

  await assert.rejects(host.open(sessionId, { host: 'server.example.net', port: 22 }, { username: 'alice', password: 'secret' },
    { columns: 80, rows: 24 }, async () => true), error => {
      assert.equal((error as { code?: string }).code, 'UNAVAILABLE');
      assert.equal((error as { networkFailure?: string }).networkFailure, 'HOST_UNREACHABLE');
      assert.equal((error as Error).message, 'SSH terminal operation failed');
      return true;
    });
  await host.shutdown();
  assert.equal(worker.killed, true);
});

test('worker host opens a file-only SSH session without sending terminal dimensions', async () => {
  const worker = new FakeUtilityProcess();
  const host = new SshTerminalWorkerHost('ssh-worker.js', 'desktop-app', () => worker as unknown as UtilityProcess);
  const sessionId = '11111111-1111-4111-8111-111111111111';

  await host.openFiles(sessionId, { host: 'server.example.net', port: 22 }, { username: 'alice', password: 'secret' }, async () => true,
    [{ endpoint: { host: 'gateway.example.net', port: 2201 }, credentials: { username: 'gateway', password: 'gateway-secret' } }]);
  assert.equal(worker.requests[0]?.command, 'open-files');
  assert.equal(Object.hasOwn(worker.requests[0] ?? {}, 'size'), false);
  const gatewayHops = worker.requests[0]?.gatewayHops as readonly { readonly endpoint: { readonly host: string; readonly port: number };
    readonly credentials: { readonly username: string; readonly password: string } }[] | undefined;
  assert.deepEqual(gatewayHops?.map(hop => hop.endpoint), [{ host: 'gateway.example.net', port: 2201 }]);
  assert.equal(gatewayHops?.[0]?.credentials.password, '', 'gateway secrets are cleared after worker handoff');
  await host.shutdown();
});

test('worker host verifies remote text revisions, byte counts, and request-bound paths', async () => {
  const worker = new RemoteTextUtilityProcess();
  const host = new SshTerminalWorkerHost('ssh-worker.js', 'desktop-app', () => worker as unknown as UtilityProcess);
  const sessionId = '11111111-1111-4111-8111-111111111111';
  const content = 'remote contents';
  const revision = createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex');
  await host.openFiles(sessionId, { host: 'server.example.net', port: 22 }, { username: 'alice', password: 'secret' }, async () => true);
  assert.deepEqual(await host.readRemoteTextFile(sessionId, '22222222-2222-4222-8222-222222222222', '/home/alice/config.txt'), {
    path: '/home/alice/config.txt', content, revision, bytes: Buffer.byteLength(content)
  });
  await assert.rejects(host.readRemoteTextFile(sessionId, '33333333-3333-4333-8333-333333333333', '/home/alice/bad.txt'),
    error => (error as { code?: string }).code === 'UNAVAILABLE');
  assert.deepEqual(await host.saveRemoteTextFile(sessionId, '44444444-4444-4444-8444-444444444444', '/home/alice/config.txt', 'updated', revision), {
    path: '/home/alice/config.txt', revision: 'c'.repeat(64), bytesSaved: Buffer.byteLength('updated')
  });
  await assert.rejects(host.saveRemoteTextFile(sessionId, '55555555-5555-4555-8555-555555555555', '/home/alice/bad-size.txt', 'updated', revision),
    error => (error as { code?: string }).code === 'UNAVAILABLE');
  await host.shutdown();
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

test('worker host lets an SFTP remote commit settle when the renderer closes its transfer view', async () => {
  const worker = new CommittingTransferUtilityProcess();
  const host = new SshTerminalWorkerHost('ssh-worker.js', 'desktop-app', () => worker as unknown as UtilityProcess);
  const sessionId = '11111111-1111-4111-8111-111111111111';
  const operationId = '22222222-2222-4222-8222-222222222222';
  await host.open(sessionId, { host: 'server.example.net', port: 22 }, { username: 'alice', password: 'secret' },
    { columns: 80, rows: 24 }, async () => true);
  const cancellation = new AbortController();
  const upload = host.uploadRemoteFile(sessionId, operationId, 'C:\\private\\report.txt', '/home/alice', 'report.txt', 'overwrite', cancellation.signal);
  await new Promise<void>(resolve => setImmediate(resolve));
  cancellation.abort();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(worker.requests.some(request => request.command === 'files.cancel'), false,
    'a commit cannot be interrupted by a late renderer cancellation');
  assert.equal(worker.killed, false);
  worker.finishTransfer();
  assert.deepEqual(await upload, { direction: 'upload', fileName: 'report.txt', bytesTransferred: 10, state: 'completed' });
  await host.shutdown();
});

test('worker host extends cleanup grace when commit progress arrives just after cancellation', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const worker = new DelayedCommitTransferUtilityProcess();
  const host = new SshTerminalWorkerHost('ssh-worker.js', 'desktop-app', () => worker as unknown as UtilityProcess);
  const sessionId = '11111111-1111-4111-8111-111111111111';
  const operationId = '22222222-2222-4222-8222-222222222222';
  await host.open(sessionId, { host: 'server.example.net', port: 22 }, { username: 'alice', password: 'secret' },
    { columns: 80, rows: 24 }, async () => true);
  const cancellation = new AbortController();
  const upload = host.uploadRemoteFile(sessionId, operationId, 'C:\\private\\report.txt', '/home/alice', 'report.txt', 'overwrite', cancellation.signal);
  await new Promise<void>(resolve => setImmediate(resolve));
  cancellation.abort();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.ok(worker.requests.some(request => request.command === 'files.cancel'));
  worker.emitCommitProgress();
  await new Promise<void>(resolve => setImmediate(resolve));
  context.mock.timers.tick(10_001);
  assert.equal(worker.killed, false, 'the original cancellation grace must be extended for commit settlement');
  worker.finishTransfer();
  assert.deepEqual(await upload, { direction: 'upload', fileName: 'report.txt', bytesTransferred: 10, state: 'completed' });
  await host.shutdown();
});

test('worker host keeps a trusted SSH worker alive through the full SFTP setup and listing budget', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const worker = new UnresponsiveListUtilityProcess();
  const host = new SshTerminalWorkerHost('ssh-worker.js', 'desktop-app', () => worker as unknown as UtilityProcess);
  const sessionId = '11111111-1111-4111-8111-111111111111';
  await host.open(sessionId, { host: 'server.example.net', port: 22 }, { username: 'alice', password: 'secret' },
    { columns: 80, rows: 24 }, async () => true);

  let settled = false;
  const listing = host.listRemoteDirectory(sessionId, '/home/alice')
    .then(() => { settled = true; }, () => { settled = true; });
  await new Promise<void>(resolve => setImmediate(resolve));
  context.mock.timers.tick(25_000);
  await new Promise<void>(resolve => setImmediate(resolve));
  const survivedInnerBudget = !worker.killed && !settled;
  await host.shutdown();
  await listing;
  assert.equal(survivedInnerBudget, true);
});
