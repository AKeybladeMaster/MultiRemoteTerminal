import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_REMOTE_TEXT_FILE_BYTES } from '../../packages/domain/src/remote-text-file.ts';
import { readLocalTextFile, saveLocalTextFile } from '../../apps/desktop/src/workers/local-text-file-provider.ts';

async function withTempDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-local-text-'));
  try { await run(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

function hasError(code: string) {
  return (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

test('local text worker reads bounded UTF-8 and commits a revision-checked save without residue', async () => {
  await withTempDirectory(async directory => {
    const path = join(directory, 'settings.txt');
    await writeFile(path, Buffer.from('\uFEFFname=old\r\n', 'utf8'));
    const loaded = await readLocalTextFile(path);
    assert.equal(loaded.fileName, 'settings.txt');
    assert.equal(loaded.content, '\uFEFFname=old\r\n');
    assert.equal(loaded.bytes, Buffer.byteLength(loaded.content));

    const content = '\uFEFFname=new\r\n';
    const saved = await saveLocalTextFile(path, content, loaded.revision);
    assert.equal(saved.bytesSaved, Buffer.byteLength(content));
    assert.equal((await readFile(path, 'utf8')), content);
    assert.equal((await readdir(directory)).some(name => name.endsWith('.partial') || name.endsWith('.backup')), false);
  });
});

test('local text worker detects an external edit and leaves the changed file intact', async () => {
  await withTempDirectory(async directory => {
    const path = join(directory, 'settings.txt');
    await writeFile(path, 'before');
    const loaded = await readLocalTextFile(path);
    await writeFile(path, 'changed outside the editor');
    await assert.rejects(saveLocalTextFile(path, 'my draft', loaded.revision), hasError('CONFLICT'));
    assert.equal(await readFile(path, 'utf8'), 'changed outside the editor');
    assert.deepEqual((await readdir(directory)).sort(), ['settings.txt']);
  });
});

test('local text worker rejects malformed UTF-8 and files above the editor bound', async () => {
  await withTempDirectory(async directory => {
    const invalidPath = join(directory, 'invalid.txt');
    const largePath = join(directory, 'large.txt');
    await writeFile(invalidPath, Buffer.from([0x61, 0xff, 0x62]));
    await writeFile(largePath, Buffer.alloc(MAX_REMOTE_TEXT_FILE_BYTES + 1, 0x61));
    await assert.rejects(readLocalTextFile(invalidPath), hasError('NOT_SUPPORTED'));
    await assert.rejects(readLocalTextFile(largePath), hasError('OUTPUT_LIMIT'));
  });
});
