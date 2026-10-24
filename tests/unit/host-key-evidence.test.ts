import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { evidenceFromSsh2HostKey } from '../../apps/desktop/src/adapters/host-key-evidence.ts';
import type { SshHostKeyParser } from '../../apps/desktop/src/adapters/host-key-evidence.ts';

const requireDesktop = createRequire(new URL('../../apps/desktop/package.json', import.meta.url));
const ssh2 = requireDesktop('ssh2') as { readonly utils: { readonly parseKey: SshHostKeyParser } };
const parseKey = ssh2.utils.parseKey;

test('ssh2 host key evidence contains the SSH algorithm and SHA-256 fingerprint without retaining its Buffer', () => {
  const rawKey = sshPublicKey('ssh-ed25519', Buffer.alloc(32, 0x5a));
  const evidence = evidenceFromSsh2HostKey(rawKey, parseKey);
  assert.ok(evidence);
  assert.equal(evidence.algorithm, 'ssh-ed25519');
  assert.equal(evidence.fingerprint, `SHA256:${createHash('sha256').update(rawKey).digest('base64').replace(/=+$/, '')}`);
  rawKey.fill(0);
  assert.notDeepEqual(Buffer.from(evidence.publicKey), rawKey);
});

test('malformed, oversized, non-Buffer, and non-ASCII SSH host keys fail closed', () => {
  assert.equal(evidenceFromSsh2HostKey(Buffer.from([0, 0, 0, 4, 0x61]), parseKey), undefined);
  assert.equal(evidenceFromSsh2HostKey(sshPublicKeyWithoutPayloadLength('ssh-ed25519', Buffer.alloc(32)), parseKey), undefined);
  assert.equal(evidenceFromSsh2HostKey(sshPublicKey('ssh-ed25519', Buffer.alloc(31)), parseKey), undefined);
  assert.equal(evidenceFromSsh2HostKey(sshPublicKey('ssh-ed25519', Buffer.alloc(32), true), parseKey), undefined);
  assert.equal(evidenceFromSsh2HostKey(sshPublicKey('ssh-ed25519', Buffer.alloc(64 * 1024)), parseKey), undefined);
  assert.equal(evidenceFromSsh2HostKey(new Uint8Array([0, 0, 0, 1, 0x61]), parseKey), undefined);
});

function sshPublicKey(algorithm: string, payload: Buffer, nonAscii = false): Buffer {
  const name = Buffer.from(algorithm, 'ascii');
  if (nonAscii) name[0] = 0xff;
  return Buffer.concat([sshString(name), sshString(payload)]);
}

function sshPublicKeyWithoutPayloadLength(algorithm: string, payload: Buffer): Buffer {
  return Buffer.concat([sshString(Buffer.from(algorithm, 'ascii')), payload]);
}

function sshString(value: Buffer): Buffer {
  const result = Buffer.alloc(4 + value.length);
  result.writeUInt32BE(value.length, 0);
  value.copy(result, 4);
  return result;
}
