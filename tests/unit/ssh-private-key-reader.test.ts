import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSshPrivateKeyFile } from '../../apps/desktop/src/main/ssh-private-key-reader.ts';
import { MAX_SSH_PRIVATE_KEY_BYTES } from '../../packages/application/src/ssh-terminals.ts';

test('SSH private-key reader returns bounded one-use bytes and rejects non-file or oversized selections', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-ssh-private-key-reader-'));
  const keyPath = join(directory, 'id_ed25519');
  const oversizedPath = join(directory, 'oversized.key');
  const folderPath = join(directory, 'key-folder');
  const source = Buffer.from('-----BEGIN OPENSSH PRIVATE KEY-----\nfixture\n-----END OPENSSH PRIVATE KEY-----\n');
  try {
    await writeFile(keyPath, source);
    const selection = await readSshPrivateKeyFile(keyPath);
    assert.equal(selection.ok, true);
    if (selection.ok) {
      assert.equal(selection.result.fileName, 'id_ed25519');
      assert.deepEqual(selection.result.data, source);
      selection.result.data.fill(0);
    }
    assert.equal((await readSshPrivateKeyFile(join(directory, 'relative-missing'))).ok, false);

    await mkdir(folderPath);
    assert.deepEqual(await readSshPrivateKeyFile(folderPath), {
      ok: false, error: { code: 'INVALID_REQUEST', target: 'application', retryable: false }
    });
    await writeFile(oversizedPath, Buffer.alloc(MAX_SSH_PRIVATE_KEY_BYTES + 1));
    assert.deepEqual(await readSshPrivateKeyFile(oversizedPath), {
      ok: false, error: { code: 'INVALID_REQUEST', target: 'application', retryable: false }
    });
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
