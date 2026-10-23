import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('dependency inventory includes production packages from workspace projects', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'mrt-dependency-inventory-'));
  const outputFile = join(outputDir, 'bom.json');
  try {
    const result = spawnSync(process.execPath, [join(projectRoot, 'scripts/dependency-inventory.mjs')], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...process.env, MRT_SBOM_OUTPUT: outputFile }
    });
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    const bom = JSON.parse(await readFile(outputFile, 'utf8')) as { components: Array<{ name: string }> };
    const names = new Set(bom.components.map(component => component.name));
    assert.ok(names.has('ssh2'), 'SSH runtime package must be inventoried');
    assert.ok(names.has('libsodium-wrappers-sumo'), 'vault crypto runtime package must be inventoried');
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
