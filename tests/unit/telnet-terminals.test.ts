import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import type { LocalTerminalEvent } from '../../packages/application/src/local-terminals.ts';
import { createTelnetTerminalController } from '../../packages/application/src/telnet-terminals.ts';
import type { TelnetTerminalProvider } from '../../packages/application/src/telnet-terminals.ts';
import { createTelnetTransportProvider } from '../../apps/desktop/src/workers/telnet-transport-provider.ts';

const sessionId = '18f2f903-7b6f-4c8d-9c42-b63a58c4b087';
const size = { columns: 80, rows: 24 };
const IAC = 255;
const DO = 253;
const WILL = 251;
const SB = 250;
const SE = 240;
const BINARY = 0;
const ECHO = 1;
const SUPPRESS_GO_AHEAD = 3;
const TERMINAL_TYPE = 24;
const WINDOW_SIZE = 31;

class FakeTelnetProvider implements TelnetTerminalProvider {
  readonly events = new Set<(event: LocalTerminalEvent) => void>();
  opened: { sessionId: string; host: string; port: number } | undefined;
  readonly writes: string[] = [];
  closed: string[] = [];
  async open(id: string, endpoint: { readonly host: string; readonly port: number }): Promise<void> { this.opened = { sessionId: id, ...endpoint }; }
  async write(_id: string, data: string): Promise<void> { this.writes.push(data); }
  async resize(): Promise<void> {}
  async acknowledgeOutput(): Promise<void> {}
  async close(id: string): Promise<void> { this.closed.push(id); }
  async shutdown(): Promise<void> {}
  subscribe(listener: (event: LocalTerminalEvent) => void): () => void { this.events.add(listener); return () => this.events.delete(listener); }
}

test('Telnet controller canonicalizes endpoints and keeps credentials outside the provider contract', async () => {
  const provider = new FakeTelnetProvider();
  const controller = createTelnetTerminalController(provider);
  const opened = await controller.open(sessionId, 'Console.Example.com.', 23, size);
  assert.deepEqual(opened, { ok: true, result: { sessionId, endpoint: { host: 'console.example.com', port: 23 }, state: 'running' } });
  assert.deepEqual(provider.opened, { sessionId, host: 'console.example.com', port: 23 });
  assert.deepEqual(await controller.write(sessionId, 'hello\r'), { ok: true, result: {} });
  assert.deepEqual(provider.writes, ['hello\r']);
  assert.deepEqual(await controller.open(sessionId, 'example.com', 0, size), {
    ok: false, error: { code: 'INVALID_REQUEST', target: 'application', retryable: false }
  });
  assert.deepEqual(await controller.close(sessionId), { ok: true, result: {} });
  assert.deepEqual(provider.closed, [sessionId]);
  await controller.dispose();
});

test('Telnet provider performs bounded TCP terminal negotiation, input, resize, output and close', async context => {
  const server = createServer();
  let peer: Socket | undefined;
  const clientBytes: number[] = [];
  let resolveClientData!: () => void;
  const sawClientData = new Promise<void>(resolve => { resolveClientData = resolve; });
  server.on('connection', socket => {
    peer = socket;
    socket.on('data', chunk => {
      clientBytes.push(...chunk);
      resolveClientData();
    });
    socket.write(Buffer.from([
      IAC, DO, BINARY, IAC, WILL, BINARY,
      IAC, WILL, ECHO, IAC, DO, SUPPRESS_GO_AHEAD,
      IAC, DO, TERMINAL_TYPE, IAC, DO, WINDOW_SIZE,
      IAC, SB, TERMINAL_TYPE, 1, IAC, SE,
      ...Buffer.from('login: ')
    ]));
  });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => { server.off('listening', onListening); reject(error); };
    const onListening = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.listen(0, '127.0.0.1', onListening);
  });
  context.after(async () => {
    peer?.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Loopback server did not bind');

  const events: LocalTerminalEvent[] = [];
  const provider = createTelnetTransportProvider(() => {});
  const controller = createTelnetTerminalController(provider);
  controller.subscribe(event => events.push(event));
  const opened = await controller.open(sessionId, '127.0.0.1', address.port, size);
  assert.equal(opened.ok, true);
  await waitUntil(() => events.some(event => event.kind === 'data' && event.data.includes('login:')));
  await sawClientData;

  const written = await controller.write(sessionId, 'admin\r');
  assert.equal(written.ok, true);
  await waitUntil(() => Buffer.from(clientBytes).includes(Buffer.from('admin\r')));
  assert.equal(Buffer.from(clientBytes).includes(Buffer.from('admin\r\0')), false, 'accepted BINARY mode preserves raw terminal carriage return');

  const resized = await controller.resize(sessionId, { columns: 132, rows: 43 });
  assert.equal(resized.ok, true);
  await waitUntil(() => containsSequence(clientBytes, [IAC, SB, WINDOW_SIZE, 0, 132, 0, 43, IAC, SE]));
  assert.equal(containsSequence(clientBytes, [IAC, SB, TERMINAL_TYPE, 0, ...Buffer.from('XTERM-256COLOR'), IAC, SE]), true);
  assert.equal(containsSequence(clientBytes, [IAC, WILL, BINARY, IAC, DO, BINARY]), true, 'the app negotiates the binary option in both directions');

  peer?.write(Buffer.from('remote output'));
  await waitUntil(() => events.some(event => event.kind === 'data' && event.data.includes('remote output')));
  assert.equal(await controller.acknowledgeOutput(sessionId, Math.max(1, ...events.filter((event): event is Extract<LocalTerminalEvent, { kind: 'data' }> => event.kind === 'data').map(event => event.sequence))).then(reply => reply.ok), true);
  assert.equal((await controller.close(sessionId)).ok, true);
  await controller.dispose();
});

function containsSequence(haystack: readonly number[], needle: readonly number[]): boolean {
  return haystack.some((_, start) => needle.every((byte, offset) => haystack[start + offset] === byte));
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 3_000) throw new Error('Timed out waiting for loopback Telnet behavior');
    await new Promise<void>(resolve => setTimeout(resolve, 5));
  }
}
