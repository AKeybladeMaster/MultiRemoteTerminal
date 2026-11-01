import { existsSync } from 'node:fs';
import { mkdtemp, open, rm, rmdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectedReleaseSigner, signedReleaseRequested } from './release-signature-policy.mjs';
import { ensureWorkspaceOutputDirectory, ensureWorkspaceTemporaryDirectory } from './third-party-notices.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireSignedRelease = signedReleaseRequested(process.env.MRT_SIGNED_RELEASE);
if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Create Windows packages on a Windows x64 host so the native bridge and package target use x64.');
}
if (requireSignedRelease && !process.env.WIN_CSC_LINK && !process.env.CSC_LINK) {
  throw new Error('A signed Windows release requires WIN_CSC_LINK or CSC_LINK from a protected secret store.');
}
if (!requireSignedRelease && (process.env.WIN_CSC_LINK || process.env.CSC_LINK)) {
  throw new Error('Unsigned Windows packaging cannot use WIN_CSC_LINK or CSC_LINK; set MRT_SIGNED_RELEASE=1 and pin MRT_RELEASE_SIGNER_SHA1 to sign.');
}
if (requireSignedRelease) expectedReleaseSigner(process.env.MRT_RELEASE_SIGNER_SHA1);
const packageManagerCli = process.env.npm_execpath;
if (!packageManagerCli) throw new Error('Run this script with the pinned pnpm');
const packageManagerIsJavaScript = /\.[cm]?js$/iu.test(packageManagerCli);
const corepackCommand = join(dirname(process.execPath), 'corepack.cmd');
if (!existsSync(corepackCommand)) throw new Error('The Node installation does not include corepack.cmd');

const temporaryToolsRoot = await ensureWorkspaceTemporaryDirectory(projectRoot);
await ensureWorkspaceOutputDirectory(projectRoot, ['artifacts', 'windows']);
const toolDirectory = await mkdtemp(join(temporaryToolsRoot, 'electron-builder-tools-'));
const packageManagerShim = join(toolDirectory, 'pnpm.cmd');
let packageManagerShimCreated = false;

const environment = {
  ...process.env,
  MRT_PACKAGER_COREPACK_CMD: corepackCommand,
  PATH: `${toolDirectory}${delimiter}${process.env.PATH ?? process.env.Path ?? ''}`
};

function runPackageManager(args) {
  const command = packageManagerIsJavaScript ? process.execPath : packageManagerCli;
  const commandArgs = packageManagerIsJavaScript ? [packageManagerCli, ...args] : args;
  const result = spawnSync(command, commandArgs, { cwd: projectRoot, env: environment, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Pinned pnpm command failed (exit ${result.status ?? 'unknown'}): ${args[0]}`);
}

try {
  const shimHandle = await open(packageManagerShim, 'wx');
  packageManagerShimCreated = true;
  try { await shimHandle.writeFile('@echo off\r\n"%MRT_PACKAGER_COREPACK_CMD%" pnpm %*\r\n'); }
  finally { await shimHandle.close(); }
  runPackageManager(['--filter', '@mrt/desktop', 'audit', 'signatures', '--prod']);
  runPackageManager(['--workspace-root', 'audit', 'signatures', '--dev']);
  runPackageManager(['build']);
  runPackageManager(['run', 'notices:win']);
  runPackageManager(['exec', 'electron-builder', '--config', 'electron-builder.yml', '--win', 'nsis', 'portable']);
  runPackageManager(['run', 'sbom:win']);
} finally {
  if (packageManagerShimCreated) await rm(packageManagerShim, { force: true });
  try { await rmdir(toolDirectory); }
  catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (code !== 'ENOENT' && code !== 'ENOTEMPTY') throw error;
  }
}
