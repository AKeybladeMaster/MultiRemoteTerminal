import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageManagerCli = process.env.npm_execpath;
if (!packageManagerCli) throw new Error('Run this script with the pinned pnpm');
const packageManagerIsJavaScript = /\.[cm]?js$/iu.test(packageManagerCli);

function runPnpm(args, environment = process.env) {
  const command = packageManagerIsJavaScript ? process.execPath : packageManagerCli;
  const commandArgs = packageManagerIsJavaScript ? [packageManagerCli, ...args] : args;
  const result = spawnSync(command, commandArgs, { cwd: projectRoot, env: environment, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

runPnpm(['package:win']);
runPnpm(['exec', 'playwright', 'test', 'tests/e2e/package-smoke.test.ts'], { ...process.env, MRT_PACKAGE_E2E: '1' });
