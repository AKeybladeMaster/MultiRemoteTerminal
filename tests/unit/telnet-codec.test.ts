import test from 'node:test';
import assert from 'node:assert/strict';
import { TelnetCodec } from '../../apps/desktop/src/workers/telnet-codec.ts';

const IAC = 255;
const DO = 253;
const WILL = 251;
const SB = 250;
const SE = 240;
const BINARY = 0;
const ECHO = 1;
const TERMINAL_TYPE = 24;
const WINDOW_SIZE = 31;

function bytes(...value: number[]): Uint8Array { return Uint8Array.from(value); }
function combine(...parts: readonly Uint8Array[]): number[] { return parts.flatMap(part => [...part]); }

test('Telnet codec requests only bounded terminal options and parses fragmented negotiation', () => {
  const codec = new TelnetCodec({ columns: 80, rows: 24 });
  assert.deepEqual(combine(codec.start()), [
    IAC, WILL, BINARY, IAC, DO, BINARY,
    IAC, WILL, 3, IAC, DO, 3,
    IAC, WILL, TERMINAL_TYPE, IAC, WILL, WINDOW_SIZE
  ]);

  const first = codec.receive(bytes(IAC, WILL));
  assert.deepEqual([...first.data], []);
  assert.deepEqual(first.replies, []);
  const second = codec.receive(bytes(ECHO, ...new TextEncoder().encode('login:')));
  assert.equal(new TextDecoder().decode(second.data), 'login:');
  assert.deepEqual(combine(...second.replies), [IAC, DO, ECHO]);
  assert.deepEqual(codec.receive(bytes(IAC, WILL, ECHO)).replies, [], 'repeated WILL for an enabled option cannot trigger negotiation chatter');
});

test('Telnet codec negotiates terminal type and window size without exposing control bytes', () => {
  const codec = new TelnetCodec({ columns: 80, rows: 24 });
  codec.start();
  const negotiation = codec.receive(bytes(
    IAC, DO, WINDOW_SIZE,
    IAC, DO, TERMINAL_TYPE,
    IAC, SB, TERMINAL_TYPE, 1, IAC, SE,
    65, IAC, IAC, 66
  ));
  assert.deepEqual([...negotiation.data], [65, IAC, 66]);
  assert.deepEqual(combine(...negotiation.replies), [
    IAC, SB, WINDOW_SIZE, 0, 80, 0, 24, IAC, SE,
    IAC, SB, TERMINAL_TYPE, 0, ...new TextEncoder().encode('XTERM-256COLOR'), IAC, SE
  ]);
  const repeatedNegotiation = codec.receive(bytes(
    IAC, DO, WINDOW_SIZE,
    ...Array<number>(20).fill(0).flatMap(() => [IAC, SB, TERMINAL_TYPE, 1, IAC, SE])
  ));
  assert.deepEqual(repeatedNegotiation.replies, [], 'duplicate option requests cannot amplify into repeated reports');
  const resized = codec.resize({ columns: 132, rows: 43 });
  assert.ok(resized);
  assert.deepEqual([...resized], [IAC, SB, WINDOW_SIZE, 0, 132, 0, 43, IAC, SE]);
});

test('Telnet codec bounds malformed subnegotiations and rejects unsupported options once', () => {
  const codec = new TelnetCodec({ columns: 80, rows: 24 });
  const unsupported = codec.receive(bytes(IAC, DO, 99, IAC, DO, 99, IAC, WILL, 100, IAC, WILL, 100));
  assert.deepEqual(combine(...unsupported.replies), [IAC, 252, 99, IAC, 254, 100]);

  const oversized = codec.receive(bytes(IAC, SB, TERMINAL_TYPE, ...Array<number>(513).fill(65), IAC, SE, 111, 107));
  assert.deepEqual([...oversized.data], [111, 107]);
  assert.deepEqual(oversized.replies, []);
});

test('Telnet input uses NVT line endings until binary mode is accepted and preserves UTF-8 after negotiation', () => {
  const codec = new TelnetCodec({ columns: 80, rows: 24 });
  codec.start();
  assert.deepEqual([...codec.encodeInput('one\r\ntwo\nthree\r')], [
    ...new TextEncoder().encode('one\r\ntwo\r\nthree\r\0')
  ]);
  assert.deepEqual([...codec.encodeInput('a\0b')], [...new TextEncoder().encode('a\0b')]);
  codec.receive(bytes(IAC, DO, BINARY, IAC, WILL, BINARY));
  assert.deepEqual([...codec.encodeInput('é\r')], [...new TextEncoder().encode('é\r')]);
});
