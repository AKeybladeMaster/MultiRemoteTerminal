import { canonicalizeRemoteEndpoint } from '../../../../packages/domain/src/remote-endpoint.ts';

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GESTURE_TTL_MS = 750;
const MAX_PENDING_GESTURES = 64;
const TERMINAL_HOST_SELECTOR = '[data-mrt-terminal-session-id]';
const TELNET_SUBMIT_SELECTOR = 'button[data-mrt-telnet-consent-trigger]';

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

interface InputValueElement { readonly value: string; }
interface TelnetConnectForm extends HostElement { querySelector(selector: string): InputValueElement | null; }
interface TrustedSubmitEvent {
  readonly type: string;
  readonly isTrusted: boolean;
  readonly target: EventTargetElement | null;
}

export interface TelnetConsentGestureDocument {
  addEventListener(type: 'submit', listener: (event: Event) => void, capture: true): void;
  removeEventListener(type: 'submit', listener: (event: Event) => void, capture: true): void;
}

export interface TelnetConsentGestureStore {
  consume(sessionId: string, host: string, port: number): Promise<boolean>;
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

export function installTelnetConsentGestureStore(documentTarget: TelnetConsentGestureDocument,
  authorize: (sessionId: string) => Promise<boolean>, now: () => number = () => performance.now()): TelnetConsentGestureStore {
  let gesture: { readonly host: string; readonly port: number; readonly expiresAt: number } | undefined;
  const observeSubmit = (event: Event): void => {
    const submit = event as unknown as TrustedSubmitEvent;
    if (submit.type !== 'submit' || !submit.isTrusted) return;
    const form = submit.target?.closest('form') as TelnetConnectForm | null | undefined;
    if (!form?.querySelector(TELNET_SUBMIT_SELECTOR)) return;
    const hostInput = form.querySelector('input[name="host"]');
    const portInput = form.querySelector('input[name="port"]');
    const port = Number(portInput?.value);
    const endpoint = canonicalizeRemoteEndpoint({ host: hostInput?.value ?? '', port });
    if (!endpoint) { gesture = undefined; return; }
    gesture = { host: endpoint.host, port: endpoint.port, expiresAt: now() + GESTURE_TTL_MS };
  };
  documentTarget.addEventListener('submit', observeSubmit, true);
  return Object.freeze({
    async consume(sessionId: string, host: string, port: number): Promise<boolean> {
      const current = gesture;
      gesture = undefined;
      const requested = canonicalizeRemoteEndpoint({ host, port });
      if (!current || current.expiresAt < now() || !requested || requested.host !== current.host || requested.port !== current.port) return false;
      try { return await authorize(sessionId) === true; }
      catch { return false; }
    },
    dispose(): void {
      documentTarget.removeEventListener('submit', observeSubmit, true);
      gesture = undefined;
    }
  });
}
