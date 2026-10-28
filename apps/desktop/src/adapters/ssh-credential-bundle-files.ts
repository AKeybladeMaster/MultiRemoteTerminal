import { open, rename, unlink, writeFile } from 'node:fs/promises';
import { StorageOperationError } from '../../../../packages/application/src/storage-errors.ts';
import { MAX_SSH_CREDENTIAL_BUNDLE_BYTES } from '../../../../packages/application/src/ssh-credential-bundle.ts';

export async function readEncryptedSshCredentialBundle(path: string): Promise<Uint8Array> {
  const file = await open(path, 'r');
  let bytes: Buffer | undefined;
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size > MAX_SSH_CREDENTIAL_BUNDLE_BYTES) throw new StorageOperationError('invalid');
    bytes = Buffer.alloc(MAX_SSH_CREDENTIAL_BUNDLE_BYTES + 1);
    let length = 0;
    while (length < bytes.byteLength) {
      const { bytesRead } = await file.read(bytes, length, bytes.byteLength - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    const after = await file.stat();
    if (length > MAX_SSH_CREDENTIAL_BUNDLE_BYTES || length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw new StorageOperationError('invalid');
    }
    return Buffer.from(bytes.subarray(0, length));
  } finally {
    bytes?.fill(0);
    await file.close();
  }
}

export async function writeEncryptedSshCredentialBundle(path: string, temporaryPath: string, contents: Uint8Array): Promise<{ readonly bytesSaved: number }> {
  if (contents.byteLength === 0 || contents.byteLength > MAX_SSH_CREDENTIAL_BUNDLE_BYTES) throw new StorageOperationError('invalid');
  const bytes = Buffer.from(contents);
  let ownsTemporaryFile = false;
  try {
    await writeFile(temporaryPath, bytes, { flag: 'wx' });
    ownsTemporaryFile = true;
    await rename(temporaryPath, path);
    ownsTemporaryFile = false;
    return { bytesSaved: bytes.byteLength };
  } catch (error) {
    if (ownsTemporaryFile) await unlink(temporaryPath).catch(() => undefined);
    throw error;
  } finally { bytes.fill(0); }
}
