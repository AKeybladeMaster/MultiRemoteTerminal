import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageOperationError } from '../../packages/application/src/storage-errors.ts';
import { DEFAULT_WORKBENCH_PREFERENCES } from '../../packages/domain/src/workbench-preferences.ts';
import { readWorkbenchSettingsTemplate, writeWorkbenchSettingsTemplate } from '../../apps/desktop/src/adapters/workbench-settings-template-files.ts';

test('settings template file adapter atomically exports and imports bounded preferences', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-settings-template-'));
  const path = join(directory, 'settings.json');
  const temporaryPath = join(directory, '.settings.json.test.tmp');
  const expected = { ...DEFAULT_WORKBENCH_PREFERENCES, startupGreeting: 'Template imported' };
  try {
    await writeFile(path, 'old contents');
    const result = await writeWorkbenchSettingsTemplate(path, temporaryPath, expected);
    assert.equal(result.bytesSaved, (await readFile(path)).byteLength);
    assert.equal(await readFile(temporaryPath).then(() => true, () => false), false);
    assert.deepEqual(await readWorkbenchSettingsTemplate(path), expected);

    await writeFile(path, Buffer.from([0xff, 0xfe]));
    await assert.rejects(readWorkbenchSettingsTemplate(path), error => error instanceof StorageOperationError && error.kind === 'invalid');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
