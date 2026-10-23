import type { Outcome } from '../../domain/src/errors.ts';
import { failure } from '../../domain/src/errors.ts';
import { canonicalizeSshHostEndpoint, hostEndpointKey, isHostKeyEvidence, sameHostKey } from '../../domain/src/host-trust.ts';
import type { HostKeyEvidence, SshHostEndpoint, TrustedHostKey } from '../../domain/src/host-trust.ts';

export type HostTrustInsertResult = 'inserted' | 'matched' | 'changed';

export interface HostTrustStore {
  find(endpoint: SshHostEndpoint): Promise<TrustedHostKey | undefined>;
  trustIfAbsent(identity: TrustedHostKey): Promise<HostTrustInsertResult>;
  remove(endpoint: SshHostEndpoint): Promise<boolean>;
}

export class HostTrustStoreError extends Error {
  readonly kind: 'busy' | 'corrupt' | 'unavailable';

  constructor(kind: 'busy' | 'corrupt' | 'unavailable') {
    super(`Host trust store ${kind}`);
    this.name = 'HostTrustStoreError';
    this.kind = kind;
  }
}

export interface HostTrustRuntime {
  createToken(): string;
  monotonicNow(): number;
  wallNow(): number;
  schedule(callback: () => void, delayMs: number): () => void;
}

export interface HostKeyChallenge {
  readonly token: string;
  readonly host: string;
  readonly port: number;
  readonly algorithm: string;
  readonly fingerprint: string;
}

export type HostTrustDecision =
  | { readonly kind: 'trusted' }
  | { readonly kind: 'approval-required'; readonly challenge: HostKeyChallenge }
  | { readonly kind: 'changed'; readonly host: string; readonly port: number; readonly algorithm: string; readonly fingerprint: string }
  | { readonly kind: 'approved' }
  | { readonly kind: 'rejected' };

export interface HostTrustManager {
  inspect(endpoint: unknown, evidence: unknown): Promise<Outcome<HostTrustDecision>>;
  approve(token: unknown): Promise<Outcome<HostTrustDecision>>;
  reject(token: unknown): Outcome<HostTrustDecision>;
  revoke(endpoint: unknown): Promise<Outcome<Record<string, never>>>;
  dispose(): void;
}

const MAX_PENDING_APPROVALS = 64;
const APPROVAL_LIFETIME_MS = 2 * 60 * 1000;
const EMPTY_RESULT: Record<string, never> = Object.freeze({});

interface PendingApproval {
  readonly token: string;
  readonly identity: TrustedHostKey;
  readonly dedupeKey: string;
  readonly expiresAt: number;
  cancelExpiry: () => void;
}

export function createHostTrustManager(store: HostTrustStore, runtime: HostTrustRuntime): HostTrustManager {
  const pending = new Map<string, PendingApproval>();
  const byEvidence = new Map<string, string>();
  let disposed = false;

  function removePending(token: string): boolean {
    const challenge = pending.get(token);
    if (!challenge) return false;
    pending.delete(token);
    byEvidence.delete(challenge.dedupeKey);
    challenge.cancelExpiry();
    return true;
  }

  function removeEndpointPending(endpoint: SshHostEndpoint): void {
    const key = hostEndpointKey(endpoint);
    for (const item of [...pending.values()]) if (hostEndpointKey(item.identity.endpoint) === key) removePending(item.token);
  }

  function makeDedupeKey(endpoint: SshHostEndpoint, evidence: HostKeyEvidence): string {
    let key = '';
    for (const byte of evidence.publicKey) key += byte.toString(16).padStart(2, '0');
    return `${hostEndpointKey(endpoint)}|${evidence.algorithm}|${evidence.fingerprint}|${key}`;
  }

  function mapStoreFailure(error: unknown): ReturnType<typeof failure> {
    return failure(error instanceof HostTrustStoreError && error.kind === 'busy' ? 'BUSY' : 'UNAVAILABLE');
  }

  function changedDecision(endpoint: SshHostEndpoint, evidence: HostKeyEvidence): HostTrustDecision {
    return { kind: 'changed', host: endpoint.host, port: endpoint.port, algorithm: evidence.algorithm, fingerprint: evidence.fingerprint };
  }

  return Object.freeze({
    async inspect(endpointInput: unknown, evidenceInput: unknown): Promise<Outcome<HostTrustDecision>> {
      if (disposed) return failure('CANCELLED');
      const endpoint = canonicalizeSshHostEndpoint(endpointInput);
      if (!endpoint || !isHostKeyEvidence(evidenceInput)) return failure('INVALID_REQUEST');
      const evidence: HostKeyEvidence = { algorithm: evidenceInput.algorithm, fingerprint: evidenceInput.fingerprint, publicKey: Uint8Array.from(evidenceInput.publicKey) };
      try {
        const current = await store.find(endpoint);
        if (disposed) return failure('CANCELLED');
        if (current) {
          removeEndpointPending(endpoint);
          return { ok: true, result: sameHostKey(current, evidence) ? { kind: 'trusted' } : changedDecision(endpoint, evidence) };
        }

        const dedupeKey = makeDedupeKey(endpoint, evidence);
        const existingToken = byEvidence.get(dedupeKey);
        const existing = existingToken ? pending.get(existingToken) : undefined;
        if (existing && runtime.monotonicNow() < existing.expiresAt) {
          return { ok: true, result: { kind: 'approval-required', challenge: challengeView(existing) } };
        }
        if (existing) removePending(existing.token);
        if (pending.size >= MAX_PENDING_APPROVALS) return failure('BUSY');

        const token = runtime.createToken();
        if (typeof token !== 'string' || token.length < 16 || token.length > 256 || pending.has(token)) return failure('UNAVAILABLE');
        const identity: TrustedHostKey = {
          endpoint,
          algorithm: evidence.algorithm,
          fingerprint: evidence.fingerprint,
          publicKey: evidence.publicKey,
          trustedAt: 0,
          approvalSource: 'user'
        };
        const now = runtime.monotonicNow();
        if (!Number.isFinite(now) || now < 0) return failure('UNAVAILABLE');
        const item: PendingApproval = { token, identity, dedupeKey, expiresAt: now + APPROVAL_LIFETIME_MS, cancelExpiry: () => {} };
        pending.set(token, item);
        byEvidence.set(dedupeKey, token);
        try {
          const cancelExpiry = runtime.schedule(() => removePending(token), APPROVAL_LIFETIME_MS);
          if (!pending.has(token)) {
            cancelExpiry();
            return failure('CANCELLED');
          }
          item.cancelExpiry = cancelExpiry;
        } catch {
          removePending(token);
          return failure('UNAVAILABLE');
        }
        return { ok: true, result: { kind: 'approval-required', challenge: challengeView(item) } };
      } catch (error) {
        return mapStoreFailure(error);
      }
    },

    async approve(tokenInput: unknown): Promise<Outcome<HostTrustDecision>> {
      if (disposed) return failure('CANCELLED');
      if (typeof tokenInput !== 'string' || tokenInput.length < 16 || tokenInput.length > 256) return failure('INVALID_REQUEST');
      const item = pending.get(tokenInput);
      if (!item) return failure('NOT_FOUND');
      const now = runtime.monotonicNow();
      if (!Number.isFinite(now) || now < 0) return failure('UNAVAILABLE');
      if (now >= item.expiresAt) {
        removePending(item.token);
        return failure('CANCELLED');
      }
      // Approval is a one-shot user action. Claim it before the first await so
      // reject, expiry and teardown cannot race a persisted approval.
      removePending(item.token);
      const trustedAt = runtime.wallNow();
      if (!Number.isSafeInteger(trustedAt) || trustedAt < 0) return failure('UNAVAILABLE');
      const identity: TrustedHostKey = { ...item.identity, publicKey: Uint8Array.from(item.identity.publicKey), trustedAt };
      try {
        const result = await store.trustIfAbsent(identity);
        return { ok: true, result: result === 'changed' ? changedDecision(identity.endpoint, identity) : { kind: 'approved' } };
      } catch (error) {
        return mapStoreFailure(error);
      }
    },

    reject(tokenInput: unknown): Outcome<HostTrustDecision> {
      if (disposed) return failure('CANCELLED');
      if (typeof tokenInput !== 'string' || tokenInput.length < 16 || tokenInput.length > 256) return failure('INVALID_REQUEST');
      if (!removePending(tokenInput)) return failure('NOT_FOUND');
      return { ok: true, result: { kind: 'rejected' } };
    },

    async revoke(endpointInput: unknown): Promise<Outcome<Record<string, never>>> {
      if (disposed) return failure('CANCELLED');
      const endpoint = canonicalizeSshHostEndpoint(endpointInput);
      if (!endpoint) return failure('INVALID_REQUEST');
      try {
        await store.remove(endpoint);
        removeEndpointPending(endpoint);
        return { ok: true, result: EMPTY_RESULT };
      } catch (error) {
        return mapStoreFailure(error);
      }
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const token of [...pending.keys()]) removePending(token);
    }
  });
}

function challengeView(item: PendingApproval): HostKeyChallenge {
  return {
    token: item.token,
    host: item.identity.endpoint.host,
    port: item.identity.endpoint.port,
    algorithm: item.identity.algorithm,
    fingerprint: item.identity.fingerprint
  };
}
