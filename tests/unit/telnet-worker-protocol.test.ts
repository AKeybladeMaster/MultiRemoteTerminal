import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTelnetWorkerInput, parseTelnetWorkerMessage, TELNET_WORKER_PROTOCOL_VERSION } from '../../apps/desktop/src/workers/telnet-worker-protocol.ts';

const requestId = '22222222-2222-4222-8222-222222222222';
const sessionId = '11111111-1111-4111-8111-111111111111';

test('Telnet worker accepts only exact canonical requests and bounded terminal input', () => {
  const open = { version: TELNET_WORKER_PROTOCOL_VERSION, type: 'request', requestId, command: 'open', sessionId,
    endpoint: { host: 'console.example.net', port: 23 }, size: { columns: 80, rows: 24 } };
  assert.equal(parseTelnetWorkerInput(open)?.type, 'request');
  assert.equal(parseTelnetWorkerInput({ ...open, secret: 'must not cross the worker boundary' }), undefined);
  assert.equal(parseTelnetWorkerInput({ ...open, endpoint: { host: 'Console.Example.Net.', port: 23 } }), undefined);

  const write = { version: 1, type: 'request', requestId, command: 'write', sessionId, data: '\0' };
  assert.equal(parseTelnetWorkerInput(write)?.type, 'request', 'terminal control characters remain available');
  assert.equal(parseTelnetWorkerInput({ ...write, data: 'x'.repeat(16_385) }), undefined);
});

test('Telnet worker replies and events reject extra or oversized values', () => {
  const reply = { version: 1, type: 'reply', requestId, ok: true, result: {} };
  assert.equal(parseTelnetWorkerMessage(reply)?.type, 'reply');
  assert.equal(parseTelnetWorkerMessage({ ...reply, secret: 'private' }), undefined);
  const output = { version: 1, type: 'event', event: { kind: 'data', sessionId, sequence: 1, data: 'x'.repeat(16_385) } };
  assert.equal(parseTelnetWorkerMessage(output), undefined);
});
