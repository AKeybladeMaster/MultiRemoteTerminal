import test from 'node:test';
import assert from 'node:assert/strict';
import { isDescribeReply, parseRequest } from '../../packages/contracts/src/commands.ts';
import { describeWorkbench } from '../../packages/application/src/workbench.ts';

const request = { command: 'app.describe', requestId: '5726a2ee-03cd-4f5a-a28c-bd72784f80a6', contractVersion: 1, payload: {} };

test('accepts only the versioned read-only command', () => {
  assert.deepEqual(parseRequest(request), { ok: true, result: request });
  assert.deepEqual(describeWorkbench({ version: '0.0.0', platform: 'win32' }), {
    name: 'MultiRemoteTerminal', version: '0.0.0', platform: 'win32', stage: 'foundation'
  });
});

test('rejects malformed, extra, oversized, and incompatible request fields', () => {
  for (const input of [null, [], 'app.describe', {}, { ...request, contractVersion: 2 },
    { ...request, requestId: '../secret' }, { ...request, requestId: 'a'.repeat(100000) },
    { ...request, payload: { shell: 'powershell' } }, { ...request, payload: { text: 'x'.repeat(1000000) } },
    { ...request, payload: [] }, { ...request, secret: 'must not pass' }, { ...request, payload: null }]) {
    const result = parseRequest(input);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'INVALID_REQUEST');
  }
  const open = { command: 'terminal.open', requestId: request.requestId, contractVersion: 1,
    payload: { sessionId: request.requestId, shell: 'powershell', columns: 80, rows: 24 } };
  assert.equal(parseRequest(open).ok, true);
  assert.equal(parseRequest({ ...open, payload: { ...open.payload, sessionId: 'bad' } }).ok, false);
});

test('unknown commands never become privileged capabilities', () => {
  for (const command of ['runtime.open', 'fs.readFile', '__proto__', 'constructor', 'mrt:admin']) {
    assert.deepEqual(parseRequest({ ...request, command }), { ok: false, error: { code: 'UNKNOWN_COMMAND', target: 'application', retryable: false } });
  }
});

test('validates reply identity, shape and length; rejects secret-bearing replies', () => {
  const reply = { requestId: request.requestId, ok: true, result: describeWorkbench({ version: '0.0.0', platform: 'win32' }) };
  assert.equal(isDescribeReply(reply, request.requestId), true);
  for (const input of [null, { ...reply, requestId: 'wrong' }, { ...reply, secret: 'hidden' },
    { ...reply, result: { ...reply.result, secret: 'hidden' } }, { ...reply, result: { ...reply.result, version: 'a'.repeat(10000) } },
    { requestId: request.requestId, ok: false, error: { code: 'UNAVAILABLE', target: 'application', retryable: true, stack: 'private' } }]) {
    assert.equal(isDescribeReply(input, request.requestId), false);
  }
});
