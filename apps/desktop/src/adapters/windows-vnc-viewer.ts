import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { formatVncTarget } from '../../../../packages/domain/src/vnc.ts';
import type { VncEndpoint } from '../../../../packages/domain/src/vnc.ts';
import { VncViewerError } from '../../../../packages/application/src/vnc-viewer.ts';
import type { VncViewerProvider } from '../../../../packages/application/src/vnc-viewer.ts';
import type { CancellationSignal } from '../../../../packages/application/src/cancellation.ts';

interface ProgramFilesDirectories {
  getLocalAppDataDirectory?(): string;
  getProgramFilesDirectories(): readonly string[];
}

export interface VncChildProcess {
  once(event: 'spawn', listener: () => void): this;
  once(event: 'error', listener: (error: Error) => void): this;
  unref(): void;
  kill(): void;
}

export type VncSpawn = (command: string, args: readonly string[], options: {
  readonly detached: true;
  readonly env: NodeJS.ProcessEnv;
  readonly shell: false;
  readonly windowsHide: true;
  readonly stdio: 'ignore';
}) => VncChildProcess;

export type VncPathExists = (candidate: string) => boolean;

const START_TIMEOUT_MS = 5_000;
const VIEWER_RELATIVE_PATH = join('TigerVNC', 'vncviewer.exe');

export function resolveTigerVncViewerPath(programFilesDirectories: readonly string[], pathExists: VncPathExists = existsSync,
  localAppDataDirectory?: string): string | undefined {
  const candidates = programFilesDirectories.slice(0, 2).filter(isAbsolute).map(directory => join(directory, VIEWER_RELATIVE_PATH));
  if (localAppDataDirectory && isAbsolute(localAppDataDirectory)) {
    candidates.push(join(localAppDataDirectory, 'Programs', VIEWER_RELATIVE_PATH));
  }
  for (const candidate of candidates) {
    try { if (pathExists(candidate)) return candidate; }
    catch { /* An unreadable or unavailable install location is skipped. */ }
  }
  return undefined;
}

export class WindowsVncViewer implements VncViewerProvider {
  private readonly programFilesDirectories: ProgramFilesDirectories;
  private readonly spawnProcess: VncSpawn;
  private readonly platform: string;
  private readonly pathExists: VncPathExists;
  private readonly environment: NodeJS.ProcessEnv;

  constructor(
    programFilesDirectories: ProgramFilesDirectories,
    spawnProcess: VncSpawn = spawn as unknown as VncSpawn,
    platform: string = process.platform,
    pathExists: VncPathExists = existsSync,
    environment: NodeJS.ProcessEnv = process.env
  ) {
    this.programFilesDirectories = programFilesDirectories;
    this.spawnProcess = spawnProcess;
    this.platform = platform;
    this.pathExists = pathExists;
    this.environment = environment;
  }

  async launch(endpoint: VncEndpoint, cancellation?: CancellationSignal): Promise<void> {
    if (this.platform !== 'win32') throw new VncViewerError('NOT_SUPPORTED');
    let executable: string | undefined;
    try {
      const programFilesDirectories = this.programFilesDirectories.getProgramFilesDirectories();
      let localAppDataDirectory: string | undefined;
      try { localAppDataDirectory = this.programFilesDirectories.getLocalAppDataDirectory?.(); } catch { /* Program Files installs remain usable. */ }
      executable = resolveTigerVncViewerPath(programFilesDirectories, this.pathExists, localAppDataDirectory);
    }
    catch { throw new VncViewerError('UNAVAILABLE'); }
    if (!executable) throw new VncViewerError('UNAVAILABLE');
    const target = formatVncTarget(endpoint);
    return new Promise<void>((resolveLaunch, rejectLaunch) => {
      let settled = false;
      let child: VncChildProcess | undefined;
      const abort = () => {
        child?.kill();
        finish(new VncViewerError('CANCELLED'));
      };
      const timeout = setTimeout(() => {
        child?.kill();
        finish(new VncViewerError('UNAVAILABLE'));
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
        finish(new VncViewerError('CANCELLED'));
        return;
      }
      cancellation?.addEventListener('abort', abort, { once: true });
      if (cancellation?.aborted) {
        abort();
        return;
      }
      try {
        child = this.spawnProcess(executable, [target], {
          detached: true,
          env: createViewerEnvironment(this.environment),
          shell: false,
          windowsHide: true,
          stdio: 'ignore'
        });
      } catch {
        finish(new VncViewerError('UNAVAILABLE'));
        return;
      }
      child.once('error', () => finish(new VncViewerError('UNAVAILABLE')));
      child.once('spawn', () => {
        if (settled) { child?.kill(); return; }
        child.unref();
        finish();
      });
    });
  }
}

function createViewerEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sanitized = { ...environment };
  for (const name of Object.keys(sanitized)) {
    const normalized = name.toUpperCase();
    if (normalized === 'VNC_USERNAME' || normalized === 'VNC_PASSWORD') delete sanitized[name];
  }
  return sanitized;
}
