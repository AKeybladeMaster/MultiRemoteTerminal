import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { readEncryptedSshCredentialBundle, writeEncryptedSshCredentialBundle } from '../../apps/desktop/src/adapters/ssh-credential-bundle-files.ts';

test('encrypted credential bundle files are read within bounds and exported by atomic sibling rename', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-credential-bundle-'));
  const path = join(directory, 'credentials.mrtcred');
  const temporaryPath = join(directory, `.${basename(path)}.11111111-1111-4111-8111-111111111111.tmp`);
  const contents = new Uint8Array([1, 2, 3, 4]);
  try {
    assert.deepEqual(await writeEncryptedSshCredentialBundle(path, temporaryPath, contents), { bytesSaved: contents.byteLength });
    assert.deepEqual(new Uint8Array(await readEncryptedSshCredentialBundle(path)), contents);
    assert.deepEqual(await readdir(directory), ['credentials.mrtcred']);
    assert.deepEqual(await readFile(path), Buffer.from(contents));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
