import test from 'node:test';
import assert from 'node:assert/strict';
import { createTftpDataPacket, createTftpErrorPacket, parseTftpAcknowledgement, parseTftpRequest } from '../../apps/desktop/src/workers/tftp-server-protocol.ts';

function request(opcode: number, fields: readonly string[]): Buffer {
  return Buffer.concat([Buffer.from([0, opcode]), ...fields.map(field => Buffer.concat([Buffer.from(field, 'ascii'), Buffer.from([0])]))]);
}

test('TFTP parser accepts octet reads and ignores well-formed options', () => {
  const parsed = parseTftpRequest(request(1, ['firmware.bin', 'octet', 'blksize', '1428']));
  assert.deepEqual(parsed, { ok: true, result: { kind: 'read', fileName: 'firmware.bin' } });
});

test('TFTP parser rejects writes, traversal, unsupported mode, and malformed fields', () => {
  for (const [packet, code] of [
    [request(2, ['target.bin', 'octet']), 2],
    [request(1, ['../secret.txt', 'octet']), 2],
    [request(1, ['folder\\secret.txt', 'octet']), 2],
    [request(1, ['CON.txt', 'octet']), 2],
    [request(1, ['file.txt', 'netascii']), 4],
    [Buffer.from([0, 1, 0x66, 0x69, 0x6c, 0x65]), 4]
  ] as const) {
    const parsed = parseTftpRequest(packet);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.equal(parsed.error.code, code);
  }
});

test('TFTP packet helpers encode bounded DATA, ACK, and sanitized ERROR packets', () => {
  const data = createTftpDataPacket(258, Buffer.from([1, 2, 3]));
  assert.deepEqual([...data], [0, 3, 1, 2, 1, 2, 3]);
  assert.equal(parseTftpAcknowledgement(Buffer.from([0, 4, 1, 2])), 258);
  assert.equal(parseTftpAcknowledgement(Buffer.from([0, 4, 1])), undefined);
  assert.deepEqual([...createTftpErrorPacket(2, 'Bad\npath')], [0, 5, 0, 2, 66, 97, 100, 112, 97, 116, 104, 0]);
  assert.deepEqual([...createTftpErrorPacket(4, 'Illegal TFTP operation')].slice(0, 4), [0, 5, 0, 4]);
  assert.deepEqual([...createTftpErrorPacket(5, 'Unknown transfer ID')].slice(0, 4), [0, 5, 0, 5]);
  assert.throws(() => createTftpDataPacket(1, Buffer.alloc(513)));
});
