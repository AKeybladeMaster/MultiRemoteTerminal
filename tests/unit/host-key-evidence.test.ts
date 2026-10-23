import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { evidenceFromSsh2HostKey } from '../../apps/desktop/src/adapters/host-key-evidence.ts';

test('ssh2 host key evidence contains the SSH algorithm and SHA-256 fingerprint without retaining its Buffer', () => {
  const rawKey = sshPublicKey('ssh-ed25519', Buffer.alloc(32, 0x5a));
  const evidence = evidenceFromSsh2HostKey(rawKey);
  assert.ok(evidence);
  assert.equal(evidence.algorithm, 'ssh-ed25519');
  assert.equal(evidence.fingerprint, `SHA256:${createHash('sha256').update(rawKey).digest('base64').replace(/=+$/, '')}`);
  rawKey.fill(0);
  assert.notDeepEqual(Buffer.from(evidence.publicKey), rawKey);
});

test('malformed, oversized, non-Buffer, and non-ASCII SSH host keys fail closed', () => {
  assert.equal(evidenceFromSsh2HostKey(Buffer.from([0, 0, 0, 4, 0x61])), undefined);
  assert.equal(evidenceFromSsh2HostKey(sshPublicKey('ssh-ed25519', Buffer.alloc(32), true)), undefined);
  assert.equal(evidenceFromSsh2HostKey(sshPublicKey('ssh-ed25519', Buffer.alloc(64 * 1024))), undefined);
  assert.equal(evidenceFromSsh2HostKey(new Uint8Array([0, 0, 0, 1, 0x61])), undefined);
});

function sshPublicKey(algorithm: string, payload: Buffer, nonAscii = false): Buffer {
  const name = Buffer.from(algorithm, 'ascii');
  if (nonAscii) name[0] = 0xff;
  const key = Buffer.alloc(4 + name.length + payload.length);
  key.writeUInt32BE(name.length, 0);
  name.copy(key, 4);
  payload.copy(key, 4 + name.length);
  return key;
}
