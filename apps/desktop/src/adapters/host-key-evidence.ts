import { createHash } from 'node:crypto';
import type * as Ssh2 from 'ssh2';
import { isHostKeyEvidence, MAX_HOST_KEY_BYTES, sshPublicKeyAlgorithm } from '../../../../packages/domain/src/host-trust.ts';
import type { HostKeyEvidence } from '../../../../packages/domain/src/host-trust.ts';

export type SshHostKeyParser = typeof Ssh2.utils.parseKey;

export function evidenceFromSsh2HostKey(input: unknown, parseKey: SshHostKeyParser): HostKeyEvidence | undefined {
  if (!Buffer.isBuffer(input) || input.byteLength > MAX_HOST_KEY_BYTES) return undefined;
  const publicKey = Uint8Array.from(input);
  const algorithm = sshPublicKeyAlgorithm(publicKey);
  if (!algorithm) return undefined;
  let parsedKey;
  try {
    parsedKey = parseKey(input);
  } catch {
    return undefined;
  }
  if (parsedKey instanceof Error || parsedKey.isPrivateKey() || parsedKey.type !== algorithm) return undefined;
  const fingerprint = `SHA256:${createHash('sha256').update(publicKey).digest('base64').replace(/=+$/, '')}`;
  const evidence = { algorithm, fingerprint, publicKey };
  return isHostKeyEvidence(evidence) ? evidence : undefined;
}
