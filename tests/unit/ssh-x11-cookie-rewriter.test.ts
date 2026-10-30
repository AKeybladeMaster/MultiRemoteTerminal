import test from 'node:test';
import assert from 'node:assert/strict';
import { SshX11CookieRewriter } from '../../apps/desktop/src/workers/ssh-x11-cookie-rewriter.ts';

function setupRequest(cookie: Buffer): Buffer {
  const setup = Buffer.alloc(48);
  setup[0] = 0x6c;
  setup.writeUInt16LE(11, 2);
  setup.writeUInt16LE(18, 6);
  setup.writeUInt16LE(16, 8);
  setup.write('MIT-MAGIC-COOKIE-1', 12, 'ascii');
  cookie.copy(setup, 32);
  return setup;
}

function rewrite(chunks: readonly Buffer[], fakeCookie: Buffer, realCookie: Buffer): Promise<Buffer[]> {
  const rewriter = new SshX11CookieRewriter(fakeCookie, realCookie);
  const output: Buffer[] = [];
  const complete = new Promise<Buffer[]>((resolve, reject) => {
    rewriter.on('data', chunk => output.push(Buffer.from(chunk)));
    rewriter.once('end', () => resolve(output));
    rewriter.once('error', reject);
  });
  for (const chunk of chunks) rewriter.write(chunk);
  rewriter.end();
  return complete;
}

test('SSH X11 cookie rewriter handles split setup and preserves subsequent X11 data', async () => {
  const fakeCookie = Buffer.alloc(16, 0x11);
  const realCookie = Buffer.alloc(16, 0x22);
  const trailing = Buffer.from([0xaa, 0xbb, 0xcc]);
  const setup = setupRequest(fakeCookie);
  const result = await rewrite([setup.subarray(0, 9), Buffer.concat([setup.subarray(9), trailing]), Buffer.from([0xdd])], fakeCookie, realCookie);

  assert.equal(result.length, 2);
  assert.deepEqual(result[0], Buffer.concat([setupRequest(realCookie), trailing]));
  assert.deepEqual(result[1], Buffer.from([0xdd]));
});

test('SSH X11 cookie rewriter rejects an unexpected authorization cookie', async () => {
  const fakeCookie = Buffer.alloc(16, 0x11);
  const wrongCookie = Buffer.alloc(16, 0x33);
  await assert.rejects(rewrite([setupRequest(wrongCookie)], fakeCookie, Buffer.alloc(16, 0x22)), /authorization/);
});

test('SSH X11 cookie rewriter rejects unsupported setup messages', async () => {
  const setup = setupRequest(Buffer.alloc(16, 0x11));
  setup.writeUInt16LE(12, 2);
  await assert.rejects(rewrite([setup], Buffer.alloc(16, 0x11), Buffer.alloc(16, 0x22)), /setup/);
});

test('SSH X11 cookie rewriter bounds pre-authentication input', async () => {
  await assert.rejects(rewrite([Buffer.alloc(65_537)], Buffer.alloc(16, 0x11), Buffer.alloc(16, 0x22)), /setup/);
});
