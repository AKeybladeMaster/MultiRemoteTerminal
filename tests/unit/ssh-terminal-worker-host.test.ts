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
