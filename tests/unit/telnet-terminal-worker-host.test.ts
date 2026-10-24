import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { UtilityProcess } from 'electron';
import { TelnetTerminalWorkerHost } from '../../apps/desktop/src/adapters/telnet-terminal-worker-host.ts';

const sessionId = '11111111-1111-4111-8111-111111111111';

class FakeUtilityProcess extends EventEmitter {
  readonly requests: Array<Record<string, unknown>> = [];
  killed = false;

  postMessage(value: unknown): void {
    const request = value as Record<string, unknown>;
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

class HangingUtilityProcess extends FakeUtilityProcess {
  override postMessage(value: unknown): void {
    this.requests.push(value as Record<string, unknown>);
  }
}

test('Telnet worker host bounds its lifecycle commands and shuts down the utility process', async () => {
  const worker = new FakeUtilityProcess();
  const host = new TelnetTerminalWorkerHost('telnet-worker.js', 'desktop-app', () => worker as unknown as UtilityProcess);
  await host.open(sessionId, { host: 'console.example.net', port: 23 }, { columns: 80, rows: 24 });
  await host.write(sessionId, 'hello\r');
  await host.resize(sessionId, { columns: 100, rows: 35 });
  await host.acknowledgeOutput(sessionId, 1);
  await host.close(sessionId);
  await host.shutdown();

  assert.deepEqual(worker.requests.map(request => request.command), ['open', 'write', 'resize', 'ack', 'close', 'shutdown']);
  assert.equal(worker.killed, true);
});

test('Telnet worker crash rejects pending opens and reports a session failure', async () => {
  const worker = new HangingUtilityProcess();
  const host = new TelnetTerminalWorkerHost('telnet-worker.js', 'desktop-app', () => worker as unknown as UtilityProcess);
  const events: unknown[] = [];
  host.subscribe(event => events.push(event));
  const opening = host.open(sessionId, { host: 'console.example.net', port: 23 }, { columns: 80, rows: 24 });
  await new Promise<void>(resolve => setImmediate(resolve));
  worker.emit('exit', 9);
  await assert.rejects(opening, error => (error as { code?: string }).code === 'UNAVAILABLE');
  assert.equal(events.some(event => (event as { kind?: unknown }).kind === 'failure'), true);
  await host.shutdown();
});
