import { Transform } from 'node:stream';
import type { TransformCallback } from 'node:stream';
import { parseX11SetupRequest, rewriteX11SetupCookie } from '../../../../packages/domain/src/x11.ts';

const MAX_X11_SETUP_PACKET_BYTES = 2_048;
// shortcut: cap startup pipelining at 64 KiB; raise only if a real X11 client requires more before the setup reply.
const MAX_X11_INITIAL_DATA_BYTES = 65_536;

export class SshX11CookieRewriter extends Transform {
  private readonly fakeCookie: Buffer;
  private readonly realCookie: Buffer;
  private readonly cookieBuffers = new Set<Buffer>();
  private pendingSetup = Buffer.alloc(0);
  private authorized = false;

  constructor(fakeCookie: Uint8Array, realCookie: Uint8Array) {
    super();
    if (fakeCookie.byteLength !== 16 || realCookie.byteLength !== 16) throw new TypeError('X11 requires 16-byte cookies');
    this.fakeCookie = Buffer.from(fakeCookie);
    this.realCookie = Buffer.from(realCookie);
  }

  clearCookieBuffer(value: Buffer): void {
    if (!this.cookieBuffers.delete(value)) return;
    value.fill(0);
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    if (this.authorized) { callback(null, chunk); return; }
    const totalBytes = this.pendingSetup.byteLength + chunk.byteLength;
    if (totalBytes > MAX_X11_INITIAL_DATA_BYTES) {
      callback(new Error('Invalid forwarded X11 setup'));
      return;
    }
    const pendingBytes = this.pendingSetup.byteLength;
    const setupBytes = Math.min(totalBytes, MAX_X11_SETUP_PACKET_BYTES);
    const setup = Buffer.concat([this.pendingSetup, chunk.subarray(0, setupBytes - pendingBytes)], setupBytes);
    const parsed = parseX11SetupRequest(setup);
    if (parsed.kind === 'incomplete') {
      this.pendingSetup.fill(0);
      this.pendingSetup = setup;
      callback();
      return;
    }
    if (parsed.kind === 'invalid') {
      setup.fill(0);
      callback(new Error('Invalid forwarded X11 setup'));
      return;
    }
    const rewritten = rewriteX11SetupCookie(setup, this.fakeCookie, this.realCookie);
    if (!rewritten) {
      setup.fill(0);
      callback(new Error('Invalid forwarded X11 authorization'));
      return;
    }
    this.pendingSetup.fill(0);
    this.pendingSetup = Buffer.alloc(0);
    this.authorized = true;
    const output = Buffer.concat([Buffer.from(rewritten.subarray(0, parsed.packetLength)),
      setup.subarray(parsed.packetLength), chunk.subarray(setupBytes - pendingBytes)]);
    setup.fill(0);
    rewritten.fill(0);
    this.cookieBuffers.add(output);
    callback(null, output);
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.fakeCookie.fill(0);
    this.realCookie.fill(0);
    this.pendingSetup.fill(0);
    for (const buffer of this.cookieBuffers) buffer.fill(0);
    this.cookieBuffers.clear();
    callback(error);
  }
}
