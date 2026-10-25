import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
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
