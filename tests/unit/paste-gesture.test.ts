import assert from 'node:assert/strict';
import test from 'node:test';
import { PasteGestureGate } from '../../apps/desktop/src/main/paste-gesture.ts';
import { installTerminalPasteGestureStore } from '../../apps/desktop/src/preload/paste-gesture.ts';

const firstSession = 'c8f87744-bd2c-4c0d-9a18-a4a324dd71fd';
const secondSession = '5726a2ee-03cd-4f5a-a28c-bd72784f80a6';

test('main paste gesture gate is one-shot, short-lived, sender-scoped and session-scoped', () => {
  let now = 100;
  const gate = new PasteGestureGate(() => now);
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
