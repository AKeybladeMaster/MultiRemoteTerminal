import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { findLocalTransferPartial, localTransferPartialName } from '../../apps/desktop/src/adapters/local-transfer-recovery.ts';

test('local transfer recovery locates only the exact staged download for a valid operation ID', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-local-transfer-recovery-'));
  const operationId = '018f7b8a-6d19-4e0c-8c6a-682f1316f004';
  const partialPath = join(directory, `.mrt-${operationId}.partial`);
  try {
    assert.equal(localTransferPartialName('../outside'), undefined);
    assert.equal(await findLocalTransferPartial(directory, operationId), undefined);
    await writeFile(partialPath, 'incomplete');
    assert.equal(await findLocalTransferPartial(directory, operationId), partialPath);
    assert.equal(await findLocalTransferPartial(`${directory}${sep}`, operationId), partialPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
