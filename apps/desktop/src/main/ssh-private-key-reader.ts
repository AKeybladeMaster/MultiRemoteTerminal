import { lstat as lstatFile, open as openFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { failure } from '../../../../packages/domain/src/errors.ts';
import type { Outcome } from '../../../../packages/domain/src/errors.ts';
import { MAX_SSH_PRIVATE_KEY_BYTES } from '../../../../packages/application/src/ssh-terminals.ts';
import type { SshPrivateKeySelection } from '../../../../packages/application/src/ssh-terminals.ts';

/** Reads only a native-picker-selected, regular key file into bounded, one-use memory. */
export async function readSshPrivateKeyFile(filePath: string): Promise<Outcome<SshPrivateKeySelection>> {
  if (typeof filePath !== 'string' || filePath.length === 0 || /[\u0000-\u001f\u007f]/u.test(filePath) ||
      resolve(filePath) !== filePath) return failure('INVALID_REQUEST');

  let data: Buffer | undefined;
  let complete = false;
  try {
    const linkStats = await lstatFile(filePath);
    if (!linkStats.isFile() || linkStats.size <= 0 || linkStats.size > MAX_SSH_PRIVATE_KEY_BYTES) return failure('INVALID_REQUEST');
    const file = await openFile(filePath, 'r');
    try {
      const openedStats = await file.stat();
      if (!openedStats.isFile() || openedStats.size !== linkStats.size || openedStats.size <= 0 ||
          openedStats.size > MAX_SSH_PRIVATE_KEY_BYTES ||
          (openedStats.ino !== 0 && linkStats.ino !== 0 && openedStats.ino !== linkStats.ino)) return failure('INVALID_REQUEST');

      data = Buffer.alloc(openedStats.size);
      let offset = 0;
      while (offset < data.length) {
        const read = await file.read(data, offset, data.length - offset, offset);
        if (read.bytesRead <= 0) return failure('UNAVAILABLE');
        offset += read.bytesRead;
      }
      const finalStats = await file.stat();
      if (finalStats.size !== openedStats.size || finalStats.mtimeMs !== openedStats.mtimeMs) return failure('INVALID_REQUEST');
      const fileName = basename(filePath);
      if (fileName.length === 0 || fileName.length > 256 || /[\u0000-\u001f\u007f]/u.test(fileName)) return failure('INVALID_REQUEST');
      complete = true;
      return { ok: true, result: { data, fileName } };
    } finally {
      await file.close().catch(() => undefined);
    }
  } catch {
    return failure('UNAVAILABLE');
  } finally {
    if (!complete) data?.fill(0);
  }
}
