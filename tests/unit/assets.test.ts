import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assetPath, serveAsset } from '../../apps/desktop/src/main/assets.ts';

test('asset routing cannot select arbitrary files or foreign origins', () => {
  assert.equal(assetPath('mrt://app/index.html'), 'index.html');
  assert.equal(assetPath('mrt://app/assets/index-123.js'), 'assets/index-123.js');
  for (const path of ['file:///C:/Windows/win.ini', 'mrt://app/../../AGENTS.md', 'mrt://app/%2e%2e/secret',
    'mrt://evil/index.html', 'mrt://app:80/index.html', 'mrt://user:pass@app/index.html',
    'mrt://app/assets/%2fsecret.js', 'mrt://app/assets/a.js?secret', 'mrt://app/secret.db', 'not-a-url']) {
    assert.equal(assetPath(path), undefined);
  }
});

test('real static asset adapter serves only allowed resources with strict headers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mrt-assets-'));
  try {
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'index.html'), '<h1>original shell</h1>');
    await writeFile(join(root, 'assets', 'index-123.js'), 'export {};');
    const response = await serveAsset(root, new Request('mrt://app/index.html'));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '<h1>original shell</h1>');
    const csp = response.headers.get('Content-Security-Policy') ?? '';
    assert.match(csp, /script-src 'self';/u);
    assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/u);
    assert.match(csp, /style-src 'self' 'unsafe-inline';/u);
    assert.match(csp, /img-src 'self' data:;/u);
    assert.doesNotMatch(csp, /script-src[^;]*data:/u);
    assert.match(csp, /connect-src 'none'/u);
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal((await serveAsset(root, new Request('mrt://app/index.html', { method: 'POST' }))).status, 403);
    assert.equal((await serveAsset(root, new Request('mrt://app/assets/missing.js'))).status, 404);
    assert.equal((await serveAsset(root, new Request('mrt://app/secret.txt'))).status, 403);
  } finally { await rm(root, { recursive: true, force: true }); }
});
