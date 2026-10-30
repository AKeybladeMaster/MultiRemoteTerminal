import test from 'node:test';
import assert from 'node:assert/strict';
import { createX11ExtensionQueryRequests, parseX11ExtensionReplies, parseX11SetupResponse } from '../../packages/domain/src/x11.ts';

test('X11 setup response parsing bounds the server setup data', () => {
  const response = Buffer.alloc(12);
  response[0] = 1;
  response.writeUInt16LE(11, 2);
  response.writeUInt16LE(1, 6);
  assert.deepEqual(parseX11SetupResponse(response.subarray(0, 7)), { kind: 'incomplete' });
  assert.deepEqual(parseX11SetupResponse(response.subarray(0, 8)), { kind: 'incomplete' });
  assert.deepEqual(parseX11SetupResponse(response), { kind: 'complete', packetLength: 12 });
  response[0] = 0;
  assert.deepEqual(parseX11SetupResponse(response), { kind: 'invalid' });
});

test('X11 extension query asks only for GLX, Composite, and RandR and parses ordered replies', () => {
  const request = createX11ExtensionQueryRequests();
  assert.equal(request.byteLength, 48);
  assert.deepEqual([
    Buffer.from(request.subarray(8, 11)).toString('ascii'),
    Buffer.from(request.subarray(20, 29)).toString('ascii'),
    Buffer.from(request.subarray(40, 45)).toString('ascii')
  ], ['GLX', 'Composite', 'RANDR']);

  const replies = Buffer.alloc(96);
  for (let index = 0; index < 3; index += 1) {
    const offset = index * 32;
    replies[offset] = 1;
    replies[offset + 1] = index === 1 ? 0 : 1;
    replies.writeUInt16LE(index + 1, offset + 2);
    replies[offset + 8] = index === 1 ? 0 : index + 1;
  }
  assert.deepEqual(parseX11ExtensionReplies(replies), {
    kind: 'complete', capabilities: { glx: true, composite: false, randr: true }
  });
  replies[66] = 9;
  assert.deepEqual(parseX11ExtensionReplies(replies), { kind: 'invalid' });
});
