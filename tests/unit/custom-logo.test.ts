import assert from 'node:assert/strict';
import test from 'node:test';
import { isCustomLogoDataUrl, MAX_CUSTOM_LOGO_DATA_URL_LENGTH, MAX_CUSTOM_LOGO_DIMENSION,
  MAX_CUSTOM_LOGO_SOURCE_BYTES, readCustomLogoPngDimensions } from '../../packages/domain/src/custom-logo.ts';

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  writeUint32(bytes, 16, width);
  writeUint32(bytes, 20, height);
  return bytes;
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value >>> 24;
  bytes[offset + 1] = value >>> 16;
  bytes[offset + 2] = value >>> 8;
  bytes[offset + 3] = value;
}

test('custom logo PNG header parser bounds dimensions before image decoding', () => {
  assert.deepEqual(readCustomLogoPngDimensions(pngHeader(24, 32)), { width: 24, height: 32 });
  assert.deepEqual(readCustomLogoPngDimensions(pngHeader(MAX_CUSTOM_LOGO_DIMENSION, MAX_CUSTOM_LOGO_DIMENSION)),
    { width: MAX_CUSTOM_LOGO_DIMENSION, height: MAX_CUSTOM_LOGO_DIMENSION });
  assert.equal(readCustomLogoPngDimensions(pngHeader(MAX_CUSTOM_LOGO_DIMENSION + 1, 1)), undefined);
  assert.equal(readCustomLogoPngDimensions(pngHeader(1, 0)), undefined);
  assert.equal(readCustomLogoPngDimensions(new Uint8Array(MAX_CUSTOM_LOGO_SOURCE_BYTES + 1)), undefined);
  assert.equal(readCustomLogoPngDimensions('not bytes'), undefined);
});

test('custom logo preferences accept only bounded canonical PNG data URLs', () => {
  assert.equal(isCustomLogoDataUrl('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'), true);
  assert.equal(isCustomLogoDataUrl('data:image/svg+xml;base64,PHN2Zz4='), false);
  assert.equal(isCustomLogoDataUrl('data:image/png;base64,../../bad'), false);
  assert.equal(isCustomLogoDataUrl(`data:image/png;base64,iVBORw0KGgo${'A'.repeat(MAX_CUSTOM_LOGO_DATA_URL_LENGTH)}`), false);
  assert.equal(isCustomLogoDataUrl(null), false);
});
