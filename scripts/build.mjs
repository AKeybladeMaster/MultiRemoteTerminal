import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { build as viteBuild } from 'vite';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Electron uses its own ABI; this slice intentionally has no native addon dependency.
const tsc = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.build.json'], { stdio: 'inherit' });
if (tsc.status !== 0) process.exit(tsc.status ?? 1);
// Sandboxed preload has a limited require; bundle local modules into one CommonJS file.
const { build } = await import('esbuild');
await mkdir('dist/preload', { recursive: true });
await build({ entryPoints: ['apps/desktop/src/preload/bridge.ts'], outfile: 'dist/preload/bridge.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['electron'], target: 'node24' });
await viteBuild();
