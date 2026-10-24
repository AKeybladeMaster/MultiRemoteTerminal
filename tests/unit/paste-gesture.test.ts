import assert from 'node:assert/strict';
import test from 'node:test';
import { RendererGestureGate } from '../../apps/desktop/src/main/renderer-gesture-gate.ts';
import { installFtpConsentGestureStore, installTelnetConsentGestureStore, installTerminalPasteGestureStore } from '../../apps/desktop/src/preload/paste-gesture.ts';

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
