import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile } from 'node:fs/promises';
import { resolve, win32 as path } from 'node:path';
import { build as viteBuild } from 'vite';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
if (process.platform === 'win32') {
  const rootManifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const electronVersion = rootManifest.devDependencies?.electron;
  if (!electronVersion) throw new Error('Pinned Electron version is required to build the system-directory bridge');
  const nodeGyp = require.resolve('node-gyp/bin/node-gyp.js');
  const nativeBuild = spawnSync(process.execPath, [nodeGyp, 'rebuild', '--target=' + electronVersion, '--arch=x64',
    '--dist-url=https://electronjs.org/headers', '--directory=apps/desktop/native'], { stdio: 'inherit' });
  if (nativeBuild.status !== 0) process.exit(nativeBuild.status ?? 1);
  await mkdir('dist/native', { recursive: true });
  await cp('apps/desktop/native/build/Release/system_directory.node', 'dist/native/system_directory.node');
  await mkdir('dist/host/apps/desktop/src/adapters', { recursive: true });
  await cp('apps/desktop/resources/credential-prompt.ps1', 'dist/host/apps/desktop/src/adapters/credential-prompt.ps1');
  const bridge = require(resolve('dist/native/system_directory.node'));
  const oldSystemRoot = process.env.SystemRoot;
  const oldWindir = process.env.WINDIR;
  try {
    process.env.SystemRoot = 'Z:\\untrusted';
    process.env.WINDIR = 'Z:\\untrusted';
    const systemDirectory = bridge.getSystemDirectory();
    if (typeof systemDirectory !== 'string' || !path.isAbsolute(systemDirectory) || !systemDirectory.toLowerCase().endsWith('\\system32')) {
      throw new Error('The system-directory bridge failed its Windows smoke check');
    }
  } finally {
    if (oldSystemRoot === undefined) delete process.env.SystemRoot;
    else process.env.SystemRoot = oldSystemRoot;
    if (oldWindir === undefined) delete process.env.WINDIR;
    else process.env.WINDIR = oldWindir;
  }
} else {
  console.info('Skipping the Windows-only system-directory bridge on this platform.');
}
// node-pty uses Node-API; the Windows Electron smoke test verifies the pinned prebuild in Electron.
const tsc = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.build.json'], { stdio: 'inherit' });
if (tsc.status !== 0) process.exit(tsc.status ?? 1);
// Sandboxed preload has a limited require; bundle local modules into one CommonJS file.
const { build } = await import('esbuild');
await mkdir('dist/preload', { recursive: true });
await build({ entryPoints: ['apps/desktop/src/preload/bridge.ts'], outfile: 'dist/preload/bridge.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['electron'], target: 'node24' });
await viteBuild();
