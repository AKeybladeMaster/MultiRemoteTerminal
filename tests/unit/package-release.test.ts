import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

test('Windows signed-release mode fails closed without a certificate reference', { skip: process.platform !== 'win32' || process.arch !== 'x64' }, () => {
  const environment: NodeJS.ProcessEnv = { ...process.env, MRT_SIGNED_RELEASE: '1' };
  delete environment.WIN_CSC_LINK;
  delete environment.WIN_CSC_KEY_PASSWORD;
  delete environment.CSC_LINK;
  delete environment.CSC_KEY_PASSWORD;
  const result = spawnSync(process.execPath, [resolve('scripts/package-win.mjs')], {
    cwd: resolve('.'),
    env: environment,
    encoding: 'utf8',
    windowsHide: true
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /A signed Windows release requires WIN_CSC_LINK or CSC_LINK/u);
});

test('Windows distribution SBOM refuses a pnpm CLI that differs from the repository pin', { skip: process.platform !== 'win32' || process.arch !== 'x64' }, async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'mrt-pnpm-pin-'));
  try {
    const alternatePnpmCli = join(temporaryDirectory, 'pnpm.cjs');
    await writeFile(alternatePnpmCli, "process.stdout.write('99.0.0\\n');\n", 'utf8');
    const result = spawnSync(process.execPath, [resolve('scripts/generate-distribution-sbom.mjs')], {
      cwd: resolve('.'),
      env: { ...process.env, npm_execpath: alternatePnpmCli },
      encoding: 'utf8',
      windowsHide: true
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Use pinned pnpm 12\.15\.0.*found 99\.0\.0/u);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
