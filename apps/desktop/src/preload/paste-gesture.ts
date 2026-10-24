const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GESTURE_TTL_MS = 750;
const MAX_PENDING_GESTURES = 64;
const TERMINAL_HOST_SELECTOR = '[data-mrt-terminal-session-id]';

interface HostElement {
  getAttribute(name: string): string | null;
}

interface EventTargetElement {
  closest(selector: string): HostElement | null;
}

interface TrustedPasteKeyEvent {
  readonly type: string;
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly repeat: boolean;
  readonly isTrusted: boolean;
  readonly target: EventTargetElement | null;
}

export interface PasteGestureDocument {
  addEventListener(type: 'keydown', listener: (event: Event) => void, capture: true): void;
  removeEventListener(type: 'keydown', listener: (event: Event) => void, capture: true): void;
}

export interface TerminalPasteGestureStore {
  consume(sessionId: string): Promise<boolean>;
  dispose(): void;
}

export function installTerminalPasteGestureStore(documentTarget: PasteGestureDocument,
  authorize: (sessionId: string) => Promise<boolean>, now: () => number = () => performance.now()): TerminalPasteGestureStore {
  const gestures = new Map<string, { readonly expiresAt: number }>();
  const observeKeydown = (event: Event): void => {
    const key = event as unknown as TrustedPasteKeyEvent;
    if (key.type !== 'keydown' || !key.isTrusted || key.repeat || !key.ctrlKey && !key.metaKey || key.altKey || key.key.toLowerCase() !== 'v') return;
    const host = key.target?.closest(TERMINAL_HOST_SELECTOR);
    const sessionId = host?.getAttribute('data-mrt-terminal-session-id');
    if (!sessionId || !SESSION_ID.test(sessionId)) return;
    if (!gestures.has(sessionId) && gestures.size >= MAX_PENDING_GESTURES) {
      const oldest = gestures.keys().next().value as string | undefined;
      if (oldest !== undefined) gestures.delete(oldest);
    }
    gestures.delete(sessionId);
    gestures.set(sessionId, { expiresAt: now() + GESTURE_TTL_MS });
  };
  documentTarget.addEventListener('keydown', observeKeydown, true);
  return Object.freeze({
    async consume(sessionId: string): Promise<boolean> {
      const gesture = gestures.get(sessionId);
      gestures.delete(sessionId);
      if (!gesture || gesture.expiresAt < now()) return false;
      try { return await authorize(sessionId) === true; }
      catch { return false; }
    },
    dispose(): void {
      documentTarget.removeEventListener('keydown', observeKeydown, true);
      gestures.clear();
    }
  });
}
