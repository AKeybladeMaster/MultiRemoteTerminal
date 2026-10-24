const GESTURE_TTL_MS = 750;
const MAX_PENDING_GESTURES = 64;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type RendererGesturePurpose = 'clipboard-paste' | 'telnet-plaintext-consent';

export class PasteGestureGate {
  private readonly expiresAtByGesture = new Map<string, number>();
  private readonly now: () => number;

  constructor(now: () => number = () => performance.now()) { this.now = now; }

  issue(senderId: number, sessionId: string, purpose: RendererGesturePurpose = 'clipboard-paste'): void {
    if (!Number.isSafeInteger(senderId) || senderId < 1 || !SESSION_ID.test(sessionId)) return;
    this.prune();
    const key = this.key(senderId, sessionId, purpose);
    if (!this.expiresAtByGesture.has(key) && this.expiresAtByGesture.size >= MAX_PENDING_GESTURES) {
      const oldest = this.expiresAtByGesture.keys().next().value as string | undefined;
      if (oldest !== undefined) this.expiresAtByGesture.delete(oldest);
    }
    this.expiresAtByGesture.delete(key);
    this.expiresAtByGesture.set(key, this.now() + GESTURE_TTL_MS);
  }

  consume(senderId: number, sessionId: string, purpose: RendererGesturePurpose = 'clipboard-paste'): boolean {
    const key = this.key(senderId, sessionId, purpose);
    const expiresAt = this.expiresAtByGesture.get(key);
    this.expiresAtByGesture.delete(key);
    return expiresAt !== undefined && expiresAt >= this.now();
  }

  clear(senderId: number): void {
    const prefix = `${senderId}/`;
    for (const key of this.expiresAtByGesture.keys()) if (key.startsWith(prefix)) this.expiresAtByGesture.delete(key);
  }

  private key(senderId: number, sessionId: string, purpose: RendererGesturePurpose): string { return `${senderId}/${purpose}/${sessionId}`; }

  private prune(): void {
    const now = this.now();
    for (const [key, expiresAt] of this.expiresAtByGesture) {
      if (expiresAt < now) this.expiresAtByGesture.delete(key);
    }
  }
}
