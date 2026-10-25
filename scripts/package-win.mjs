import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Create Windows packages on a Windows x64 host so the native bridge and package target use x64.');
}
if (process.env.MRT_SIGNED_RELEASE === '1' && !process.env.WIN_CSC_LINK && !process.env.CSC_LINK) {
  throw new Error('A signed Windows release requires WIN_CSC_LINK or CSC_LINK from a protected secret store.');
}
const packageManagerCli = process.env.npm_execpath;
if (!packageManagerCli) throw new Error('Run this script with the pinned pnpm');
const packageManagerIsJavaScript = /\.[cm]?js$/iu.test(packageManagerCli);
const corepackCommand = join(dirname(process.execPath), 'corepack.cmd');
if (!existsSync(corepackCommand)) throw new Error('The Node installation does not include corepack.cmd');

const toolDirectory = resolve(projectRoot, '.cache/electron-builder-bin');
const packageManagerShim = join(toolDirectory, 'pnpm.cmd');
await mkdir(toolDirectory, { recursive: true });
await writeFile(packageManagerShim, '@echo off\r\n"%MRT_PACKAGER_COREPACK_CMD%" pnpm %*\r\n');

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
  if (result.status !== 0) process.exit(result.status ?? 1);
}

try {
  runPackageManager(['build']);
  runPackageManager(['exec', 'electron-builder', '--config', 'electron-builder.yml', '--win', 'nsis', 'portable']);
  runPackageManager(['run', 'sbom:win']);
} finally {
  await rm(packageManagerShim, { force: true });
}
