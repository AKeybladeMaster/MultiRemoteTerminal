import { spawn } from 'node:child_process';
import type { ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { win32 } from 'node:path';
import { decodeWslDistributionList, MAX_WSL_DISTRIBUTION_OUTPUT_BYTES } from '../../../../packages/domain/src/wsl-distributions.ts';
import type { WslDistribution } from '../../../../packages/domain/src/wsl-distributions.ts';

const LIST_TIMEOUT_MS = 5_000;

interface ActiveDiscovery {
  readonly child: ChildProcessByStdio<null, Readable, null>;
  readonly chunks: Buffer[];
  timer: ReturnType<typeof setTimeout>;
  bytes: number;
  settled: boolean;
  readonly reject: (error: Error) => void;
}

export interface WslDistributionDiscovery {
  list(): Promise<readonly WslDistribution[]>;
  cancel(): void;
}

/** Owns the one bounded read-only WSL list process used by this terminal worker. */
export function createWslDistributionDiscovery(systemDirectory: string,
  spawnProcess: typeof spawn = spawn): WslDistributionDiscovery {
  let active: ActiveDiscovery | undefined;

  function cancel(): void {
    if (!active) return;
    settleFailure(active, new Error('WSL distribution discovery was cancelled'));
  }

  function settleFailure(discovery: ActiveDiscovery, error: Error): void {
    if (discovery.settled) return;
    discovery.settled = true;
    clearTimeout(discovery.timer);
    try { discovery.child.kill(); } catch { /* The timeout still releases the caller. */ }
    discovery.reject(error);
  }

  return Object.freeze({
    async list(): Promise<readonly WslDistribution[]> {
      if (active) throw new Error('WSL distribution discovery is busy');
      if (!win32.isAbsolute(systemDirectory)) throw new Error('Windows system directory is unavailable');

      return new Promise<readonly WslDistribution[]>((resolve, reject) => {
        let child: ChildProcessByStdio<null, Readable, null>;
        try {
          child = spawnProcess(win32.join(systemDirectory, 'wsl.exe'), ['--list', '--quiet'], {
            windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']
          });
        } catch {
          reject(new Error('WSL could not be started'));
          return;
        }

        const discovery: ActiveDiscovery = {
          child, chunks: [], timer: setTimeout(() => settleFailure(discovery, new Error('WSL distribution discovery timed out')),
            LIST_TIMEOUT_MS), bytes: 0, settled: false, reject
        };
        active = discovery;
        child.stdout.on('data', (chunk: Buffer | string) => {
          if (discovery.settled) return;
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
          discovery.bytes += bytes.byteLength;
          if (discovery.bytes > MAX_WSL_DISTRIBUTION_OUTPUT_BYTES) {
            settleFailure(discovery, new Error('WSL distribution output exceeded its limit'));
            return;
          }
          discovery.chunks.push(bytes);
        });
        child.stdout.once('error', () => settleFailure(discovery, new Error('WSL distribution output could not be read')));
        child.once('error', () => settleFailure(discovery, new Error('WSL distribution discovery failed')));
        child.once('close', (code, signal) => {
          clearTimeout(discovery.timer);
          if (active === discovery) active = undefined;
          if (discovery.settled) return;
          discovery.settled = true;
          if (code !== 0 || signal !== null) {
            reject(new Error('WSL distribution discovery failed'));
            return;
          }
          const output = Buffer.concat(discovery.chunks, discovery.bytes);
          const distributions = decodeWslDistributionList(output);
          if (!distributions) {
            reject(new Error('WSL returned an invalid distribution list'));
            return;
          }
          resolve(distributions);
        });
      });
    },
    cancel
  });
}
