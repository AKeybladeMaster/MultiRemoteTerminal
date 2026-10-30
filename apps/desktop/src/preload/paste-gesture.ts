import { canonicalizeRemoteEndpoint } from '../../../../packages/domain/src/remote-endpoint.ts';
import { canonicalizeFtpEndpoint } from '../../../../packages/domain/src/ftp.ts';
import { canonicalizeSshHostEndpoint } from '../../../../packages/domain/src/host-trust.ts';
import { isSshGatewayProfileIds, MAX_SSH_GATEWAY_HOPS } from '../../../../packages/domain/src/ssh-route.ts';
import { canonicalizeXdmcpHost } from '../../../../packages/domain/src/xdmcp.ts';

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GESTURE_TTL_MS = 750;
const MAX_PENDING_GESTURES = 64;
const TERMINAL_HOST_SELECTOR = '[data-mrt-terminal-session-id]';
const TELNET_SUBMIT_SELECTOR = 'button[data-mrt-telnet-consent-trigger]';

interface HostElement {
  getAttribute(name: string): string | null;
  closest(selector: string): HostElement | null;
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

export interface SshSessionLogConsentGestureStore {
  consume(sessionId: string, host: string, port: number, gatewayProfileIds: readonly string[]): Promise<boolean>;
  dispose(): void;
}

export interface SshX11ConsentGestureStore {
  consume(host: string, port: number, gatewayProfileIds: readonly string[]): Promise<boolean>;
  dispose(): void;
}

export interface XdmcpLaunchGestureStore {
  consume(host: string): Promise<boolean>;
  dispose(): void;
}

export interface FtpConsentGestureStore {
  consume(sessionId: string, host: string, port: number, secure: boolean): Promise<boolean>;
  dispose(): void;
}

export interface ExternalViewerLaunchGestureStore {
  consume(host: string, port: number): Promise<boolean>;
  dispose(): void;
}

export interface ExternalViewerLaunchGestureDocument {
  addEventListener(type: 'click', listener: (event: Event) => void, capture: true): void;
  removeEventListener(type: 'click', listener: (event: Event) => void, capture: true): void;
}

export interface TftpServerActionGestureStore {
  consume(action: 'choose-root' | 'start', selectionId?: string, port?: number): Promise<boolean>;
  dispose(): void;
}

export interface TftpServerActionGestureDocument {
  addEventListener(type: 'click', listener: (event: Event) => void, capture: true): void;
  removeEventListener(type: 'click', listener: (event: Event) => void, capture: true): void;
  addEventListener(type: 'submit', listener: (event: Event) => void, capture: true): void;
  removeEventListener(type: 'submit', listener: (event: Event) => void, capture: true): void;
}

export interface PowerShellProfileGestureDocument {
  addEventListener(type: 'click', listener: (event: Event) => void, capture: true): void;
  removeEventListener(type: 'click', listener: (event: Event) => void, capture: true): void;
}

export interface PowerShellProfileGestureStore {
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

export function installSshSessionLogConsentGestureStore(documentTarget: TelnetConsentGestureDocument,
  authorize: (sessionId: string, host: string, port: number, gatewayProfileIds: readonly string[]) => Promise<boolean>,
  now: () => number = () => performance.now()): SshSessionLogConsentGestureStore {
  let gesture: { readonly host: string; readonly port: number; readonly gatewayProfileIds: readonly string[]; readonly expiresAt: number } | undefined;
  const observeSubmit = (event: Event): void => {
    const submit = event as unknown as TrustedSubmitEvent;
    if (submit.type !== 'submit' || !submit.isTrusted) return;
    const form = submit.target?.closest('form') as TelnetConnectForm | null | undefined;
    if (!form?.querySelector('button[data-mrt-ssh-session-log-consent-trigger]') ||
        (form.querySelector('#ssh-session-log') as { readonly checked?: boolean } | null)?.checked !== true) { gesture = undefined; return; }
    const endpoint = canonicalizeSshHostEndpoint({ host: form.querySelector('input[name="host"]')?.value ?? '',
      port: Number(form.querySelector('input[name="port"]')?.value) });
    const gatewayProfileIds = Array.from({ length: MAX_SSH_GATEWAY_HOPS }, (_, index) => form.querySelector(`select[name="sshGateway${index + 1}"]`)?.value ?? '')
      .filter(id => id.length > 0);
    gesture = endpoint && isSshGatewayProfileIds(gatewayProfileIds)
      ? { host: endpoint.host, port: endpoint.port, gatewayProfileIds, expiresAt: now() + GESTURE_TTL_MS } : undefined;
  };
  documentTarget.addEventListener('submit', observeSubmit, true);
  return Object.freeze({
    async consume(sessionId: string, host: string, port: number, gatewayProfileIds: readonly string[]): Promise<boolean> {
      const current = gesture;
      gesture = undefined;
      const endpoint = canonicalizeSshHostEndpoint({ host, port });
      if (!current || current.expiresAt < now() || !SESSION_ID.test(sessionId) || !endpoint || endpoint.host !== current.host ||
          endpoint.port !== current.port || !isSshGatewayProfileIds(gatewayProfileIds) ||
          gatewayProfileIds.length !== current.gatewayProfileIds.length || gatewayProfileIds.some((id, index) => id !== current.gatewayProfileIds[index])) return false;
      try { return await authorize(sessionId, endpoint.host, endpoint.port, gatewayProfileIds) === true; }
      catch { return false; }
    },
    dispose(): void {
      documentTarget.removeEventListener('submit', observeSubmit, true);
      gesture = undefined;
    }
  });
}

export function installSshX11ConsentGestureStore(documentTarget: TelnetConsentGestureDocument,
  authorize: (host: string, port: number, gatewayProfileIds: readonly string[]) => Promise<boolean>,
  now: () => number = () => performance.now()): SshX11ConsentGestureStore {
  let gesture: { readonly host: string; readonly port: number; readonly gatewayProfileIds: readonly string[]; readonly expiresAt: number } | undefined;
  const observeSubmit = (event: Event): void => {
    const submit = event as unknown as TrustedSubmitEvent;
    if (submit.type !== 'submit' || !submit.isTrusted) return;
    const form = submit.target?.closest('form') as TelnetConnectForm | null | undefined;
    if (!form?.querySelector('button[data-mrt-ssh-x11-consent-trigger]') ||
        (form.querySelector('#ssh-x11-forwarding') as { readonly checked?: boolean } | null)?.checked !== true) { gesture = undefined; return; }
    const endpoint = canonicalizeSshHostEndpoint({ host: form.querySelector('input[name="host"]')?.value ?? '',
      port: Number(form.querySelector('input[name="port"]')?.value) });
    const gatewayProfileIds = Array.from({ length: MAX_SSH_GATEWAY_HOPS }, (_, index) => form.querySelector(`select[name="sshGateway${index + 1}"]`)?.value ?? '')
      .filter(id => id.length > 0);
    gesture = endpoint && isSshGatewayProfileIds(gatewayProfileIds)
      ? { host: endpoint.host, port: endpoint.port, gatewayProfileIds, expiresAt: now() + GESTURE_TTL_MS } : undefined;
  };
  documentTarget.addEventListener('submit', observeSubmit, true);
  return Object.freeze({
    async consume(host: string, port: number, gatewayProfileIds: readonly string[]): Promise<boolean> {
      const current = gesture;
      gesture = undefined;
      const endpoint = canonicalizeSshHostEndpoint({ host, port });
      if (!current || current.expiresAt < now() || !endpoint || endpoint.host !== current.host || endpoint.port !== current.port ||
          !isSshGatewayProfileIds(gatewayProfileIds) || gatewayProfileIds.length !== current.gatewayProfileIds.length ||
          gatewayProfileIds.some((id, index) => id !== current.gatewayProfileIds[index])) return false;
      try { return await authorize(endpoint.host, endpoint.port, gatewayProfileIds) === true; }
      catch { return false; }
    },
    dispose(): void {
      documentTarget.removeEventListener('submit', observeSubmit, true);
      gesture = undefined;
    }
  });
}

export function installXdmcpLaunchGestureStore(documentTarget: TelnetConsentGestureDocument,
  authorize: (host: string) => Promise<boolean>, now: () => number = () => performance.now()): XdmcpLaunchGestureStore {
  let gesture: { readonly host: string; readonly expiresAt: number } | undefined;
  const observeSubmit = (event: Event): void => {
    const submit = event as unknown as TrustedSubmitEvent;
    if (submit.type !== 'submit' || !submit.isTrusted) return;
    const form = submit.target?.closest('form') as TelnetConnectForm | null | undefined;
    if (!form?.querySelector('button[data-mrt-xdmcp-launch-trigger]') ||
        (form.querySelector('#xdmcp-insecure-confirm') as { readonly checked?: boolean } | null)?.checked !== true) { gesture = undefined; return; }
    const host = canonicalizeXdmcpHost(form.querySelector('input[name="xdmcpHost"]')?.value ?? '');
    gesture = host ? { host, expiresAt: now() + GESTURE_TTL_MS } : undefined;
  };
  documentTarget.addEventListener('submit', observeSubmit, true);
  return Object.freeze({
    async consume(host: string): Promise<boolean> {
      const current = gesture;
      gesture = undefined;
      const requestedHost = canonicalizeXdmcpHost(host);
      if (!current || current.expiresAt < now() || !requestedHost || requestedHost !== current.host) return false;
      try { return await authorize(requestedHost) === true; }
      catch { return false; }
    },
    dispose(): void {
      documentTarget.removeEventListener('submit', observeSubmit, true);
      gesture = undefined;
    }
  });
}

export function installExternalViewerLaunchGestureStore(documentTarget: ExternalViewerLaunchGestureDocument, protocol: 'rdp' | 'vnc',
  authorize: (host: string, port: number) => Promise<boolean>, now: () => number = () => performance.now()): ExternalViewerLaunchGestureStore {
  let gesture: { readonly host: string; readonly port: number; readonly expiresAt: number } | undefined;
  const observeClick = (event: Event): void => {
    const click = event as unknown as { readonly type: string; readonly isTrusted: boolean; readonly target: EventTargetElement | null };
    if (click.type !== 'click' || !click.isTrusted) return;
    const button = click.target?.closest(`button[data-mrt-${protocol}-launch-trigger]`) as EventTargetElement | null | undefined;
    const form = button?.closest('form') as TelnetConnectForm | null | undefined;
    if (!form) return;
    const hostInput = form.querySelector('input[name="host"]');
    const portInput = form.querySelector('input[name="port"]');
    const endpoint = canonicalizeRemoteEndpoint({ host: hostInput?.value ?? '', port: Number(portInput?.value) });
    gesture = endpoint ? { host: endpoint.host, port: endpoint.port, expiresAt: now() + GESTURE_TTL_MS } : undefined;
  };
  documentTarget.addEventListener('click', observeClick, true);
  return Object.freeze({
    async consume(host: string, port: number): Promise<boolean> {
      const current = gesture;
      gesture = undefined;
      const requested = canonicalizeRemoteEndpoint({ host, port });
      if (!current || current.expiresAt < now() || !requested || requested.host !== current.host || requested.port !== current.port) return false;
      try { return await authorize(requested.host, requested.port) === true; }
      catch { return false; }
    },
    dispose(): void {
      documentTarget.removeEventListener('click', observeClick, true);
      gesture = undefined;
    }
  });
}

export function installTftpServerActionGestureStore(documentTarget: TftpServerActionGestureDocument,
  authorize: (action: 'choose-root' | 'start', selectionId?: string, port?: number) => Promise<boolean>,
  now: () => number = () => performance.now()): TftpServerActionGestureStore {
  let gesture: { readonly action: 'choose-root' | 'start'; readonly selectionId?: string; readonly port?: number; readonly expiresAt: number } | undefined;
  const captureStart = (form: TelnetConnectForm): void => {
    const selectionId = form.getAttribute('data-mrt-tftp-selection-id') ?? '';
    const port = Number(form.querySelector('input[name="port"]')?.value);
    if (!SESSION_ID.test(selectionId) || !Number.isSafeInteger(port) || port < 0 || port > 65_535) { gesture = undefined; return; }
    gesture = { action: 'start', selectionId, port, expiresAt: now() + GESTURE_TTL_MS };
  };
  const observeClick = (event: Event): void => {
    const click = event as unknown as { readonly type: string; readonly isTrusted: boolean; readonly target: EventTargetElement | null };
    if (click.type !== 'click' || !click.isTrusted) return;
    const button = click.target?.closest('button[data-mrt-tftp-server-action-trigger]');
    const action = button?.getAttribute('data-mrt-tftp-server-action-trigger');
    if (action === 'choose-root') { gesture = { action, expiresAt: now() + GESTURE_TTL_MS }; return; }
    if (action !== 'start') return;
    const form = button?.closest('form') as TelnetConnectForm | null | undefined;
    if (form) captureStart(form);
  };
  const observeSubmit = (event: Event): void => {
    const submit = event as unknown as TrustedSubmitEvent;
    if (submit.type !== 'submit' || !submit.isTrusted) return;
    const form = submit.target?.closest('form[data-mrt-tftp-selection-id]');
    if (form) captureStart(form as TelnetConnectForm);
  };
  documentTarget.addEventListener('click', observeClick, true);
  documentTarget.addEventListener('submit', observeSubmit, true);
  return Object.freeze({
    async consume(action: 'choose-root' | 'start', selectionId?: string, port?: number): Promise<boolean> {
      const current = gesture;
      gesture = undefined;
      if (!current || current.expiresAt < now() || current.action !== action) return false;
      if (action === 'start' && (selectionId !== current.selectionId || port !== current.port)) return false;
      if (action === 'choose-root' && (selectionId !== undefined || port !== undefined)) return false;
      try { return await authorize(action, current.selectionId, current.port) === true; }
      catch { return false; }
    },
    dispose(): void {
      documentTarget.removeEventListener('click', observeClick, true);
      documentTarget.removeEventListener('submit', observeSubmit, true);
      gesture = undefined;
    }
  });
}

export function installPowerShellProfileGestureStore(documentTarget: PowerShellProfileGestureDocument,
  authorize: (sessionId: string) => Promise<boolean>, now: () => number = () => performance.now()): PowerShellProfileGestureStore {
  const gestures = new Map<string, number>();
  const observeClick = (event: Event): void => {
    const click = event as unknown as { readonly type: string; readonly isTrusted: boolean; readonly target: EventTargetElement | null };
    if (click.type !== 'click' || !click.isTrusted) return;
    const button = click.target?.closest('button[data-mrt-powershell-profile-trigger]');
    const sessionId = button?.getAttribute('data-mrt-powershell-profile-trigger');
    if (!sessionId || !SESSION_ID.test(sessionId)) return;
    for (const [pendingSessionId, expiresAt] of gestures) if (expiresAt < now()) gestures.delete(pendingSessionId);
    if (!gestures.has(sessionId) && gestures.size >= MAX_PENDING_GESTURES) {
      const oldest = gestures.keys().next().value as string | undefined;
      if (oldest !== undefined) gestures.delete(oldest);
    }
    gestures.delete(sessionId);
    gestures.set(sessionId, now() + GESTURE_TTL_MS);
  };
  documentTarget.addEventListener('click', observeClick, true);
  return Object.freeze({
    async consume(sessionId: string): Promise<boolean> {
      const expiresAt = gestures.get(sessionId);
      gestures.delete(sessionId);
      if (!SESSION_ID.test(sessionId) || expiresAt === undefined || expiresAt < now()) return false;
      try { return await authorize(sessionId) === true; }
      catch { return false; }
    },
    dispose(): void {
      documentTarget.removeEventListener('click', observeClick, true);
      gestures.clear();
    }
  });
}

export function installFtpConsentGestureStore(documentTarget: TelnetConsentGestureDocument,
  authorize: (sessionId: string) => Promise<boolean>, now: () => number = () => performance.now()): FtpConsentGestureStore {
  let gesture: { readonly host: string; readonly port: number; readonly expiresAt: number } | undefined;
  const observeSubmit = (event: Event): void => {
    const submit = event as unknown as TrustedSubmitEvent;
    if (submit.type !== 'submit' || !submit.isTrusted) return;
    const form = submit.target?.closest('form') as TelnetConnectForm | null | undefined;
    if (!form?.querySelector('button[data-mrt-ftp-consent-trigger]')) return;
    const hostInput = form.querySelector('input[name="host"]');
    const portInput = form.querySelector('input[name="port"]');
    const securityInput = form.querySelector('select[name="security"]');
    const port = Number(portInput?.value);
    const secure = securityInput?.value === 'ftps';
    const endpoint = canonicalizeFtpEndpoint({ host: hostInput?.value ?? '', port, secure });
    if (!endpoint || endpoint.secure) { gesture = undefined; return; }
    gesture = { host: endpoint.host, port: endpoint.port, expiresAt: now() + GESTURE_TTL_MS };
  };
  documentTarget.addEventListener('submit', observeSubmit, true);
  return Object.freeze({
    async consume(sessionId: string, host: string, port: number, secure: boolean): Promise<boolean> {
      const current = gesture;
      gesture = undefined;
      const requested = canonicalizeFtpEndpoint({ host, port, secure });
      if (!current || current.expiresAt < now() || !requested || requested.secure || requested.host !== current.host || requested.port !== current.port) return false;
      try { return await authorize(sessionId) === true; }
      catch { return false; }
    },
    dispose(): void {
      documentTarget.removeEventListener('submit', observeSubmit, true);
      gesture = undefined;
    }
  });
}
