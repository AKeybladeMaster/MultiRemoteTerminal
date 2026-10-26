import { open } from 'node:fs/promises';
import { failure } from '../../../../packages/domain/src/errors.ts';
import type { Outcome } from '../../../../packages/domain/src/errors.ts';
import { isCustomLogoDataUrl, MAX_CUSTOM_LOGO_DATA_URL_LENGTH, MAX_CUSTOM_LOGO_PNG_BYTES,
  MAX_CUSTOM_LOGO_SOURCE_BYTES, readCustomLogoPngDimensions } from '../../../../packages/domain/src/custom-logo.ts';
import type { CustomLogoSelection } from '../../../../packages/domain/src/custom-logo.ts';

interface DecodedImage {
  isEmpty(): boolean;
  getSize(): { readonly width: number; readonly height: number };
  toPNG(): Uint8Array;
}

export interface CustomLogoPicker {
  select(): Promise<Outcome<CustomLogoSelection>>;
}

/** Reads only the chosen, bounded image and returns a normalized PNG without its source path. */
export function createCustomLogoPicker(chooseFile: () => Promise<string | undefined>,
  decodeImage: (bytes: Uint8Array) => DecodedImage): CustomLogoPicker {
  return Object.freeze({
    async select(): Promise<Outcome<CustomLogoSelection>> {
      let path: string | undefined;
      try { path = await chooseFile(); }
      catch { return failure('UNAVAILABLE'); }
      if (!path) return failure('CANCELLED');

      let source: Uint8Array | undefined;
      try { source = await readBoundedFile(path); }
      catch { return failure('UNAVAILABLE'); }
      const dimensions = readCustomLogoPngDimensions(source);
      if (!source || !dimensions) return failure('INVALID_REQUEST');

      let image: DecodedImage;
      try { image = decodeImage(source); }
      catch { return failure('INVALID_REQUEST'); }
      if (image.isEmpty()) return failure('INVALID_REQUEST');
      const decodedSize = image.getSize();
      if (decodedSize.width !== dimensions.width || decodedSize.height !== dimensions.height) return failure('INVALID_REQUEST');

      let normalized: Uint8Array;
      try { normalized = image.toPNG(); }
      catch { return failure('INVALID_REQUEST'); }
      if (normalized.byteLength > MAX_CUSTOM_LOGO_PNG_BYTES || !readCustomLogoPngDimensions(normalized)) return failure('INVALID_REQUEST');
      const dataUrl = `data:image/png;base64,${Buffer.from(normalized).toString('base64')}`;
      if (dataUrl.length > MAX_CUSTOM_LOGO_DATA_URL_LENGTH || !isCustomLogoDataUrl(dataUrl)) return failure('INVALID_REQUEST');
      return { ok: true, result: Object.freeze({ dataUrl }) };
    }
  });
}

async function readBoundedFile(path: string): Promise<Uint8Array | undefined> {
  const handle = await open(path, 'r');
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size < 1 || metadata.size > MAX_CUSTOM_LOGO_SOURCE_BYTES) return undefined;
    const bytes = Buffer.alloc(MAX_CUSTOM_LOGO_SOURCE_BYTES + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.byteLength, 0);
    if (bytesRead < 1 || bytesRead > MAX_CUSTOM_LOGO_SOURCE_BYTES) return undefined;
    return bytes.subarray(0, bytesRead);
  } finally { await handle.close(); }
}
