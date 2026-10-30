import assert from 'node:assert/strict';
import test from 'node:test';
import { RendererGestureGate } from '../../apps/desktop/src/main/renderer-gesture-gate.ts';
import { installExternalViewerLaunchGestureStore, installFtpConsentGestureStore, installSshSessionLogConsentGestureStore, installSshX11ConsentGestureStore, installTelnetConsentGestureStore, installTerminalPasteGestureStore,
  installTftpServerActionGestureStore, installPowerShellProfileGestureStore, installXdmcpLaunchGestureStore } from '../../apps/desktop/src/preload/paste-gesture.ts';

const firstSession = 'c8f87744-bd2c-4c0d-9a18-a4a324dd71fd';
const secondSession = '5726a2ee-03cd-4f5a-a28c-bd72784f80a6';

test('main renderer gesture gate is one-shot, short-lived, sender-scoped, purpose-scoped and session-scoped', () => {
  let now = 100;
  const gate = new RendererGestureGate(() => now);
  gate.issue(11, firstSession);
  assert.equal(gate.consume(12, firstSession), false);
  assert.equal(gate.consume(11, secondSession), false);
  assert.equal(gate.consume(11, firstSession), true);
  assert.equal(gate.consume(11, firstSession), false);
  gate.issue(11, firstSession);
  now += 751;
  assert.equal(gate.consume(11, firstSession), false);
  gate.issue(11, firstSession);
  gate.clear(11);
  assert.equal(gate.consume(11, firstSession), false);
  gate.issue(11, firstSession, 'clipboard-paste');
  assert.equal(gate.consume(11, firstSession, 'telnet-plaintext-consent'), false, 'gesture purposes are isolated');
  assert.equal(gate.consume(11, firstSession, 'clipboard-paste'), true);
  gate.issueExternalViewerLaunch(11, 'rdp', 'DESK.EXAMPLE.COM', 3389);
  assert.equal(gate.consumeExternalViewerLaunch(12, 'rdp', 'desk.example.com', 3389), false, 'RDP gesture is sender-scoped');
  assert.equal(gate.consumeExternalViewerLaunch(11, 'vnc', 'desk.example.com', 3389), false, 'viewer types cannot share a launch gesture');
  assert.equal(gate.consumeExternalViewerLaunch(11, 'rdp', 'other.example.com', 3389), false, 'RDP gesture is endpoint-scoped');
  gate.issueExternalViewerLaunch(11, 'rdp', 'DESK.EXAMPLE.COM', 3389);
  assert.equal(gate.consumeExternalViewerLaunch(11, 'rdp', 'desk.example.com', 3389), true, 'RDP endpoint is canonicalized');
  assert.equal(gate.consumeExternalViewerLaunch(11, 'rdp', 'desk.example.com', 3389), false, 'RDP gesture is one-shot');
  const gateways = ['11111111-1111-4111-8111-111111111111'];
  gate.issueSshSessionLog(11, firstSession, 'LINUX.EXAMPLE.COM.', 22, gateways);
  assert.equal(gate.consumeSshSessionLog(12, firstSession, 'linux.example.com', 22, gateways), false, 'session-log consent is sender-scoped');
  assert.equal(gate.consumeSshSessionLog(11, firstSession, 'linux.example.com', 22, []), false, 'session-log consent is route-scoped');
  gate.issueSshSessionLog(11, firstSession, 'LINUX.EXAMPLE.COM.', 22, gateways);
  assert.equal(gate.consumeSshSessionLog(11, firstSession, 'linux.example.com', 22, gateways), true, 'session-log endpoint is canonicalized');
  assert.equal(gate.consumeSshSessionLog(11, firstSession, 'linux.example.com', 22, gateways), false, 'session-log consent is one-shot');
});

test('preload authorizes only trusted paste keys from a terminal and binds them to that session', async () => {
  let now = 20;
  let keydown: ((event: Event) => void) | undefined;
  const authorized: string[] = [];
  const documentTarget = {
    addEventListener(_type: 'keydown', listener: (event: Event) => void) { keydown = listener; },
    removeEventListener(_type: 'keydown', listener: (event: Event) => void) { if (keydown === listener) keydown = undefined; }
  };
  const gestures = installTerminalPasteGestureStore(documentTarget, async sessionId => { authorized.push(sessionId); return true; }, () => now);
  const host = { getAttribute(name: string) { return name === 'data-mrt-terminal-session-id' ? firstSession : null; } };
  const target = { closest(selector: string) { return selector === '[data-mrt-terminal-session-id]' ? host : null; } };
  const event = (overrides: Partial<{ isTrusted: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean; repeat: boolean; key: string; target: typeof target }> = {}) =>
    ({ type: 'keydown', key: 'v', ctrlKey: true, metaKey: false, altKey: false, repeat: false, isTrusted: true, target,
      ...overrides, preventDefault() {}, stopImmediatePropagation() {} }) as unknown as Event;
  keydown?.(event({ isTrusted: false }));
  keydown?.(event({ repeat: true }));
  keydown?.(event({ altKey: true }));
  keydown?.(event({ ctrlKey: false, metaKey: false }));
  keydown?.(event({ target: { closest: () => null } }));
  assert.equal(await gestures.consume(firstSession), false);
  assert.deepEqual(authorized, []);
  keydown?.(event());
  assert.deepEqual(authorized, [], 'a terminal key only stores a local gesture until the bridge consumes it');
  assert.equal(await gestures.consume(secondSession), false);
  const authorizedPaste = gestures.consume(firstSession);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(authorized, [firstSession]);
  assert.equal(await authorizedPaste, true);
  assert.equal(await gestures.consume(firstSession), false);
  keydown?.(event());
  now += 751;
  assert.equal(await gestures.consume(firstSession), false);
  gestures.dispose();
  assert.equal(keydown, undefined);
});

test('preload authorizes RDP only after a trusted click on the matching launch button', async () => {
  let now = 70;
  let click: ((event: Event) => void) | undefined;
  const authorized: Array<{ host: string; port: number }> = [];
  const inputs = new Map<string, { readonly value: string }>([
    ['input[name="host"]', { value: 'DESK.EXAMPLE.COM' }], ['input[name="port"]', { value: '3389' }]
  ]);
  const form = {
    getAttribute() { return null; },
    querySelector(selector: string) {
      return inputs.get(selector) ?? null;
    }
  };
  const button = { getAttribute() { return null; }, closest(selector: string) { return selector === 'form' ? form : null; } };
  const documentTarget = {
    addEventListener(_type: 'click', listener: (event: Event) => void) { click = listener; },
    removeEventListener(_type: 'click', listener: (event: Event) => void) { if (click === listener) click = undefined; }
  };
  const gestures = installExternalViewerLaunchGestureStore(documentTarget, 'rdp', async (host, port) => {
    authorized.push({ host, port });
    return true;
  }, () => now);
  const event = (isTrusted: boolean) => ({ type: 'click', isTrusted, target: { closest: (selector: string) => selector === 'button[data-mrt-rdp-launch-trigger]' ? button : null } }) as unknown as Event;
  click?.(event(false));
  assert.equal(await gestures.consume('desk.example.com', 3389), false, 'scripted clicks cannot authorize launch');
  click?.({ type: 'submit', isTrusted: true, target: button } as unknown as Event);
  assert.equal(await gestures.consume('desk.example.com', 3389), false, 'programmatic form submission cannot authorize launch');
  click?.(event(true));
  assert.equal(await gestures.consume('other.example.com', 3389), false, 'gesture cannot authorize another target');
  assert.equal(await gestures.consume('desk.example.com', 3389), false, 'target mismatch consumes the gesture');
  click?.(event(true));
  assert.equal(await gestures.consume('desk.example.com', 3389), true);
  assert.deepEqual(authorized, [{ host: 'desk.example.com', port: 3389 }]);
  click?.(event(true));
  now += 751;
  assert.equal(await gestures.consume('desk.example.com', 3389), false, 'expired gesture is rejected');
  gestures.dispose();
});

test('preload binds a VNC launch gesture to its VNC button and canonical endpoint', async () => {
  let click: ((event: Event) => void) | undefined;
  const authorized: Array<{ host: string; port: number }> = [];
  const inputs = new Map<string, { readonly value: string }>([
    ['input[name="host"]', { value: 'VNC.Example.com.' }], ['input[name="port"]', { value: '5901' }]
  ]);
  const form = { querySelector: (selector: string) => inputs.get(selector) ?? null };
  const button = { closest: (selector: string) => selector === 'form' ? form : null };
  const documentTarget = {
    addEventListener(_type: 'click', listener: (event: Event) => void) { click = listener; },
    removeEventListener(_type: 'click', listener: (event: Event) => void) { if (click === listener) click = undefined; }
  };
  const gestures = installExternalViewerLaunchGestureStore(documentTarget, 'vnc', async (host, port) => {
    authorized.push({ host, port });
    return true;
  });
  click?.({ type: 'click', isTrusted: true, target: { closest: (selector: string) => selector === 'button[data-mrt-vnc-launch-trigger]' ? button : null } } as unknown as Event);
  assert.equal(await gestures.consume('vnc.example.com', 5901), true);
  assert.deepEqual(authorized, [{ host: 'vnc.example.com', port: 5901 }]);
  click?.({ type: 'click', isTrusted: true, target: { closest: (selector: string) => selector === 'button[data-mrt-rdp-launch-trigger]' ? button : null } } as unknown as Event);
  assert.equal(await gestures.consume('vnc.example.com', 5901), false, 'an RDP button cannot authorize VNC');
  gestures.dispose();
});

test('preload Telnet consent requires a trusted submit for the same endpoint and a one-shot main authorization', async () => {
  let now = 50;
  let submit: ((event: Event) => void) | undefined;
  const authorized: string[] = [];
  const hostInput = { value: 'Console.Example.com.' };
  const portInput = { value: '23' };
  const form = {
    closest(selector: string) { return selector === 'form' ? this : null; },
    querySelector(selector: string) {
      if (selector === 'button[data-mrt-telnet-consent-trigger]') return {};
      if (selector === 'input[name="host"]') return hostInput;
      if (selector === 'input[name="port"]') return portInput;
      return null;
    }
  };
  const documentTarget = {
    addEventListener(_type: 'submit', listener: (event: Event) => void) { submit = listener; },
    removeEventListener(_type: 'submit', listener: (event: Event) => void) { if (submit === listener) submit = undefined; }
  };
  const gestures = installTelnetConsentGestureStore(documentTarget, async sessionId => { authorized.push(sessionId); return true; }, () => now);
  const event = (isTrusted: boolean) => ({ type: 'submit', isTrusted, target: form }) as unknown as Event;
  submit?.(event(false));
  assert.equal(await gestures.consume(firstSession, 'console.example.com', 23), false);
  submit?.(event(true));
  assert.equal(await gestures.consume(firstSession, 'other.example.com', 23), false, 'consent cannot authorize a different destination');
  submit?.(event(true));
  assert.equal(await gestures.consume(firstSession, 'console.example.com', 23), true);
  assert.equal(await gestures.consume(firstSession, 'console.example.com', 23), false, 'consent is one-shot');
  assert.deepEqual(authorized, [firstSession]);
  submit?.(event(true));
  now += 751;
  assert.equal(await gestures.consume(firstSession, 'console.example.com', 23), false, 'expired consent is rejected');
  gestures.dispose();
  assert.equal(submit, undefined);
});

test('preload SSH log consent requires a trusted opted-in submit for the same endpoint and gateway route', async () => {
  let now = 60;
  let submit: ((event: Event) => void) | undefined;
  const authorized: Array<{ sessionId: string; host: string; port: number; gatewayProfileIds: readonly string[] }> = [];
  const inputs = new Map<string, { readonly value: string; readonly checked?: boolean }>([
    ['button[data-mrt-ssh-session-log-consent-trigger]', { value: '' }], ['#ssh-session-log', { value: '', checked: true }],
    ['input[name="host"]', { value: 'LINUX.Example.com.' }], ['input[name="port"]', { value: '22' }],
    ['select[name="sshGateway1"]', { value: '11111111-1111-4111-8111-111111111111' }]
  ]);
  const form = {
    closest(selector: string) { return selector === 'form' ? this : null; },
    querySelector(selector: string) { return inputs.get(selector) ?? null; }
  };
  const documentTarget = {
    addEventListener(_type: 'submit', listener: (event: Event) => void) { submit = listener; },
    removeEventListener(_type: 'submit', listener: (event: Event) => void) { if (submit === listener) submit = undefined; }
  };
  const gestures = installSshSessionLogConsentGestureStore(documentTarget, async (sessionId, host, port, gatewayProfileIds) => {
    authorized.push({ sessionId, host, port, gatewayProfileIds });
    return true;
  }, () => now);
  const event = (isTrusted: boolean) => ({ type: 'submit', isTrusted, target: form }) as unknown as Event;
  const gateways = ['11111111-1111-4111-8111-111111111111'];
  submit?.(event(false));
  assert.equal(await gestures.consume(firstSession, 'linux.example.com', 22, gateways), false, 'scripted submits cannot grant consent');
  inputs.set('#ssh-session-log', { value: '', checked: false });
  submit?.(event(true));
  assert.equal(await gestures.consume(firstSession, 'linux.example.com', 22, gateways), false, 'unchecked recording cannot grant consent');
  inputs.set('#ssh-session-log', { value: '', checked: true });
  submit?.(event(true));
  assert.equal(await gestures.consume(firstSession, 'linux.example.com', 22, []), false, 'consent cannot authorize a different route');
  submit?.(event(true));
  assert.equal(await gestures.consume(firstSession, 'linux.example.com', 22, gateways), true);
  assert.equal(await gestures.consume(firstSession, 'linux.example.com', 22, gateways), false, 'consent is one-shot');
  assert.deepEqual(authorized, [{ sessionId: firstSession, host: 'linux.example.com', port: 22, gatewayProfileIds: gateways }]);
  submit?.(event(true));
  now += 751;
  assert.equal(await gestures.consume(firstSession, 'linux.example.com', 22, gateways), false, 'expired consent is rejected');
  gestures.dispose();
  assert.equal(submit, undefined);
});

test('preload plain FTP consent is trusted, endpoint-bound, one-shot, and unavailable for FTPS', async () => {
  let now = 80;
  let submit: ((event: Event) => void) | undefined;
  const authorized: string[] = [];
  const hostInput = { value: 'Files.Example.com.' };
  const portInput = { value: '21' };
  const securityInput = { value: 'ftp' };
  const form = {
    closest(selector: string) { return selector === 'form' ? this : null; },
    querySelector(selector: string) {
      if (selector === 'button[data-mrt-ftp-consent-trigger]') return {};
      if (selector === 'input[name="host"]') return hostInput;
      if (selector === 'input[name="port"]') return portInput;
      if (selector === 'select[name="security"]') return securityInput;
      return null;
    }
  };
  const documentTarget = {
    addEventListener(_type: 'submit', listener: (event: Event) => void) { submit = listener; },
    removeEventListener(_type: 'submit', listener: (event: Event) => void) { if (submit === listener) submit = undefined; }
  };
  const gestures = installFtpConsentGestureStore(documentTarget, async sessionId => { authorized.push(sessionId); return true; }, () => now);
  const event = (isTrusted: boolean) => ({ type: 'submit', isTrusted, target: form }) as unknown as Event;
  submit?.(event(false));
  assert.equal(await gestures.consume(firstSession, 'files.example.com', 21, false), false);
  submit?.(event(true));
  assert.equal(await gestures.consume(firstSession, 'files.example.com', 2121, false), false, 'consent cannot authorize another port');
  submit?.(event(true));
  assert.equal(await gestures.consume(firstSession, 'files.example.com', 21, true), false, 'plain consent cannot authorize FTPS or be reused');
  submit?.(event(true));
  assert.equal(await gestures.consume(firstSession, 'files.example.com', 21, false), true);
  assert.equal(await gestures.consume(firstSession, 'files.example.com', 21, false), false, 'consent is one-shot');
  assert.deepEqual(authorized, [firstSession]);
  submit?.(event(true));
  now += 751;
  assert.equal(await gestures.consume(firstSession, 'files.example.com', 21, false), false, 'expired consent is rejected');
  gestures.dispose();
  assert.equal(submit, undefined);
});

test('TFTP gestures require trusted folder/start actions and support keyboard form submission', async () => {
  let now = 120;
  let click: ((event: Event) => void) | undefined;
  let submit: ((event: Event) => void) | undefined;
  const authorized: Array<{ action: string; selectionId?: string; port?: number }> = [];
  const form = {
    getAttribute(name: string) { return name === 'data-mrt-tftp-selection-id' ? firstSession : null; },
    closest(selector: string) { return selector.startsWith('form') ? this : null; },
    querySelector(selector: string) { return selector === 'input[name="port"]' ? { value: '69' } : null; }
  };
  const buttonTarget = (action: string) => {
    const button = {
      getAttribute(name: string) { return name === 'data-mrt-tftp-server-action-trigger' ? action : null; },
      closest(selector: string) { return selector === 'form' ? form : null; }
    };
    return { closest(selector: string) { return selector === 'button[data-mrt-tftp-server-action-trigger]' ? button : null; } };
  };
  const documentTarget = {
    addEventListener(type: 'click' | 'submit', listener: (event: Event) => void) { if (type === 'click') click = listener; else submit = listener; },
    removeEventListener(type: 'click' | 'submit', listener: (event: Event) => void) {
      if (type === 'click' && click === listener) click = undefined;
      if (type === 'submit' && submit === listener) submit = undefined;
    }
  };
  const gestures = installTftpServerActionGestureStore(documentTarget, async (action, selectionId, port) => {
    authorized.push({ action, ...(selectionId ? { selectionId } : {}), ...(port !== undefined ? { port } : {}) });
    return true;
  }, () => now);
  const clickEvent = (action: string, isTrusted: boolean) => ({ type: 'click', isTrusted, target: buttonTarget(action) }) as unknown as Event;

  click?.(clickEvent('choose-root', false));
  assert.equal(await gestures.consume('choose-root'), false, 'untrusted clicks cannot authorize folder selection');
  click?.(clickEvent('choose-root', true));
  assert.equal(await gestures.consume('choose-root'), true);
  assert.equal(await gestures.consume('choose-root'), false, 'folder selection authorization is one-shot');

  click?.(clickEvent('start', false));
  assert.equal(await gestures.consume('start', firstSession, 69), false);
  click?.(clickEvent('start', true));
  assert.equal(await gestures.consume('start', firstSession, 70), false, 'the submitted port must match the trusted form');
  click?.(clickEvent('start', true));
  assert.equal(await gestures.consume('start', firstSession, 69), true);
  const submitEvent = (isTrusted: boolean) => ({ type: 'submit', isTrusted, target: form }) as unknown as Event;
  submit?.(submitEvent(true));
  assert.equal(await gestures.consume('start', firstSession, 69), true, 'trusted Enter/form submission remains keyboard accessible');
  submit?.(submitEvent(false));
  assert.equal(await gestures.consume('start', firstSession, 69), false);
  assert.deepEqual(authorized, [
    { action: 'choose-root' }, { action: 'start', selectionId: firstSession, port: 69 }, { action: 'start', selectionId: firstSession, port: 69 }
  ]);
  click?.(clickEvent('start', true));
  now += 751;
  assert.equal(await gestures.consume('start', firstSession, 69), false, 'expired gestures cannot start the server');
  gestures.dispose();
  assert.equal(click, undefined);
  assert.equal(submit, undefined);
});

test('main TFTP server gestures are sender, action, selection, port, and one-shot scoped', () => {
  let now = 300;
  const gate = new RendererGestureGate(() => now);
  gate.issueTftpServerAction(11, 'start', firstSession, 69);
  assert.equal(gate.consumeTftpServerAction(12, 'start', firstSession, 69), false);
  assert.equal(gate.consumeTftpServerAction(11, 'start', secondSession, 69), false);
  assert.equal(gate.consumeTftpServerAction(11, 'start', firstSession, 70), false);
  assert.equal(gate.consumeTftpServerAction(11, 'choose-root'), false);
  assert.equal(gate.consumeTftpServerAction(11, 'start', firstSession, 69), true);
  assert.equal(gate.consumeTftpServerAction(11, 'start', firstSession, 69), false);
  gate.issueTftpServerAction(11, 'choose-root');
  now += 751;
  assert.equal(gate.consumeTftpServerAction(11, 'choose-root'), false);
});

test('PowerShell profile execution gesture requires a trusted click on the session-bound action', async () => {
  let now = 400;
  let click: ((event: Event) => void) | undefined;
  const authorized: string[] = [];
  const documentTarget = {
    addEventListener(_type: 'click', listener: (event: Event) => void) { click = listener; },
    removeEventListener(_type: 'click', listener: (event: Event) => void) { if (click === listener) click = undefined; }
  };
  const button = {
    getAttribute(name: string) { return name === 'data-mrt-powershell-profile-trigger' ? firstSession : null; }
  };
  const target = { closest(selector: string) {
    return selector === 'button[data-mrt-powershell-profile-trigger]' ? button : null;
  } };
  const gestures = installPowerShellProfileGestureStore(documentTarget, async sessionId => {
    authorized.push(sessionId);
    return true;
  }, () => now);
  const event = (isTrusted: boolean) => ({ type: 'click', isTrusted, target }) as unknown as Event;

  click?.(event(false));
  assert.equal(await gestures.consume(firstSession), false, 'scripted clicks cannot authorize script execution');
  click?.(event(true));
  assert.equal(await gestures.consume(secondSession), false, 'gesture cannot be redirected to another terminal');
  click?.(event(true));
  assert.equal(await gestures.consume(firstSession), true);
  assert.equal(await gestures.consume(firstSession), false, 'gesture is one-shot');
  assert.deepEqual(authorized, [firstSession]);
  click?.(event(true));
  now += 751;
  assert.equal(await gestures.consume(firstSession), false, 'expired gesture cannot authorize execution');
  gestures.dispose();
  assert.equal(click, undefined);
});

test('SSH X11 consent is trusted-submit, endpoint, route, expiry, and one-shot scoped', async () => {
  let now = 500;
  let submit: ((event: Event) => void) | undefined;
  const authorized: string[] = [];
  const gatewayId = '11111111-1111-4111-8111-111111111111';
  const form = {
    closest(selector: string) { return selector === 'form' ? this : null; },
    querySelector(selector: string) {
      if (selector === 'button[data-mrt-ssh-x11-consent-trigger]') return {};
      if (selector === '#ssh-x11-forwarding') return { checked: true };
      if (selector === 'input[name="host"]') return { value: 'SSH.EXAMPLE.COM.' };
      if (selector === 'input[name="port"]') return { value: '22' };
      if (selector === 'select[name="sshGateway1"]') return { value: gatewayId };
      return null;
    }
  };
  const target = { closest(selector: string) { return selector === 'form' ? form : null; } };
  const documentTarget = {
    addEventListener(_type: 'submit', listener: (event: Event) => void) { submit = listener; },
    removeEventListener(_type: 'submit', listener: (event: Event) => void) { if (submit === listener) submit = undefined; }
  };
  const gestures = installSshX11ConsentGestureStore(documentTarget, async (host, port, gateways) => {
    authorized.push(`${host}:${port}/${gateways.join(',')}`);
    return true;
  }, () => now);
  const event = (isTrusted: boolean) => ({ type: 'submit', isTrusted, target }) as unknown as Event;

  submit?.(event(false));
  assert.equal(await gestures.consume('ssh.example.com', 22, [gatewayId]), false, 'scripted submits cannot grant X11 access');
  submit?.(event(true));
  assert.equal(await gestures.consume('other.example.com', 22, [gatewayId]), false, 'consent is bound to the submitted host');
  submit?.(event(true));
  assert.equal(await gestures.consume('ssh.example.com', 22, []), false, 'consent is bound to the submitted gateway route');
  submit?.(event(true));
  assert.equal(await gestures.consume('ssh.example.com', 22, [gatewayId]), true);
  assert.equal(await gestures.consume('ssh.example.com', 22, [gatewayId]), false, 'consent can be consumed only once');
  assert.deepEqual(authorized, ['ssh.example.com:22/11111111-1111-4111-8111-111111111111']);
  submit?.(event(true));
  now += 751;
  assert.equal(await gestures.consume('ssh.example.com', 22, [gatewayId]), false, 'expired consent cannot enable forwarding');
  gestures.dispose();
  assert.equal(submit, undefined);
});

test('SSH X11 main-process authorization survives one native prompt but stays one-use and route-bound', () => {
  let now = 600;
  const gate = new RendererGestureGate(() => now);
  const gatewayId = '11111111-1111-4111-8111-111111111111';
  gate.issueSshX11Consent(11, 'SSH.EXAMPLE.COM.', 22, [gatewayId]);
  assert.equal(gate.authorizeSshX11Forwarding(12, 'ssh.example.com', 22, [gatewayId]), false);
  assert.equal(gate.authorizeSshX11Forwarding(11, 'other.example.com', 22, [gatewayId]), false);
  assert.equal(gate.authorizeSshX11Forwarding(11, 'ssh.example.com', 22, []), false);
  assert.equal(gate.authorizeSshX11Forwarding(11, 'ssh.example.com', 22, [gatewayId]), true);
  assert.equal(gate.consumeSshX11Authorization(12, 'ssh.example.com', 22, [gatewayId]), false);
  assert.equal(gate.consumeSshX11Authorization(11, 'ssh.example.com', 22, []), false);
  assert.equal(gate.consumeSshX11Authorization(11, 'ssh.example.com', 22, [gatewayId]), true);
  assert.equal(gate.consumeSshX11Authorization(11, 'ssh.example.com', 22, [gatewayId]), false);
  gate.issueSshX11Consent(11, 'ssh.example.com', 22, [gatewayId]);
  assert.equal(gate.authorizeSshX11Forwarding(11, 'ssh.example.com', 22, [gatewayId]), true);
  now += 5 * 60_000 + 1;
  assert.equal(gate.consumeSshX11Authorization(11, 'ssh.example.com', 22, [gatewayId]), false);
});

test('XDMCP requires a trusted submit and the unencrypted-display acknowledgement', async () => {
  let now = 700;
  let submit: ((event: Event) => void) | undefined;
  let confirmed = false;
  const authorized: string[] = [];
  const form = {
    closest(selector: string) { return selector === 'form' ? this : null; },
    querySelector(selector: string) {
      if (selector === 'button[data-mrt-xdmcp-launch-trigger]') return {};
      if (selector === '#xdmcp-insecure-confirm') return { checked: confirmed };
      if (selector === 'input[name="xdmcpHost"]') return { value: 'DISPLAY.EXAMPLE.COM.' };
      return null;
    }
  };
  const target = { closest(selector: string) { return selector === 'form' ? form : null; } };
  const documentTarget = {
    addEventListener(_type: 'submit', listener: (event: Event) => void) { submit = listener; },
    removeEventListener(_type: 'submit', listener: (event: Event) => void) { if (submit === listener) submit = undefined; }
  };
  const gestures = installXdmcpLaunchGestureStore(documentTarget, async host => { authorized.push(host); return true; }, () => now);
  const event = (isTrusted: boolean) => ({ type: 'submit', isTrusted, target }) as unknown as Event;

  submit?.(event(true));
  assert.equal(await gestures.consume('display.example.com'), false, 'the warning must be checked');
  confirmed = true;
  submit?.(event(false));
  assert.equal(await gestures.consume('display.example.com'), false, 'scripted submits cannot grant launch consent');
  submit?.(event(true));
  assert.equal(await gestures.consume('other.example.com'), false, 'consent is bound to the submitted host');
  submit?.(event(true));
  assert.equal(await gestures.consume('display.example.com'), true);
  assert.equal(await gestures.consume('display.example.com'), false, 'consent is one-use');
  assert.deepEqual(authorized, ['display.example.com']);
  submit?.(event(true));
  now += 751;
  assert.equal(await gestures.consume('display.example.com'), false, 'expired consent cannot authorize a launch');
  gestures.dispose();
  assert.equal(submit, undefined);
});

test('XDMCP main-process launch authorization is one-shot and host-bound', () => {
  let now = 800;
  const gate = new RendererGestureGate(() => now);
  gate.issueXdmcpLaunch(11, 'DISPLAY.EXAMPLE.COM.');
  assert.equal(gate.consumeXdmcpLaunch(12, 'display.example.com'), false);
  assert.equal(gate.consumeXdmcpLaunch(11, 'other.example.com'), false);
  assert.equal(gate.consumeXdmcpLaunch(11, 'display.example.com'), true);
  assert.equal(gate.consumeXdmcpLaunch(11, 'display.example.com'), false);
  gate.issueXdmcpLaunch(11, 'display.example.com');
  now += 751;
  assert.equal(gate.consumeXdmcpLaunch(11, 'display.example.com'), false);
});
