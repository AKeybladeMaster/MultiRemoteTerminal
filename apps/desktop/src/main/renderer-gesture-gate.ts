import { canonicalizeRemoteEndpoint } from '../../../../packages/domain/src/remote-endpoint.ts';
import { canonicalizeSshHostEndpoint } from '../../../../packages/domain/src/host-trust.ts';
import { isSshGatewayProfileIds } from '../../../../packages/domain/src/ssh-route.ts';
import { canonicalizeXdmcpHost } from '../../../../packages/domain/src/xdmcp.ts';

const GESTURE_TTL_MS = 750;
const MAX_PENDING_GESTURES = 64;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type TftpServerAction = 'choose-root' | 'start';
export type RendererGesturePurpose = 'clipboard-paste' | 'telnet-plaintext-consent' | 'ftp-plaintext-consent' | 'external-viewer-launch' |
  'tftp-server-action' | 'powershell-profile-script' | 'ssh-session-log' | 'ssh-x11-consent' | 'ssh-x11-authorized' | 'xdmcp-launch';

export class RendererGestureGate {
  private readonly expiresAtByGesture = new Map<string, number>();
  private readonly now: () => number;

  constructor(now: () => number = () => performance.now()) { this.now = now; }

  issue(senderId: number, sessionId: string, purpose: RendererGesturePurpose = 'clipboard-paste'): void {
    if (!Number.isSafeInteger(senderId) || senderId < 1 || purpose === 'external-viewer-launch' || !SESSION_ID.test(sessionId)) return;
    this.issueScope(senderId, sessionId, purpose);
  }

  issueExternalViewerLaunch(senderId: number, protocol: 'rdp' | 'vnc', host: string, port: number): void {
    const endpoint = canonicalizeRemoteEndpoint({ host, port });
    if (!Number.isSafeInteger(senderId) || senderId < 1 || !endpoint) return;
    this.issueScope(senderId, `${protocol}\u0000${endpoint.host}\u0000${endpoint.port}`, 'external-viewer-launch');
  }

  consumeExternalViewerLaunch(senderId: number, protocol: 'rdp' | 'vnc', host: string, port: number): boolean {
    const endpoint = canonicalizeRemoteEndpoint({ host, port });
    return endpoint !== undefined && this.consumeScope(senderId, `${protocol}\u0000${endpoint.host}\u0000${endpoint.port}`, 'external-viewer-launch');
  }

  issueSshSessionLog(senderId: number, sessionId: string, host: string, port: number, gatewayProfileIds: readonly string[]): void {
    const scope = this.sshSessionLogScope(sessionId, host, port, gatewayProfileIds);
    if (Number.isSafeInteger(senderId) && senderId > 0 && scope) this.issueScope(senderId, scope, 'ssh-session-log');
  }

  consumeSshSessionLog(senderId: number, sessionId: string, host: string, port: number, gatewayProfileIds: readonly string[]): boolean {
    const scope = this.sshSessionLogScope(sessionId, host, port, gatewayProfileIds);
    return scope !== undefined && this.consumeScope(senderId, scope, 'ssh-session-log');
  }

  issueSshX11Consent(senderId: number, host: string, port: number, gatewayProfileIds: readonly string[]): void {
    const scope = this.sshX11Scope(host, port, gatewayProfileIds);
    if (Number.isSafeInteger(senderId) && senderId > 0 && scope) this.issueScope(senderId, scope, 'ssh-x11-consent');
  }

  consumeSshX11Consent(senderId: number, host: string, port: number, gatewayProfileIds: readonly string[]): boolean {
    const scope = this.sshX11Scope(host, port, gatewayProfileIds);
    return scope !== undefined && this.consumeScope(senderId, scope, 'ssh-x11-consent');
  }

  authorizeSshX11Forwarding(senderId: number, host: string, port: number, gatewayProfileIds: readonly string[]): boolean {
    const scope = this.sshX11Scope(host, port, gatewayProfileIds);
    if (!scope || !this.consumeScope(senderId, scope, 'ssh-x11-consent')) return false;
    this.issueScope(senderId, scope, 'ssh-x11-authorized', 5 * 60_000);
    return true;
  }

  consumeSshX11Authorization(senderId: number, host: string, port: number, gatewayProfileIds: readonly string[]): boolean {
    const scope = this.sshX11Scope(host, port, gatewayProfileIds);
    return scope !== undefined && this.consumeScope(senderId, scope, 'ssh-x11-authorized');
  }

  issueXdmcpLaunch(senderId: number, host: string): void {
    const canonicalHost = canonicalizeXdmcpHost(host);
    if (Number.isSafeInteger(senderId) && senderId > 0 && canonicalHost) this.issueScope(senderId, canonicalHost, 'xdmcp-launch');
  }

  consumeXdmcpLaunch(senderId: number, host: string): boolean {
    const canonicalHost = canonicalizeXdmcpHost(host);
    return canonicalHost !== undefined && this.consumeScope(senderId, canonicalHost, 'xdmcp-launch');
  }

  issueTftpServerAction(senderId: number, action: TftpServerAction, selectionId?: string, port?: number): void {
    if (!Number.isSafeInteger(senderId) || senderId < 1) return;
    const scope = this.tftpScope(action, selectionId, port);
    if (scope) this.issueScope(senderId, scope, 'tftp-server-action');
  }

  consumeTftpServerAction(senderId: number, action: TftpServerAction, selectionId?: string, port?: number): boolean {
    const scope = this.tftpScope(action, selectionId, port);
    return scope !== undefined && this.consumeScope(senderId, scope, 'tftp-server-action');
  }

  private issueScope(senderId: number, scope: string, purpose: RendererGesturePurpose, ttlMs = GESTURE_TTL_MS): void {
    this.prune();
    const key = this.key(senderId, scope, purpose);
    if (!this.expiresAtByGesture.has(key) && this.expiresAtByGesture.size >= MAX_PENDING_GESTURES) {
      const oldest = this.expiresAtByGesture.keys().next().value as string | undefined;
      if (oldest !== undefined) this.expiresAtByGesture.delete(oldest);
    }
    this.expiresAtByGesture.delete(key);
    this.expiresAtByGesture.set(key, this.now() + ttlMs);
  }

  consume(senderId: number, sessionId: string, purpose: RendererGesturePurpose = 'clipboard-paste'): boolean {
    if (!SESSION_ID.test(sessionId) || purpose === 'external-viewer-launch') return false;
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

  private sshSessionLogScope(sessionId: string, host: string, port: number, gatewayProfileIds: readonly string[]): string | undefined {
    const endpoint = canonicalizeSshHostEndpoint({ host, port });
    return SESSION_ID.test(sessionId) && endpoint && isSshGatewayProfileIds(gatewayProfileIds)
      ? `${sessionId}\u0000${endpoint.host}\u0000${endpoint.port}\u0000${gatewayProfileIds.join('\u0000')}` : undefined;
  }

  private sshX11Scope(host: string, port: number, gatewayProfileIds: readonly string[]): string | undefined {
    const endpoint = canonicalizeSshHostEndpoint({ host, port });
    return endpoint && isSshGatewayProfileIds(gatewayProfileIds)
      ? `${endpoint.host}\u0000${endpoint.port}\u0000${gatewayProfileIds.join('\u0000')}` : undefined;
  }

  private tftpScope(action: TftpServerAction, selectionId?: string, port?: number): string | undefined {
    if (action === 'choose-root') return 'choose-root';
    if (action !== 'start' || !selectionId || !SESSION_ID.test(selectionId) || !Number.isSafeInteger(port) || (port as number) < 0 || (port as number) > 65_535) return undefined;
    return `start/${selectionId}/${port}`;
  }

  private prune(): void {
    const now = this.now();
    for (const [key, expiresAt] of this.expiresAtByGesture) {
      if (expiresAt < now) this.expiresAtByGesture.delete(key);
    }
  }
}
