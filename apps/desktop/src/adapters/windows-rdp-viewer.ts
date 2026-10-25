import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { formatRdpTarget } from '../../../../packages/domain/src/rdp.ts';
import type { RdpEndpoint } from '../../../../packages/domain/src/rdp.ts';
import { RdpViewerError } from '../../../../packages/application/src/rdp-viewer.ts';
import type { RdpViewerProvider } from '../../../../packages/application/src/rdp-viewer.ts';
import type { CancellationSignal } from '../../../../packages/application/src/cancellation.ts';

interface SystemDirectory {
  getSystemDirectory(): string;
}

export interface RdpChildProcess {
  once(event: 'spawn', listener: () => void): this;
  once(event: 'error', listener: (error: Error) => void): this;
  unref(): void;
  kill(): void;
}

export type RdpSpawn = (command: string, args: readonly string[], options: {
  readonly detached: true;
  readonly shell: false;
  readonly windowsHide: true;
  readonly stdio: 'ignore';
}) => RdpChildProcess;

const START_TIMEOUT_MS = 5_000;

export class WindowsRdpViewer implements RdpViewerProvider {
  private readonly systemDirectory: SystemDirectory;
  private readonly spawnProcess: RdpSpawn;
  private readonly platform: string;

  constructor(
    systemDirectory: SystemDirectory,
    spawnProcess: RdpSpawn = spawn as unknown as RdpSpawn,
    platform: string = process.platform
  ) {
    this.systemDirectory = systemDirectory;
    this.spawnProcess = spawnProcess;
    this.platform = platform;
  }

  async launch(endpoint: RdpEndpoint, cancellation?: CancellationSignal): Promise<void> {
    if (this.platform !== 'win32') throw new RdpViewerError('NOT_SUPPORTED');
    const executable = join(this.systemDirectory.getSystemDirectory(), 'mstsc.exe');
    const target = formatRdpTarget(endpoint);
    return new Promise<void>((resolveLaunch, rejectLaunch) => {
      let settled = false;
      let child: RdpChildProcess | undefined;
      const abort = () => {
        child?.kill();
        finish(new RdpViewerError('CANCELLED'));
      };
      const timeout = setTimeout(() => {
        child?.kill();
        finish(new RdpViewerError('UNAVAILABLE'));
      }, START_TIMEOUT_MS);
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        cancellation?.removeEventListener('abort', abort);
        if (error) rejectLaunch(error);
        else resolveLaunch();
      };

      if (cancellation?.aborted) {
        finish(new RdpViewerError('CANCELLED'));
        return;
      }
      cancellation?.addEventListener('abort', abort, { once: true });
      if (cancellation?.aborted) {
        abort();
        return;
      }
      try {
        child = this.spawnProcess(executable, [`/v:${target}`], {
          detached: true,
          shell: false,
          windowsHide: true,
          stdio: 'ignore'
        });
      } catch {
        finish(new RdpViewerError('UNAVAILABLE'));
        return;
      }
      child.once('error', () => finish(new RdpViewerError('UNAVAILABLE')));
      child.once('spawn', () => {
        if (settled) { child?.kill(); return; }
        child.unref();
        finish();
      });
    });
  }
}
