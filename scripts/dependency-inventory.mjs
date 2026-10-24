import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// Invoked by pnpm; reuse its pinned CLI, without a shell or global install.
const cli = process.env.npm_execpath;
if (!cli) throw new Error('Run this script with the pinned pnpm');
const native = !/\.[cm]?js$/.test(cli);
const result = spawnSync(native ? cli : process.execPath, [...(native ? [] : [cli]), '--recursive', 'licenses', 'list', '--json'], { encoding: 'utf8' });
if (result.status !== 0) { console.error('Could not read dependency license inventory'); process.exit(1); }
const licenses = JSON.parse(result.stdout);
const components = Object.values(licenses).flatMap(group => group.flatMap(item => item.versions.map(version => ({
  type: 'library', name: item.name, version,
  purl: `pkg:npm/${item.name.replace('@', '%40')}@${version}`,
  licenses: [{ expression: item.license }],
  ...(item.homepage ? { externalReferences: [{ type: 'website', url: item.homepage }] } : {})
})))).sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
const bom = { bomFormat: 'CycloneDX', specVersion: '1.6', version: 1,
  metadata: { component: { type: 'application', name: 'MultiRemoteTerminal', version: '0.0.0' } }, components };
const output = process.env.MRT_SBOM_OUTPUT ?? 'docs/dependencies/wp-00-sbom.cdx.json';
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(bom, null, 2) + '\n');
console.log(`Wrote ${components.length} installed dependency entries (development and runtime).`);
