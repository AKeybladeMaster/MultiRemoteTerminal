import { canonicalizeRdpEndpoint, formatRdpTarget } from '../../../../packages/domain/src/rdp.ts';

const GESTURE_TTL_MS = 750;
const MAX_PENDING_GESTURES = 64;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type RendererGesturePurpose = 'clipboard-paste' | 'telnet-plaintext-consent' | 'ftp-plaintext-consent' | 'rdp-external-launch';

export class RendererGestureGate {
  private readonly expiresAtByGesture = new Map<string, number>();
  private readonly now: () => number;

  constructor(now: () => number = () => performance.now()) { this.now = now; }

  issue(senderId: number, sessionId: string, purpose: RendererGesturePurpose = 'clipboard-paste'): void {
    if (!Number.isSafeInteger(senderId) || senderId < 1 || purpose === 'rdp-external-launch' || !SESSION_ID.test(sessionId)) return;
    this.issueScope(senderId, sessionId, purpose);
  }

  issueRdpLaunch(senderId: number, host: string, port: number): void {
    const endpoint = canonicalizeRdpEndpoint({ host, port });
    if (!Number.isSafeInteger(senderId) || senderId < 1 || !endpoint) return;
    this.issueScope(senderId, formatRdpTarget(endpoint), 'rdp-external-launch');
  }

  consumeRdpLaunch(senderId: number, host: string, port: number): boolean {
    const endpoint = canonicalizeRdpEndpoint({ host, port });
    return endpoint !== undefined && this.consumeScope(senderId, formatRdpTarget(endpoint), 'rdp-external-launch');
  }

  private issueScope(senderId: number, scope: string, purpose: RendererGesturePurpose): void {
    this.prune();
    const key = this.key(senderId, scope, purpose);
    if (!this.expiresAtByGesture.has(key) && this.expiresAtByGesture.size >= MAX_PENDING_GESTURES) {
      const oldest = this.expiresAtByGesture.keys().next().value as string | undefined;
      if (oldest !== undefined) this.expiresAtByGesture.delete(oldest);
    }
    this.expiresAtByGesture.delete(key);
    this.expiresAtByGesture.set(key, this.now() + GESTURE_TTL_MS);
  }

  consume(senderId: number, sessionId: string, purpose: RendererGesturePurpose = 'clipboard-paste'): boolean {
    if (!SESSION_ID.test(sessionId) || purpose === 'rdp-external-launch') return false;
    return this.consumeScope(senderId, sessionId, purpose);
  }

  private consumeScope(senderId: number, scope: string, purpose: RendererGesturePurpose): boolean {
    if (!Number.isSafeInteger(senderId) || senderId < 1) return false;
    const key = this.key(senderId, scope, purpose);
    const expiresAt = this.expiresAtByGesture.get(key);
    this.expiresAtByGesture.delete(key);
    return expiresAt !== undefined && expiresAt >= this.now();
  }

  clear(senderId: number): void {
    const prefix = `${senderId}/`;
    for (const key of this.expiresAtByGesture.keys()) if (key.startsWith(prefix)) this.expiresAtByGesture.delete(key);
  }

  private key(senderId: number, scope: string, purpose: RendererGesturePurpose): string { return `${senderId}/${purpose}/${scope}`; }

  private prune(): void {
    const now = this.now();
    for (const [key, expiresAt] of this.expiresAtByGesture) {
      if (expiresAt < now) this.expiresAtByGesture.delete(key);
    }
  }
}
