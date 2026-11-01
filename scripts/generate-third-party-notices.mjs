import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildThirdPartyNotices, ensureWorkspaceTemporaryDirectory, productionLicensePackages,
  writeWorkspaceTemporaryNoticeFile } from './third-party-notices.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await ensureWorkspaceTemporaryDirectory(projectRoot);

function runPnpmJson(args) {
  const cli = process.env.npm_execpath;
  if (!cli) throw new Error('Run this script through the pinned pnpm command.');
  const isJavaScriptCli = /\.[cm]?js$/iu.test(cli);
  const result = spawnSync(isJavaScriptCli ? process.execPath : cli,
    [...(isJavaScriptCli ? [cli] : []), ...args], {
      cwd: projectRoot,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true
    });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Pinned pnpm command failed: ${args[0]}`);
  return JSON.parse(result.stdout);
}

const licenses = runPnpmJson(['licenses', 'list', '--prod', '--filter', '@mrt/desktop', '--json']);
const packages = productionLicensePackages(licenses);
const notices = await buildThirdPartyNotices(packages, join(projectRoot, 'node_modules'));
await writeWorkspaceTemporaryNoticeFile(projectRoot, notices);
console.log(`Prepared bounded third-party notices for ${packages.length} production package versions.`);
