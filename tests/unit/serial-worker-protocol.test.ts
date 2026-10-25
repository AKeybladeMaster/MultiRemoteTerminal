import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSerialWorkerInput, parseSerialWorkerMessage } from '../../apps/desktop/src/workers/serial-worker-protocol.ts';

const id = 'a540e2c4-402e-4a33-86fc-60aaea747672';
const configuration = { path: 'COM19', baudRate: 9_600, dataBits: 8, parity: 'none', stopBits: 1, flowControl: 'none' };

test('serial worker protocol accepts only bounded, versioned requests and messages', () => {
  const base = { version: 1, type: 'request', requestId: id };
  assert.equal(parseSerialWorkerInput({ ...base, command: 'open', sessionId: id, configuration })?.type, 'request');
  assert.equal(parseSerialWorkerInput({ ...base, command: 'open', sessionId: id, configuration, password: 'secret' }), undefined);
  assert.equal(parseSerialWorkerInput({ ...base, command: 'write', sessionId: id, data: 'x'.repeat(1_025) }), undefined);
  assert.equal(parseSerialWorkerInput({ ...base, command: 'list', version: 2 }), undefined);
  assert.equal(parseSerialWorkerMessage({ version: 1, type: 'reply', requestId: id, ok: true, result: { ports: [{ path: 'COM19' }] } })?.type, 'reply');
  assert.equal(parseSerialWorkerMessage({ version: 1, type: 'reply', requestId: id, ok: false, errorCode: 'AUTHENTICATION_FAILED' }), undefined);
  assert.equal(parseSerialWorkerMessage({ version: 1, type: 'event', event: { kind: 'data', sessionId: id, sequence: 1, data: 'x'.repeat(16_385) } }), undefined);
});
