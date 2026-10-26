import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createCustomLogoPicker } from '../../apps/desktop/src/main/custom-logo-picker.ts';
import { MAX_CUSTOM_LOGO_PNG_BYTES } from '../../packages/domain/src/custom-logo.ts';

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

async function createInput(bytes: Uint8Array): Promise<{ readonly directory: string; readonly path: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-logo-picker-'));
  const path = join(directory, 'logo.png');
  await writeFile(path, bytes);
  return { directory, path };
}

test('logo picker normalizes a user-selected image and returns no filesystem path', async () => {
  const source = pngHeader(2, 3);
  const input = await createInput(source);
  try {
    const picker = createCustomLogoPicker(async () => input.path, bytes => ({
      isEmpty: () => false,
      getSize: () => ({ width: 2, height: 3 }),
      toPNG: () => bytes
    }));
    const result = await picker.select();
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.match(result.result.dataUrl, /^data:image\/png;base64,iVBORw0KGgo/u);
    assert.equal(result.result.dataUrl.includes(input.path), false);
    assert.deepEqual(Object.keys(result.result), ['dataUrl']);
  } finally { await rm(input.directory, { recursive: true, force: true }); }
});

test('logo picker cancels without decoding and rejects malformed, oversized, or undecodable images', async () => {
  let decoded = false;
  const cancelled = createCustomLogoPicker(async () => undefined, () => { decoded = true; throw new Error('must not decode'); });
  assert.deepEqual(await cancelled.select(), { ok: false, error: { code: 'CANCELLED', target: 'application', retryable: false } });
  assert.equal(decoded, false);

  const invalid = await createInput(new Uint8Array(40));
  const oversized = await createInput(pngHeader(513, 1));
  const tooLarge = await createInput(new Uint8Array(MAX_CUSTOM_LOGO_PNG_BYTES * 2 + 1));
  const valid = await createInput(pngHeader(1, 1));
  const largeOutput = new Uint8Array(MAX_CUSTOM_LOGO_PNG_BYTES + 1);
  largeOutput.set(pngHeader(1, 1));
  try {
    const invalidPicker = createCustomLogoPicker(async () => invalid.path, () => { decoded = true; throw new Error('invalid header should not decode'); });
    assert.equal((await invalidPicker.select()).ok, false);
    assert.equal(decoded, false);
    const oversizedPicker = createCustomLogoPicker(async () => oversized.path, () => { decoded = true; throw new Error('large image should not decode'); });
    assert.equal((await oversizedPicker.select()).ok, false);
    assert.equal(decoded, false);
    const tooLargePicker = createCustomLogoPicker(async () => tooLarge.path, () => { decoded = true; throw new Error('oversized source should not decode'); });
    assert.equal((await tooLargePicker.select()).ok, false);
    assert.equal(decoded, false);
    const decoderFailure = createCustomLogoPicker(async () => valid.path, () => { throw new Error('unsupported PNG'); });
    assert.equal((await decoderFailure.select()).ok, false);
    const largeResult = createCustomLogoPicker(async () => valid.path, () => ({
      isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }), toPNG: () => largeOutput
    }));
    assert.equal((await largeResult.select()).ok, false);
  } finally {
    await Promise.all([invalid.directory, oversized.directory, tooLarge.directory, valid.directory]
      .map(directory => rm(directory, { recursive: true, force: true })));
  }
});
