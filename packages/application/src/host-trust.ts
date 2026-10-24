import type { Outcome } from '../../domain/src/errors.ts';
import { failure } from '../../domain/src/errors.ts';
import { StorageOperationError } from './storage-errors.ts';
import { canonicalizeSshHostEndpoint, hostEndpointKey, isHostKeyEvidence, sameHostKey } from '../../domain/src/host-trust.ts';
import type { HostKeyEvidence, SshHostEndpoint, TrustedHostKey } from '../../domain/src/host-trust.ts';
import type { CredentialPromptCancellation } from './credential-prompt.ts';

export type HostTrustInsertResult = 'inserted' | 'matched' | 'changed';

export interface HostTrustStore {
  find(endpoint: SshHostEndpoint, cancellation?: CredentialPromptCancellation): Promise<TrustedHostKey | undefined>;
  trustIfAbsent(identity: TrustedHostKey, cancellation?: CredentialPromptCancellation): Promise<HostTrustInsertResult>;
  remove(endpoint: SshHostEndpoint, cancellation?: CredentialPromptCancellation): Promise<boolean>;
}

export class HostTrustStoreError extends StorageOperationError {
  constructor(kind: 'busy' | 'cancelled' | 'conflict' | 'corrupt' | 'not-found' | 'unavailable') {
    super(kind);
    this.name = 'HostTrustStoreError';
  }
}

export interface HostTrustRuntime {
  createToken(): string;
  monotonicNow(): number;
  wallNow(): number;
  schedule(callback: () => void, delayMs: number): () => void;
}

export type HostTrustResolution = 'approved' | 'rejected' | 'expired' | 'cancelled' | 'changed' | 'unavailable' | 'not-found';

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
  inspect(endpoint: unknown, evidence: unknown, cancellation?: CredentialPromptCancellation): Promise<Outcome<HostTrustDecision>>;
  waitForResolution(token: unknown): Promise<HostTrustResolution>;
  approve(token: unknown): Promise<Outcome<HostTrustDecision>>;
  reject(token: unknown): Outcome<HostTrustDecision>;
  revoke(endpoint: unknown): Promise<Outcome<Record<string, never>>>;
  dispose(): void;
}

const MAX_PENDING_APPROVALS = 64;
const MAX_RECENT_RESOLUTIONS = 64;
const APPROVAL_LIFETIME_MS = 2 * 60 * 1000;
const APPROVAL_PERSISTENCE_TIMEOUT_MS = 15_000;
const EMPTY_RESULT: Record<string, never> = Object.freeze({});

interface PendingApproval {
  readonly token: string;
  readonly identity: TrustedHostKey;
  readonly dedupeKey: string;
  readonly expiresAt: number;
  readonly completion: Promise<HostTrustResolution>;
  readonly resolveCompletion: (resolution: HostTrustResolution) => void;
  settled: boolean;
  cancelExpiry: () => void;
  cancelPersistenceTimeout: () => void;
}

export function createHostTrustManager(store: HostTrustStore, runtime: HostTrustRuntime): HostTrustManager {
  const pending = new Map<string, PendingApproval>();
  const approving = new Map<string, PendingApproval>();
  const recentResolutions = new Map<string, HostTrustResolution>();
  const byEvidence = new Map<string, string>();
  let disposed = false;

  function takePending(token: string): PendingApproval | undefined {
    const challenge = pending.get(token);
    if (!challenge) return undefined;
    pending.delete(token);
    byEvidence.delete(challenge.dedupeKey);
    challenge.cancelExpiry();
    return challenge;
  }

  function finish(item: PendingApproval, resolution: HostTrustResolution): void {
    if (item.settled) return;
    item.settled = true;
    item.cancelExpiry();
    item.cancelPersistenceTimeout();
    approving.delete(item.token);
    recentResolutions.delete(item.token);
    recentResolutions.set(item.token, resolution);
    while (recentResolutions.size > MAX_RECENT_RESOLUTIONS) {
      const oldest = recentResolutions.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      recentResolutions.delete(oldest);
    }
    item.resolveCompletion(resolution);
  }

  function removePending(token: string, resolution: HostTrustResolution): boolean {
    const challenge = takePending(token);
    if (!challenge) return false;
    finish(challenge, resolution);
    return true;
  }

  function removeEndpointPending(endpoint: SshHostEndpoint, resolutionFor: (item: PendingApproval) => HostTrustResolution): void {
    const key = hostEndpointKey(endpoint);
    for (const item of [...pending.values()]) {
      if (hostEndpointKey(item.identity.endpoint) === key) removePending(item.token, resolutionFor(item));
    }
  }

  function makeDedupeKey(endpoint: SshHostEndpoint, evidence: HostKeyEvidence): string {
    let key = '';
    for (const byte of evidence.publicKey) key += byte.toString(16).padStart(2, '0');
    return `${hostEndpointKey(endpoint)}|${evidence.algorithm}|${evidence.fingerprint}|${key}`;
  }

  function mapStoreFailure(error: unknown): ReturnType<typeof failure> {
    if (error instanceof HostTrustStoreError && error.kind === 'cancelled') return failure('CANCELLED');
    return failure(error instanceof HostTrustStoreError && error.kind === 'busy' ? 'BUSY' : 'UNAVAILABLE');
  }

  function changedDecision(endpoint: SshHostEndpoint, evidence: HostKeyEvidence): HostTrustDecision {
    return { kind: 'changed', host: endpoint.host, port: endpoint.port, algorithm: evidence.algorithm, fingerprint: evidence.fingerprint };
  }

  return Object.freeze({
    async inspect(endpointInput: unknown, evidenceInput: unknown, cancellation?: CredentialPromptCancellation): Promise<Outcome<HostTrustDecision>> {
      if (disposed || cancellation?.aborted) return failure('CANCELLED');
      const endpoint = canonicalizeSshHostEndpoint(endpointInput);
      if (!endpoint || !isHostKeyEvidence(evidenceInput)) return failure('INVALID_REQUEST');
      const evidence: HostKeyEvidence = { algorithm: evidenceInput.algorithm, fingerprint: evidenceInput.fingerprint, publicKey: Uint8Array.from(evidenceInput.publicKey) };
      try {
        const current = await store.find(endpoint, cancellation);
        if (disposed || cancellation?.aborted) return failure('CANCELLED');
        if (current) {
          const matches = sameHostKey(current, evidence);
          removeEndpointPending(endpoint, item => sameHostKey(current, item.identity) ? 'approved' : 'changed');
          return { ok: true, result: matches ? { kind: 'trusted' } : changedDecision(endpoint, evidence) };
        }

        const dedupeKey = makeDedupeKey(endpoint, evidence);
        const existingToken = byEvidence.get(dedupeKey);
        const existing = existingToken ? pending.get(existingToken) : undefined;
        if (existing && runtime.monotonicNow() < existing.expiresAt) {
          return { ok: true, result: { kind: 'approval-required', challenge: challengeView(existing) } };
        }
        if (existing) removePending(existing.token, 'expired');
        if (pending.size + approving.size >= MAX_PENDING_APPROVALS) return failure('BUSY');

        const token = runtime.createToken();
        if (typeof token !== 'string' || token.length < 16 || token.length > 256 || pending.has(token) || approving.has(token) || recentResolutions.has(token)) return failure('UNAVAILABLE');
        const identity: TrustedHostKey = {
          endpoint,
          algorithm: evidence.algorithm,
          fingerprint: evidence.fingerprint,
          publicKey: evidence.publicKey,
          trustedAt: 0,
          approvalSource: 'user'
        };
        let resolveCompletion!: (resolution: HostTrustResolution) => void;
        const completion = new Promise<HostTrustResolution>(resolve => { resolveCompletion = resolve; });
        const now = runtime.monotonicNow();
        if (!Number.isFinite(now) || now < 0) return failure('UNAVAILABLE');
        const item: PendingApproval = {
          token, identity, dedupeKey, expiresAt: now + APPROVAL_LIFETIME_MS,
          completion, resolveCompletion, settled: false, cancelExpiry: () => {}, cancelPersistenceTimeout: () => {}
        };
        pending.set(token, item);
        byEvidence.set(dedupeKey, token);
        try {
          const cancelExpiry = runtime.schedule(() => removePending(token, 'expired'), APPROVAL_LIFETIME_MS);
          if (!pending.has(token)) {
            cancelExpiry();
            return failure('CANCELLED');
          }
          item.cancelExpiry = cancelExpiry;
        } catch {
          removePending(token, 'cancelled');
          return failure('UNAVAILABLE');
        }
        return { ok: true, result: { kind: 'approval-required', challenge: challengeView(item) } };
      } catch (error) {
        return mapStoreFailure(error);
      }
    },

    waitForResolution(tokenInput: unknown): Promise<HostTrustResolution> {
      if (disposed) return Promise.resolve('cancelled');
      if (typeof tokenInput !== 'string' || tokenInput.length < 16 || tokenInput.length > 256) return Promise.resolve('not-found');
      const item = pending.get(tokenInput) ?? approving.get(tokenInput);
      return item?.completion ?? Promise.resolve(recentResolutions.get(tokenInput) ?? 'not-found');
    },

    async approve(tokenInput: unknown): Promise<Outcome<HostTrustDecision>> {
      if (disposed) return failure('CANCELLED');
      if (typeof tokenInput !== 'string' || tokenInput.length < 16 || tokenInput.length > 256) return failure('INVALID_REQUEST');
      const item = pending.get(tokenInput);
      if (!item) return failure('NOT_FOUND');
      const now = runtime.monotonicNow();
      if (!Number.isFinite(now) || now < 0) return failure('UNAVAILABLE');
      if (now >= item.expiresAt) {
        removePending(item.token, 'expired');
        return failure('CANCELLED');
      }
      // Approval is a one-shot user action. Claim it before the first await so
      // reject, expiry and teardown cannot race a persisted approval.
      const claimed = takePending(item.token);
      if (!claimed) return failure('NOT_FOUND');
      approving.set(item.token, claimed);
      const trustedAt = runtime.wallNow();
      if (!Number.isSafeInteger(trustedAt) || trustedAt < 0) {
        finish(item, 'unavailable');
        return failure('UNAVAILABLE');
      }
      const identity: TrustedHostKey = { ...item.identity, publicKey: Uint8Array.from(item.identity.publicKey), trustedAt };
      let cancelTimeout = (): void => {};
      try {
        const timeout = new Promise<'timeout'>(resolve => {
          cancelTimeout = runtime.schedule(() => resolve('timeout'), APPROVAL_PERSISTENCE_TIMEOUT_MS);
          item.cancelPersistenceTimeout = cancelTimeout;
        });
        const write = store.trustIfAbsent(identity).then(result => ({ kind: 'stored' as const, result }));
        const completion = await Promise.race([
          write,
          timeout.then(() => ({ kind: 'timeout' as const })),
          item.completion.then(resolution => ({ kind: 'resolved' as const, resolution }))
        ]);
        if (completion.kind === 'timeout') {
          finish(item, 'unavailable');
          return failure('TIMEOUT');
        }
        if (completion.kind === 'resolved') return failure(completion.resolution === 'cancelled' ? 'CANCELLED' : 'UNAVAILABLE');
        const result = completion.result;
        finish(item, result === 'changed' ? 'changed' : 'approved');
        return { ok: true, result: result === 'changed' ? changedDecision(identity.endpoint, identity) : { kind: 'approved' } };
      } catch (error) {
        finish(item, 'unavailable');
        return mapStoreFailure(error);
      } finally {
        cancelTimeout();
      }
    },

    reject(tokenInput: unknown): Outcome<HostTrustDecision> {
      if (disposed) return failure('CANCELLED');
      if (typeof tokenInput !== 'string' || tokenInput.length < 16 || tokenInput.length > 256) return failure('INVALID_REQUEST');
      if (!removePending(tokenInput, 'rejected')) return failure('NOT_FOUND');
      return { ok: true, result: { kind: 'rejected' } };
    },

    async revoke(endpointInput: unknown): Promise<Outcome<Record<string, never>>> {
      if (disposed) return failure('CANCELLED');
      const endpoint = canonicalizeSshHostEndpoint(endpointInput);
      if (!endpoint) return failure('INVALID_REQUEST');
      try {
        await store.remove(endpoint);
        removeEndpointPending(endpoint, () => 'cancelled');
        return { ok: true, result: EMPTY_RESULT };
      } catch (error) {
        return mapStoreFailure(error);
      }
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const token of [...pending.keys()]) removePending(token, 'cancelled');
      for (const item of approving.values()) finish(item, 'cancelled');
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
