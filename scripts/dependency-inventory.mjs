import { spawnSync } from 'node:child_process';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeWorkspaceOutputFile } from './third-party-notices.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(projectRoot, process.env.MRT_SBOM_OUTPUT ?? 'docs/dependencies/wp-00-sbom.cdx.json');
const outputRelativePath = relative(projectRoot, output);
if (!outputRelativePath || outputRelativePath === '..' || outputRelativePath.startsWith(`..${sep}`) || isAbsolute(outputRelativePath)) {
  throw new Error('The dependency inventory output must stay inside the workspace.');
}
const outputDirectory = dirname(outputRelativePath);
const outputComponents = outputDirectory === '.' ? [] : outputDirectory.split(sep).filter(Boolean);

// Invoked by pnpm; reuse its pinned CLI, without a shell or global install.
const cli = process.env.npm_execpath;
if (!cli) throw new Error('Run this script with the pinned pnpm');
const native = !/\.[cm]?js$/.test(cli);
const result = spawnSync(native ? cli : process.execPath, [...(native ? [] : [cli]), '--recursive', 'licenses', 'list', '--json'], {
  cwd: projectRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024
});
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
await writeWorkspaceOutputFile(projectRoot, outputComponents, basename(output), JSON.stringify(bom, null, 2) + '\n');
console.log(`Wrote ${components.length} installed dependency entries (development and runtime).`);
