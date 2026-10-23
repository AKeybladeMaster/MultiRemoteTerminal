import { createHash } from 'node:crypto';
import { isHostKeyEvidence, MAX_HOST_KEY_BYTES, sshPublicKeyAlgorithm } from '../../../../packages/domain/src/host-trust.ts';
import type { HostKeyEvidence } from '../../../../packages/domain/src/host-trust.ts';

export function evidenceFromSsh2HostKey(input: unknown): HostKeyEvidence | undefined {
  if (!Buffer.isBuffer(input) || input.byteLength > MAX_HOST_KEY_BYTES) return undefined;
  const publicKey = Uint8Array.from(input);
  const algorithm = sshPublicKeyAlgorithm(publicKey);
  if (!algorithm) return undefined;
  const fingerprint = `SHA256:${createHash('sha256').update(publicKey).digest('base64').replace(/=+$/, '')}`;
  const evidence = { algorithm, fingerprint, publicKey };
  return isHostKeyEvidence(evidence) ? evidence : undefined;
}
