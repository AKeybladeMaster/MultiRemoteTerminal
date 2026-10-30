import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { CancellationSignal } from '../../../../packages/application/src/cancellation.ts';
import { XdmcpProviderError } from '../../../../packages/application/src/xdmcp.ts';
import type { XdmcpProvider } from '../../../../packages/application/src/xdmcp.ts';
import type { SshX11Display, SshX11DisplayProvider } from '../../../../packages/application/src/ssh-x11-display.ts';
import { canonicalizeXdmcpHost } from '../../../../packages/domain/src/xdmcp.ts';
import { createX11ExtensionQueryRequests, parseX11ExtensionReplies, parseX11SetupResponse } from '../../../../packages/domain/src/x11.ts';
import type { X11ExtensionCapabilities } from '../../../../packages/domain/src/x11.ts';

const START_TIMEOUT_MS = 5_000;
const DISPLAY_READY_TIMEOUT_MS = 10_000;
const MAX_DISPLAY_ATTEMPTS = 64;
const MAX_CYGWIN_PATH_BYTES = 131_072;
const XAUTHORITY_NAME = 'MIT-MAGIC-COOKIE-1';
const SESSION_AUTHORITY_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.authority$/iu;

export interface CygwinXPaths {
  readonly xwinExecutable: string;
  readonly xauthExecutable: string;
  readonly cygpathExecutable: string;
  readonly socatExecutable: string;
}

interface LocalAppDataDirectory {
  getLocalAppDataDirectory(): string;
}

interface ManagedDisplay extends SshX11Display {
  readonly authorityPath: string;
  readonly process: ChildProcess;
  closePromise?: Promise<void>;
}

interface ManagedXdmcpDisplay {
  readonly display: number;
  readonly process: ChildProcess;
  closePromise?: Promise<void>;
}

export function resolveCygwinXPaths(localAppDataDirectory: string, pathExists: (path: string) => boolean = existsSync): CygwinXPaths | undefined {
  if (!isAbsolute(localAppDataDirectory)) return undefined;
  const roots = [join(localAppDataDirectory, 'Programs', 'Cygwin64'), 'C:\\cygwin64'];
  for (const root of roots) {
    const paths = {
      xwinExecutable: join(root, 'bin', 'XWin.exe'),
      xauthExecutable: join(root, 'bin', 'xauth.exe'),
      cygpathExecutable: join(root, 'bin', 'cygpath.exe'),
      socatExecutable: join(root, 'usr', 'bin', 'socat.exe')
    };
    try {
      if (Object.values(paths).every(pathExists)) return paths;
    } catch { /* An unreadable provider root is treated as unavailable. */ }
  }
  return undefined;
}

export function resolveXWinExecutable(localAppDataDirectory: string, pathExists: (path: string) => boolean = existsSync): string | undefined {
  if (!isAbsolute(localAppDataDirectory)) return undefined;
  for (const root of [join(localAppDataDirectory, 'Programs', 'Cygwin64'), 'C:\\cygwin64']) {
    const executable = join(root, 'bin', 'XWin.exe');
    try { if (pathExists(executable)) return executable; }
    catch { /* An unreadable provider root is treated as unavailable. */ }
  }
  return undefined;
}

export function createXdmcpLaunchArguments(host: string, display: number): readonly string[] {
  const canonicalHost = canonicalizeXdmcpHost(host);
  if (!canonicalHost || !Number.isInteger(display) || display < 1 || display > 59_535) throw new TypeError('Invalid XDMCP target');
  return [`:${display}`, '-fullscreen', '-clipboard', '-listen', 'tcp', '-query', canonicalHost, '-once'];
}

export function createX11SetupRequest(cookie: Uint8Array): Buffer {
  if (cookie.byteLength !== 16) throw new TypeError('X11 requires a 16-byte MIT cookie');
  const name = Buffer.from(XAUTHORITY_NAME, 'ascii');
  const namePaddedLength = (name.length + 3) & ~3;
  const dataPaddedLength = (cookie.byteLength + 3) & ~3;
  const request = Buffer.alloc(12 + namePaddedLength + dataPaddedLength);
  request[0] = 0x6c;
  request.writeUInt16LE(11, 2);
  request.writeUInt16LE(0, 4);
  request.writeUInt16LE(name.length, 6);
  request.writeUInt16LE(cookie.byteLength, 8);
  name.copy(request, 12);
  request.set(cookie, 12 + namePaddedLength);
  return request;
}

export class WindowsCygwinX11Provider implements SshX11DisplayProvider, XdmcpProvider {
  private readonly systemDirectories: LocalAppDataDirectory;
  private readonly authorityDirectory: string;
  private readonly pathExists: (path: string) => boolean;
  private readonly spawnProcess: typeof spawn;
  private readonly platform: string;
  private readonly displays = new Map<string, ManagedDisplay>();
  private readonly openingDisplays = new Map<string, Promise<SshX11Display>>();
  private readonly xdmcpDisplays = new Map<string, ManagedXdmcpDisplay>();
  private readonly openingXdmcpDisplays = new Map<string, Promise<void>>();
  private usedDisplayNumbers = new Set<number>();
  private staleAuthoritiesCleaned = false;
  private staleAuthoritiesCleanup: Promise<void> | undefined;

  constructor(systemDirectories: LocalAppDataDirectory, userDataDirectory: string,
    spawnProcess: typeof spawn = spawn, pathExists: (path: string) => boolean = existsSync, platform = process.platform) {
    if (!isAbsolute(userDataDirectory)) throw new TypeError('User data directory must be absolute');
    this.systemDirectories = systemDirectories;
    this.authorityDirectory = join(userDataDirectory, 'x11-authority');
    this.spawnProcess = spawnProcess;
    this.pathExists = pathExists;
    this.platform = platform;
  }

  async open(sessionId: string, cancellation?: CancellationSignal): Promise<SshX11Display> {
    if (this.displays.has(sessionId) || this.openingDisplays.has(sessionId)) throw new Error('X11 display already exists');
    const opening = this.openDisplay(sessionId, cancellation);
    this.openingDisplays.set(sessionId, opening);
    try { return await opening; }
    finally { if (this.openingDisplays.get(sessionId) === opening) this.openingDisplays.delete(sessionId); }
  }

  private async openDisplay(sessionId: string, cancellation?: CancellationSignal): Promise<SshX11Display> {
    if (this.platform !== 'win32') throw new Error('X11 provider is Windows-only');
    if (this.displays.has(sessionId)) throw new Error('X11 display already exists');
    if (cancellation?.aborted) throw new Error('X11 display start cancelled');
    let localAppDataDirectory: string;
    try { localAppDataDirectory = this.systemDirectories.getLocalAppDataDirectory(); }
    catch { throw new Error('Cygwin/X is unavailable'); }
    const paths = resolveCygwinXPaths(localAppDataDirectory, this.pathExists);
    if (!paths) throw new Error('Cygwin/X is unavailable');
    await this.cleanStaleAuthorities();

    const display = this.allocateDisplayNumber();
    if (display === undefined) throw new Error('No X11 display number is available');

    const cookie = randomBytes(16);
    const authorityPath = join(this.authorityDirectory, `${sessionId}.authority`);
    let managed: ManagedDisplay | undefined;
    try {
      await mkdir(this.authorityDirectory, { recursive: true, mode: 0o700 });
      await writeFile(authorityPath, new Uint8Array(), { flag: 'wx', mode: 0o600 });
      if (cancellation?.aborted) throw new Error('X11 display start cancelled');
      const cygwinAuthorityPath = await this.toCygwinPath(paths.cygpathExecutable, authorityPath, cancellation);
      await this.addAuthority(paths.xauthExecutable, cygwinAuthorityPath, display, cookie, cancellation);
      if (cancellation?.aborted) throw new Error('X11 display start cancelled');
      const process = this.spawnProcess(paths.xwinExecutable, [
        `:${display}`, '-multiwindow', '-clipboard', '-auth', cygwinAuthorityPath, '-nolisten', 'tcp', '-iglx'
      ], { shell: false, windowsHide: true, stdio: 'ignore', env: this.providerEnvironment() });
      managed = { display, cookie, socatExecutable: paths.socatExecutable, authorityPath, process };
      this.displays.set(sessionId, managed);
      process.once('exit', () => { void this.onDisplayExit(sessionId, managed!); });
      await this.waitForSpawn(process, cancellation);
      const ready = await this.waitForDisplayReady(managed, cancellation);
      if (!ready) throw new Error('Cygwin/X display did not become ready');
      if (cancellation?.aborted) throw new Error('X11 display start cancelled');
      let extensions: X11ExtensionCapabilities | undefined;
      try { extensions = await this.probeDisplayExtensions(managed, cancellation); }
      catch { /* A failed capability query does not disable an otherwise working X11 display. */ }
      if (cancellation?.aborted) throw new Error('X11 display start cancelled');
      return { display, cookie, socatExecutable: paths.socatExecutable, ...(extensions ? { extensions } : {}) };
    } catch (error) {
      cookie.fill(0);
      if (managed) await this.closeManagedDisplay(sessionId, managed);
      else {
        this.usedDisplayNumbers.delete(display);
        await rm(authorityPath, { force: true }).catch(() => undefined);
      }
      throw error;
    }
  }

  async close(sessionId: string): Promise<void> {
    const display = this.displays.get(sessionId);
    if (!display) return;
    await this.closeManagedDisplay(sessionId, display);
  }

  async launch(requestId: string, host: string, cancellation?: CancellationSignal): Promise<void> {
    if (this.platform !== 'win32') throw new XdmcpProviderError('NOT_SUPPORTED');
    const canonicalHost = canonicalizeXdmcpHost(host);
    if (!canonicalHost) throw new XdmcpProviderError('NOT_SUPPORTED');
    if (this.xdmcpDisplays.has(requestId) || this.openingXdmcpDisplays.has(requestId)) throw new XdmcpProviderError('NOT_SUPPORTED');
    const opening = this.launchXdmcpDisplay(requestId, canonicalHost, cancellation);
    this.openingXdmcpDisplays.set(requestId, opening);
    try { await opening; }
    finally { if (this.openingXdmcpDisplays.get(requestId) === opening) this.openingXdmcpDisplays.delete(requestId); }
  }

  private async launchXdmcpDisplay(requestId: string, host: string, cancellation?: CancellationSignal): Promise<void> {
    if (cancellation?.aborted) throw new XdmcpProviderError('CANCELLED');
    let localAppDataDirectory: string;
    try { localAppDataDirectory = this.systemDirectories.getLocalAppDataDirectory(); }
    catch { throw new XdmcpProviderError('UNAVAILABLE'); }
    const executable = resolveXWinExecutable(localAppDataDirectory, this.pathExists);
    if (!executable) throw new XdmcpProviderError('UNAVAILABLE');
    const display = this.allocateDisplayNumber();
    if (display === undefined) throw new XdmcpProviderError('UNAVAILABLE');
    let managed: ManagedXdmcpDisplay | undefined;
    try {
      const child = this.spawnProcess(executable, [...createXdmcpLaunchArguments(host, display)], {
        shell: false, windowsHide: false, stdio: 'ignore', env: this.providerEnvironment()
      });
      managed = { display, process: child };
      this.xdmcpDisplays.set(requestId, managed);
      child.once('exit', () => { void this.onXdmcpExit(requestId, managed!); });
      child.once('error', () => { void this.closeManagedXdmcpDisplay(requestId, managed!); });
      await this.waitForSpawn(child, cancellation);
      await this.waitForXdmcpServer(child, cancellation);
      if (cancellation?.aborted) throw new XdmcpProviderError('CANCELLED');
    } catch (error) {
      if (managed) await this.closeManagedXdmcpDisplay(requestId, managed);
      else this.usedDisplayNumbers.delete(display);
      if (error instanceof XdmcpProviderError) throw error;
      throw new XdmcpProviderError(cancellation?.aborted ? 'CANCELLED' : 'UNAVAILABLE');
    }
  }

  async closeAll(): Promise<void> {
    await Promise.allSettled([...this.openingDisplays.values(), ...this.openingXdmcpDisplays.values()]);
    await Promise.all([...this.displays].map(([sessionId, display]) => this.closeManagedDisplay(sessionId, display)));
    await Promise.all([...this.xdmcpDisplays].map(([requestId, display]) => this.closeManagedXdmcpDisplay(requestId, display)));
  }

  private allocateDisplayNumber(): number | undefined {
    for (let attempt = 0; attempt < MAX_DISPLAY_ATTEMPTS; attempt++) {
      const candidate = randomInt(1, 59_536);
      if (this.usedDisplayNumbers.has(candidate)) continue;
      this.usedDisplayNumbers.add(candidate);
      return candidate;
    }
    return undefined;
  }

  private async cleanStaleAuthorities(): Promise<void> {
    if (this.staleAuthoritiesCleaned) return;
    this.staleAuthoritiesCleanup ??= (async () => {
      await mkdir(this.authorityDirectory, { recursive: true, mode: 0o700 });
      const files = await readdir(this.authorityDirectory, { withFileTypes: true }).catch(() => []);
      await Promise.all(files.filter(entry => entry.isFile() && SESSION_AUTHORITY_FILE.test(entry.name))
        .map(entry => rm(join(this.authorityDirectory, entry.name), { force: true }).catch(() => undefined)));
      this.staleAuthoritiesCleaned = true;
    })();
    await this.staleAuthoritiesCleanup;
  }

  private async addAuthority(xauthExecutable: string, authorityPath: string, display: number, cookie: Uint8Array,
    cancellation?: CancellationSignal): Promise<void> {
    const child = this.spawnProcess(xauthExecutable, ['-f', authorityPath], {
      shell: false, windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'], env: this.providerEnvironment()
    });
    const prefix = Buffer.from(`add :${display} ${XAUTHORITY_NAME} `, 'ascii');
    const suffix = Buffer.from('\nexit\n', 'ascii');
    const command = Buffer.alloc(prefix.length + cookie.byteLength * 2 + suffix.length);
    prefix.copy(command);
    const hex = Buffer.from('0123456789abcdef', 'ascii');
    let offset = prefix.length;
    for (const value of cookie) { command[offset++] = hex[value >> 4]!; command[offset++] = hex[value & 0x0f]!; }
    suffix.copy(command, offset);
    try { await this.waitForExit(child, START_TIMEOUT_MS, cancellation, () => child.stdin?.end(command)); }
    finally { command.fill(0); }
    if (child.exitCode !== 0) throw new Error('Cygwin xauth failed');
  }

  private toCygwinPath(cygpathExecutable: string, windowsPath: string, cancellation?: CancellationSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      if (cancellation?.aborted) { reject(new Error('Cygwin path conversion cancelled')); return; }
      const child = this.spawnProcess(cygpathExecutable, ['-u', '-U', windowsPath], {
        shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], env: this.providerEnvironment()
      });
      let settled = false;
      let output = Buffer.alloc(0);
      const finish = (error?: Error, convertedPath?: string): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cancellation?.removeEventListener('abort', abort);
        child.stdout?.removeListener('data', onData);
        child.removeListener('error', onError);
        child.removeListener('close', onClose);
        output.fill(0);
        if (error) {
          if (child.exitCode === null && child.signalCode === null) child.kill();
          reject(error);
        } else if (convertedPath) resolve(convertedPath);
        else reject(new Error('Cygwin path conversion failed'));
      };
      const onData = (chunk: Buffer): void => {
        if (output.byteLength + chunk.byteLength > MAX_CYGWIN_PATH_BYTES) { finish(new Error('Cygwin path conversion failed')); return; }
        const next = Buffer.concat([output, chunk]);
        output.fill(0);
        output = next;
      };
      const onError = (): void => finish(new Error('Cygwin path conversion failed'));
      const onClose = (code: number | null): void => {
        if (code !== 0) { finish(new Error('Cygwin path conversion failed')); return; }
        try {
          const decoded = new TextDecoder('utf-8', { fatal: true }).decode(output);
          const convertedPath = decoded.endsWith('\r\n') ? decoded.slice(0, -2) : decoded.endsWith('\n') ? decoded.slice(0, -1) : decoded;
          if (!convertedPath.startsWith('/') || convertedPath.includes('\\') || /[\0\r\n]/u.test(convertedPath)) {
            finish(new Error('Cygwin path conversion failed'));
            return;
          }
          finish(undefined, convertedPath);
        } catch { finish(new Error('Cygwin path conversion failed')); }
      };
      const abort = (): void => finish(new Error('Cygwin path conversion cancelled'));
      const timer = setTimeout(() => finish(new Error('Cygwin path conversion timed out')), START_TIMEOUT_MS);
      child.stdout?.on('data', onData);
      child.once('error', onError);
      child.once('close', onClose);
      cancellation?.addEventListener('abort', abort, { once: true });
      if (cancellation?.aborted) abort();
    });
  }

  private waitForSpawn(child: ChildProcess, cancellation?: CancellationSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cancellation?.removeEventListener('abort', abort);
        child.removeListener('spawn', onSpawn);
        child.removeListener('error', onError);
        if (error) reject(error);
        else resolve();
      };
      const onSpawn = () => finish();
      const onError = () => finish(new Error('Cygwin/X process failed to start'));
      const abort = () => { child.kill(); finish(new Error('X11 display start cancelled')); };
      const timer = setTimeout(() => { child.kill(); finish(new Error('Cygwin/X startup timed out')); }, START_TIMEOUT_MS);
      child.once('spawn', onSpawn);
      child.once('error', onError);
      cancellation?.addEventListener('abort', abort, { once: true });
      if (cancellation?.aborted) abort();
    });
  }

  private waitForXdmcpServer(child: ChildProcess, cancellation?: CancellationSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.removeListener('exit', onExit);
        child.removeListener('error', onError);
        cancellation?.removeEventListener('abort', abort);
        if (error) reject(error);
        else resolve();
      };
      const onExit = () => finish(new XdmcpProviderError('UNAVAILABLE'));
      const onError = () => finish(new XdmcpProviderError('UNAVAILABLE'));
      const abort = () => { child.kill(); finish(new XdmcpProviderError('CANCELLED')); };
      const timer = setTimeout(() => finish(), 300);
      child.once('exit', onExit);
      child.once('error', onError);
      cancellation?.addEventListener('abort', abort, { once: true });
      if (child.exitCode !== null || child.signalCode !== null) onExit();
      else if (cancellation?.aborted) abort();
    });
  }

  private waitForExit(child: ChildProcess, timeoutMs: number, cancellation: CancellationSignal | undefined,
    onSpawn?: () => void): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let stoppingError: Error | undefined;
      let stopTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(stopTimer);
        cancellation?.removeEventListener('abort', abort);
        child.removeListener('spawn', spawnChild);
        child.removeListener('exit', exitChild);
        child.removeListener('error', errorChild);
        if (error) reject(error);
        else resolve();
      };
      const spawnChild = () => {
        try { onSpawn?.(); } catch { stop(new Error('Cygwin helper failed')); }
      };
      const exitChild = (code: number | null) => stoppingError ? finish(stoppingError) : code === 0 ? finish() : finish(new Error('Cygwin helper failed'));
      const errorChild = () => finish(stoppingError ?? new Error('Cygwin helper failed to start'));
      const stop = (error: Error) => {
        stoppingError ??= error;
        child.kill();
        if (child.exitCode !== null || child.signalCode !== null) finish(stoppingError);
        else stopTimer ??= setTimeout(() => finish(stoppingError), 1_000);
      };
      const abort = () => stop(new Error('X11 display start cancelled'));
      const timer = setTimeout(() => stop(new Error('Cygwin helper timed out')), timeoutMs);
      child.once('spawn', spawnChild);
      child.once('exit', exitChild);
      child.once('error', errorChild);
      cancellation?.addEventListener('abort', abort, { once: true });
      if (cancellation?.aborted) abort();
    });
  }

  private async waitForDisplayReady(display: ManagedDisplay, cancellation?: CancellationSignal): Promise<boolean> {
    const deadline = Date.now() + DISPLAY_READY_TIMEOUT_MS;
    while (Date.now() < deadline && !cancellation?.aborted && display.process.exitCode === null && display.process.signalCode === null) {
      if (await this.probeDisplay(display, cancellation)) return true;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    return false;
  }

  private probeDisplay(display: ManagedDisplay, cancellation?: CancellationSignal): Promise<boolean> {
    return new Promise(resolve => {
      if (cancellation?.aborted) { resolve(false); return; }
      const probe = this.spawnProcess(display.socatExecutable, ['-', `UNIX-CONNECT:/tmp/.X11-unix/X${display.display}`], {
        shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'], env: this.providerEnvironment()
      });
      let settled = false;
      let response = Buffer.alloc(0);
      const finish = (ready: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cancellation?.removeEventListener('abort', abort);
        probe.stdout?.removeListener('data', onData);
        probe.removeListener('error', onError);
        probe.removeListener('exit', onExit);
        response.fill(0);
        probe.kill();
        resolve(ready);
      };
      const onData = (chunk: Buffer) => {
        if (chunk.length === 0) return;
        if (response.length + chunk.length > 262_144) { finish(false); return; }
        const next = Buffer.concat([response, chunk]);
        response.fill(0);
        response = next;
        const setup = parseX11SetupResponse(response);
        if (setup.kind === 'invalid') finish(false);
        else if (setup.kind === 'complete') finish(response.length === setup.packetLength);
      };
      const onError = () => finish(false);
      const onExit = () => finish(false);
      const abort = () => finish(false);
      const timer = setTimeout(() => finish(false), 1_000);
      probe.stdout?.on('data', onData);
      probe.once('error', onError);
      probe.once('exit', onExit);
      cancellation?.addEventListener('abort', abort, { once: true });
      probe.once('spawn', () => {
        const setup = createX11SetupRequest(display.cookie);
        try {
          if (!probe.stdin || probe.stdin.destroyed) { setup.fill(0); finish(false); return; }
          probe.stdin.write(setup, () => setup.fill(0));
        } catch { setup.fill(0); finish(false); }
      });
      if (cancellation?.aborted) abort();
    });
  }

  private probeDisplayExtensions(display: ManagedDisplay, cancellation?: CancellationSignal): Promise<X11ExtensionCapabilities | undefined> {
    return new Promise(resolve => {
      if (cancellation?.aborted) { resolve(undefined); return; }
      const probe = this.spawnProcess(display.socatExecutable, ['-', `UNIX-CONNECT:/tmp/.X11-unix/X${display.display}`], {
        shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'], env: this.providerEnvironment()
      });
      let settled = false;
      let stage: 'setup' | 'extensions' = 'setup';
      let response = Buffer.alloc(0);
      const finish = (capabilities?: X11ExtensionCapabilities) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cancellation?.removeEventListener('abort', abort);
        probe.stdout?.removeListener('data', onData);
        probe.removeListener('error', onFailure);
        probe.removeListener('exit', onFailure);
        response.fill(0);
        probe.kill();
        resolve(capabilities);
      };
      const onFailure = () => finish();
      const abort = () => finish();
      const onData = (chunk: Buffer) => {
        if (response.length + chunk.length > 262_240) { finish(); return; }
        const next = Buffer.concat([response, chunk]);
        response.fill(0);
        response = next;
        if (stage === 'setup') {
          const setup = parseX11SetupResponse(response);
          if (setup.kind === 'incomplete') return;
          if (setup.kind === 'invalid') { finish(); return; }
          const remaining = Buffer.from(response.subarray(setup.packetLength));
          response.fill(0);
          response = remaining;
          stage = 'extensions';
          const requests = Buffer.from(createX11ExtensionQueryRequests());
          try {
            if (!probe.stdin || probe.stdin.destroyed) { requests.fill(0); finish(); return; }
            probe.stdin.write(requests, () => requests.fill(0));
          } catch { requests.fill(0); finish(); return; }
        }
        if (stage === 'extensions') {
          if (response.length > 96) { finish(); return; }
          const result = parseX11ExtensionReplies(response);
          if (result.kind === 'complete') finish(result.capabilities);
          else if (result.kind === 'invalid') finish();
        }
      };
      const timer = setTimeout(() => finish(), 2_000);
      probe.stdout?.on('data', onData);
      probe.once('error', onFailure);
      probe.once('exit', onFailure);
      cancellation?.addEventListener('abort', abort, { once: true });
      probe.once('spawn', () => {
        const setup = createX11SetupRequest(display.cookie);
        try {
          if (!probe.stdin || probe.stdin.destroyed) { setup.fill(0); finish(); return; }
          probe.stdin.write(setup, () => setup.fill(0));
        } catch { setup.fill(0); finish(); }
      });
      if (cancellation?.aborted) abort();
    });
  }

  private async closeManagedDisplay(sessionId: string, display: ManagedDisplay): Promise<void> {
    if (display.closePromise) return display.closePromise;
    if (this.displays.get(sessionId) === display) this.displays.delete(sessionId);
    display.cookie.fill(0);
    display.closePromise = (async () => {
      if (display.process.exitCode === null && display.process.signalCode === null) {
        display.process.kill();
        await new Promise<void>(resolve => {
          const timer = setTimeout(resolve, 1_000);
          display.process.once('exit', () => { clearTimeout(timer); resolve(); });
        });
      }
      if (display.process.pid === undefined || display.process.exitCode !== null || display.process.signalCode !== null) this.usedDisplayNumbers.delete(display.display);
      await rm(display.authorityPath, { force: true }).catch(() => undefined);
    })();
    return display.closePromise;
  }

  private async onDisplayExit(sessionId: string, display: ManagedDisplay): Promise<void> {
    if (this.displays.get(sessionId) === display) this.displays.delete(sessionId);
    this.usedDisplayNumbers.delete(display.display);
    display.cookie.fill(0);
    await rm(display.authorityPath, { force: true }).catch(() => undefined);
  }

  private async closeManagedXdmcpDisplay(requestId: string, display: ManagedXdmcpDisplay): Promise<void> {
    if (display.closePromise) return display.closePromise;
    if (this.xdmcpDisplays.get(requestId) === display) this.xdmcpDisplays.delete(requestId);
    display.closePromise = (async () => {
      if (display.process.exitCode === null && display.process.signalCode === null) {
        display.process.kill();
        await new Promise<void>(resolve => {
          const timer = setTimeout(resolve, 1_000);
          display.process.once('exit', () => { clearTimeout(timer); resolve(); });
        });
      }
      if (display.process.pid === undefined || display.process.exitCode !== null || display.process.signalCode !== null) this.usedDisplayNumbers.delete(display.display);
    })();
    return display.closePromise;
  }

  private async onXdmcpExit(requestId: string, display: ManagedXdmcpDisplay): Promise<void> {
    if (this.xdmcpDisplays.get(requestId) === display) this.xdmcpDisplays.delete(requestId);
    this.usedDisplayNumbers.delete(display.display);
  }

  private providerEnvironment(): NodeJS.ProcessEnv {
    const safe: NodeJS.ProcessEnv = {};
    for (const name of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA']) {
      const value = process.env[name];
      if (value) safe[name] = value;
    }
    return safe;
  }
}
