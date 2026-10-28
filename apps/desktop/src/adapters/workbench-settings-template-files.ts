import { open, rename, unlink, writeFile } from 'node:fs/promises';
import type { WorkbenchPreferences } from '../../../../packages/domain/src/workbench-preferences.ts';
import { MAX_WORKBENCH_SETTINGS_TEMPLATE_BYTES, parseWorkbenchSettingsTemplate, serializeWorkbenchSettingsTemplate } from '../../../../packages/domain/src/workbench-settings-template.ts';
import { StorageOperationError } from '../../../../packages/application/src/storage-errors.ts';

export async function writeWorkbenchSettingsTemplate(path: string, temporaryPath: string, preferences: WorkbenchPreferences): Promise<{ readonly bytesSaved: number }> {
  const contents = serializeWorkbenchSettingsTemplate(preferences);
  if (contents === undefined) throw new StorageOperationError('invalid');
  const bytes = Buffer.from(contents, 'utf8');
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

export async function readWorkbenchSettingsTemplate(path: string): Promise<WorkbenchPreferences> {
  const file = await open(path, 'r');
  try {
    const details = await file.stat();
    if (!details.isFile() || details.size > MAX_WORKBENCH_SETTINGS_TEMPLATE_BYTES) throw new StorageOperationError('invalid');
    const bytes = Buffer.alloc(MAX_WORKBENCH_SETTINGS_TEMPLATE_BYTES + 1);
    let length = 0;
    while (length <= MAX_WORKBENCH_SETTINGS_TEMPLATE_BYTES) {
      const { bytesRead } = await file.read(bytes, length, Math.min(64 * 1024, bytes.byteLength - length), null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > MAX_WORKBENCH_SETTINGS_TEMPLATE_BYTES) throw new StorageOperationError('invalid');
    let contents: string;
    try { contents = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)); }
    catch { throw new StorageOperationError('invalid'); }
    const preferences = parseWorkbenchSettingsTemplate(contents);
    if (!preferences) throw new StorageOperationError('invalid');
    return preferences;
  } finally { await file.close(); }
}
