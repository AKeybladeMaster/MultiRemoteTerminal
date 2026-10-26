import { test, expect, _electron as electron } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { EventEmitter } from 'node:events';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { lstat as lstatFile, mkdir, mkdtemp, open as openFile, readFile, readdir as readDirectory, rename as renameFile, rm, stat as statFile, unlink as unlinkFile, writeFile } from 'node:fs/promises';
import { connect as connectTcp, createServer } from 'node:net';
import type { AddressInfo, Server, Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { tmpdir } from 'node:os';
import { join, posix, resolve, win32 } from 'node:path';
import { createSessionFolderBundle } from '../../packages/domain/src/session-folder-bundle.ts';
import { resolveShellExecutable } from '../../apps/desktop/src/workers/local-pty-provider.ts';

interface Ssh2FixtureClient extends EventEmitter {
  end(): void;
  forwardOut(boundAddress: string, boundPort: number, remoteAddress: string, remotePort: number,
    callback: (error: Error | undefined, channel?: Duplex) => void): this;
}
interface VaultE2EProbe {
  getState(): string;
  store(reference: string, secret: string): Promise<void>;
  resolve(reference: string): Promise<string>;
  unlock(): Promise<void>;
}
type Ssh2FixtureSession = EventEmitter;
interface Ssh2FixtureStream extends EventEmitter { write(data: string | Buffer): boolean; }
interface Ssh2AuthenticationContext {
  readonly username: string;
  readonly password: string;
  readonly method: string;
  readonly key?: { readonly algo: string; readonly data: Buffer };
  readonly blob?: Buffer;
  readonly signature?: Buffer;
  readonly hashAlgo?: string;
  accept(): void;
  reject(): void;
}
interface Ssh2ParsedKey {
  readonly type: string;
  getPublicSSH(): string | Buffer;
  sign(data: Buffer, options?: { readonly hash?: string }): Buffer | Error;
  verify(data: Buffer, signature: Buffer, hashAlgo?: string): boolean | Error;
}
interface Ssh2AgentProtocol extends EventEmitter {
  getIdentitiesReply(request: unknown, keys: readonly Ssh2ParsedKey[]): void;
  signReply(request: unknown, signature: Buffer): void;
  failureReply(request: unknown): void;
}
interface SftpFixtureAttributes { readonly mode: number; readonly uid: number; readonly gid: number; readonly size: number; readonly atime: number; readonly mtime: number; }
interface Ssh2FixtureSftp extends EventEmitter {
  handle(requestId: number, handle: Buffer): void;
  status(requestId: number, code: number, message?: string, language?: string): void;
  attrs(requestId: number, attributes: SftpFixtureAttributes): void;
  name(requestId: number, entries: readonly { readonly filename: string; readonly longname: string; readonly attrs: SftpFixtureAttributes }[]): void;
  data(requestId: number, value: Buffer): void;
}
interface Ssh2FixtureServer extends EventEmitter {
  listen(port: number, host: string, callback: () => void): void;
  address(): AddressInfo | string | null;
  close(callback: () => void): void;
}
interface Ssh2FixturePackage {
  readonly Server: new (configuration: { readonly hostKeys: readonly string[] }, onConnect: (client: EventEmitter) => void) => Ssh2FixtureServer;
  readonly AgentProtocol: new (isClient: boolean) => Ssh2AgentProtocol;
  readonly utils: {
    generateKeyPairSync(type: 'ed25519', options?: { readonly passphrase?: string; readonly cipher?: string }): { readonly private: string; readonly public: string };
    parseKey(key: string | Buffer): Ssh2ParsedKey | Error;
    readonly sftp: {
      readonly OPEN_MODE: { readonly READ: number; readonly WRITE: number; readonly APPEND: number; readonly CREAT: number; readonly TRUNC: number; readonly EXCL: number };
      readonly STATUS_CODE: { readonly OK: number; readonly EOF: number; readonly NO_SUCH_FILE: number; readonly PERMISSION_DENIED: number; readonly FAILURE: number };
    };
  };
}

interface SftpFixtureOptions {
  readonly readDelayMs?: number;
  readonly readDelayForPath?: (path: string) => number;
  readonly readDelayForRequest?: (path: string, offset: number, length: number) => number | undefined;
  readonly writeDelayMs?: number;
  readonly writeDelayForPath?: (path: string) => number;
  readonly renameDelayMs?: number;
  readonly onUploadStart?: (path: string) => void;
  readonly onRename?: (path: string) => void;
}

function startSftpFixture(sftp: Ssh2FixtureSftp, remoteRoot: string, api: Ssh2FixturePackage['utils']['sftp'],
  options: SftpFixtureOptions = {}): void {
  interface DirectoryHandle { readonly path: string; readonly names: string[]; read: boolean; }
  const fileHandles = new Map<number, Awaited<ReturnType<typeof openFile>>>();
  const fileHandlePaths = new Map<number, string>();
  const directoryHandles = new Map<number, DirectoryHandle>();
  const pendingDelays = new Set<() => void>();
  let closed = false;
  const waitForDelay = (delayMs: number): Promise<void> => new Promise(resolveDelay => {
    if (closed || delayMs <= 0) { resolveDelay(); return; }
    const timer = setTimeout(() => {
      pendingDelays.delete(cancelDelay);
      resolveDelay();
    }, delayMs);
    const cancelDelay = () => {
      clearTimeout(timer);
      pendingDelays.delete(cancelDelay);
      resolveDelay();
    };
    pendingDelays.add(cancelDelay);
  });
  let nextHandleId = 1;
  const handleBytes = (id: number) => { const value = Buffer.alloc(4); value.writeUInt32BE(id); return value; };
  const handleId = (value: Buffer) => value.length === 4 ? value.readUInt32BE(0) : -1;
  const remoteLocation = (input: string): { readonly remote: string; readonly local: string } => {
    const remote = input === '.' ? '/home/mrt' : input.startsWith('/') ? posix.normalize(input) : posix.resolve('/home/mrt', input);
    if (remote !== '/home/mrt' && !remote.startsWith('/home/mrt/')) throw Object.assign(new Error('Outside SFTP fixture root'), { code: 'EACCES' });
    const parts = remote.slice('/home/mrt'.length).split('/').filter(Boolean);
    if (parts.some(part => part === '.' || part === '..' || part.includes('\\'))) throw Object.assign(new Error('Invalid SFTP fixture path'), { code: 'EACCES' });
    return { remote, local: join(remoteRoot, ...parts) };
  };
  const attributes = (value: { readonly mode: number; readonly uid: number; readonly gid: number; readonly size: number;
    readonly atimeMs: number; readonly mtimeMs: number }): SftpFixtureAttributes => ({
    mode: value.mode, uid: value.uid, gid: value.gid, size: value.size,
    atime: Math.floor(value.atimeMs / 1_000), mtime: Math.floor(value.mtimeMs / 1_000)
  });
  const statusForError = (error: unknown): number => {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    return code === 'ENOENT' ? api.STATUS_CODE.NO_SUCH_FILE
      : code === 'EACCES' || code === 'EPERM' ? api.STATUS_CODE.PERMISSION_DENIED : api.STATUS_CODE.FAILURE;
  };
  const respondWithAttrs = async (requestId: number, path: string) => {
    try { sftp.attrs(requestId, attributes(await lstatFile(remoteLocation(path).local))); }
    catch (error) { sftp.status(requestId, statusForError(error)); }
  };
  sftp.on('REALPATH', (requestId: number, path: string) => {
    try {
      const resolved = remoteLocation(path);
      void statFile(resolved.local).then(stats => sftp.name(requestId, [{ filename: resolved.remote, longname: resolved.remote, attrs: attributes(stats) }]),
        error => sftp.status(requestId, statusForError(error)));
    } catch (error) { sftp.status(requestId, statusForError(error)); }
  });
  sftp.on('STAT', (requestId: number, path: string) => { void respondWithAttrs(requestId, path); });
  sftp.on('LSTAT', (requestId: number, path: string) => { void respondWithAttrs(requestId, path); });
  sftp.on('OPENDIR', (requestId: number, path: string) => {
    void (async () => {
      const location = remoteLocation(path);
      const stats = await statFile(location.local);
      if (!stats.isDirectory()) throw Object.assign(new Error('Not a directory'), { code: 'ENOTDIR' });
      const id = nextHandleId++;
      directoryHandles.set(id, { path: location.remote, names: await readDirectory(location.local), read: false });
      sftp.handle(requestId, handleBytes(id));
    })().catch(error => sftp.status(requestId, statusForError(error)));
  });
  sftp.on('READDIR', (requestId: number, handle: Buffer) => {
    const directory = directoryHandles.get(handleId(handle));
    if (!directory || directory.read) { sftp.status(requestId, api.STATUS_CODE.EOF); return; }
    directory.read = true;
    void (async () => {
      const entries = await Promise.all(directory.names.map(async filename => {
        const path = remoteLocation(posix.join(directory.path, filename)).local;
        const item = await lstatFile(path);
        const prefix = item.isDirectory() ? 'drwx------' : item.isSymbolicLink() ? 'lrwxrwxrwx' : '-rw-------';
        return { filename, longname: `${prefix} 1 mrt mrt ${item.size} Jan 01 00:00 ${filename}`, attrs: attributes(item) };
      }));
      if (entries.length === 0) sftp.status(requestId, api.STATUS_CODE.EOF);
      else sftp.name(requestId, entries);
    })().catch(error => sftp.status(requestId, statusForError(error)));
  });
  sftp.on('OPEN', (requestId: number, path: string, flags: number, requestAttributes: { readonly mode?: number }) => {
    void (async () => {
      const location = remoteLocation(path);
      const mode = api.OPEN_MODE;
      const writing = (flags & mode.WRITE) !== 0;
      const reading = (flags & mode.READ) !== 0;
      const append = (flags & mode.APPEND) !== 0;
      const create = (flags & mode.CREAT) !== 0;
      const truncate = (flags & mode.TRUNC) !== 0;
      const exclusive = (flags & mode.EXCL) !== 0;
      const fileFlags = writing
        ? append ? exclusive ? 'ax' : 'a' : create && (truncate || exclusive) ? exclusive ? 'wx' : 'w' : reading ? 'r+' : 'r+'
        : 'r';
      const file = await openFile(location.local, fileFlags, requestAttributes.mode ? requestAttributes.mode & 0o777 : 0o600);
      const id = nextHandleId++;
      fileHandles.set(id, file);
      fileHandlePaths.set(id, location.remote);
      if (writing) options.onUploadStart?.(location.remote);
      sftp.handle(requestId, handleBytes(id));
    })().catch(error => sftp.status(requestId, statusForError(error)));
  });
  sftp.on('READ', (requestId: number, handle: Buffer, offset: number, length: number) => {
    const id = handleId(handle);
    const file = fileHandles.get(id);
    if (!file || !Number.isSafeInteger(length) || length < 0 || length > 256 * 1024) { sftp.status(requestId, api.STATUS_CODE.FAILURE); return; }
    void (async () => {
      const path = fileHandlePaths.get(id) ?? '';
      const delayMs = options.readDelayForRequest?.(path, offset, length) ?? options.readDelayForPath?.(path) ?? options.readDelayMs ?? 0;
      await waitForDelay(delayMs);
      if (closed) return;
      const buffer = Buffer.alloc(length);
      const result = await file.read(buffer, 0, length, offset);
      if (closed) return;
      if (result.bytesRead === 0) sftp.status(requestId, api.STATUS_CODE.EOF);
      else sftp.data(requestId, buffer.subarray(0, result.bytesRead));
    })().catch(error => { if (!closed) sftp.status(requestId, statusForError(error)); });
  });
  sftp.on('WRITE', (requestId: number, handle: Buffer, offset: number, data: Buffer) => {
    const id = handleId(handle);
    const file = fileHandles.get(id);
    if (!file || data.byteLength > 256 * 1024) { sftp.status(requestId, api.STATUS_CODE.FAILURE); return; }
    const delayMs = options.writeDelayForPath?.(fileHandlePaths.get(id) ?? '') ?? options.writeDelayMs ?? 0;
    void file.write(data, 0, data.length, offset).then(async () => {
      await waitForDelay(delayMs);
      if (closed) return;
      sftp.status(requestId, api.STATUS_CODE.OK);
    }, error => { if (!closed) sftp.status(requestId, statusForError(error)); });
  });
  sftp.on('FSTAT', (requestId: number, handle: Buffer) => {
    const file = fileHandles.get(handleId(handle));
    if (!file) { sftp.status(requestId, api.STATUS_CODE.FAILURE); return; }
    void file.stat().then(value => sftp.attrs(requestId, attributes(value)), error => sftp.status(requestId, statusForError(error)));
  });
  sftp.on('CLOSE', (requestId: number, handle: Buffer) => {
    const id = handleId(handle);
    const file = fileHandles.get(id);
    if (file) {
      fileHandles.delete(id);
      fileHandlePaths.delete(id);
      void file.close().then(() => sftp.status(requestId, api.STATUS_CODE.OK), error => sftp.status(requestId, statusForError(error)));
      return;
    }
    if (directoryHandles.delete(id)) sftp.status(requestId, api.STATUS_CODE.OK);
    else sftp.status(requestId, api.STATUS_CODE.FAILURE);
  });
  sftp.on('RENAME', (requestId: number, source: string, destination: string) => {
    void (async () => {
      await waitForDelay(options.renameDelayMs ?? 0);
      if (closed) return;
      const from = remoteLocation(source).local;
      const to = remoteLocation(destination).local;
      try { await lstatFile(to); sftp.status(requestId, api.STATUS_CODE.FAILURE); }
      catch (error) {
        const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
        if (code !== 'ENOENT') throw error;
        await renameFile(from, to);
        options.onRename?.(remoteLocation(destination).remote);
        sftp.status(requestId, api.STATUS_CODE.OK);
      }
    })().catch(error => { if (!closed) sftp.status(requestId, statusForError(error)); });
  });
  sftp.on('REMOVE', (requestId: number, path: string) => {
    void unlinkFile(remoteLocation(path).local).then(() => sftp.status(requestId, api.STATUS_CODE.OK),
      error => sftp.status(requestId, statusForError(error)));
  });
  sftp.once('close', () => {
    closed = true;
    for (const finishDelay of pendingDelays) finishDelay();
    for (const file of fileHandles.values()) void file.close().catch(() => undefined);
    fileHandles.clear();
    fileHandlePaths.clear();
    directoryHandles.clear();
  });
}

interface E2EFileDigest { readonly size: number; readonly sha256: string; }

async function writePatternFile(path: string, size: number, seed: number): Promise<void> {
  const words = new Uint32Array((1024 * 1024) / Uint32Array.BYTES_PER_ELEMENT);
  const chunk = Buffer.from(words.buffer);
  const file = await openFile(path, 'w');
  try {
    for (let position = 0; position < size;) {
      const length = Math.min(chunk.byteLength, size - position);
      const block = Math.floor(position / chunk.byteLength);
      let state = (seed ^ Math.imul(block + 1, 0x9e3779b1)) >>> 0;
      if (state === 0) state = 0x6d2b79f5;
      const wordCount = Math.floor(length / Uint32Array.BYTES_PER_ELEMENT);
      for (let index = 0; index < wordCount; index++) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        words[index] = state >>> 0;
      }
      for (let index = wordCount * Uint32Array.BYTES_PER_ELEMENT; index < length; index++) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        chunk[index] = state & 0xff;
      }
      let offset = 0;
      while (offset < length) {
        const result = await file.write(chunk, offset, length - offset, position + offset);
        if (result.bytesWritten === 0) throw new Error('The large-file fixture write made no progress.');
        offset += result.bytesWritten;
      }
      position += length;
    }
  } finally { await file.close(); }
}

async function hashFile(path: string): Promise<E2EFileDigest> {
  const file = await openFile(path, 'r');
  const buffer = Buffer.alloc(1024 * 1024);
  const hash = createHash('sha256');
  let size = 0;
  try {
    for (;;) {
      const result = await file.read(buffer, 0, buffer.byteLength, null);
      if (result.bytesRead === 0) break;
      size += result.bytesRead;
      hash.update(buffer.subarray(0, result.bytesRead));
    }
  } finally { await file.close(); }
  return { size, sha256: hash.digest('hex') };
}

const unicodeSample = String.fromCodePoint(0x416, 0x96ea, 0x1f642);
const bashUnicodeSample = String.fromCodePoint(0x416, 0x96ea);
let nextPowerShellSizeProbe = 0;

function electronEnvironment(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] =>
    entry[1] !== undefined && entry[0] !== 'ELECTRON_RUN_AS_NODE'));
}

function launchVaultE2EApp(profile: string, masterPassword = false) {
  return electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`, '--mrt-e2e-vault-probe',
    ...(masterPassword ? ['--mrt-e2e-master-password'] : [])],
    env: { ...electronEnvironment(), MRT_E2E: '1' } });
}

function vaultE2EProbeState(app: Awaited<ReturnType<typeof electron.launch>>) {
  return app.evaluate(() => (globalThis as typeof globalThis & {
    __mrtE2EVaultProbe?: Pick<VaultE2EProbe, 'getState'>;
  }).__mrtE2EVaultProbe?.getState());
}

async function waitForVaultE2EProbe(app: Awaited<ReturnType<typeof electron.launch>>): Promise<void> {
  await expect.poll(() => vaultE2EProbeState(app), { timeout: 15_000 }).toBe('available');
}

async function focusVirtualizedListBoundary(list: Locator, edge: 'first' | 'last') {
  return list.evaluate((element, direction) => {
    const controls = Array.from(element.querySelectorAll<HTMLElement>('button:not(:disabled), summary[role="button"]'))
      .filter(control => control.getClientRects().length > 0);
    const boundary = direction === 'first' ? controls[0] : controls.at(-1);
    const row = boundary?.closest<HTMLElement>('[data-virtual-index]');
    if (!boundary || !row) throw new Error('The virtualized list boundary had no keyboard control.');
    boundary.focus();
    return { index: Number(row.dataset.virtualIndex), focused: document.activeElement === boundary };
  }, edge);
}

async function dispatchFileDrop(page: Page, filePaths: readonly string[], targetSelector: string): Promise<void> {
  const inputId = `mrt-e2e-drop-input-${randomUUID()}`;
  const inputSelector = `#${inputId}`;
  await page.evaluate(({ id }) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.id = id;
    input.multiple = true;
    input.hidden = true;
    document.body.append(input);
  }, { id: inputId });
  await page.locator(inputSelector).setInputFiles([...filePaths]);
  await expect.poll(() => page.evaluate(() => typeof (globalThis as unknown as { __mrtE2EFileDrop?: unknown }).__mrtE2EFileDrop))
    .toBe('object');
  const dispatched = await page.evaluate(({ inputSelector: input, targetSelector: target }) => (globalThis as unknown as {
    __mrtE2EFileDrop?: { dropFromInput(inputSelector: string, targetSelector: string): boolean }
  }).__mrtE2EFileDrop?.dropFromInput(input, target) ?? false, { inputSelector, targetSelector });
  expect(dispatched).toBe(true);
}

async function runPaletteCommand(page: Page, label: string): Promise<void> {
  await page.keyboard.press('Control+Shift+P');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await palette.getByRole('button', { name: label, exact: true }).click();
}

async function selectTerminal(page: Page, title: string) {
  const tab = page.getByRole('tab').filter({ hasText: title }).first();
  await expect(tab).toBeVisible();
  await tab.click();
  const panelId = await tab.getAttribute('aria-controls');
  if (!panelId) throw new Error(`Missing terminal panel for ${title}`);
  return page.locator(`#${panelId}`);
}

async function sendLine(page: Page, title: string, line: string, marker: string | RegExp) {
  const panel = await selectTerminal(page, title);
  await panel.locator('.terminal-host').click({ position: { x: 80, y: 60 } });
  await expect(panel.locator('.xterm-helper-textarea')).toBeFocused();
  await page.keyboard.type(line);
  await page.keyboard.press('Enter');
  const rows = panel.locator('.xterm-rows');
  await expect(rows).toContainText(marker, { timeout: 15_000 });
  return { panel, rows };
}

async function confirmCloseActiveTerminal(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'Close active terminal' }).click();
  const confirmation = page.getByRole('alertdialog');
  await expect(confirmation).toContainText(title);
  await confirmation.getByRole('button', { name: 'Close terminal' }).click();
}

function systemExecutable(name: string): string {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
  return join(systemRoot, 'System32', name);
}

function windowsPowerShellExecutable(): string {
  return join(systemExecutable(''), 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function installedGitBashExecutable(): string | undefined {
  try { return resolveShellExecutable('bash'); }
  catch { return undefined; }
}

function processIsRunning(pid: number): boolean {
  const result = execFileSync(systemExecutable('tasklist.exe'), ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
    encoding: 'utf8', windowsHide: true
  });
  return result.includes(`"${pid}"`);
}

function parentProcessId(pid: number): number {
  const result = execFileSync(windowsPowerShellExecutable(), ['-NoProfile', '-NonInteractive', '-Command',
    `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').ParentProcessId`], {
    encoding: 'utf8', windowsHide: true
  });
  return Number(result.trim());
}

function powerShellProcessIds(): number[] {
  const result = execFileSync(windowsPowerShellExecutable(),
    ['-NoProfile', '-NonInteractive', '-Command',
      `Get-CimInstance Win32_Process -Filter \"Name = 'powershell.exe'\" | Where-Object ProcessId -ne $PID | ForEach-Object ProcessId`], {
      encoding: 'utf8', windowsHide: true
    });
  return result.split(/\r?\n/).map(value => Number(value.trim())).filter(value => Number.isSafeInteger(value) && value > 0);
}

async function readPowerShellPid(page: Page, title: string): Promise<number> {
  const { rows } = await sendLine(page, title, "Write-Output ('MRT-' + 'PID:' + $PID)", /MRT-PID:\d+/);
  const matches = [...(await rows.innerText()).matchAll(/MRT-PID:(\d+)/g)];
  const pid = Number(matches.at(-1)?.[1]);
  expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
  return pid;
}

async function readPowerShellSize(page: Page, title: string): Promise<{ readonly columns: number; readonly rows: number }> {
  const marker = `MRT-SIZE-${++nextPowerShellSizeProbe}`;
  const outputPattern = new RegExp(`${marker}:(\\d+)x(\\d+)`);
  const { rows } = await sendLine(page, title,
    `Write-Output ('${marker}:' + $Host.UI.RawUI.WindowSize.Width + 'x' + $Host.UI.RawUI.WindowSize.Height)`, outputPattern);
  const match = (await rows.innerText()).match(outputPattern);
  const columns = Number(match?.[1]);
  const rowCount = Number(match?.[2]);
  expect(Number.isSafeInteger(columns) && columns > 1).toBe(true);
  expect(Number.isSafeInteger(rowCount) && rowCount > 0).toBe(true);
  return { columns, rows: rowCount };
}

function waitForExit(child: ReturnType<typeof spawn>, timeoutMs: number): Promise<number> {
  return new Promise((resolveExit, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Second application instance did not exit after failing to acquire the lock'));
    }, timeoutMs);
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', code => {
      clearTimeout(timer);
      resolveExit(code ?? -1);
    });
  });
}

test('Windows local text editor preserves drafts on conflict and saves the selected file', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'mrt-local-text-editor-e2e-'));
  const path = join(profile, 'settings.txt');
  await writeFile(path, 'name=old\r\nlegacy=1\n');
  const app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`, '--mrt-e2e-local-text-editor',
    `--mrt-e2e-local-text-file=${path}`], env: { ...electronEnvironment(), MRT_E2E: '1' } });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Edit local file', exact: true }).click();
    const editor = page.getByTestId('local-text-editor');
    const contents = editor.getByRole('textbox', { name: 'File contents' });
    await expect(editor.getByRole('heading', { name: 'settings.txt', exact: true })).toBeVisible();
    await expect(contents).toHaveValue('name=old\nlegacy=1\n');
    await expect(editor.getByRole('note')).toHaveText('Mixed line endings will be normalized to CRLF when you save.');
    await contents.fill('name=draft\nlegacy=1\n');
    await writeFile(path, 'name=external\r\nlegacy=external\n');
    await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(editor.getByRole('alert')).toContainText('changed since it was opened');
    await expect(contents).toHaveValue('name=draft\nlegacy=1\n');
    await editor.getByRole('button', { name: 'Reload', exact: true }).click();
    await editor.getByRole('button', { name: 'Discard and reload', exact: true }).click();
    await expect(contents).toHaveValue('name=external\nlegacy=external\n');
    await expect(editor.getByRole('note')).toHaveText('Mixed line endings will be normalized to CRLF when you save.');
    await contents.fill('name=final\nlegacy=external\n');
    await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(editor.getByRole('status')).toHaveText('Saved');
    expect(await readFile(path, 'utf8')).toBe('name=final\r\nlegacy=external\r\n');
    await expect(page.locator('body')).not.toContainText(path);
    await editor.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(editor).toBeHidden();
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('local text editor auto-detects shell syntax and supports a JSON color profile', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'mrt-editor-syntax-e2e-'));
  const path = join(profile, 'example.zsh');
  const source = 'if test "$HOME"; then\n  git status --short\nfi\n';
  await writeFile(path, source);
  const app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`, '--mrt-e2e-local-text-editor',
    `--mrt-e2e-local-text-file=${path}`], env: { ...electronEnvironment(), MRT_E2E: '1' } });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Edit local file', exact: true }).click();
    const editor = page.getByTestId('local-text-editor');
    const syntax = editor.getByLabel('Syntax profile');
    const contents = editor.getByRole('textbox', { name: 'File contents' });
    const preview = editor.getByTestId('text-editor-code-preview');
    await expect(syntax).toHaveValue('auto');
    await expect(contents).toHaveValue(source);
    await expect(preview.locator('[data-token-kind="shell-keyword"]').first()).toHaveCSS('color', 'rgb(223, 143, 255)');
    await expect(preview.locator('[data-token-kind="shell-command"]').first()).toHaveCSS('color', 'rgb(84, 215, 212)');
    await page.screenshot({ path: 'test-results/editor-shell-syntax.png' });

    await syntax.selectOption('json');
    await contents.fill('{"name":"MultiRemoteTerminal","enabled":true}');
    await expect(preview.locator('[data-token-kind="json-key"]').first()).toHaveCSS('color', 'rgb(84, 215, 212)');
    await expect(preview.locator('[data-token-kind="json-literal"]').first()).toHaveCSS('color', 'rgb(223, 143, 255)');
    const longJson = Array.from({ length: 120 }, (_, index) => `{"name":"line-${index}","enabled":true}`).join('\n');
    await contents.fill(longJson);
    const textareaScrollTop = await contents.evaluate(element => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event('scroll'));
      return element.scrollTop;
    });
    await expect.poll(() => preview.evaluate(element => element.scrollTop)).toBe(textareaScrollTop);
    await syntax.selectOption('plain');
    await expect(preview.locator('[data-token-kind]')).toHaveCount(0);
    expect(await readFile(path, 'utf8')).toBe(source);

    await editor.getByRole('button', { name: 'Close', exact: true }).click();
    await editor.getByRole('button', { name: 'Discard and close', exact: true }).click();
    await expect(editor).toBeHidden();
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('a second application process exits and shows and focuses the primary window under the same profile', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'mrt-single-instance-'));
  const app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`], env: electronEnvironment() });
  let secondInstance: ReturnType<typeof spawn> | undefined;
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await expect.poll(() => app.evaluate(electron => electron.BrowserWindow.getAllWindows()[0]?.isVisible())).toBe(true);
    await app.evaluate(electron => electron.BrowserWindow.getAllWindows()[0]?.hide());
    await expect.poll(() => app.evaluate(electron => electron.BrowserWindow.getAllWindows()[0]?.isVisible())).toBe(false);
    const executable = await app.evaluate(() => process.execPath);
    secondInstance = spawn(executable, [resolve('apps/desktop'), `--user-data-dir=${profile}`], {
      env: electronEnvironment(), windowsHide: true, stdio: 'ignore'
    });
    expect(await waitForExit(secondInstance, 10_000)).toBe(0);
    expect(app.process()?.exitCode).toBeNull();
    await expect.poll(() => app.evaluate(electron => ({
      visible: electron.BrowserWindow.getAllWindows()[0]?.isVisible(),
      minimized: electron.BrowserWindow.getAllWindows()[0]?.isMinimized(),
      focused: electron.BrowserWindow.getAllWindows()[0]?.isFocused()
    })), { timeout: 10_000 }).toEqual({ visible: true, minimized: false, focused: true });
    await expect(page.locator('.workbench')).toHaveCount(1);
  } finally {
    secondInstance?.kill();
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('SSH quick connect validates the address before any credential prompt and returns focus on cancel', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'mrt-ssh-connect-e2e-'));
  const app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`, '--force-device-scale-factor=1'], env: electronEnvironment() });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    const workerReply = await app.evaluate(async ({ utilityProcess }, { workerPath, appRoot }) => new Promise<unknown>((resolveReply, rejectReply) => {
      const requestId = '00000000-0000-4000-8000-000000000001';
      const child = utilityProcess.fork(workerPath, [], { cwd: appRoot, env: { MRT_APP_ROOT: appRoot }, stdio: 'ignore' });
      let settled = false;
      const finish = (error?: Error, value?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill();
        if (error) rejectReply(error);
        else resolveReply(value);
      };
      const timer = setTimeout(() => finish(new Error('SSH worker did not acknowledge shutdown')), 10_000);
      child.once('error', error => finish(new Error(String(error))));
      child.once('exit', code => finish(new Error(`SSH worker exited before replying (${code})`)));
      child.on('message', value => {
        const message = value as { requestId?: unknown };
        if (message?.requestId === requestId) finish(undefined, message);
      });
      child.once('spawn', () => child.postMessage({ version: 1, type: 'request', requestId, command: 'shutdown' }));
    }), { workerPath: resolve('dist/host/apps/desktop/src/workers/ssh-worker.js'), appRoot: resolve('apps/desktop') });
    expect(workerReply).toEqual({ version: 1, type: 'reply', requestId: '00000000-0000-4000-8000-000000000001', ok: true, result: {} });
    const connectButton = page.getByRole('button', { name: 'Connect to SSH' }).first();
    await connectButton.click();
    const dialog = page.getByRole('dialog', { name: 'Connect to an SSH server' });
    await expect(dialog).toBeVisible();
    const hostInput = page.getByLabel('Host name or IP address');
    await expect(hostInput).toBeFocused();
    await page.screenshot({ path: 'test-results/ssh-quick-connect-100pct.png', fullPage: true });
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Enter a host name or IP address.');
    await hostInput.fill('https://server.example.com');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Enter a valid DNS name or IP address.');
    await expect(hostInput).toBeFocused();
    await expect(page.getByRole('tab')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(connectButton).toBeFocused();
    await expect(page.locator('.status-bar')).toContainText('Local');
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('SSH private-key mode authenticates a trusted terminal and standalone SFTP session', async () => {
  test.setTimeout(60_000);
  const profile = await mkdtemp(join(tmpdir(), 'mrt-ssh-private-key-e2e-'));
  const privateKeyPath = join(profile, 'id_ed25519');
  const remoteRoot = join(profile, 'remote-files');
  const passphrase = 'mrt-e2e-key-passphrase';
  const ssh2 = createRequire(resolve('apps/desktop/package.json'))('ssh2') as Ssh2FixturePackage;
  const hostKeyPair = ssh2.utils.generateKeyPairSync('ed25519');
  const clientKeyPair = ssh2.utils.generateKeyPairSync('ed25519', { passphrase, cipher: 'aes256-cbc' });
  const allowedClientKey = ssh2.utils.parseKey(clientKeyPair.public);
  if (allowedClientKey instanceof Error) throw new Error('The key-auth fixture public key could not be parsed');
  const allowedClientKeyBytes = Buffer.from(allowedClientKey.getPublicSSH());
  const fixtureEvents: string[] = [];
  const fixtureErrors: string[] = [];
  const clients = new Set<Ssh2FixtureClient>();
  let shellRequests = 0;
  let sftpRequests = 0;
  const server = new ssh2.Server({ hostKeys: [hostKeyPair.private] }, rawClient => {
    const client = rawClient as Ssh2FixtureClient;
    clients.add(client);
    client.once('close', () => clients.delete(client));
    client.on('error', error => fixtureErrors.push(error.message));
    client.on('authentication', (rawContext: unknown) => {
      const context = rawContext as Ssh2AuthenticationContext;
      fixtureEvents.push(`auth:${context.method}:${context.username}`);
      if (context.method === 'publickey' && context.username === 'mrt-e2e-key-user' && context.key?.algo === allowedClientKey.type &&
          context.key.data.equals(allowedClientKeyBytes) && (!context.signature ||
            Boolean(context.blob && allowedClientKey.verify(context.blob, context.signature, context.hashAlgo) === true))) context.accept();
      else context.reject();
    });
    client.on('ready', () => {
      fixtureEvents.push('authenticated');
      client.on('session', (acceptSession: () => Ssh2FixtureSession) => {
        const session = acceptSession();
        session.on('pty', (accept: () => void) => accept());
        session.on('shell', (acceptShell: () => Ssh2FixtureStream) => {
          shellRequests += 1;
          acceptShell().write('MRT-SSH-PUBLICKEY-READY\r\n');
        });
        session.on('sftp', (acceptSftp: () => Ssh2FixtureSftp) => {
          sftpRequests += 1;
          startSftpFixture(acceptSftp(), remoteRoot, ssh2.utils.sftp);
        });
      });
    });
  });
  server.on('error', error => fixtureErrors.push(error.message));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  let listening = false;
  try {
    await mkdir(remoteRoot);
    await writeFile(join(remoteRoot, 'private-key-sftp.txt'), 'private-key-authenticated SFTP payload');
    await writeFile(privateKeyPath, clientKeyPair.private, { encoding: 'utf8', mode: 0o600 });
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(0, '127.0.0.1', () => { listening = true; resolveListen(); });
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('The public-key SSH fixture did not bind a loopback port');
    app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`, '--mrt-e2e-ssh-key-auth',
      `--mrt-e2e-ssh-private-key=${privateKeyPath}`], env: { ...electronEnvironment(), MRT_E2E: '1' } });
    const page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Connect to SSH', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Connect to an SSH server' });
    await dialog.getByLabel('Host name or IP address').fill('127.0.0.1');
    await dialog.getByLabel('Port').fill(String(address.port));
    await dialog.getByLabel('Authentication method').selectOption('private-key');
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
    const trust = page.getByRole('dialog', { name: 'Verify this SSH host' });
    await expect(trust, `Fixture events: ${fixtureEvents.join(', ')}; errors: ${fixtureErrors.join(', ')}; page: ${await page.locator('body').innerText()}`)
      .toBeVisible({ timeout: 15_000 });
    await trust.getByRole('button', { name: 'Trust key and connect' }).click();

    const sshTab = page.getByRole('tab').filter({ hasText: /SSH/ }).first();
    await expect(sshTab).toBeVisible({ timeout: 20_000 });
    const panelId = await sshTab.getAttribute('aria-controls');
    if (!panelId) throw new Error('Missing public-key SSH terminal panel');
    await expect(page.locator(`#${panelId} .xterm-rows`)).toContainText('MRT-SSH-PUBLICKEY-READY', { timeout: 15_000 });
    expect(fixtureEvents).toContain('auth:publickey:mrt-e2e-key-user');
    expect(fixtureEvents).toContain('authenticated');
    expect(await app.evaluate(() => Reflect.get(globalThis, '__mrtE2ESshKeyPromptCount'))).toBe(1);

    const sftpRequestsBeforeStandalone = sftpRequests;
    await page.getByRole('button', { name: 'Connect to SFTP files', exact: true }).first().click();
    const sftpDialog = page.getByRole('dialog', { name: 'Connect to SFTP files' });
    await sftpDialog.getByLabel('Host name or IP address').fill('127.0.0.1');
    await sftpDialog.getByLabel('Port').fill(String(address.port));
    await sftpDialog.getByLabel('Authentication method').selectOption('private-key');
    await sftpDialog.getByRole('button', { name: 'Connect', exact: true }).click();
    const sftpTab = page.getByRole('tab').filter({ hasText: /SFTP/ }).first();
    await expect(sftpTab).toBeVisible({ timeout: 20_000 });
    const sftpPanelId = await sftpTab.getAttribute('aria-controls');
    if (!sftpPanelId) throw new Error('Missing private-key SFTP panel');
    await expect(page.locator('#' + sftpPanelId).getByTestId('remote-file-browser').getByText('private-key-sftp.txt', { exact: true }))
      .toBeVisible({ timeout: 15_000 });
    expect(sftpRequests).toBeGreaterThan(sftpRequestsBeforeStandalone);
    expect(shellRequests).toBe(1);
    expect(fixtureEvents.filter(event => event === 'authenticated')).toHaveLength(2);
    expect(await app.evaluate(() => Reflect.get(globalThis, '__mrtE2ESshKeyPromptCount'))).toBe(2);
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain(privateKeyPath);
    expect(bodyText).not.toContain('PRIVATE KEY');
    expect(bodyText).not.toContain(passphrase);
  } finally {
    await app?.close();
    for (const client of clients) client.end();
    if (listening) await new Promise<void>(resolveClose => server.close(() => resolveClose()));
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('SSH agent mode signs through a Windows named pipe and authenticates a trusted loopback terminal', async () => {
  test.setTimeout(60_000);
  const profile = await mkdtemp(join(tmpdir(), 'mrt-ssh-agent-e2e-'));
  const remoteRoot = join(profile, 'remote-files');
  const agentPipePath = String.raw`\\.\pipe\mrt-ssh-agent-${randomUUID()}`;
  const ssh2 = createRequire(resolve('apps/desktop/package.json'))('ssh2') as Ssh2FixturePackage;
  const hostKeyPair = ssh2.utils.generateKeyPairSync('ed25519');
  const agentKeyPair = ssh2.utils.generateKeyPairSync('ed25519');
  const agentPublicKey = ssh2.utils.parseKey(agentKeyPair.public);
  const agentPrivateKey = ssh2.utils.parseKey(agentKeyPair.private);
  if (agentPublicKey instanceof Error || agentPrivateKey instanceof Error) throw new Error('The SSH agent fixture key could not be parsed');
  const agentPublicKeyBytes = Buffer.from(agentPublicKey.getPublicSSH());
  const fixtureEvents: string[] = [];
  const fixtureErrors: string[] = [];
  const clients = new Set<Ssh2FixtureClient>();
  const agentSockets = new Set<Socket>();
  let identityRequests = 0;
  let signRequests = 0;
  let shellRequests = 0;
  let sftpRequests = 0;
  const agentServer = createServer(socket => {
    agentSockets.add(socket);
    socket.once('close', () => agentSockets.delete(socket));
    socket.on('error', error => fixtureErrors.push(`agent socket: ${error.message}`));
    const protocol = new ssh2.AgentProtocol(false);
    protocol.on('identities', request => {
      identityRequests += 1;
      protocol.getIdentitiesReply(request, [agentPublicKey]);
    });
    protocol.on('sign', (request, _key, data, options) => {
      signRequests += 1;
      const signature = agentPrivateKey.sign(data, options as { readonly hash?: string });
      if (signature instanceof Error) protocol.failureReply(request);
      else protocol.signReply(request, signature);
    });
    protocol.on('error', error => fixtureErrors.push(`agent protocol: ${error.message}`));
    (protocol as unknown as Duplex).pipe(socket).pipe(protocol as unknown as Duplex);
  });
  const sshServer = new ssh2.Server({ hostKeys: [hostKeyPair.private] }, rawClient => {
    const client = rawClient as Ssh2FixtureClient;
    clients.add(client);
    client.once('close', () => clients.delete(client));
    client.on('error', error => fixtureErrors.push(error.message));
    client.on('authentication', (rawContext: unknown) => {
      const context = rawContext as Ssh2AuthenticationContext;
      fixtureEvents.push(`auth:${context.method}:${context.username}`);
      const expectedKey = context.method === 'publickey' && context.username === 'mrt-e2e-agent-user' &&
        context.key?.algo === agentPublicKey.type && context.key.data.equals(agentPublicKeyBytes);
      if (expectedKey && !context.signature) context.accept();
      else if (expectedKey && context.signature && context.blob &&
          agentPublicKey.verify(context.blob, context.signature, context.hashAlgo) === true) context.accept();
      else context.reject();
    });
    client.on('ready', () => {
      fixtureEvents.push('authenticated');
      client.on('session', (acceptSession: () => Ssh2FixtureSession) => {
        const session = acceptSession();
        session.on('pty', (accept: () => void) => accept());
        session.on('shell', (acceptShell: () => Ssh2FixtureStream) => {
          shellRequests += 1;
          acceptShell().write('MRT-SSH-AGENT-READY\r\n');
        });
        session.on('sftp', (acceptSftp: () => Ssh2FixtureSftp) => {
          sftpRequests += 1;
          startSftpFixture(acceptSftp(), remoteRoot, ssh2.utils.sftp);
        });
      });
    });
  });
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  let agentListening = false;
  let sshListening = false;
  try {
    await mkdir(remoteRoot);
    await writeFile(join(remoteRoot, 'agent-sftp.txt'), 'agent-authenticated SFTP payload');
    await new Promise<void>((resolveListen, rejectListen) => {
      agentServer.once('error', rejectListen);
      agentServer.listen(agentPipePath, () => { agentListening = true; resolveListen(); });
    });
    await new Promise<void>((resolveListen, rejectListen) => {
      sshServer.once('error', rejectListen);
      sshServer.listen(0, '127.0.0.1', () => { sshListening = true; resolveListen(); });
    });
    const address = sshServer.address();
    if (!address || typeof address === 'string') throw new Error('The SSH agent fixture did not bind a loopback port');
    app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`, '--mrt-e2e-ssh-agent-auth',
      `--mrt-e2e-ssh-agent-pipe=${agentPipePath}`], env: { ...electronEnvironment(), MRT_E2E: '1' } });
    const page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Connect to SSH', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Connect to an SSH server' });
    await dialog.getByLabel('Host name or IP address').fill('127.0.0.1');
    await dialog.getByLabel('Port').fill(String(address.port));
    await dialog.getByLabel('Authentication method').selectOption('agent');
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
    const trust = page.getByRole('dialog', { name: 'Verify this SSH host' });
    await expect(trust, `Fixture events: ${fixtureEvents.join(', ')}; errors: ${fixtureErrors.join(', ')}; page: ${await page.locator('body').innerText()}`)
      .toBeVisible({ timeout: 15_000 });
    await trust.getByRole('button', { name: 'Trust key and connect' }).click();

    const sshTab = page.getByRole('tab').filter({ hasText: /SSH/ }).first();
    await expect(sshTab).toBeVisible({ timeout: 20_000 });
    const panelId = await sshTab.getAttribute('aria-controls');
    if (!panelId) throw new Error('Missing SSH agent terminal panel');
    await expect(page.locator(`#${panelId} .xterm-rows`)).toContainText('MRT-SSH-AGENT-READY', { timeout: 15_000 });
    expect(fixtureEvents).toContain('auth:publickey:mrt-e2e-agent-user');
    expect(fixtureEvents).toContain('authenticated');
    expect(identityRequests).toBeGreaterThan(0);
    expect(signRequests).toBeGreaterThan(0);
    expect(await app.evaluate(() => Reflect.get(globalThis, '__mrtE2ESshAgentPromptCount'))).toBe(1);

    const signRequestsBeforeSftp = signRequests;
    const sftpRequestsBeforeStandalone = sftpRequests;
    await page.getByRole('button', { name: 'Connect to SFTP files', exact: true }).first().click();
    const sftpDialog = page.getByRole('dialog', { name: 'Connect to SFTP files' });
    await sftpDialog.getByLabel('Host name or IP address').fill('127.0.0.1');
    await sftpDialog.getByLabel('Port').fill(String(address.port));
    await sftpDialog.getByLabel('Authentication method').selectOption('agent');
    await sftpDialog.getByRole('button', { name: 'Connect', exact: true }).click();
    const sftpTab = page.getByRole('tab').filter({ hasText: /SFTP/ }).first();
    await expect(sftpTab).toBeVisible({ timeout: 20_000 });
    const sftpPanelId = await sftpTab.getAttribute('aria-controls');
    if (!sftpPanelId) throw new Error('Missing standalone SFTP agent panel');
    await expect(page.locator(`#${sftpPanelId}`).getByTestId('remote-file-browser').getByText('agent-sftp.txt', { exact: true }))
      .toBeVisible({ timeout: 15_000 });
    expect(sftpRequests).toBeGreaterThan(sftpRequestsBeforeStandalone);
    expect(shellRequests).toBe(1);
    expect(signRequests).toBeGreaterThan(signRequestsBeforeSftp);
    expect(await app.evaluate(() => Reflect.get(globalThis, '__mrtE2ESshAgentPromptCount'))).toBe(2);
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain(agentPipePath);
    expect(bodyText).not.toContain(agentKeyPair.private);
  } finally {
    await app?.close();
    for (const client of clients) client.end();
    for (const socket of agentSockets) socket.destroy();
    if (sshListening) await new Promise<void>(resolveClose => sshServer.close(() => resolveClose()));
    if (agentListening) await new Promise<void>(resolveClose => agentServer.close(() => resolveClose()));
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('SFTP sessions verify trust and transfers, render hostile SSH output as text, and avoid unrequested shells', async () => {
  test.setTimeout(180_000);
  const profile = await mkdtemp(join(tmpdir(), 'mrt-sftp-e2e-profile-'));
  const remoteRoot = join(profile, 'remote-files');
  const hostileOutputPath = join(profile, 'hostile-output-owned.txt');
  const hostileOutputPathLiteral = JSON.stringify(hostileOutputPath).replace(/'/gu, '&#39;');
  const hostileShellOutput = `<img src=x onerror='globalThis.__mrtRemoteOutputExecuted = true; require("node:fs").writeFileSync(${hostileOutputPathLiteral}, "owned")'>`;
  const remoteScaleRoot = join(remoteRoot, 'scale');
  const largeRemoteFile = join(remoteRoot, 'large.bin');
  const largeTransferSize = 100 * 1024 * 1024;
  const interruptedRemoteFile = join(remoteRoot, 'interrupted.bin');
  const interruptedTransferSize = 4 * 1024 * 1024;
  const interruptedUploadSource = join(profile, 'interrupted-upload.txt');
  const interruptedUploadTarget = join(remoteRoot, 'interrupted-upload.txt');
  const interruptedUploadContents = Buffer.alloc(512 * 1024, 0x5a);
  const largeDropUploadSource = join(profile, 'large-upload.bin');
  const dropUploadContents = [Buffer.alloc(1_024, 0x41), Buffer.from('private dropped upload payload two')];
  const uploadSource = join(profile, 'upload.txt');
  const dropUploadSources = [join(profile, 'dragged-upload.txt'), join(profile, 'dragged-upload-second.txt')];
  const dropFixtureEvents: string[] = [];
  let sftpDropUploadStartCount = 0;
  let largeDropUploadStarted = false;
  let stallInterruptedDownload = true;
  let stallInterruptedUpload = false;
  let activeFilesOnlyClient: Ssh2FixtureClient | undefined;
  const terminalClients = new Set<Ssh2FixtureClient>();
  const downloadRoot = join(profile, 'downloads');
  let expectedLargeFileDigest: E2EFileDigest;
  let expectedLargeUploadDigest: E2EFileDigest;
  const ssh2 = createRequire(resolve('apps/desktop/package.json'))('ssh2') as Ssh2FixturePackage;
  const keyPair = ssh2.utils.generateKeyPairSync('ed25519');
  const clients = new Set<Ssh2FixtureClient>();
  const fixtureEvents: string[] = [];
  const server = new ssh2.Server({ hostKeys: [keyPair.private] }, rawClient => {
    const client = rawClient as Ssh2FixtureClient;
    fixtureEvents.push('connection');
    clients.add(client);
    client.once('close', () => {
      clients.delete(client);
      terminalClients.delete(client);
      if (activeFilesOnlyClient === client) activeFilesOnlyClient = undefined;
    });
    client.on('error', error => fixtureEvents.push(`client-error:${error.message}`));
    client.on('authentication', (rawContext: unknown) => {
      const context = rawContext as Ssh2AuthenticationContext;
      fixtureEvents.push(`auth:${context.method}:${context.username}`);
      if (context.method === 'password' && context.username === 'mrt-e2e-user' && context.password === 'sftp-e2e-secret') context.accept();
      else context.reject();
    });
    client.on('ready', () => {
      fixtureEvents.push('authenticated');
      client.on('session', (acceptSession: () => Ssh2FixtureSession) => {
      const session = acceptSession();
      session.on('pty', (accept: () => void) => accept());
      session.on('shell', (acceptShell: () => Ssh2FixtureStream) => {
        fixtureEvents.push('shell');
        terminalClients.add(client);
        const stream = acceptShell();
        stream.write(`MRT-SFTP-READY\r\n${hostileShellOutput}\r\n`);
      });
      session.on('sftp', (acceptSftp: () => Ssh2FixtureSftp) => {
        fixtureEvents.push('sftp');
        if (!terminalClients.has(client)) activeFilesOnlyClient = client;
        startSftpFixture(acceptSftp(), remoteRoot, ssh2.utils.sftp, { readDelayMs: 700, writeDelayMs: 700, renameDelayMs: 500,
          readDelayForRequest: (path, offset) => path === '/home/mrt/interrupted.bin'
            ? stallInterruptedDownload && offset >= 1024 * 1024 ? 10_000 : 0
            : undefined,
          readDelayForPath: path => path === '/home/mrt/large.bin' ? 0 : 700,
          writeDelayForPath: path => path.endsWith('.partial') && stallInterruptedUpload ? 30_000 : largeDropUploadStarted ? 0 : 700,
          onUploadStart: path => {
            if (path.endsWith('.partial')) {
              sftpDropUploadStartCount++;
              largeDropUploadStarted = sftpDropUploadStartCount === 3;
              dropFixtureEvents.push('start');
            }
          },
          onRename: path => {
            const fileName = posix.basename(path);
            if (fileName === 'dragged-upload.txt' || fileName === 'dragged-upload-second.txt' || fileName === 'large-upload.bin') {
              dropFixtureEvents.push(`complete:${fileName}`);
            }
          }
        });
      });
    });
    });
  });
  server.on('connection', () => fixtureEvents.push('tcp-connection'));
  server.on('error', error => fixtureEvents.push(`server-error:${error.message}`));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  let listening = false;
  try {
    await mkdir(remoteRoot);
    await mkdir(downloadRoot);
    await mkdir(remoteScaleRoot);
    await Promise.all(Array.from({ length: 100 }, (_, index) => writeFile(join(remoteScaleRoot, `file-${String(index).padStart(3, '0')}.txt`), 'scale fixture')));
    await writePatternFile(largeRemoteFile, largeTransferSize, 0x5a);
    expectedLargeFileDigest = await hashFile(largeRemoteFile);
    await writePatternFile(interruptedRemoteFile, interruptedTransferSize, 0x28);
    await writePatternFile(largeDropUploadSource, largeTransferSize, 0x36);
    expectedLargeUploadDigest = await hashFile(largeDropUploadSource);
    await writeFile(uploadSource, 'private local upload payload');
    await Promise.all(dropUploadSources.map((path, index) => writeFile(path, dropUploadContents[index]!)));
    await writeFile(join(remoteRoot, 'remote.txt'), 'remote download payload');
    await writeFile(join(remoteRoot, 'editor.txt'), 'original remote text\r\nsecond line\n');
    await writeFile(join(remoteRoot, 'remote.zsh'), 'if true; then\n  echo remote\nfi\n');
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(0, '127.0.0.1', () => { listening = true; resolveListen(); });
    });
    app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`, '--mrt-e2e-ssh-credentials',
      '--mrt-e2e-sftp-transfers', '--mrt-e2e-file-drop', `--mrt-e2e-sftp-upload-file=${uploadSource}`, `--mrt-e2e-sftp-download-root=${downloadRoot}`],
      env: { ...electronEnvironment(), MRT_E2E: '1' } });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('The loopback SSH fixture did not bind a TCP address');
    const page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    const shellRequestsBeforeSftp = fixtureEvents.filter(event => event === 'shell').length;
    await page.getByRole('button', { name: 'Connect to SFTP files', exact: true }).first().click();
    const sftpDialog = page.getByRole('dialog', { name: 'Connect to SFTP files' });
    await sftpDialog.getByLabel('Host name or IP address').fill('127.0.0.1');
    const sftpPort = sftpDialog.getByLabel('Port');
    await sftpPort.fill(String(address.port));
    await expect(sftpPort).toHaveValue(String(address.port));
    await sftpDialog.getByRole('button', { name: 'Connect', exact: true }).click();
    const trust = page.getByRole('dialog', { name: 'Verify this SSH host' });
    await expect(trust, `Fixture events: ${fixtureEvents.join(', ')}. Page: ${await page.locator('body').innerText()}`).toBeVisible({ timeout: 15_000 });
    await trust.getByRole('button', { name: 'Trust key and connect' }).click();

    const sftpTab = page.getByRole('tab').filter({ hasText: /SFTP/ }).first();
    await expect(sftpTab).toBeVisible({ timeout: 20_000 });
    const sftpPanelId = await sftpTab.getAttribute('aria-controls');
    if (!sftpPanelId) throw new Error('Missing standalone SFTP file panel');
    const sftpPanel = page.locator(`#${sftpPanelId}`);
    await expect(sftpPanel.getByTestId('remote-file-browser').getByText('remote.txt', { exact: true })).toBeVisible({ timeout: 15_000 });
    const remoteFileList = sftpPanel.locator('.remote-file-list');
    await remoteFileList.getByRole('button', { name: 'Open folder scale', exact: true }).click();
    await expect(remoteFileList).toHaveAttribute('aria-label', 'Items in /home/mrt/scale');
    await expect.poll(() => remoteFileList.evaluate(element => element.clientHeight)).toBeGreaterThan(0);
    await expect(remoteFileList.locator('li[data-virtual-index]').first()).toHaveAttribute('data-virtual-index', '0');
    const initiallyRenderedFiles = await remoteFileList.locator('li[data-virtual-index]').count();
    expect(initiallyRenderedFiles).toBeGreaterThan(0);
    expect(initiallyRenderedFiles).toBeLessThan(100);
    const remoteForwardProbe = await focusVirtualizedListBoundary(remoteFileList, 'last');
    expect(remoteForwardProbe.focused).toBe(true);
    await page.keyboard.press('Tab');
    await expect.poll(() => page.evaluate(() => Number(document.activeElement?.closest('[data-virtual-index]')?.getAttribute('data-virtual-index'))))
      .toBe(remoteForwardProbe.index + 1);
    await remoteFileList.evaluate(element => { element.scrollTop = 1_200; });
    await expect.poll(() => remoteFileList.locator('li[data-virtual-index]').first().getAttribute('data-virtual-index'))
      .not.toBe('0');
    const remoteReverseProbe = await focusVirtualizedListBoundary(remoteFileList, 'first');
    expect(remoteReverseProbe.focused).toBe(true);
    await page.keyboard.press('Shift+Tab');
    await expect.poll(() => page.evaluate(() => Number(document.activeElement?.closest('[data-virtual-index]')?.getAttribute('data-virtual-index'))))
      .toBe(remoteReverseProbe.index - 1);
    await remoteFileList.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(remoteFileList.locator('li[data-virtual-index]').last()).toHaveAttribute('data-virtual-index', '99');
    await remoteFileList.evaluate(element => { element.scrollTop = 0; });
    await expect(remoteFileList.locator('li[data-virtual-index]').first()).toHaveAttribute('data-virtual-index', '0');
    await sftpPanel.getByRole('button', { name: 'Open parent folder', exact: true }).click();
    await expect(remoteFileList).toHaveAttribute('aria-label', 'Items in /home/mrt');
    await sftpPanel.getByRole('button', { name: 'Download large.bin', exact: true }).click();
    await expect(sftpPanel.getByText('Downloaded large.bin (100 MB).', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => hashFile(join(downloadRoot, 'large.bin')).catch(() => undefined), { timeout: 30_000 })
      .toEqual(expectedLargeFileDigest);
    await sftpPanel.getByRole('button', { name: 'Download remote.txt', exact: true }).click();
    await expect(sftpPanel.getByText(/Downloaded remote.txt/u)).toBeVisible({ timeout: 15_000 });
    expect(await readFile(join(downloadRoot, 'remote.txt'), 'utf8')).toBe('remote download payload');
    const editButton = sftpPanel.getByRole('button', { name: 'Edit editor.txt', exact: true });
    await editButton.click();
    const editor = page.getByRole('dialog', { name: 'editor.txt' });
    const editorText = editor.getByRole('textbox', { name: 'File contents' });
    await expect(editor.getByRole('status')).toContainText('Reading file', { timeout: 15_000 });
    const editorClose = editor.getByRole('button', { name: 'Close', exact: true });
    await expect(editorClose).toBeDisabled();
    await editor.getByRole('button', { name: 'Cancel request', exact: true }).click();
    await expect(editorClose).toBeEnabled({ timeout: 15_000 });
    await editorClose.click();
    await expect(editor).toHaveCount(0);
    await expect(editButton).toBeEnabled({ timeout: 15_000 });
    await editButton.click();
    await expect(editorText).toHaveValue('original remote text\nsecond line\n');
    await expect(editor.getByRole('note')).toHaveText('Mixed line endings will be normalized to CRLF when you save.');
    await editorText.fill('edited from app\nsecond line\n');
    await editor.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(editor.getByRole('alert')).toContainText('Discard your unsaved changes?');
    await expect(editor.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
    await editor.getByRole('button', { name: 'Keep editing', exact: true }).click();
    await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(editorClose).toBeDisabled();
    await expect(editor.getByRole('status')).toContainText('Finishing save', { timeout: 15_000 });
    await expect(editorClose).toBeDisabled();
    await expect(editor.getByRole('status')).toContainText('Saved', { timeout: 15_000 });
    await expect(editor.getByRole('alert')).toHaveCount(0);
    expect(await readFile(join(remoteRoot, 'editor.txt'), 'utf8')).toBe('edited from app\r\nsecond line\r\n');
    await expect(editor.getByRole('note')).toHaveCount(0);

    await editor.getByRole('button', { name: 'Reload', exact: true }).click();
    await expect(editorText).toHaveValue('edited from app\nsecond line\n');
    await editorText.fill('draft kept on conflict\nsecond line\n');
    await writeFile(join(remoteRoot, 'editor.txt'), 'remote changed!\r\nsecond line\r\n');
    await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(editor.getByRole('alert')).toContainText('remote file changed', { timeout: 15_000 });
    await expect(editorText).toHaveValue('draft kept on conflict\nsecond line\n');
    await editor.getByRole('button', { name: 'Reload', exact: true }).click();
    await editor.getByRole('button', { name: 'Discard and reload', exact: true }).click();
    await expect(editorText).toHaveValue('remote changed!\nsecond line\n');
    await editor.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(editor).toHaveCount(0);
    const remoteSyntaxEdit = sftpPanel.getByRole('button', { name: 'Edit remote.zsh', exact: true });
    await remoteSyntaxEdit.click();
    const remoteSyntaxEditor = page.getByRole('dialog', { name: 'remote.zsh' });
    await expect(remoteSyntaxEditor.getByLabel('Syntax profile')).toHaveValue('auto');
    await expect(remoteSyntaxEditor.locator('[data-token-kind="shell-keyword"]').first()).toHaveText('if');
    await expect(remoteSyntaxEditor.locator('[data-token-kind="shell-command"]').first()).toHaveText('true');
    await remoteSyntaxEditor.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(remoteSyntaxEditor).toHaveCount(0);
    expect(fixtureEvents.filter(event => event === 'shell')).toHaveLength(shellRequestsBeforeSftp);

    await page.getByRole('button', { name: 'Save active session', exact: true }).click();
    const saveSftpDialog = page.getByRole('dialog', { name: 'Save active session' });
    await saveSftpDialog.getByLabel('Session name').fill('SFTP loopback');
    await saveSftpDialog.getByRole('button', { name: 'Save session', exact: true }).click();
    const savedSftp = page.getByRole('button', { name: 'Open SFTP loopback', exact: true });
    await expect(savedSftp).toBeVisible();
    await page.getByRole('button', { name: 'Close active file session' }).click();
    const closeSftpDialog = page.getByRole('alertdialog');
    await closeSftpDialog.getByRole('button', { name: 'Close session' }).click();
    await savedSftp.click();
    const reopenedSftpTab = page.getByRole('tab').filter({ hasText: 'SFTP loopback' });
    await expect(reopenedSftpTab).toBeVisible({ timeout: 20_000 });
    const reopenedSftpPanelId = await reopenedSftpTab.getAttribute('aria-controls');
    if (!reopenedSftpPanelId) throw new Error('Missing reopened standalone SFTP panel');
    await expect(page.locator(`#${reopenedSftpPanelId} [data-testid="remote-file-browser"]`).getByText('remote.txt', { exact: true }))
      .toBeVisible({ timeout: 15_000 });
    expect(fixtureEvents.filter(event => event === 'shell')).toHaveLength(shellRequestsBeforeSftp);

    const reopenedSftpPanel = page.locator(`#${reopenedSftpPanelId}`);
    const reopenedRemoteBrowser = reopenedSftpPanel.getByTestId('remote-file-browser');
    const stagedFilesBeforeInterruptedDownload = (await readDirectory(downloadRoot)).filter(name => name.startsWith('.mrt-'));
    expect(stagedFilesBeforeInterruptedDownload).toEqual([]);
    await reopenedRemoteBrowser.getByRole('button', { name: 'Download interrupted.bin', exact: true }).click();
    const interruptedDownloadStagingFiles = async () => {
      const stagedFiles = (await readDirectory(downloadRoot)).filter(name => name.startsWith('.mrt-'));
      return Promise.all(stagedFiles.map(async name => ({ name, size: (await statFile(join(downloadRoot, name))).size })));
    };
    await expect.poll(async () => (await interruptedDownloadStagingFiles()).some(file => file.size > 0), { timeout: 15_000 }).toBe(true);
    const partialDownloadFiles = await interruptedDownloadStagingFiles();
    expect(partialDownloadFiles).toHaveLength(1);
    expect(partialDownloadFiles[0]?.size).toBeGreaterThan(0);
    expect(partialDownloadFiles[0]?.size).toBeLessThan(interruptedTransferSize);
    const interruptedClient = activeFilesOnlyClient;
    const interruptedSocket = (interruptedClient as unknown as { readonly _sock?: Socket } | undefined)?._sock;
    if (!interruptedSocket || interruptedSocket.destroyed) throw new Error('The SFTP files-only fixture has no live socket to reset');
    interruptedSocket.resetAndDestroy();
    await expect(reopenedRemoteBrowser.getByRole('button', { name: 'Reconnect to SFTP server', exact: true }))
      .toBeVisible({ timeout: 15_000 });
    expect(await statFile(join(downloadRoot, 'interrupted.bin')).then(() => true, () => false)).toBe(false);
    expect((await readDirectory(downloadRoot)).some(name => name.startsWith('.mrt-'))).toBe(false);

    stallInterruptedDownload = false;
    await reopenedRemoteBrowser.getByRole('button', { name: 'Reconnect to SFTP server', exact: true }).click();
    const reconnectSftpDialog = page.getByRole('dialog', { name: 'Connect to SFTP files' });
    await expect(reconnectSftpDialog.getByLabel('Host name or IP address')).toHaveValue('127.0.0.1');
    await reconnectSftpDialog.getByRole('button', { name: 'Connect', exact: true }).click();
    const recoveredSftpTab = page.getByRole('tab').filter({ hasText: 'SFTP loopback' }).last();
    await expect(recoveredSftpTab).toBeVisible({ timeout: 20_000 });
    const recoveredSftpPanelId = await recoveredSftpTab.getAttribute('aria-controls');
    if (!recoveredSftpPanelId) throw new Error('Missing recovered standalone SFTP panel');
    const recoveredSftpPanel = page.locator(`#${recoveredSftpPanelId}`);
    const recoveredRemoteBrowser = recoveredSftpPanel.getByTestId('remote-file-browser');
    await expect(recoveredRemoteBrowser.getByText('interrupted.bin', { exact: true })).toBeVisible({ timeout: 15_000 });
    await recoveredRemoteBrowser.getByRole('button', { name: 'Download interrupted.bin', exact: true }).click();
    await expect(recoveredRemoteBrowser.getByText('Downloaded interrupted.bin (4 MB).', { exact: true })).toBeVisible({ timeout: 15_000 });
    expect(await hashFile(join(downloadRoot, 'interrupted.bin'))).toEqual(await hashFile(interruptedRemoteFile));
    expect(fixtureEvents.filter(event => event === 'shell')).toHaveLength(shellRequestsBeforeSftp);

    await writeFile(interruptedUploadSource, interruptedUploadContents);
    stallInterruptedUpload = true;
    await dispatchFileDrop(page, [interruptedUploadSource], `#${recoveredSftpPanelId} [data-testid="remote-file-browser"]`);
    const interruptedRemoteUploadStages = async () => Promise.all((await readDirectory(remoteRoot))
      .filter(name => name.startsWith('.mrt-') && name.endsWith('.partial'))
      .map(async name => ({ name, size: (await statFile(join(remoteRoot, name))).size })));
    await expect.poll(async () => (await interruptedRemoteUploadStages()).some(file => file.size > 0), { timeout: 15_000 }).toBe(true);
    const interruptedRemoteStages = await interruptedRemoteUploadStages();
    expect(interruptedRemoteStages).toHaveLength(1);
    expect(interruptedRemoteStages[0]?.size).toBeGreaterThan(0);
    expect(interruptedRemoteStages[0]?.size).toBeLessThan(interruptedUploadContents.length);
    const interruptedUploadClient = activeFilesOnlyClient;
    const interruptedUploadSocket = (interruptedUploadClient as unknown as { readonly _sock?: Socket } | undefined)?._sock;
    if (!interruptedUploadSocket || interruptedUploadSocket.destroyed) throw new Error('The SFTP upload fixture has no live socket to reset');
    interruptedUploadSocket.resetAndDestroy();
    await expect(recoveredRemoteBrowser.getByRole('button', { name: 'Reconnect to SFTP server', exact: true }))
      .toBeVisible({ timeout: 15_000 });
    expect(await statFile(interruptedUploadTarget).then(() => true, () => false)).toBe(false);
    expect((await interruptedRemoteUploadStages()).length).toBe(1);

    stallInterruptedUpload = false;
    await recoveredRemoteBrowser.getByRole('button', { name: 'Reconnect to SFTP server', exact: true }).click();
    const reconnectUploadDialog = page.getByRole('dialog', { name: 'Connect to SFTP files' });
    await expect(reconnectUploadDialog.getByLabel('Host name or IP address')).toHaveValue('127.0.0.1');
    await reconnectUploadDialog.getByRole('button', { name: 'Connect', exact: true }).click();
    const uploadRecoveredSftpTab = page.getByRole('tab').filter({ hasText: 'SFTP loopback' }).last();
    await expect(uploadRecoveredSftpTab).toBeVisible({ timeout: 20_000 });
    const uploadRecoveredSftpPanelId = await uploadRecoveredSftpTab.getAttribute('aria-controls');
    if (!uploadRecoveredSftpPanelId) throw new Error('Missing SFTP panel after interrupted-upload recovery');
    const uploadRecoveredRemoteBrowser = page.locator(`#${uploadRecoveredSftpPanelId} [data-testid="remote-file-browser"]`);
    await expect(uploadRecoveredRemoteBrowser.getByText('interrupted.bin', { exact: true })).toBeVisible({ timeout: 15_000 });
    expect(await interruptedRemoteUploadStages()).toEqual([]);
    expect(await statFile(interruptedUploadTarget).then(() => true, () => false)).toBe(false);
    await dispatchFileDrop(page, [interruptedUploadSource], `#${uploadRecoveredSftpPanelId} [data-testid="remote-file-browser"]`);
    await expect.poll(async () => readFile(interruptedUploadTarget).then(data => data.equals(interruptedUploadContents), () => false),
      { timeout: 30_000 }).toBe(true);
    expect(await interruptedRemoteUploadStages()).toEqual([]);

    await page.getByRole('button', { name: 'Connect to SSH', exact: true }).first().click();
    const sshDialog = page.getByRole('dialog', { name: 'Connect to an SSH server' });
    const sshHost = sshDialog.getByLabel('Host name or IP address');
    const sshPort = sshDialog.getByLabel('Port');
    await expect(sshHost).toBeFocused();
    await sshHost.fill('127.0.0.1');
    await sshPort.fill(String(address.port));
    await expect(sshHost).toHaveValue('127.0.0.1');
    await expect(sshPort).toHaveValue(String(address.port));
    await sshDialog.getByRole('button', { name: 'Connect', exact: true }).click();
    const sshTab = page.getByRole('tab').filter({ hasText: /SSH/ }).first();
    await expect(sshTab).toBeVisible({ timeout: 20_000 });
    const sshPanelId = await sshTab.getAttribute('aria-controls');
    if (!sshPanelId) throw new Error('Missing SSH terminal panel');
    const sshPanel = page.locator(`#${sshPanelId}`);
    await expect(sshPanel.locator('.xterm-rows')).toContainText('MRT-SFTP-READY', { timeout: 10_000 });
    await expect(sshPanel.locator('.xterm-rows')).toContainText('__mrtRemoteOutputExecuted', { timeout: 10_000 });
    const hostileOutputResult = await sshPanel.locator('.terminal-host').evaluate(host => {
      const globals = globalThis as unknown as Record<string, unknown>;
      return { executed: globals.__mrtRemoteOutputExecuted === true, images: host.querySelectorAll('img').length,
        process: typeof globals.process, require: typeof globals.require };
    });
    expect(hostileOutputResult).toEqual({ executed: false, images: 0, process: 'undefined', require: 'undefined' });
    expect(await statFile(hostileOutputPath).then(() => true, () => false)).toBe(false);
    const contextualFiles = sshPanel.locator('[data-testid="remote-file-browser"]');
    await expect(contextualFiles.getByText('remote.txt', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(contextualFiles).toHaveAttribute('data-mrt-remote-file-drop-target', 'true');
    await rm(join(downloadRoot, 'interrupted.bin'), { force: true });
    stallInterruptedDownload = true;
    await contextualFiles.getByRole('button', { name: 'Download interrupted.bin', exact: true }).click();
    await expect(contextualFiles.getByText('Downloading interrupted.bin', { exact: true })).toBeAttached({ timeout: 15_000 });
    const contextualDownloadStagingFiles = async () => Promise.all((await readDirectory(downloadRoot))
      .filter(name => name.startsWith('.mrt-')).map(async name => ({ name, size: (await statFile(join(downloadRoot, name))).size })));
    await expect.poll(async () => (await contextualDownloadStagingFiles()).some(file => file.size > 0), { timeout: 15_000 }).toBe(true);

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const paneSettings = page.getByRole('dialog', { name: 'Workbench settings' });
    const showSftpPane = paneSettings.getByRole('checkbox', { name: 'Show the remote file pane beside SSH terminals' });
    await expect(showSftpPane).toBeChecked();
    await showSftpPane.uncheck();
    await paneSettings.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(paneSettings.getByText('Settings saved.', { exact: true })).toBeVisible();
    await paneSettings.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(contextualFiles).toHaveCount(1);
    await expect(contextualFiles).toBeHidden();
    await expect(sshPanel.locator('.terminal-panel-layout')).not.toHaveClass(/with-remote-files/u);
    await expect(uploadRecoveredRemoteBrowser).toHaveCount(1);
    await expect(contextualFiles.getByText('Downloading interrupted.bin', { exact: true })).toBeAttached();
    await expect.poll(async () => (await contextualDownloadStagingFiles()).some(file => file.size > 0), { timeout: 15_000 }).toBe(true);

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const restoredPaneSettings = page.getByRole('dialog', { name: 'Workbench settings' });
    const restoredShowSftpPane = restoredPaneSettings.getByRole('checkbox', { name: 'Show the remote file pane beside SSH terminals' });
    await expect(restoredShowSftpPane).not.toBeChecked();
    await restoredShowSftpPane.check();
    await restoredPaneSettings.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(restoredPaneSettings.getByText('Settings saved.', { exact: true })).toBeVisible();
    await restoredPaneSettings.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(contextualFiles.getByText('remote.txt', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(sshPanel.locator('.terminal-panel-layout')).toHaveClass(/with-remote-files/u);
    await expect(contextualFiles.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
    await contextualFiles.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(contextualFiles.getByText('Download cancelled.', { exact: true })).toBeVisible({ timeout: 15_000 });
    expect(await statFile(join(downloadRoot, 'interrupted.bin')).then(() => true, () => false)).toBe(false);
    expect((await readDirectory(downloadRoot)).some(name => name.startsWith('.mrt-'))).toBe(false);
    stallInterruptedDownload = false;

    dropFixtureEvents.length = 0;
    sftpDropUploadStartCount = 0;
    largeDropUploadStarted = false;
    await dispatchFileDrop(page, [...dropUploadSources, largeDropUploadSource], `#${sshPanelId} [data-testid="remote-file-browser"]`);
    await expect.poll(() => [...dropFixtureEvents], { timeout: 120_000 }).toEqual([
      'start', 'complete:dragged-upload.txt', 'start', 'complete:dragged-upload-second.txt',
      'start', 'complete:large-upload.bin'
    ]);
    expect(await readFile(join(remoteRoot, 'dragged-upload.txt'))).toEqual(dropUploadContents[0]);
    expect(await readFile(join(remoteRoot, 'dragged-upload-second.txt'))).toEqual(dropUploadContents[1]);
    expect(await hashFile(join(remoteRoot, 'large-upload.bin'))).toEqual(expectedLargeUploadDigest);
    await expect(contextualFiles.getByText(/Uploaded large-upload\.bin/u)).toBeVisible({ timeout: 15_000 });

    await contextualFiles.getByRole('button', { name: 'Upload file', exact: true }).click();
    await expect(contextualFiles.getByText(/Uploaded upload.txt/u)).toBeVisible({ timeout: 15_000 });
    expect(await readFile(join(remoteRoot, 'upload.txt'), 'utf8')).toBe('private local upload payload');

    await contextualFiles.getByRole('button', { name: 'Download upload.txt', exact: true }).click();
    await expect(contextualFiles.getByText(/Downloaded upload.txt/u)).toBeVisible({ timeout: 15_000 });
    expect(await readFile(join(downloadRoot, 'upload.txt'), 'utf8')).toBe('private local upload payload');
  } finally {
    for (const client of clients) client.end();
    if (listening) await new Promise<void>(resolveClose => server.close(() => resolveClose()));
    await app?.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('a lost SSH transport fails its tab cleanly and allows explicit saved-profile reconnect', async () => {
  test.skip(process.platform !== 'win32', 'Run the SSH credential and recovery acceptance on Windows');
  test.setTimeout(90_000);
  const profile = await mkdtemp(join(tmpdir(), 'mrt-ssh-recovery-e2e-'));
  const ssh2 = createRequire(resolve('apps/desktop/package.json'))('ssh2') as Ssh2FixturePackage;
  const keyPair = ssh2.utils.generateKeyPairSync('ed25519');
  const clients = new Set<Ssh2FixtureClient>();
  const fixtureErrors: string[] = [];
  let terminalClient: Ssh2FixtureClient | undefined;
  let shellCount = 0;
  const server = new ssh2.Server({ hostKeys: [keyPair.private] }, rawClient => {
    const client = rawClient as Ssh2FixtureClient;
    clients.add(client);
    client.once('close', () => clients.delete(client));
    client.on('error', error => fixtureErrors.push(error.message));
    client.on('authentication', (rawContext: unknown) => {
      const context = rawContext as Ssh2AuthenticationContext;
      if (context.method === 'password' && context.username === 'mrt-e2e-user' && context.password === 'sftp-e2e-secret') context.accept();
      else context.reject();
    });
    client.on('ready', () => client.on('session', (acceptSession: () => Ssh2FixtureSession) => {
      const session = acceptSession();
      session.on('pty', (accept: () => void) => accept());
      session.on('shell', (acceptShell: () => Ssh2FixtureStream) => {
        terminalClient = client;
        shellCount += 1;
        acceptShell().write(`MRT-SSH-RECOVERY-${shellCount}\r\n`);
      });
    }));
  });
  server.on('error', error => fixtureErrors.push(error.message));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  let listening = false;
  try {
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(0, '127.0.0.1', () => { listening = true; resolveListen(); });
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('The SSH recovery fixture did not bind a loopback port');
    app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`, '--mrt-e2e-ssh-credentials'],
      env: { ...electronEnvironment(), MRT_E2E: '1' } });
    const page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Connect to SSH', exact: true }).first().click();
    const connectDialog = page.getByRole('dialog', { name: 'Connect to an SSH server' });
    await connectDialog.getByLabel('Host name or IP address').fill('127.0.0.1');
    await connectDialog.getByLabel('Port').fill(String(address.port));
    await connectDialog.getByRole('button', { name: 'Connect', exact: true }).click();
    const trustDialog = page.getByRole('dialog', { name: 'Verify this SSH host' });
    await expect(trustDialog, `Fixture errors: ${fixtureErrors.join(', ')}; page: ${await page.locator('body').innerText()}`).toBeVisible({ timeout: 15_000 });
    await trustDialog.getByRole('button', { name: 'Trust key and connect' }).click();

    const sshTab = page.getByRole('tab').filter({ hasText: /SSH/ }).first();
    await expect(sshTab).toBeVisible({ timeout: 20_000 });
    const panelId = await sshTab.getAttribute('aria-controls');
    if (!panelId) throw new Error('Missing SSH recovery terminal panel');
    const sshPanel = page.locator(`#${panelId}`);
    await expect(sshPanel.locator('.xterm-rows')).toContainText('MRT-SSH-RECOVERY-1', { timeout: 15_000 });

    const savedName = 'Recoverable SSH profile';
    await page.getByRole('button', { name: 'Save active session', exact: true }).click();
    const saveDialog = page.getByRole('dialog', { name: 'Save active session' });
    await saveDialog.getByLabel('Session name').fill(savedName);
    await saveDialog.getByRole('button', { name: 'Save session', exact: true }).click();
    const reopenButton = page.getByRole('button', { name: `Open ${savedName}`, exact: true });
    await expect(reopenButton).toBeVisible();
    await page.getByRole('button', { name: `Actions for saved session ${savedName}` }).click();
    await page.getByRole('button', { name: 'Save password…', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'A password is saved with Windows account protection' }))
      .toContainText('A password is saved with Windows account protection');
    expect(await app.evaluate(() => Reflect.get(globalThis, '__mrtE2ESshCredentialPromptCount'))).toBe(2);

    const liveClient = terminalClient;
    // The pinned ssh2 fixture exposes the accepted TCP socket internally; resetAndDestroy models a link failure, while client.end() is a graceful SSH disconnect.
    const transportSocket = (liveClient as unknown as { readonly _sock?: Socket } | undefined)?._sock;
    if (!transportSocket || transportSocket.destroyed) throw new Error('The SSH fixture has no live socket to reset');
    transportSocket.resetAndDestroy();
    await expect(sshTab.locator('.state-dot')).toHaveClass(/(?:^|\s)failed(?:\s|$)/u, { timeout: 15_000 });
    await expect(page.getByRole('alert')).toContainText('UNAVAILABLE');

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    let settings = page.getByRole('dialog', { name: 'Workbench settings' });
    await expect(settings.getByText('Status: Unlocked')).toBeVisible();
    await settings.getByRole('button', { name: 'Lock credentials', exact: true }).click();
    await expect(settings.getByText('Status: Locked')).toBeVisible();
    await settings.getByRole('button', { name: 'Close', exact: true }).click();
    await reopenButton.click();
    await expect(page.getByRole('alert')).toContainText('credential vault is locked');
    expect(shellCount).toBe(1);
    expect(await app.evaluate(() => Reflect.get(globalThis, '__mrtE2ESshCredentialPromptCount'))).toBe(2);

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    settings = page.getByRole('dialog', { name: 'Workbench settings' });
    await expect(settings.getByText('Status: Locked')).toBeVisible();
    await settings.getByRole('button', { name: 'Unlock credentials', exact: true }).click();
    await expect(settings.getByText('Status: Unlocked')).toBeVisible();
    await settings.getByRole('button', { name: 'Close', exact: true }).click();
    await reopenButton.click();
    const reopenedTab = page.getByRole('tab', { name: savedName, exact: true });
    await expect(reopenedTab).toBeVisible({ timeout: 20_000 });
    const reopenedPanelId = await reopenedTab.getAttribute('aria-controls');
    if (!reopenedPanelId) throw new Error('The reopened SSH profile has no terminal panel');
    const reopenedPanel = page.locator(`#${reopenedPanelId}`);
    await expect(reopenedPanel.locator('.xterm-rows')).toContainText('MRT-SSH-RECOVERY-2', { timeout: 15_000 });
    await expect(reopenedTab.locator('.state-dot')).toHaveClass(/(?:^|\s)running(?:\s|$)/u);
    expect(shellCount).toBe(2);
    expect(await app.evaluate(() => Reflect.get(globalThis, '__mrtE2ESshCredentialPromptCount'))).toBe(2);
  } finally {
    for (const client of clients) client.end();
    await app?.close();
    if (listening) await new Promise<void>(resolveClose => server.close(() => resolveClose()));
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('SSH credentials stay out of renderer output, saved storage, exports and application console', async () => {
  test.skip(process.platform !== 'win32', 'Credential-boundary acceptance runs on Windows');
  test.setTimeout(90_000);
  const profile = await mkdtemp(join(tmpdir(), 'mrt-ssh-secret-boundary-'));
  const bundlePath = join(profile, 'audit.mrt-session-folder.json');
  const secret = 'sftp-e2e-secret';
  const ssh2 = createRequire(resolve('apps/desktop/package.json'))('ssh2') as Ssh2FixturePackage;
  const keyPair = ssh2.utils.generateKeyPairSync('ed25519');
  let acceptedPasswordAttempts = 0;
  const server = new ssh2.Server({ hostKeys: [keyPair.private] }, rawClient => {
    const client = rawClient as Ssh2FixtureClient;
    client.on('authentication', (rawContext: unknown) => {
      const context = rawContext as Ssh2AuthenticationContext;
      if (context.method === 'password' && context.username === 'mrt-e2e-user' && context.password === secret) {
        acceptedPasswordAttempts += 1;
        context.accept();
      } else context.reject();
    });
    client.on('ready', () => client.on('session', (acceptSession: () => Ssh2FixtureSession) => {
      const session = acceptSession();
      session.on('pty', (accept: () => void) => accept());
      session.on('shell', (acceptShell: () => Ssh2FixtureStream) => acceptShell().write('MRT-SECRET-BOUNDARY-READY\r\n'));
    }));
  });
  const mainConsoleMessages: string[] = [];
  const rendererConsoleMessages: string[] = [];
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  let listening = false;
  try {
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(0, '127.0.0.1', () => { listening = true; resolveListen(); });
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('The credential-boundary fixture did not bind a TCP address');
    app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`, '--mrt-e2e-ssh-credentials'],
      env: { ...electronEnvironment(), MRT_E2E: '1' } });
    app.on('console', message => mainConsoleMessages.push(message.text()));
    const page = await app.firstWindow();
    page.on('console', message => rendererConsoleMessages.push(message.text()));
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Connect to SSH', exact: true }).first().click();
    const connectDialog = page.getByRole('dialog', { name: 'Connect to an SSH server' });
    await connectDialog.getByLabel('Host name or IP address').fill('127.0.0.1');
    await connectDialog.getByLabel('Port').fill(String(address.port));
    await connectDialog.getByRole('button', { name: 'Connect', exact: true }).click();
    const trustDialog = page.getByRole('dialog', { name: 'Verify this SSH host' });
    await expect(trustDialog).toBeVisible({ timeout: 15_000 });
    await trustDialog.getByRole('button', { name: 'Trust key and connect' }).click();
    const sshTab = page.getByRole('tab').filter({ hasText: /SSH/ }).first();
    await expect(sshTab).toBeVisible({ timeout: 20_000 });
    const panelId = await sshTab.getAttribute('aria-controls');
    if (!panelId) throw new Error('Missing credential-boundary SSH terminal panel');
    await expect(page.locator(`#${panelId} .xterm-rows`)).toContainText('MRT-SECRET-BOUNDARY-READY', { timeout: 15_000 });
    expect(acceptedPasswordAttempts).toBe(1);
    expect(await page.locator('body').innerText()).not.toContain(secret);

    const savedName = 'Boundary profile';
    await page.getByRole('button', { name: 'Save active session', exact: true }).click();
    const saveDialog = page.getByRole('dialog', { name: 'Save active session' });
    await saveDialog.getByLabel('Session name').fill(savedName);
    await saveDialog.getByRole('button', { name: 'Save session', exact: true }).click();
    await expect(page.getByRole('button', { name: `Open ${savedName}`, exact: true })).toBeVisible();
    await page.getByRole('button', { name: `Actions for saved session ${savedName}` }).click();
    await page.getByRole('button', { name: 'Save password…', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'A password is saved with Windows account protection' }))
      .toContainText('A password is saved with Windows account protection');
    expect(await app.evaluate(() => Reflect.get(globalThis, '__mrtE2ESshCredentialPromptCount'))).toBe(2);
    await page.getByRole('button', { name: `Open ${savedName}`, exact: true }).click();
    const savedProfileTab = page.getByRole('tab', { name: savedName, exact: true });
    await expect(savedProfileTab).toBeVisible({ timeout: 20_000 });
    const savedProfilePanelId = await savedProfileTab.getAttribute('aria-controls');
    if (!savedProfilePanelId) throw new Error('Missing saved-credential SSH terminal panel');
    await expect(page.locator(`#${savedProfilePanelId} .xterm-rows`)).toContainText('MRT-SECRET-BOUNDARY-READY', { timeout: 15_000 });
    expect(acceptedPasswordAttempts).toBe(2);
    expect(await app.evaluate(() => Reflect.get(globalThis, '__mrtE2ESshCredentialPromptCount'))).toBe(2);
    expect(await page.locator('body').innerText()).not.toContain(secret);
    await page.getByRole('button', { name: '+ Folder', exact: true }).click();
    const folderDialog = page.getByRole('dialog', { name: 'Create folder' });
    await folderDialog.getByLabel('Folder name').fill('Audit');
    await folderDialog.getByRole('button', { name: 'Create folder', exact: true }).click();
    await page.getByRole('button', { name: `Actions for saved session ${savedName}` }).click();
    await page.getByRole('button', { name: `Move saved session ${savedName}`, exact: true }).click();
    const moveDialog = page.getByRole('dialog', { name: `Move ${savedName}` });
    await moveDialog.getByLabel('Move to').selectOption({ label: 'Audit' });
    await moveDialog.getByRole('button', { name: 'Move', exact: true }).click();
    await app.evaluate(({ dialog: nativeDialog }, filePath) => {
      Object.defineProperty(nativeDialog, 'showSaveDialog', { configurable: true,
        value: async () => ({ canceled: false, filePath }) });
    }, bundlePath);
    await page.getByRole('button', { name: 'Actions for folder Audit' }).click();
    await page.getByRole('button', { name: 'Export folder Audit', exact: true }).click();
    await expect(page.locator('.alert-strip > span')).toContainText('Exported 1 folder and 1 saved session.');
    const bundleText = await readFile(bundlePath, 'utf8');
    expect(bundleText).not.toContain(secret);
    expect(bundleText).not.toMatch(/password|credential|privateKey/i);
    expect(await page.locator('body').innerText()).not.toContain(secret);
    expect(rendererConsoleMessages.join('\n')).not.toContain(secret);
    expect(pageErrors).toEqual([]);

    await app.close();
    app = undefined;
    expect(mainConsoleMessages.join('\n')).not.toContain(secret);
    const database = new DatabaseSync(join(profile, 'multiremote-terminal.sqlite'), { readOnly: true });
    try {
      const saved = database.prepare('SELECT id, kind, name, host, port, username, credential_ref, options_json FROM session_definitions WHERE name = ?')
        .get(savedName) as Record<string, unknown> | undefined;
      expect(saved).toMatchObject({ kind: 'ssh', name: savedName, host: '127.0.0.1', port: address.port, username: null });
      expect(saved?.credential_ref).toMatch(/^[0-9a-f-]{36}$/i);
      expect(JSON.stringify(saved)).not.toContain(secret);
    } finally { database.close(); }

    const pendingDirectories = [profile];
    while (pendingDirectories.length > 0) {
      const directory = pendingDirectories.pop();
      if (!directory) continue;
      for (const entry of await readDirectory(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        expect(entry.name).not.toContain(secret);
        if (entry.isDirectory()) pendingDirectories.push(path);
        else if (entry.isFile()) expect((await readFile(path)).includes(Buffer.from(secret, 'utf8')), path).toBe(false);
      }
    }
  } finally {
    await app?.close();
    if (listening) await new Promise<void>(resolveClose => server.close(() => resolveClose()));
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('a Windows session-lock event blocks safeStorage credential access until explicit vault unlock', async () => {
  test.skip(process.platform !== 'win32', 'Exercise the Windows safeStorage vault and lock event on Windows');
  test.setTimeout(45_000);
  const profile = await mkdtemp(join(tmpdir(), 'mrt-vault-lock-e2e-'));
  const reference = randomUUID();
  const secret = `MRT-E2E-VAULT-${randomUUID()}`;
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    app = await launchVaultE2EApp(profile);
    const page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await waitForVaultE2EProbe(app);

    const result = await app.evaluate(async ({ app: electronApp, powerMonitor }, { credentialReference, credentialSecret }) => {
      const probe = (globalThis as typeof globalThis & { __mrtE2EVaultProbe?: VaultE2EProbe }).__mrtE2EVaultProbe;
      if (!probe) throw new Error('The guarded main-process vault probe is unavailable');

      await probe.store(credentialReference, credentialSecret);
      const resolvedBeforeLock = await probe.resolve(credentialReference);

      // This synthetic Electron event exercises the registered lock handler; it is not a physical Windows session lock.
      powerMonitor.emit('lock-screen');
      const lockedState = probe.getState();
      let lockedResolutionKind: string | undefined;
      try {
        await probe.resolve(credentialReference);
      } catch (error) {
        lockedResolutionKind = typeof error === 'object' && error !== null && 'kind' in error
          ? String(error.kind) : undefined;
      }

      await probe.unlock();
      const unlockedState = probe.getState();
      const resolvedAfterUnlock = await probe.resolve(credentialReference);
      return { userDataPath: electronApp.getPath('userData'), resolvedBeforeLock, lockedState, lockedResolutionKind,
        unlockedState, resolvedAfterUnlock };
    }, { credentialReference: reference, credentialSecret: secret });

    expect(result.resolvedBeforeLock).toBe(secret);
    expect(result.lockedState).toBe('locked');
    expect(result.lockedResolutionKind).toBe('locked');
    expect(result.unlockedState).toBe('available');
    expect(result.resolvedAfterUnlock).toBe(secret);
    const encryptedVault = await readFile(join(result.userDataPath, 'credentials.json'), 'utf8');
    expect(encryptedVault).not.toContain(secret);
  } finally {
    await app?.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('Windows safeStorage vault credentials survive an application restart without plaintext storage', async () => {
  test.skip(process.platform !== 'win32', 'Exercise persisted Windows safeStorage credentials on Windows');
  test.setTimeout(60_000);
  const profile = await mkdtemp(join(tmpdir(), 'mrt-vault-restart-e2e-'));
  const reference = randomUUID();
  const secret = `MRT-E2E-VAULT-RESTART-${randomUUID()}`;
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    app = await launchVaultE2EApp(profile);
    let page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await waitForVaultE2EProbe(app);
    const firstRun = await app.evaluate(async ({ app: electronApp }, { credentialReference, credentialSecret }) => {
      const probe = (globalThis as typeof globalThis & { __mrtE2EVaultProbe?: VaultE2EProbe }).__mrtE2EVaultProbe;
      if (!probe) throw new Error('The guarded main-process vault probe is unavailable');
      await probe.store(credentialReference, credentialSecret);
      return { state: probe.getState(), userDataPath: electronApp.getPath('userData') };
    }, { credentialReference: reference, credentialSecret: secret });
    expect(firstRun.state).toBe('available');
    const firstVault = await readFile(join(firstRun.userDataPath, 'credentials.json'), 'utf8');
    expect(firstVault).not.toContain(secret);

    await app.close();
    app = await launchVaultE2EApp(profile);
    page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await waitForVaultE2EProbe(app);
    const secondRun = await app.evaluate(async ({ app: electronApp }, credentialReference) => {
      const probe = (globalThis as typeof globalThis & { __mrtE2EVaultProbe?: VaultE2EProbe }).__mrtE2EVaultProbe;
      if (!probe) throw new Error('The guarded main-process vault probe is unavailable');
      return { state: probe.getState(), userDataPath: electronApp.getPath('userData'),
        resolvedSecret: await probe.resolve(credentialReference) };
    }, reference);
    expect(secondRun.state).toBe('available');
    expect(secondRun.userDataPath).toBe(firstRun.userDataPath);
    expect(secondRun.resolvedSecret).toBe(secret);
    const reopenedVault = await readFile(join(secondRun.userDataPath, 'credentials.json'), 'utf8');
    expect(reopenedVault).not.toContain(secret);
  } finally {
    await app?.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('Windows master-password vault converts, locks after restart, unlocks through its KDF worker, and supports explicit reset', async () => {
  test.skip(process.platform !== 'win32', 'Exercise the master-password vault and Electron utility process on Windows');
  test.setTimeout(180_000);
  const profile = await mkdtemp(join(tmpdir(), 'mrt-master-vault-e2e-'));
  const reference = randomUUID();
  const secret = `MRT-E2E-MASTER-VAULT-${randomUUID()}`;
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    app = await launchVaultE2EApp(profile, true);
    let page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await waitForVaultE2EProbe(app);
    const firstRun = await app.evaluate(async ({ app: electronApp }, { credentialReference, credentialSecret }) => {
      const probe = (globalThis as typeof globalThis & { __mrtE2EVaultProbe?: VaultE2EProbe }).__mrtE2EVaultProbe;
      if (!probe) throw new Error('The guarded main-process vault probe is unavailable');
      await probe.store(credentialReference, credentialSecret);
      return { userDataPath: electronApp.getPath('userData') };
    }, { credentialReference: reference, credentialSecret: secret });

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    let settings = page.getByRole('dialog', { name: 'Workbench settings' });
    await expect(settings.getByText('Protection: Windows account')).toBeVisible();
    await settings.getByRole('button', { name: 'Use a master password' }).click();
    await expect(settings.getByText('Protection: Master password')).toBeVisible({ timeout: 60_000 });
    await expect(settings.getByRole('status')).toHaveText('Status: Unlocked');
    const masterVault = await readFile(join(firstRun.userDataPath, 'credentials.json'), 'utf8');
    expect(masterVault).not.toContain(secret);
    expect(masterVault).not.toContain('mrt-e2e-master-password-v1');
    expect(JSON.parse(masterVault).mode).toBe('master-password');

    await app.close();
    app = await launchVaultE2EApp(profile, true);
    page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await expect.poll(() => vaultE2EProbeState(app!)).toBe('locked');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    settings = page.getByRole('dialog', { name: 'Workbench settings' });
    await expect(settings.getByText('Protection: Master password')).toBeVisible();
    await expect(settings.getByRole('status')).toHaveText('Status: Locked');
    await page.screenshot({ path: 'test-results/master-password-vault-settings.png' });
    await settings.getByRole('button', { name: 'Unlock credentials' }).click();
    await expect(settings.getByRole('status')).toHaveText('Status: Unlocked', { timeout: 60_000 });
    const resolved = await app.evaluate(async (_electron, credentialReference) => {
      const probe = (globalThis as typeof globalThis & { __mrtE2EVaultProbe?: VaultE2EProbe }).__mrtE2EVaultProbe;
      if (!probe) throw new Error('The guarded main-process vault probe is unavailable');
      return probe.resolve(credentialReference);
    }, reference);
    expect(resolved).toBe(secret);

    await settings.getByRole('button', { name: 'Lock credentials' }).click();
    await expect(settings.getByRole('status')).toHaveText('Status: Locked');
    page.once('dialog', dialog => { void dialog.accept(); });
    await settings.getByRole('button', { name: 'Delete saved passwords' }).click();
    await expect(settings.getByText('Protection: Windows account')).toBeVisible();
    await expect(settings.getByRole('status')).toHaveText('Status: Locked');
    await settings.getByRole('button', { name: 'Unlock credentials' }).click();
    await expect(settings.getByRole('status')).toHaveText('Status: Unlocked');
    const resetOutcome = await app.evaluate(async (_electron, credentialReference) => {
      const probe = (globalThis as typeof globalThis & { __mrtE2EVaultProbe?: VaultE2EProbe }).__mrtE2EVaultProbe;
      if (!probe) throw new Error('The guarded main-process vault probe is unavailable');
      try { await probe.resolve(credentialReference); return 'resolved'; }
      catch (error) { return typeof error === 'object' && error !== null && 'kind' in error ? String(error.kind) : 'failed'; }
    }, reference);
    expect(resetOutcome).toBe('not-found');
    const resetVault = await readFile(join(firstRun.userDataPath, 'credentials.json'), 'utf8');
    expect(JSON.parse(resetVault)).toEqual({ version: 2, mode: 'windows-account', entries: {} });
  } finally {
    await app?.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('Windows master-password vault restores into a different app profile after explicit unlock', async () => {
  test.skip(process.platform !== 'win32', 'Exercise master-password profile restore and the Electron KDF utility process on Windows');
  test.setTimeout(180_000);
  const sourceProfile = await mkdtemp(join(tmpdir(), 'mrt-master-vault-source-'));
  const restoredProfile = await mkdtemp(join(tmpdir(), 'mrt-master-vault-restored-'));
  const reference = randomUUID();
  const secret = `MRT-E2E-RESTORED-MASTER-VAULT-${randomUUID()}`;
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    app = await launchVaultE2EApp(sourceProfile, true);
    let page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await waitForVaultE2EProbe(app);
    const sourceUserDataPath = await app.evaluate(async ({ app: electronApp }, { credentialReference, credentialSecret }) => {
      const probe = (globalThis as typeof globalThis & { __mrtE2EVaultProbe?: VaultE2EProbe }).__mrtE2EVaultProbe;
      if (!probe) throw new Error('The guarded main-process vault probe is unavailable');
      await probe.store(credentialReference, credentialSecret);
      return electronApp.getPath('userData');
    }, { credentialReference: reference, credentialSecret: secret });
    expect(sourceUserDataPath).toBe(sourceProfile);

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const sourceSettings = page.getByRole('dialog', { name: 'Workbench settings' });
    await sourceSettings.getByRole('button', { name: 'Use a master password' }).click();
    await expect(sourceSettings.getByText('Protection: Master password')).toBeVisible({ timeout: 60_000 });
    const sourceVault = await readFile(join(sourceUserDataPath, 'credentials.json'));
    expect(sourceVault.toString('utf8')).not.toContain(secret);
    expect(JSON.parse(sourceVault.toString('utf8')).mode).toBe('master-password');

    await app.close();
    app = undefined;
    await writeFile(join(restoredProfile, 'credentials.json'), sourceVault);
    app = await launchVaultE2EApp(restoredProfile, true);
    page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await expect.poll(() => vaultE2EProbeState(app!)).toBe('locked');
    const restoredUserDataPath = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
    expect(restoredUserDataPath).toBe(restoredProfile);
    expect(restoredUserDataPath).not.toBe(sourceUserDataPath);
    const beforeUnlock = await app.evaluate(async (_electron, credentialReference) => {
      const probe = (globalThis as typeof globalThis & { __mrtE2EVaultProbe?: VaultE2EProbe }).__mrtE2EVaultProbe;
      if (!probe) throw new Error('The guarded main-process vault probe is unavailable');
      try { await probe.resolve(credentialReference); return 'resolved'; }
      catch (error) { return typeof error === 'object' && error !== null && 'kind' in error ? String(error.kind) : 'failed'; }
    }, reference);
    expect(beforeUnlock).toBe('locked');

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const restoredSettings = page.getByRole('dialog', { name: 'Workbench settings' });
    await expect(restoredSettings.getByText('Protection: Master password')).toBeVisible();
    await expect(restoredSettings.getByRole('status')).toHaveText('Status: Locked');
    await restoredSettings.getByRole('button', { name: 'Unlock credentials' }).click();
    await expect(restoredSettings.getByRole('status')).toHaveText('Status: Unlocked', { timeout: 60_000 });
    const restoredSecret = await app.evaluate(async (_electron, credentialReference) => {
      const probe = (globalThis as typeof globalThis & { __mrtE2EVaultProbe?: VaultE2EProbe }).__mrtE2EVaultProbe;
      if (!probe) throw new Error('The guarded main-process vault probe is unavailable');
      return probe.resolve(credentialReference);
    }, reference);
    expect(restoredSecret).toBe(secret);
    const restoredVault = await readFile(join(restoredUserDataPath, 'credentials.json'), 'utf8');
    expect(restoredVault).not.toContain(secret);
    expect(JSON.parse(restoredVault).mode).toBe('master-password');
  } finally {
    await app?.close();
    await rm(sourceProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    await rm(restoredProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('SSH saved-profile jump routes verify every hop and clean up one- and two-gateway chains', async () => {
  test.setTimeout(120_000);
  const profile = await mkdtemp(join(tmpdir(), 'mrt-ssh-route-e2e-'));
  const ssh2 = createRequire(resolve('apps/desktop/package.json'))('ssh2') as Ssh2FixturePackage;
  const clients = new Set<Ssh2FixtureClient>();
  const relaySockets = new Set<Socket>();
  const fixtureEvents: string[] = [];
  const servers: Array<{ readonly name: string; readonly server: Ssh2FixtureServer; address?: AddressInfo }> = [];
  const createFixture = (name: string, target: boolean): Ssh2FixtureServer => {
    const keyPair = ssh2.utils.generateKeyPairSync('ed25519');
    const server = new ssh2.Server({ hostKeys: [keyPair.private] }, rawClient => {
      const client = rawClient as Ssh2FixtureClient;
      clients.add(client);
      client.once('close', () => clients.delete(client));
      client.on('error', error => fixtureEvents.push(`${name}:client-error:${error.message}`));
      client.on('authentication', (rawContext: unknown) => {
        const context = rawContext as Ssh2AuthenticationContext;
        fixtureEvents.push(`${name}:auth:${context.username}`);
        if (context.method === 'password' && context.username === 'mrt-e2e-user' && context.password === 'sftp-e2e-secret') context.accept();
        else context.reject();
      });
      client.on('ready', () => {
        fixtureEvents.push(`${name}:authenticated`);
        if (!target) client.on('tcpip', (acceptChannel: () => Duplex, rejectChannel: () => void, rawInfo: unknown) => {
          const info = rawInfo as { readonly destIP: string; readonly destPort: number };
          if (info.destIP !== '127.0.0.1' || !servers.some(item => item.address?.port === info.destPort)) {
            fixtureEvents.push(`${name}:rejected:${info.destIP}:${info.destPort}`);
            rejectChannel();
            return;
          }
          const channel = acceptChannel();
          const socket = connectTcp(info.destPort, '127.0.0.1');
          relaySockets.add(socket);
          socket.once('close', () => relaySockets.delete(socket));
          const closeRelay = (): void => {
            if (!socket.destroyed) socket.destroy();
            if (!channel.destroyed) channel.destroy();
          };
          socket.once('error', error => { fixtureEvents.push(`${name}:relay-error:${error.message}`); closeRelay(); });
          socket.once('close', closeRelay);
          channel.once('error', closeRelay);
          channel.once('close', closeRelay);
          socket.once('connect', () => fixtureEvents.push(`${name}:relay:${info.destPort}`));
          channel.pipe(socket).pipe(channel);
        });
        if (target) client.on('session', (acceptSession: () => Ssh2FixtureSession) => {
          const session = acceptSession();
          session.on('pty', (accept: () => void) => accept());
          session.on('shell', (acceptShell: () => Ssh2FixtureStream) => {
            fixtureEvents.push(`${name}:shell`);
            acceptShell().write('MRT-JUMP-TARGET-READY\r\n');
          });
        });
      });
    });
    server.on('error', error => fixtureEvents.push(`${name}:server-error:${error.message}`));
    servers.push({ name, server });
    return server;
  };
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    createFixture('gateway-one', false);
    createFixture('gateway-two', false);
    createFixture('target', true);
    for (const fixture of servers) {
      await new Promise<void>((resolveListen, rejectListen) => {
        fixture.server.once('error', rejectListen);
        fixture.server.listen(0, '127.0.0.1', () => {
          const address = fixture.server.address();
          if (!address || typeof address === 'string') { rejectListen(new Error(`${fixture.name} did not bind a loopback port`)); return; }
          fixture.address = address;
          resolveListen();
        });
      });
    }
    const gatewayOnePort = servers[0]?.address?.port;
    const gatewayTwoPort = servers[1]?.address?.port;
    const targetPort = servers[2]?.address?.port;
    if (!gatewayOnePort || !gatewayTwoPort || !targetPort) throw new Error('The SSH route fixture did not expose all ports');

    app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`, '--mrt-e2e-ssh-credentials'],
      env: { ...electronEnvironment(), MRT_E2E: '1' } });
    const page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    const profileIds = await page.evaluate(async ports => {
      const replies = await Promise.all([
        window.multiRemoteTerminal.createSavedSession({ kind: 'ssh', name: 'Gateway one', host: '127.0.0.1', port: ports.gatewayOne }),
        window.multiRemoteTerminal.createSavedSession({ kind: 'ssh', name: 'Gateway two', host: '127.0.0.1', port: ports.gatewayTwo }),
        window.multiRemoteTerminal.createSavedSession({ kind: 'ssh', name: 'Target profile', host: '127.0.0.1', port: ports.target })
      ]);
      const ids: string[] = [];
      for (const reply of replies) {
        if (!reply.ok) throw new Error(`Could not create a route fixture profile (${reply.error.code})`);
        ids.push(reply.result.id);
      }
      return ids;
    }, { gatewayOne: gatewayOnePort, gatewayTwo: gatewayTwoPort, target: targetPort });
    expect(profileIds).toHaveLength(3);
    await page.reload();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });

    const openRoute = async (secondGateway: boolean): Promise<void> => {
      await page.getByRole('button', { name: 'Actions for saved session Target profile' }).click();
      await page.getByRole('button', { name: 'Connect Target profile through gateways' }).click();
      const dialog = page.getByRole('dialog', { name: 'Connect Target profile through gateways' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel('SSH gateway 1')).toBeFocused();
      await expect(dialog.getByLabel('Host name or IP address')).toBeDisabled();
      await dialog.getByLabel('SSH gateway 1').selectOption(profileIds[0]!);
      if (secondGateway) await dialog.getByLabel('SSH gateway 2 (optional)').selectOption(profileIds[1]!);
      await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
      const trustPorts = secondGateway ? [gatewayOnePort, gatewayTwoPort, targetPort] : [];
      for (let trustIndex = 0; trustIndex < trustPorts.length; trustIndex += 1) {
        const trust = page.getByRole('dialog', { name: 'Verify this SSH host' });
        await expect(trust).toBeVisible({ timeout: 15_000 });
        await expect(trust.locator('.ssh-host-facts')).toContainText(`127.0.0.1:${trustPorts[trustIndex]}`);
        await trust.getByRole('button', { name: 'Trust key and connect' }).click();
      }
      const tab = page.getByRole('tab').filter({ hasText: 'Target profile' }).last();
      await expect(tab).toBeVisible({ timeout: 25_000 });
      const panelId = await tab.getAttribute('aria-controls');
      if (!panelId) throw new Error('Missing routed SSH terminal panel');
      await expect(page.locator(`#${panelId} .xterm-rows`)).toContainText('MRT-JUMP-TARGET-READY', { timeout: 15_000 });
      await confirmCloseActiveTerminal(page, secondGateway ? 'Gateway one → Gateway two → Target profile' : 'Gateway one → Target profile');
    };
    const waitForRelayCleanup = async (): Promise<void> => {
      try { await expect.poll(() => relaySockets.size).toBe(0); }
      catch (error) {
        const remaining = [...relaySockets].map(socket => ({ localPort: socket.localPort, remotePort: socket.remotePort,
          destroyed: socket.destroyed, readableEnded: socket.readableEnded, writableEnded: socket.writableEnded }));
        throw new Error(`${error instanceof Error ? error.message : 'Relay cleanup timed out'}\nRemaining route relays: ${JSON.stringify(remaining)}`);
      }
    };

    await openRoute(true);
    await expect.poll(() => fixtureEvents.filter(event => event.endsWith(':shell')).length).toBe(1);
    expect(fixtureEvents).toContain('gateway-one:relay:' + gatewayTwoPort);
    expect(fixtureEvents).toContain('gateway-two:relay:' + targetPort);
    expect(fixtureEvents.filter(event => event === 'gateway-one:authenticated')).toHaveLength(1);
    expect(fixtureEvents.filter(event => event === 'gateway-two:authenticated')).toHaveLength(1);
    expect(fixtureEvents.filter(event => event === 'target:authenticated')).toHaveLength(1);
    await expect.poll(() => clients.size).toBe(0);
    await waitForRelayCleanup();

    await openRoute(false);
    await expect.poll(() => fixtureEvents.filter(event => event.endsWith(':shell')).length).toBe(2);
    expect(fixtureEvents).toContain('gateway-one:relay:' + targetPort);
    expect(fixtureEvents.filter(event => event === 'gateway-two:authenticated')).toHaveLength(1);
    await expect.poll(() => clients.size).toBe(0);
    await waitForRelayCleanup();
  } finally {
    await app?.close();
    for (const client of clients) client.end();
    for (const socket of relaySockets) socket.destroy();
    for (const fixture of servers) await new Promise<void>(resolveClose => fixture.server.close(() => resolveClose()));
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('saved SSH profiles start loopback forwards, relay traffic and restore stopped tunnels after restart', async () => {
  test.setTimeout(120_000);
  const profile = await mkdtemp(join(tmpdir(), 'mrt-ssh-forward-e2e-'));
  const ssh2 = createRequire(resolve('apps/desktop/package.json'))('ssh2') as Ssh2FixturePackage;
  const keyPair = ssh2.utils.generateKeyPairSync('ed25519');
  const clients = new Set<Ssh2FixtureClient>();
  const remoteBindings = new Map<Ssh2FixtureClient, Map<number, Server>>();
  const remoteBindRequests: string[] = [];
  const targetSockets = new Set<Socket>();
  const fixtureEvents: string[] = [];
  let bytesReceivedByTarget = 0;
  const targetServer = createServer(socket => {
    targetSockets.add(socket);
    socket.once('close', () => targetSockets.delete(socket));
    socket.on('error', () => {});
    socket.on('data', data => {
      bytesReceivedByTarget += data.length;
      socket.write(Buffer.concat([Buffer.from('MRT-FORWARDED:'), data]));
    });
  });
  const forwardRemoteTraffic = (boundPort: number, payload: string): Promise<string> => new Promise((resolvePayload, rejectPayload) => {
    const socket = connectTcp(boundPort, '127.0.0.1');
    let received = '';
    const timer = setTimeout(() => {
      socket.destroy();
      rejectPayload(new Error(`Timed out waiting for remote-forwarded TCP data. Events: ${fixtureEvents.join(', ')}; target bytes: ${bytesReceivedByTarget}; target sockets: ${targetSockets.size}`));
    }, 10_000);
    socket.on('data', data => {
      received += data.toString('utf8');
      if (received.includes(`MRT-FORWARDED:${payload}`)) { clearTimeout(timer); resolvePayload(received); socket.destroy(); }
    });
    socket.once('error', error => { clearTimeout(timer); rejectPayload(error); });
    socket.once('connect', () => socket.write(Buffer.from(payload)));
  });
  const forwardSocksTraffic = (proxyPort: number, targetHost: string, targetPort: number, payload: string): Promise<string> =>
    new Promise((resolvePayload, rejectPayload) => {
      const socket = connectTcp(proxyPort, '127.0.0.1');
      let phase: 'method' | 'connect' | 'data' = 'method';
      let received = Buffer.alloc(0);
      let response = '';
      const timer = setTimeout(() => {
        socket.destroy();
        rejectPayload(new Error(`Timed out during dynamic SOCKS forwarding. Events: ${fixtureEvents.join(', ')}; target bytes: ${bytesReceivedByTarget}`));
      }, 10_000);
      const finish = (error?: Error): void => {
        clearTimeout(timer);
        if (error) rejectPayload(error);
      };
      socket.once('connect', () => socket.write(Buffer.from([5, 1, 0])));
      socket.on('data', chunk => {
        received = Buffer.concat([received, chunk]);
        if (phase === 'method' && received.length >= 2) {
          if (received[0] !== 5 || received[1] !== 0) { finish(new Error('SOCKS proxy did not select no-authentication')); socket.destroy(); return; }
          received = received.subarray(2);
          phase = 'connect';
          const host = Buffer.from(targetHost, 'ascii');
          socket.write(Buffer.concat([Buffer.from([5, 1, 0, 3, host.length]), host, Buffer.from([targetPort >> 8, targetPort & 0xff])]));
        }
        if (phase === 'connect' && received.length >= 10) {
          if (received[0] !== 5 || received[1] !== 0) { finish(new Error(`SOCKS CONNECT failed with reply ${received[1]}`)); socket.destroy(); return; }
          received = received.subarray(10);
          phase = 'data';
          socket.write(Buffer.from(payload));
        }
        if (phase === 'data') {
          response += received.toString('utf8');
          received = Buffer.alloc(0);
          if (response.includes(`MRT-FORWARDED:${payload}`)) { clearTimeout(timer); resolvePayload(response); socket.destroy(); }
        }
      });
      socket.once('error', error => finish(error));
    });
  const sshServer = new ssh2.Server({ hostKeys: [keyPair.private] }, rawClient => {
    const client = rawClient as Ssh2FixtureClient;
    clients.add(client);
    client.once('close', () => {
      clients.delete(client);
      for (const server of remoteBindings.get(client)?.values() ?? []) server.close();
      remoteBindings.delete(client);
    });
    client.on('error', error => fixtureEvents.push(`client-error:${error.message}`));
    client.on('authentication', (rawContext: unknown) => {
      const context = rawContext as Ssh2AuthenticationContext;
      if (context.method === 'password' && context.username === 'mrt-e2e-user' && context.password === 'sftp-e2e-secret') context.accept();
      else context.reject();
    });
    client.on('ready', () => {
      fixtureEvents.push('authenticated');
      client.on('request', (rawAccept: unknown, rawReject: unknown, name: string, rawInfo: unknown) => {
        const accept = typeof rawAccept === 'function' ? rawAccept as (port?: number) => void : undefined;
        const reject = typeof rawReject === 'function' ? rawReject as () => void : undefined;
        const info = rawInfo as { readonly bindAddr: string; readonly bindPort: number };
        if (name === 'tcpip-forward') {
          if (info.bindAddr !== '127.0.0.1') { reject?.(); return; }
          let assignedPort = info.bindPort;
          const server = createServer(remoteSocket => {
            const sourceAddress = remoteSocket.remoteAddress ?? '127.0.0.1';
            const sourcePort = remoteSocket.remotePort ?? 0;
            client.forwardOut('127.0.0.1', assignedPort, sourceAddress, sourcePort, (error, channel) => {
              if (error || !channel) { fixtureEvents.push(`remote-forwardOut-error:${error?.message ?? 'no channel'}`); remoteSocket.destroy(); return; }
              fixtureEvents.push(`remote-forwardOut-open:${assignedPort}`);
              remoteSocket.once('error', () => channel.destroy());
              channel.once('error', () => remoteSocket.destroy());
              channel.pipe(remoteSocket).pipe(channel);
            });
          });
          server.once('error', error => { fixtureEvents.push(`remote-listener-error:${error.message}`); reject?.(); });
          server.listen(info.bindPort, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') { server.close(); reject?.(); return; }
            const port = address.port;
            assignedPort = port;
            const ports = remoteBindings.get(client) ?? new Map<number, Server>();
            ports.set(port, server);
            remoteBindings.set(client, ports);
            remoteBindRequests.push(`${info.bindAddr}:${info.bindPort}`);
            if (info.bindPort === 0) accept?.(port);
            else accept?.();
          });
          return;
        }
        if (name === 'cancel-tcpip-forward') {
          const ports = remoteBindings.get(client);
          ports?.get(info.bindPort)?.close();
          ports?.delete(info.bindPort);
          accept?.();
          return;
        }
        reject?.();
      });
      client.on('session', (acceptSession: () => Ssh2FixtureSession) => {
        const session = acceptSession();
        session.on('pty', (accept: () => void) => accept());
        session.on('shell', (acceptShell: () => Ssh2FixtureStream) => {
          fixtureEvents.push('shell');
          acceptShell().write('MRT-FORWARD-READY\r\n');
        });
      });
      client.on('tcpip', (acceptChannel: () => Duplex, rejectChannel: () => void, rawInfo: unknown) => {
        const info = rawInfo as { readonly destIP: string; readonly destPort: number };
        const targetAddress = targetServer.address();
        if (!targetAddress || typeof targetAddress === 'string' || (info.destIP !== '127.0.0.1' && info.destIP !== 'localhost') || info.destPort !== targetAddress.port) {
          rejectChannel();
          return;
        }
        const isDomainDestination = info.destIP === 'localhost';
        fixtureEvents.push(isDomainDestination ? 'dynamic-direct-tcpip-domain' : 'direct-tcpip');
        const socket = connectTcp(info.destPort, isDomainDestination ? '127.0.0.1' : info.destIP);
        targetSockets.add(socket);
        socket.once('close', () => targetSockets.delete(socket));
        socket.once('error', error => {
          const code = 'code' in error && typeof error.code === 'string' ? error.code : 'unknown';
          fixtureEvents.push(`target-error:${code}`);
          rejectChannel();
        });
        socket.once('connect', () => {
          fixtureEvents.push('target-connected');
          const channel = acceptChannel();
          socket.once('error', () => channel.destroy());
          channel.once('error', () => socket.destroy());
          channel.pipe(socket).pipe(channel);
        });
      });
    });
  });

  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  let targetListening = false;
  let sshListening = false;
  try {
    await new Promise<void>((resolveListen, rejectListen) => {
      targetServer.once('error', rejectListen);
      targetServer.listen(0, '127.0.0.1', () => { targetListening = true; resolveListen(); });
    });
    await new Promise<void>((resolveListen, rejectListen) => {
      sshServer.once('error', rejectListen);
      sshServer.listen(0, '127.0.0.1', () => { sshListening = true; resolveListen(); });
    });
    const sshAddress = sshServer.address();
    const targetAddress = targetServer.address();
    if (!sshAddress || typeof sshAddress === 'string' || !targetAddress || typeof targetAddress === 'string') {
      throw new Error('The SSH forwarding fixture did not bind loopback addresses');
    }

    const launch = () => electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`, '--mrt-e2e-ssh-credentials'],
      env: { ...electronEnvironment(), MRT_E2E: '1' } });
    app = await launch();
    let page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Connect to SSH', exact: true }).first().click();
    const connectDialog = page.getByRole('dialog', { name: 'Connect to an SSH server' });
    await connectDialog.getByLabel('Host name or IP address').fill('127.0.0.1');
    await connectDialog.getByLabel('Port').fill(String(sshAddress.port));
    await connectDialog.getByRole('button', { name: 'Connect', exact: true }).click();
    const trustDialog = page.getByRole('dialog', { name: 'Verify this SSH host' });
    await expect(trustDialog).toBeVisible({ timeout: 15_000 });
    await trustDialog.getByRole('button', { name: 'Trust key and connect' }).click();
    const sshTab = page.getByRole('tab').filter({ hasText: /SSH/ }).first();
    await expect(sshTab).toBeVisible({ timeout: 20_000 });
    const sshPanelId = await sshTab.getAttribute('aria-controls');
    if (!sshPanelId) throw new Error('Missing SSH forwarding profile terminal');
    await expect(page.locator(`#${sshPanelId} .xterm-rows`)).toContainText('MRT-FORWARD-READY', { timeout: 10_000 });

    await page.getByRole('button', { name: 'Save active session', exact: true }).click();
    const saveProfileDialog = page.getByRole('dialog', { name: 'Save active session' });
    await saveProfileDialog.getByLabel('Session name').fill('Forwarding SSH profile');
    await saveProfileDialog.getByRole('button', { name: 'Save session', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open Forwarding SSH profile', exact: true })).toBeVisible();

    const shellCountBeforeForward = fixtureEvents.filter(event => event === 'shell').length;
    const openForwardingManager = page.getByRole('button', { name: 'Port forwarding', exact: true });
    await openForwardingManager.click();
    let manager = page.getByRole('dialog', { name: 'Port forwarding' });
    await expect(manager).toBeVisible();
    await expect(manager.getByRole('button', { name: 'Close port forwarding' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(manager.getByRole('button', { name: 'Save tunnel', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(manager).toHaveCount(0);
    await expect(openForwardingManager).toBeFocused();
    await openForwardingManager.click();
    manager = page.getByRole('dialog', { name: 'Port forwarding' });
    await expect(manager).toBeVisible();
    const tunnelNames = ['Local database forward', 'Secondary database forward', 'Tertiary database forward'];
    const localPorts: number[] = [];
    for (const [index, tunnelName] of tunnelNames.entries()) {
      await manager.getByRole('button', { name: '+ New tunnel' }).click();
      await manager.getByLabel('Tunnel name').fill(tunnelName);
      const profileSelect = manager.getByLabel('SSH profile');
      await expect(profileSelect).not.toHaveValue('');
      await manager.getByLabel('Local port').fill('0');
      await manager.getByLabel('Remote destination host').fill('127.0.0.1');
      await manager.getByLabel('Remote destination port').fill(String(targetAddress.port));
      await manager.getByRole('button', { name: 'Save tunnel', exact: true }).click();
      await expect(manager.getByRole('button', { name: new RegExp(tunnelName, 'u') })).toBeVisible();
      if (index === 0) {
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.setSize(700, 720));
        await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(720);
        await page.screenshot({ path: 'test-results/ssh-tunnel-manager-narrow.png', fullPage: true });
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.setSize(1200, 800));
        await expect.poll(() => page.evaluate(() => innerWidth)).toBeGreaterThan(720);
        await page.screenshot({ path: 'test-results/ssh-tunnel-manager.png', fullPage: true });
      }
      await manager.getByRole('button', { name: 'Start tunnel', exact: true }).click();
      const editor = manager.getByRole('region', { name: 'Tunnel settings' });
      const tunnelStatus = editor.getByRole('status');
      await expect(tunnelStatus).toContainText('Active', { timeout: 20_000 });
      const activeEndpoint = await tunnelStatus.locator('code').innerText();
      const portMatch = /^Local 127\.0\.0\.1:(\d+)/u.exec(activeEndpoint);
      expect(portMatch).not.toBeNull();
      const localPort = Number(portMatch?.[1]);
      expect(localPort).toBeGreaterThan(0);
      expect(activeEndpoint).toContain(`Remote 127.0.0.1:${targetAddress.port}`);
      localPorts.push(localPort);

      const payload = `payload-through-tunnel-${index + 1}`;
      const forwardedPayload = await new Promise<string>((resolvePayload, rejectPayload) => {
        const socket = connectTcp(localPort, '127.0.0.1');
        let received = Buffer.alloc(0);
        const timer = setTimeout(() => socket.destroy(new Error('Timed out waiting for forwarded TCP data')), 10_000);
        socket.once('connect', () => socket.end(Buffer.from(payload)));
        socket.on('data', chunk => { received = Buffer.concat([received, chunk]); });
        socket.once('end', () => { clearTimeout(timer); resolvePayload(received.toString('utf8')); });
        socket.once('error', error => { clearTimeout(timer); rejectPayload(error); });
      });
      expect(forwardedPayload, `Fixture events: ${fixtureEvents.join(', ')}; target bytes: ${bytesReceivedByTarget}`)
        .toBe(`MRT-FORWARDED:${payload}`);
    }
    expect(new Set(localPorts).size).toBe(3);
    for (const [index, localPort] of localPorts.entries()) {
      const payload = `simultaneous-through-tunnel-${index + 1}`;
      const forwardedPayload = await new Promise<string>((resolvePayload, rejectPayload) => {
        const socket = connectTcp(localPort, '127.0.0.1');
        let received = Buffer.alloc(0);
        const timer = setTimeout(() => socket.destroy(new Error('Timed out verifying simultaneous forwards')), 10_000);
        socket.once('connect', () => socket.end(Buffer.from(payload)));
        socket.on('data', chunk => { received = Buffer.concat([received, chunk]); });
        socket.once('end', () => { clearTimeout(timer); resolvePayload(received.toString('utf8')); });
        socket.once('error', error => { clearTimeout(timer); rejectPayload(error); });
      });
      expect(forwardedPayload, `Tunnel ${index + 1} stopped responding after all forwards were active`)
        .toBe(`MRT-FORWARDED:${payload}`);
    }
    expect(fixtureEvents.filter(event => event === 'direct-tcpip')).toHaveLength(6);
    expect(fixtureEvents.filter(event => event === 'shell')).toHaveLength(shellCountBeforeForward);

    const remoteTunnelName = 'Reverse API forward';
    await manager.getByRole('button', { name: '+ New tunnel' }).click();
    await manager.getByLabel('Tunnel name').fill(remoteTunnelName);
    await manager.getByLabel('Forward direction').selectOption('remote');
    await expect(manager.getByRole('note', { name: 'Remote forwarding exposure warning' })).toContainText('GatewayPorts');
    await manager.getByLabel('SSH profile').selectOption({ index: 1 });
    await manager.getByLabel('Remote port').fill('0');
    await manager.getByLabel('Local destination host').fill('127.0.0.1');
    await manager.getByLabel('Local destination port').fill(String(targetAddress.port));
    await manager.getByRole('button', { name: 'Save tunnel', exact: true }).click();
    await manager.getByRole('button', { name: new RegExp(remoteTunnelName, 'u') }).click();
    const remoteEditor = manager.getByRole('region', { name: 'Tunnel settings' });
    const remoteListItem = manager.getByRole('button', { name: new RegExp(remoteTunnelName, 'u') });
    await expect(remoteListItem).toContainText('Remote forward');
    await expect(remoteListItem).toContainText('SSH server 127.0.0.1:Auto → Local 127.0.0.1:');
    await page.screenshot({ path: 'test-results/ssh-remote-forward-manager.png', fullPage: true });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.setSize(700, 720));
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(720);
    await page.screenshot({ path: 'test-results/ssh-remote-forward-manager-narrow.png', fullPage: true });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.setSize(1200, 800));
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeGreaterThan(720);
    await remoteEditor.getByRole('button', { name: 'Start tunnel', exact: true }).click();
    const remoteStatus = remoteEditor.getByRole('status');
    await expect(remoteStatus).toContainText('Active', { timeout: 20_000 });
    const remoteEndpoint = await remoteStatus.locator('code').innerText();
    expect(remoteEndpoint).toContain(`Local 127.0.0.1:${targetAddress.port}`);
    const remotePortMatch = /SSH server 127\.0\.0\.1:(\d+)/u.exec(remoteEndpoint);
    expect(remotePortMatch).not.toBeNull();
    const remotePort = Number(remotePortMatch?.[1]);
    expect(remotePort).toBeGreaterThan(0);
    expect(remoteBindRequests.at(-1)).toBe('127.0.0.1:0');
    expect(await forwardRemoteTraffic(remotePort, 'reverse-forward-roundtrip')).toContain('MRT-FORWARDED:reverse-forward-roundtrip');
    expect(fixtureEvents).toContain(`remote-forwardOut-open:${remotePort}`);
    expect(fixtureEvents.filter(event => event === 'shell')).toHaveLength(shellCountBeforeForward);

    await remoteEditor.getByRole('button', { name: 'Stop tunnel', exact: true }).click();
    await expect(remoteStatus).toContainText('Stopped', { timeout: 15_000 });
    expect([...remoteBindings.values()].some(ports => ports.has(remotePort))).toBe(false);
    await remoteEditor.getByRole('button', { name: 'Start tunnel', exact: true }).click();
    await expect(remoteStatus).toContainText('Active', { timeout: 20_000 });
    const restartedEndpoint = await remoteStatus.locator('code').innerText();
    const restartedPortMatch = /SSH server 127\.0\.0\.1:(\d+)/u.exec(restartedEndpoint);
    expect(restartedPortMatch).not.toBeNull();
    const restartedRemotePort = Number(restartedPortMatch?.[1]);

    const dynamicTunnelName = 'SOCKS browser proxy';
    await manager.getByRole('button', { name: '+ New tunnel' }).click();
    await manager.getByLabel('Tunnel name').fill(dynamicTunnelName);
    await manager.getByLabel('Forward direction').selectOption('dynamic');
    await expect(manager.getByLabel('Local SOCKS5 port')).toBeVisible();
    await expect(manager.getByLabel('Remote destination host')).toHaveCount(0);
    await manager.getByLabel('Local SOCKS5 port').fill('0');
    await manager.getByRole('button', { name: 'Save tunnel', exact: true }).click();
    const dynamicItem = manager.getByRole('button', { name: new RegExp(dynamicTunnelName, 'u') });
    await expect(dynamicItem).toContainText('SOCKS5 proxy');
    await dynamicItem.click();
    const dynamicEditor = manager.getByRole('region', { name: 'Tunnel settings' });
    await page.screenshot({ path: 'test-results/ssh-dynamic-socks-manager.png', fullPage: true });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.setSize(700, 720));
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(720);
    await page.screenshot({ path: 'test-results/ssh-dynamic-socks-manager-narrow.png', fullPage: true });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.setSize(1200, 800));
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeGreaterThan(720);
    await dynamicEditor.getByRole('button', { name: 'Start tunnel', exact: true }).click();
    const dynamicStatus = dynamicEditor.getByRole('status');
    await expect(dynamicStatus).toContainText('Active', { timeout: 20_000 });
    const dynamicEndpoint = await dynamicStatus.locator('code').innerText();
    const dynamicPortMatch = /SOCKS5 proxy 127\.0\.0\.1:(\d+)/u.exec(dynamicEndpoint);
    expect(dynamicPortMatch).not.toBeNull();
    const socksPort = Number(dynamicPortMatch?.[1]);
    expect(socksPort).toBeGreaterThan(0);
    expect(await forwardSocksTraffic(socksPort, 'localhost', targetAddress.port, 'dynamic-socks-roundtrip'))
      .toContain('MRT-FORWARDED:dynamic-socks-roundtrip');
    expect(fixtureEvents).toContain('dynamic-direct-tcpip-domain');
    expect(fixtureEvents.filter(event => event === 'shell')).toHaveLength(shellCountBeforeForward);
    localPorts.push(socksPort);

    await app.close();
    app = undefined;
    expect([...remoteBindings.values()].some(ports => ports.has(restartedRemotePort))).toBe(false);
    for (const localPort of localPorts) {
      const releasedPortError = await new Promise<Error | undefined>(resolveConnection => {
        const socket = connectTcp(localPort, '127.0.0.1');
        socket.once('connect', () => { socket.destroy(); resolveConnection(undefined); });
        socket.once('error', error => resolveConnection(error));
      });
      expect(releasedPortError && 'code' in releasedPortError ? releasedPortError.code : undefined).toBe('ECONNREFUSED');
    }

    app = await launch();
    page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Open Forwarding SSH profile', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Port forwarding', exact: true }).click();
    const restoredManager = page.getByRole('dialog', { name: 'Port forwarding' });
    for (const tunnelName of tunnelNames) {
      const savedTunnel = restoredManager.getByRole('button', { name: new RegExp(tunnelName, 'u') });
      await expect(savedTunnel).toBeVisible();
      await savedTunnel.click();
      await expect(restoredManager.getByRole('region', { name: 'Tunnel settings' }).getByRole('status')).toContainText('Stopped');
    }
    const restoredRemote = restoredManager.getByRole('button', { name: new RegExp(remoteTunnelName, 'u') });
    await expect(restoredRemote).toBeVisible();
    await restoredRemote.click();
    await expect(restoredManager.getByRole('region', { name: 'Tunnel settings' }).getByRole('status')).toContainText('Stopped');
    const restoredDynamic = restoredManager.getByRole('button', { name: new RegExp(dynamicTunnelName, 'u') });
    await expect(restoredDynamic).toBeVisible();
    await restoredDynamic.click();
    await expect(restoredManager.getByRole('region', { name: 'Tunnel settings' }).getByRole('status')).toContainText('Stopped');
    expect(fixtureEvents.filter(event => event === 'shell')).toHaveLength(shellCountBeforeForward);
  } finally {
    await app?.close();
    for (const client of clients) client.end();
    for (const socket of targetSockets) socket.destroy();
    if (sshListening) await new Promise<void>(resolveClose => sshServer.close(() => resolveClose()));
    if (targetListening) await new Promise<void>(resolveClose => targetServer.close(() => resolveClose()));
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('Windows serial terminal uses the utility worker mock and supports terminal tab actions', async () => {
  test.skip(process.platform !== 'win32', 'Electron serial addon acceptance evidence is required on Windows');
  test.setTimeout(75_000);
  const profile = await mkdtemp(join(tmpdir(), 'mrt-serial-e2e-'));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`, '--mrt-e2e-serial-mock'],
      env: { ...electronEnvironment(), MRT_E2E: '1' } });
    const page = await app.firstWindow();
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Connect to serial port', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Connect to a serial port' });
    const portSelect = dialog.getByLabel('Port');
    await expect(portSelect.locator('option[value="COM4095"]')).toHaveCount(1, { timeout: 15_000 });
    await portSelect.selectOption('COM4095');
    await expect(dialog.getByLabel('Baud rate')).toHaveValue('9600');
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click();

    const serialTab = page.getByRole('tab').filter({ hasText: 'COM4095 · 9600 baud · Serial' });
    await expect(serialTab).toBeVisible({ timeout: 15_000 });
    const panelId = await serialTab.getAttribute('aria-controls');
    if (!panelId) throw new Error('Missing serial terminal panel');
    const panel = page.locator(`#${panelId}`);
    await expect(panel.locator('.xterm-rows')).toContainText('MRT serial mock ready', { timeout: 10_000 });
    await panel.locator('.terminal-host').click({ position: { x: 80, y: 60 } });
    await page.keyboard.type('MRT-SERIAL-ECHO');
    await expect(panel.locator('.xterm-rows')).toContainText('MRT-SERIAL-ECHO', { timeout: 10_000 });

    await serialTab.click({ button: 'right' });
    await expect(page.getByRole('menu', { name: /Terminal actions for COM4095/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Clear terminal' })).toBeVisible();
    await page.keyboard.press('Escape');
    await serialTab.click({ button: 'middle' });
    const closeDialog = page.getByRole('alertdialog', { name: /Close COM4095/ });
    await expect(closeDialog).toBeVisible();
    await closeDialog.getByRole('button', { name: 'Keep terminal' }).click();
    await serialTab.click();
    await page.keyboard.press('Control+W');
    await expect(closeDialog).toBeVisible();
    await closeDialog.getByRole('button', { name: 'Close terminal' }).click();
    await expect(serialTab).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await app?.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('serial profiles persist across restart and round-trip through saved-folder JSON', async () => {
  test.skip(process.platform !== 'win32', 'Electron serial addon acceptance evidence is required on Windows');
  test.setTimeout(120_000);
  const sourceProfile = await mkdtemp(join(tmpdir(), 'mrt-serial-profile-source-'));
  const targetProfile = await mkdtemp(join(tmpdir(), 'mrt-serial-profile-target-'));
  const bundleDirectory = await mkdtemp(join(tmpdir(), 'mrt-serial-profile-bundle-'));
  const bundlePath = join(bundleDirectory, 'serial.mrt-session-folder.json');
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${sourceProfile}`, '--mrt-e2e-serial-mock'],
      env: { ...electronEnvironment(), MRT_E2E: '1' } });
    let page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Connect to serial port', exact: true }).first().click();
    let dialog = page.getByRole('dialog', { name: 'Connect to a serial port' });
    await expect(dialog.getByLabel('Port').locator('option[value="COM4095"]')).toHaveCount(1, { timeout: 15_000 });
    await dialog.getByLabel('Port').selectOption('COM4095');
    await dialog.getByLabel('Baud rate').fill('115200');
    await dialog.getByLabel('Data bits').selectOption('7');
    await dialog.getByLabel('Parity').selectOption('even');
    await dialog.getByLabel('Stop bits').selectOption('1.5');
    await dialog.getByLabel('Flow control').selectOption('rtscts');
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
    const serialTab = page.getByRole('tab').filter({ hasText: 'COM4095 · 115200 baud · Serial' });
    await expect(serialTab).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Save active session', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Save active session' });
    await dialog.getByLabel('Session name').fill('Serial controller');
    await dialog.getByRole('button', { name: 'Save session', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open Serial controller', exact: true })).toBeVisible();

    await page.getByRole('button', { name: '+ Folder', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Create folder' });
    await dialog.getByLabel('Folder name').fill('Hardware');
    await dialog.getByRole('button', { name: 'Create folder', exact: true }).click();
    await page.getByRole('button', { name: 'Actions for saved session Serial controller' }).click();
    await page.getByRole('button', { name: 'Move saved session Serial controller', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Move Serial controller' });
    await dialog.getByLabel('Move to').selectOption({ label: 'Hardware' });
    await dialog.getByRole('button', { name: 'Move', exact: true }).click();

    await app.evaluate(({ dialog: nativeDialog }, filePath) => {
      Object.defineProperty(nativeDialog, 'showSaveDialog', { configurable: true,
        value: async () => ({ canceled: false, filePath }) });
    }, bundlePath);
    await page.getByRole('button', { name: 'Actions for folder Hardware' }).click();
    await page.getByRole('button', { name: 'Export folder Hardware', exact: true }).click();
    await expect(page.locator('.alert-strip > span')).toContainText('Exported 1 folder and 1 saved session.');
    const bundle = JSON.parse(await readFile(bundlePath, 'utf8')) as { version?: unknown; sessions?: readonly { kind?: unknown; configuration?: unknown }[] };
    expect(bundle.version).toBe(6);
    expect(bundle.sessions).toHaveLength(1);
    expect(bundle.sessions?.[0]).toMatchObject({ kind: 'serial', configuration: {
      path: 'COM4095', baudRate: 115200, dataBits: 7, parity: 'even', stopBits: 1.5, flowControl: 'rtscts'
    } });
    expect(JSON.stringify(bundle)).not.toMatch(/password|credential|privateKey/i);
    await app.close();

    app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${targetProfile}`, '--mrt-e2e-serial-mock'],
      env: { ...electronEnvironment(), MRT_E2E: '1' } });
    page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await app.evaluate(({ dialog: nativeDialog }, filePath) => {
      Object.defineProperty(nativeDialog, 'showOpenDialog', { configurable: true,
        value: async () => ({ canceled: false, filePaths: [filePath] }) });
    }, bundlePath);
    await page.getByRole('button', { name: 'Import a saved session folder', exact: true }).click();
    await expect(page.locator('.alert-strip > span')).toContainText('Imported 1 folder and 1 saved session (1 folders and 1 sessions added).');
    const unavailableProfile = await page.evaluate(() => window.multiRemoteTerminal.createSavedSession({
      kind: 'serial', name: 'Unavailable serial', configuration: {
        path: 'COM4094', baudRate: 9_600, dataBits: 8, parity: 'none', stopBits: 1, flowControl: 'none'
      }
    }));
    expect(unavailableProfile.ok).toBe(true);
    await app.close();

    app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${targetProfile}`, '--mrt-e2e-serial-mock'],
      env: { ...electronEnvironment(), MRT_E2E: '1' } });
    page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Collapse folder Hardware', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
    await page.getByRole('button', { name: 'Open Unavailable serial', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Connect to a serial port' });
    await expect(dialog.getByLabel('Port')).toHaveValue('');
    await expect(dialog.getByText(/The saved profile uses COM4094, which is not currently listed/)).toBeVisible();
    const serialConnectButton = dialog.getByRole('button', { name: 'Connect', exact: true });
    await expect(serialConnectButton).toBeDisabled();
    await dialog.getByLabel('Port').selectOption('COM4095');
    await expect(dialog.getByLabel('Port')).toHaveValue('COM4095');
    await expect(serialConnectButton).toBeEnabled();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

    await page.getByRole('button', { name: 'Open Serial controller', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Connect to a serial port' });
    await expect(dialog.getByLabel('Port')).toHaveValue('COM4095');
    await expect(dialog.getByLabel('Baud rate')).toHaveValue('115200');
    await expect(dialog.getByLabel('Data bits')).toHaveValue('7');
    await expect(dialog.getByLabel('Parity')).toHaveValue('even');
    await expect(dialog.getByLabel('Stop bits')).toHaveValue('1.5');
    await expect(dialog.getByLabel('Flow control')).toHaveValue('rtscts');
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
    const reopenedTab = page.getByRole('tab', { name: /Serial controller/ });
    await expect(reopenedTab).toBeVisible({ timeout: 15_000 });
    const panelId = await reopenedTab.getAttribute('aria-controls');
    if (!panelId) throw new Error('Missing reopened serial terminal panel');
    const panel = page.locator(`#${panelId}`);
    await expect(panel.locator('.xterm-rows')).toContainText('MRT serial mock ready', { timeout: 10_000 });
  } finally {
    await app?.close();
    await rm(sourceProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    await rm(targetProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    await rm(bundleDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('Telnet requires plaintext consent and carries terminal input through the worker to a saved-profile reconnect', async () => {
  test.setTimeout(60_000);
  const profile = await mkdtemp(join(tmpdir(), 'mrt-telnet-e2e-'));
  const sockets = new Set<Socket>();
  let connectionNumber = 0;
  let observedInput = false;
  const server = createServer(socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    const markerNumber = ++connectionNumber;
    let clientBytes = Buffer.alloc(0);
    socket.write(Buffer.from([255, 251, 1, 255, 251, 3, 255, 253, 3, 255, 251, 0, 255, 253, 0, 255, 253, 24, 255, 253, 31]));
    socket.write(Buffer.from([255, 250, 24, 1, 255, 240]));
    socket.write(`MRT-TELNET-READY-${markerNumber}\r\n`);
    socket.on('data', data => {
      clientBytes = Buffer.concat([clientBytes, data]);
      // The fixture accepts BINARY, so NVT's CR NUL mapping no longer applies.
      if (observedInput || !clientBytes.includes(Buffer.from('mrt-e2e-input\r'))) return;
      observedInput = true;
      socket.write('MRT-TELNET-INPUT-ACK\r\n');
    });
  });
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(0, '127.0.0.1', resolveListen);
    });
    const address = server.address() as AddressInfo;
    app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`], env: electronEnvironment() });
    const page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });

    await page.getByRole('button', { name: 'Connect to Telnet (plaintext)', exact: true }).first().click();
    const connectDialog = page.getByRole('dialog', { name: 'Connect to a Telnet server' });
    await expect(connectDialog.getByText('Telnet traffic is sent in plaintext.')).toBeVisible();
    const connect = connectDialog.getByRole('button', { name: 'Connect', exact: true });
    await connectDialog.getByLabel('Host name or IP address').fill('127.0.0.1');
    await connectDialog.getByLabel('Port').fill(String(address.port));
    await connect.click();

    const telnetTab = page.getByRole('tab').filter({ hasText: /Telnet \(plaintext\)/ }).first();
    await expect(telnetTab).toBeVisible({ timeout: 15_000 });
    const telnetPanelId = await telnetTab.getAttribute('aria-controls');
    if (!telnetPanelId) throw new Error('Missing Telnet terminal panel');
    const telnetPanel = page.locator(`#${telnetPanelId}`);
    await expect(telnetPanel.locator('.xterm-rows')).toContainText('MRT-TELNET-READY-1', { timeout: 10_000 });
    await telnetPanel.locator('.terminal-host').click({ position: { x: 80, y: 60 } });
    await page.keyboard.type('mrt-e2e-input');
    await page.keyboard.press('Enter');
    await expect.poll(() => observedInput, { timeout: 10_000 }).toBe(true);
    await expect(telnetPanel.locator('.xterm-rows')).toContainText('MRT-TELNET-INPUT-ACK', { timeout: 10_000 });

    await page.getByRole('button', { name: 'Save active session', exact: true }).click();
    const saveDialog = page.getByRole('dialog', { name: 'Save active session' });
    await saveDialog.getByLabel('Session name').fill('Reusable Telnet');
    await saveDialog.getByRole('button', { name: 'Save session', exact: true }).click();
    const savedTelnet = page.getByRole('button', { name: 'Open Reusable Telnet', exact: true });
    await expect(savedTelnet).toBeVisible();

    await confirmCloseActiveTerminal(page, 'Telnet (plaintext)');
    await savedTelnet.click();
    const reconnectDialog = page.getByRole('dialog', { name: 'Connect to a Telnet server' });
    await expect(reconnectDialog.getByLabel('Host name or IP address')).toHaveValue('127.0.0.1');
    await expect(reconnectDialog.getByLabel('Port')).toHaveValue(String(address.port));
    await reconnectDialog.getByRole('button', { name: 'Connect', exact: true }).click();
    const reopenedTab = page.getByRole('tab').filter({ hasText: 'Reusable Telnet' });
    await expect(reopenedTab).toBeVisible({ timeout: 15_000 });
    const reopenedPanelId = await reopenedTab.getAttribute('aria-controls');
    if (!reopenedPanelId) throw new Error('Missing reopened Telnet terminal panel');
    await expect(page.locator(`#${reopenedPanelId} .xterm-rows`)).toContainText('MRT-TELNET-READY-2', { timeout: 10_000 });
  } finally {
    await app?.close();
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise<void>(resolveClose => server.close(() => resolveClose()));
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('FTP shows plaintext risk, browses through the utility worker, and persists a credential-free profile for reconnect', async () => {
  test.setTimeout(120_000);
  const profile = await mkdtemp(join(tmpdir(), 'mrt-ftp-e2e-'));
  const uploadSource = join(profile, 'e2e-upload.txt');
  const interruptedUploadName = 'zz-interrupted-upload.bin';
  const dropUploadSources = [join(profile, 'mrt-drop-first.txt'), join(profile, 'mrt-drop-second.txt')];
  const dropUploadContents = [Buffer.alloc(1_024, 0x42), Buffer.from('second dropped FTP payload')];
  const largeTransferSize = 100 * 1024 * 1024;
  const interruptedTransferSize = 4 * 1024 * 1024;
  const interruptedDownloadContents = Buffer.alloc(interruptedTransferSize);
  let interruptedSeed = 0x5a17c3e1;
  for (let index = 0; index < interruptedDownloadContents.length; index++) {
    interruptedSeed ^= interruptedSeed << 13;
    interruptedSeed ^= interruptedSeed >>> 17;
    interruptedSeed ^= interruptedSeed << 5;
    interruptedDownloadContents[index] = interruptedSeed & 0xff;
  }
  const downloadRoot = join(profile, 'downloads');
  let expectedLargeFileDigest: E2EFileDigest;
  const remoteFiles = new Map<string, Buffer>([
    ['readme.txt', Buffer.from('hello remote')],
    ['documents/nested.txt', Buffer.from('nested content abc')],
    ...Array.from({ length: 100 }, (_, index) =>
      [`scale-file-${String(index).padStart(3, '0')}.txt`, Buffer.from('scale fixture')] as const)
  ]);
  const controlSockets = new Set<Socket>();
  const dataSockets = new Set<Socket>();
  let connectionCount = 0;
  let interruptedDownloadSocket: Socket | undefined;
  let interruptedDownloadControlSocket: Socket | undefined;
  let interruptNextDownload = false;
  let interruptedUploadSocket: Socket | undefined;
  let interruptedUploadControlSocket: Socket | undefined;
  let interruptNextUpload = false;
  let nextStouName: string | undefined;
  let acceptedUsername = false;
  let acceptedPassword = false;
  const ftpCommandVerbs: string[] = [];
  const ftpListArguments: string[] = [];
  const ftpStouCommands: string[] = [];
  const ftpCwdArguments: string[] = [];
  const ftpDeleteArguments: string[] = [];
  const ftpDropUploadEvents: string[] = [];
  let ftpLargeUploadDigest: string | undefined;
  let stouCount = 0;
  let uploadTransferStartedCount = 0;
  let firstDropReplyPending = false;
  const control = createServer(socket => {
    controlSockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => controlSockets.delete(socket));
    connectionCount++;
    socket.write('220 MRT FTP fixture ready\r\n');
    let input = '';
    let passive: ReturnType<typeof createServer> | undefined;
    let transferSocket: Socket | undefined;
    let listRequested = false;
    let requestedListingPath = '.';
    let currentDirectory = '/';
    let transferStarted = false;
    let uploadName: string | undefined;
    let downloadName: string | undefined;
    let renameSource: string | undefined;
    const reply = (line: string) => { if (!socket.destroyed) socket.write(`${line}\r\n`); };
    const beginPassive = (extended: boolean) => {
      passive?.close();
      passive = createServer(dataSocket => {
        transferSocket = dataSocket;
        dataSockets.add(dataSocket);
        dataSocket.once('error', () => {});
        dataSocket.once('close', () => dataSockets.delete(dataSocket));
        if (listRequested) sendListing();
        else if (uploadName) receiveUpload();
        else if (downloadName) sendDownload();
      });
      passive.on('error', () => {});
      transferSocket = undefined;
      listRequested = false;
      transferStarted = false;
      passive.listen(0, '127.0.0.1', () => {
        const address = passive?.address();
        if (!address || typeof address === 'string') { reply('425 Could not start passive mode'); return; }
        if (extended) reply(`229 Entering Extended Passive Mode (|||${address.port}|)`);
        else {
          const high = Math.floor(address.port / 256);
          const low = address.port % 256;
          reply(`227 Entering Passive Mode (127,0,0,1,${high},${low})`);
        }
      });
    };
    const sendListing = () => {
      if (transferStarted || !transferSocket) return;
      transferStarted = true;
      const requestedName = requestedListingPath.trim().split(/\s+/u).at(-1)?.replace(/\/+$/u, '').split('/').at(-1);
      const files = [...remoteFiles.entries()].filter(([path]) => requestedName === 'documents'
        ? path.startsWith('documents/') : !path.includes('/'));
      const listing = files.map(([path, contents]) => {
        const name = path.slice(path.lastIndexOf('/') + 1);
        return `-rw-r--r-- 1 owner group ${contents.length} Oct 24 12:00 ${name}\r\n`;
      }).join('') + (requestedName === 'documents' ? '' : 'drwxr-xr-x 1 owner group 0 Oct 24 12:00 documents\r\n');
      transferSocket.end(listing);
      transferSocket.once('close', () => {
        reply('226 Directory send complete');
        passive?.close();
        passive = undefined;
        transferSocket = undefined;
        listRequested = false;
        transferStarted = false;
      });
    };
    const finishTransfer = () => {
      passive?.close();
      passive = undefined;
      transferSocket = undefined;
      uploadName = undefined;
      downloadName = undefined;
      transferStarted = false;
    };
    const receiveUpload = () => {
      if (transferStarted || !transferSocket || !uploadName) return;
      transferStarted = true;
      uploadTransferStartedCount++;
      const isInterruptedUpload = uploadName === interruptedUploadName;
      if (stouCount === 2) {
        transferSocket.pause();
        setTimeout(() => transferSocket?.resume(), 1_500);
      }
      const name = uploadName;
      const dataSocket = transferSocket;
      if (isInterruptedUpload) {
        interruptedUploadSocket = dataSocket;
        interruptedUploadControlSocket = socket;
        dataSocket.pause();
        setTimeout(() => dataSocket.resume(), 20);
      }
      const chunks: Buffer[] = [];
      const uploadHash = name === 'mrt-server-generated.txt' || name === 'zz-interrupted-upload-retry.bin'
        ? createHash('sha256') : undefined;
      dataSocket.on('data', chunk => {
        const data = Buffer.from(chunk);
        chunks.push(data);
        uploadHash?.update(data);
        if (isInterruptedUpload) {
          remoteFiles.set(posix.resolve(currentDirectory, name).replace(/^\//u, ''), Buffer.concat(chunks));
          dataSocket.pause();
        }
      });
      dataSocket.once('end', () => {
        const complete = () => {
          remoteFiles.set(posix.join(currentDirectory, name).replace(/^\//u, ''), Buffer.concat(chunks));
          if (uploadHash) ftpLargeUploadDigest = uploadHash.digest('hex');
          if (name.startsWith('mrt-drop-')) ftpDropUploadEvents.push(`complete:${name}`);
          dataSocket.end();
          reply('226 Transfer complete');
          finishTransfer();
        };
        if (name === 'mrt-drop-first.txt') {
          firstDropReplyPending = true;
          setTimeout(() => { firstDropReplyPending = false; complete(); }, 600);
        } else complete();
      });
    };
    const sendDownload = () => {
      if (transferStarted || !transferSocket || !downloadName) return;
      transferStarted = true;
      const remotePath = (downloadName.startsWith('/') ? posix.normalize(downloadName) : posix.resolve(currentDirectory, downloadName))
        .replace(/^\//u, '');
      const contents = remoteFiles.get(remotePath);
      if (!contents) { reply('550 File not found'); transferSocket.destroy(); finishTransfer(); return; }
      if (remotePath === 'zz-interrupted-download.bin' && interruptNextDownload) {
        interruptNextDownload = false;
        interruptedDownloadSocket = transferSocket;
        interruptedDownloadControlSocket = socket;
        transferSocket.write(contents.subarray(0, 1024 * 1024));
        return;
      }
      transferSocket.end(contents);
      transferSocket.once('close', () => {
        reply('226 Transfer complete');
        finishTransfer();
      });
    };
    socket.on('data', chunk => {
      input += chunk.toString('utf8');
      for (;;) {
        const newline = input.indexOf('\n');
        if (newline < 0) break;
        const command = input.slice(0, newline).replace(/\r$/u, '');
        input = input.slice(newline + 1);
        const [verb, ...arguments_] = command.split(' ');
        ftpCommandVerbs.push(verb ?? '');
        const argument = arguments_.join(' ');
        if (verb === 'USER') { acceptedUsername ||= argument === 'mrt-e2e-user'; reply('331 Password required'); }
        else if (verb === 'PASS') { acceptedPassword ||= argument === 'ftp-e2e-secret'; reply(argument === 'ftp-e2e-secret' ? '230 Login successful' : '530 Login incorrect'); }
        else if (verb === 'FEAT') socket.write('211-Features\r\n EPSV\r\n PASV\r\n211 End\r\n');
        else if (verb === 'SYST') reply('215 UNIX Type: L8');
        else if (verb === 'TYPE' || verb === 'OPTS' || verb === 'NOOP') reply('200 Command okay');
        else if (verb === 'PWD') reply(`257 "${currentDirectory}" is current directory`);
        else if (verb === 'CWD') {
          ftpCwdArguments.push(argument);
          currentDirectory = posix.resolve(currentDirectory, argument || '.');
          reply('250 Directory changed');
        }
        else if (verb === 'PASV') beginPassive(false);
        else if (verb === 'EPSV') beginPassive(true);
        else if (verb === 'LIST' || verb === 'NLST') {
          requestedListingPath = argument || '.';
          ftpListArguments.push(argument);
          listRequested = true;
          reply('150 Opening data connection');
          sendListing();
        }
        else if (verb === 'STOU') {
          ftpStouCommands.push(command);
          if (argument !== '') { reply('501 STOU does not accept a pathname'); continue; }
          stouCount++;
          const requestedName = interruptNextUpload ? interruptedUploadName : nextStouName ?? (stouCount <= 2 ? 'mrt-server-generated.txt'
            : `mrt-drop-${stouCount === 3 ? 'first' : 'second'}.txt`);
          if (interruptNextUpload) interruptNextUpload = false;
          nextStouName = undefined;
          const extensionAt = requestedName.lastIndexOf('.');
          const extension = extensionAt > 0 ? requestedName.slice(extensionAt) : '';
          const stem = extension ? requestedName.slice(0, -extension.length) : requestedName;
          uploadName = requestedName;
          const prefix = currentDirectory === '/' ? '' : `${currentDirectory.replace(/^\//u, '')}/`;
          for (let ordinal = 1; remoteFiles.has(`${prefix}${uploadName}`); ordinal++) uploadName = `${stem} (${ordinal})${extension}`;
          if (uploadName.startsWith('mrt-drop-')) ftpDropUploadEvents.push(`start:${uploadName}`);
          reply(`150 FILE: ${uploadName}`);
          receiveUpload();
        }
        else if (verb === 'STOR') {
          uploadName = argument.slice(argument.lastIndexOf('/') + 1);
          reply('150 Opening upload connection');
          receiveUpload();
        }
        else if (verb === 'RETR') {
          downloadName = argument;
          reply('150 Opening download connection');
          sendDownload();
        }
        else if (verb === 'RNFR') { renameSource = argument.slice(argument.lastIndexOf('/') + 1); reply('350 Ready for destination'); }
        else if (verb === 'RNTO') {
          const target = argument.slice(argument.lastIndexOf('/') + 1);
          const contents = renameSource ? remoteFiles.get(renameSource) : undefined;
          if (!renameSource || !contents) reply('550 Source file not found');
          else { remoteFiles.delete(renameSource); remoteFiles.set(target, contents); reply('250 Rename successful'); }
          renameSource = undefined;
        }
        else if (verb === 'DELE') {
          ftpDeleteArguments.push(argument);
          remoteFiles.delete(posix.resolve(currentDirectory, argument).replace(/^\//u, ''));
          reply('250 Delete successful');
        }
        else if (verb === 'SIZE') {
          const path = posix.resolve(currentDirectory, argument).replace(/^\//u, '');
          const contents = remoteFiles.get(path);
          reply(contents ? `213 ${contents.byteLength}` : '550 File not found');
        }
        else if (verb === 'QUIT') { reply('221 Goodbye'); socket.end(); }
        else reply('502 Command not implemented');
      }
    });
    socket.once('close', () => passive?.close());
  });
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  const launch = async () => electron.launch({
    args: [resolve('apps/desktop'), `--user-data-dir=${profile}`, '--mrt-e2e-ftp-credentials', '--mrt-e2e-ftp-transfers',
      '--mrt-e2e-file-drop', `--mrt-e2e-ftp-upload-file=${uploadSource}`, `--mrt-e2e-ftp-download-root=${downloadRoot}`],
    env: { ...electronEnvironment(), MRT_E2E: '1' }
  });
  try {
    await writePatternFile(uploadSource, largeTransferSize, 0x41);
    expectedLargeFileDigest = await hashFile(uploadSource);
    await Promise.all(dropUploadSources.map((path, index) => writeFile(path, dropUploadContents[index]!)));
    await mkdir(downloadRoot);
    await new Promise<void>((resolveListen, rejectListen) => {
      control.once('error', rejectListen);
      control.listen(0, '127.0.0.1', resolveListen);
    });
    const address = control.address() as AddressInfo;
    app = await launch();
    let page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Connect to FTP / FTPS files', exact: true }).first().click();
    let dialog = page.getByRole('dialog', { name: 'Connect to FTP or FTPS files' });
    await dialog.getByLabel('Host name or IP address').fill('127.0.0.1');
    await dialog.getByLabel('Port').fill(String(address.port));
    await dialog.getByLabel('Connection security').selectOption('ftp');
    await expect(dialog.getByText(/sends the username, password, and file contents without encryption/i)).toBeVisible();
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click();

    const browser = page.getByTestId('remote-file-browser');
    await expect(browser, `FTP fixture saw ${connectionCount} control connections, USER=${acceptedUsername}, PASS=${acceptedPassword}, commands=${ftpCommandVerbs.join(',')}, LIST arguments=${ftpListArguments.join('|')}`)
      .toBeVisible({ timeout: 20_000 });
    await expect(browser.getByText('readme.txt', { exact: true })).toBeVisible({ timeout: 15_000 });
    const ftpFileList = browser.locator('.remote-file-list');
    await expect(ftpFileList).toHaveClass(/is-virtualized/u);
    await expect.poll(() => ftpFileList.evaluate(element => element.clientHeight)).toBeGreaterThan(0);
    expect(await ftpFileList.locator('li[data-virtual-index]').count()).toBeLessThan(102);
    await ftpFileList.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(ftpFileList.locator('li[data-virtual-index]').last()).toHaveAttribute('data-virtual-index', '101');
    await expect(browser.getByRole('button', { name: 'Open folder documents', exact: true })).toBeVisible();
    await browser.getByRole('button', { name: 'Open folder documents', exact: true }).click();
    await expect(browser.getByText('nested.txt', { exact: true }), `FTP LIST arguments=${ftpListArguments.join('|')}`).toBeVisible({ timeout: 10_000 });
    await browser.getByRole('button', { name: 'Upload file', exact: true }).click();
    await expect.poll(() => ftpStouCommands.length).toBe(1);
    await expect.poll(() => ftpCwdArguments.length).toBe(2);
    expect(ftpStouCommands).toEqual(['STOU']);
    expect(ftpCwdArguments).toEqual(['documents', '/']);
    await expect.poll(() => remoteFiles.get('documents/mrt-server-generated.txt')?.length).toBe(largeTransferSize);
    const uploadedLargeFile = remoteFiles.get('documents/mrt-server-generated.txt');
    if (!uploadedLargeFile) throw new Error('The FTP fixture did not retain the uploaded large file.');
    expect({ size: uploadedLargeFile.byteLength, sha256: ftpLargeUploadDigest })
      .toEqual(expectedLargeFileDigest);
    await expect(browser.getByText(/^Uploaded mrt-server-generated\.txt \(/u)).toBeVisible({ timeout: 10_000 });

    await browser.getByRole('button', { name: 'Upload file', exact: true }).click();
    await expect.poll(() => ftpStouCommands.length).toBe(2);
    await expect.poll(() => uploadTransferStartedCount).toBe(2);
    await browser.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(browser.getByText('Upload cancelled. The server may retain a partial file if cleanup was interrupted.')).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => ftpDeleteArguments.length, { timeout: 10_000 }).toBe(1);
    expect(remoteFiles.has('documents/mrt-server-generated (1).txt')).toBe(false);
    expect(ftpStouCommands).toEqual(['STOU', 'STOU']);
    expect(ftpCwdArguments).toEqual(['documents', '/', 'documents', '/']);
    await browser.getByRole('button', { name: 'Open parent folder', exact: true }).click();
    await expect(browser.getByText('readme.txt', { exact: true })).toBeVisible({ timeout: 10_000 });
    await browser.getByRole('button', { name: 'Download readme.txt', exact: true }).click();
    await expect.poll(() => readFile(join(downloadRoot, 'readme.txt'), 'utf8').catch(() => undefined)).toBe('hello remote');
    await expect(browser.getByText('Downloaded readme.txt (12 B).', { exact: true })).toBeVisible({ timeout: 10_000 });

    const rootFileList = browser.locator('.remote-file-list');
    await rootFileList.evaluate(element => { element.scrollTop = element.scrollHeight; });
    const openDocuments = browser.getByRole('button', { name: 'Open folder documents', exact: true });
    await expect(openDocuments).toBeVisible({ timeout: 10_000 });
    await openDocuments.click();
    const downloadLargeButton = browser.getByRole('button', { name: 'Download mrt-server-generated.txt', exact: true });
    await expect(downloadLargeButton).toBeVisible({ timeout: 10_000 });
    await downloadLargeButton.click();
    await expect(browser.getByText('Downloaded mrt-server-generated.txt (100 MB).', { exact: true }))
      .toBeVisible({ timeout: 60_000 });
    await expect.poll(() => hashFile(join(downloadRoot, 'mrt-server-generated.txt')).catch(() => undefined), { timeout: 60_000 })
      .toEqual(expectedLargeFileDigest);
    await browser.getByRole('button', { name: 'Open parent folder', exact: true }).click();
    await expect(browser.getByText('readme.txt', { exact: true })).toBeVisible({ timeout: 10_000 });

    await expect(browser).toHaveAttribute('data-mrt-remote-file-drop-target', 'true');
    await dispatchFileDrop(page, dropUploadSources, '[data-testid="remote-file-browser"]');
    await expect.poll(() => ftpDropUploadEvents.includes('start:mrt-drop-first.txt')).toBe(true);
    await expect.poll(() => firstDropReplyPending).toBe(true);
    await expect.poll(() => [...ftpDropUploadEvents], { timeout: 20_000 }).toEqual([
      'start:mrt-drop-first.txt', 'complete:mrt-drop-first.txt',
      'start:mrt-drop-second.txt', 'complete:mrt-drop-second.txt'
    ]);
    expect(remoteFiles.get('mrt-drop-first.txt')).toEqual(dropUploadContents[0]);
    expect(remoteFiles.get('mrt-drop-second.txt')).toEqual(dropUploadContents[1]);
    await expect(browser.getByText(/Uploaded mrt-drop-second\.txt/u)).toBeVisible({ timeout: 10_000 });

    expect(acceptedUsername).toBe(true);
    expect(acceptedPassword).toBe(true);
    expect(await page.locator('body').innerText()).not.toContain('ftp-e2e-secret');

    await page.getByRole('button', { name: 'Save active session', exact: true }).click();
    const saveDialog = page.getByRole('dialog', { name: 'Save active session' });
    await saveDialog.getByLabel('Session name').fill('FTP loopback');
    await saveDialog.getByRole('button', { name: 'Save session', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open FTP loopback', exact: true })).toBeVisible();

    const expectedInterruptedDownloadDigest = {
      size: interruptedDownloadContents.byteLength,
      sha256: createHash('sha256').update(interruptedDownloadContents).digest('hex')
    };
    remoteFiles.set('zz-interrupted-download.bin', interruptedDownloadContents);
    await browser.getByRole('button', { name: 'Refresh remote folder' }).click();
    const readStagedFileNames = async () => (await readDirectory(downloadRoot)).filter(name => name.startsWith('.mrt-'));
    const stagedFilesBeforeInterruptedDownload = await readStagedFileNames();
    expect(stagedFilesBeforeInterruptedDownload).toEqual([]);
    const remoteFileList = browser.locator('.remote-file-list');
    await remoteFileList.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(browser.getByText('zz-interrupted-download.bin', { exact: true })).toBeVisible({ timeout: 10_000 });
    interruptNextDownload = true;
    await browser.getByRole('button', { name: 'Download zz-interrupted-download.bin', exact: true }).click();
    const stagedInterruptedDownloadFiles = async () => {
      const stagedNames = await readStagedFileNames();
      return Promise.all(stagedNames.map(async name => ({ name, size: (await statFile(join(downloadRoot, name))).size })));
    };
    await expect.poll(async () => (await stagedInterruptedDownloadFiles()).some(file => file.size > 0), { timeout: 15_000 }).toBe(true);
    const partialInterruptedFiles = await stagedInterruptedDownloadFiles();
    expect(partialInterruptedFiles).toHaveLength(1);
    expect(partialInterruptedFiles[0]?.size).toBeGreaterThan(0);
    expect(partialInterruptedFiles[0]?.size).toBeLessThan(interruptedTransferSize);
    const failedDataSocket = interruptedDownloadSocket;
    const failedControlSocket = interruptedDownloadControlSocket;
    if (!failedDataSocket || failedDataSocket.destroyed || !failedControlSocket || failedControlSocket.destroyed) {
      throw new Error('The FTP fixture has no live control and data sockets to reset');
    }
    failedDataSocket.resetAndDestroy();
    failedControlSocket.resetAndDestroy();
    await expect(browser.getByText('The file transfer failed. Check the connection and server permissions.', { exact: true }))
      .toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => (await readStagedFileNames()).length, { timeout: 15_000 }).toBe(0);
    expect(await readDirectory(downloadRoot)).not.toContain('zz-interrupted-download.bin');

    await browser.getByRole('button', { name: 'Refresh remote folder' }).click();
    const reconnectButton = browser.getByRole('button', { name: 'Reconnect to file server' });
    await expect(reconnectButton).toBeVisible({ timeout: 15_000 });
    await reconnectButton.click();
    dialog = page.getByRole('dialog', { name: 'Connect to FTP or FTPS files' });
    await expect(dialog.getByLabel('Host name or IP address')).toHaveValue('127.0.0.1');
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByTestId('remote-file-browser').getByText('readme.txt', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => connectionCount).toBe(2);
    await browser.locator('.remote-file-list').evaluate(element => { element.scrollTop = element.scrollHeight; });
    const retryInterruptedDownload = browser.getByRole('button', { name: 'Download zz-interrupted-download.bin', exact: true });
    await expect(retryInterruptedDownload).toBeVisible({ timeout: 10_000 });
    await retryInterruptedDownload.click();
    await expect(browser.getByText('Downloaded zz-interrupted-download.bin (4 MB).', { exact: true }))
      .toBeVisible({ timeout: 15_000 });
    expect(await hashFile(join(downloadRoot, 'zz-interrupted-download.bin'))).toEqual(expectedInterruptedDownloadDigest);

    interruptNextUpload = true;
    await browser.getByRole('button', { name: 'Upload file', exact: true }).click();
    await expect.poll(() => ftpStouCommands.length).toBe(5);
    await expect.poll(() => remoteFiles.get(interruptedUploadName)?.byteLength ?? 0, { timeout: 15_000 }).toBeGreaterThan(0);
    const partialUploadSize = remoteFiles.get(interruptedUploadName)?.byteLength ?? 0;
    expect(partialUploadSize).toBeLessThan(largeTransferSize);
    const failedUploadDataSocket = interruptedUploadSocket;
    const failedUploadControlSocket = interruptedUploadControlSocket;
    if (!failedUploadDataSocket || failedUploadDataSocket.destroyed || !failedUploadControlSocket || failedUploadControlSocket.destroyed) {
      throw new Error('The FTP fixture has no live control and data sockets to reset during upload');
    }
    failedUploadDataSocket.resetAndDestroy();
    failedUploadControlSocket.resetAndDestroy();
    await expect(browser.getByText('The file transfer failed. Check the connection and server permissions.', { exact: true }))
      .toBeVisible({ timeout: 15_000 });

    await browser.getByRole('button', { name: 'Refresh remote folder' }).click();
    await expect(reconnectButton).toBeVisible({ timeout: 15_000 });
    await reconnectButton.click();
    dialog = page.getByRole('dialog', { name: 'Connect to FTP or FTPS files' });
    await expect(dialog.getByLabel('Host name or IP address')).toHaveValue('127.0.0.1');
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByTestId('remote-file-browser').getByText('readme.txt', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => connectionCount).toBe(3);
    await expect.poll(() => remoteFiles.has(interruptedUploadName), { timeout: 10_000 }).toBe(false);
    expect(ftpDeleteArguments).toContain(interruptedUploadName);
    nextStouName = 'zz-interrupted-upload-retry.bin';
    await browser.getByRole('button', { name: 'Upload file', exact: true }).click();
    await expect.poll(() => ftpStouCommands.length).toBe(6);
    await expect.poll(() => remoteFiles.get('zz-interrupted-upload-retry.bin')?.byteLength ?? 0, { timeout: 30_000 })
      .toBe(largeTransferSize);
    expect({ size: remoteFiles.get('zz-interrupted-upload-retry.bin')?.byteLength, sha256: ftpLargeUploadDigest })
      .toEqual(expectedLargeFileDigest);
    await expect(browser.getByText(/^Uploaded zz-interrupted-upload-retry\.bin \(/u)).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Close active file session', exact: true }).click();
    const closeDialog = page.getByRole('alertdialog');
    await closeDialog.getByRole('button', { name: 'Close session', exact: true }).click();
    await expect(page.getByRole('tab').filter({ hasText: /FTP \(plaintext\)/ })).toHaveCount(0);
    await app.close();
    app = undefined;

    const database = new DatabaseSync(join(profile, 'multiremote-terminal.sqlite'), { readOnly: true });
    try {
      const saved = database.prepare('SELECT kind, host, port, username, credential_ref, options_json FROM session_definitions WHERE name = ?').get('FTP loopback') as {
        readonly kind: string; readonly host: string; readonly port: number; readonly username: string | null;
        readonly credential_ref: string | null; readonly options_json: string;
      } | undefined;
      expect(saved).toEqual({ kind: 'ftp', host: '127.0.0.1', port: address.port, username: null, credential_ref: null, options_json: '{"secure":false}' });
    } finally { database.close(); }

    app = await launch();
    page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    const savedProfile = page.getByRole('button', { name: 'Open FTP loopback', exact: true });
    await expect(savedProfile).toBeVisible({ timeout: 15_000 });
    await savedProfile.click();
    dialog = page.getByRole('dialog', { name: 'Connect to FTP or FTPS files' });
    await expect(dialog.getByLabel('Host name or IP address')).toHaveValue('127.0.0.1');
    await expect(dialog.getByLabel('Port')).toHaveValue(String(address.port));
    await expect(dialog.getByLabel('Connection security')).toHaveValue('ftp');
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByTestId('remote-file-browser').getByText('readme.txt', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => connectionCount).toBe(4);
  } finally {
    await app?.close();
    for (const socket of controlSockets) socket.destroy();
    for (const socket of dataSockets) socket.destroy();
    if (control.listening) await new Promise<void>(resolveClose => control.close(() => resolveClose()));
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('saved sessions save, search, favorite, reopen and delete through the workbench', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'mrt-session-catalog-e2e-'));
  const app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`], env: electronEnvironment() });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await expect(page.getByRole('tab', { name: /PowerShell session 1/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('No saved sessions yet.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Saved sessions', exact: true })).toHaveText('Saved sessions');
    await expect(page.getByLabel('0 saved sessions')).toBeVisible();
    await page.getByRole('button', { name: 'Save active session', exact: true }).click();
    const saveDialog = page.getByRole('dialog', { name: 'Save active session' });
    await expect(saveDialog).toBeVisible();
    const sessionNameInput = saveDialog.getByLabel('Session name');
    await expect(sessionNameInput).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(saveDialog.getByRole('button', { name: 'Save session', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(sessionNameInput).toBeFocused();
    await sessionNameInput.fill('Reusable PowerShell');
    await saveDialog.getByRole('button', { name: 'Save session', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save active session', exact: true })).toBeFocused();
    const search = page.getByRole('searchbox', { name: 'Search saved sessions' });
    const openSaved = page.getByRole('button', { name: 'Open Reusable PowerShell', exact: true });
    await expect(openSaved).toBeVisible();
    await expect(page.getByLabel('1 saved session')).toBeVisible();
    await openSaved.click({ button: 'right' });
    await expect(page.locator('.terminal-tab-menu')).toHaveCount(0);
    await page.getByRole('button', { name: 'Make favorite Reusable PowerShell', exact: true }).click();
    const favorite = page.getByRole('button', { name: 'Remove favorite from Reusable PowerShell', exact: true });
    await expect(favorite).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ path: 'test-results/saved-session-catalog.png', fullPage: true });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(820, 700));
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(900);
    await page.screenshot({ path: 'test-results/saved-session-catalog-narrow.png', fullPage: true });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(700, 480));
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(740);
    await expect(search).toBeVisible();
    await expect(page.getByRole('button', { name: 'PowerShell session 1 running' })).toBeVisible();
    const paletteHint = page.getByRole('button', { name: /Command palette/ });
    await paletteHint.scrollIntoViewIfNeeded();
    await expect(paletteHint).toBeVisible();
    await page.screenshot({ path: 'test-results/saved-session-catalog-min-width.png', fullPage: true });
    const previousSavedSessionRow = await page.locator('.saved-session-row').filter({ hasText: 'Reusable PowerShell' }).elementHandle();
    if (!previousSavedSessionRow) throw new Error('Saved session row was missing before the search refresh.');
    await search.fill('reusable power');
    await expect.poll(() => previousSavedSessionRow.evaluate(element => element.isConnected).catch(() => false),
      { intervals: [10, 50, 100], timeout: 5_000 }).toBe(false);
    await expect(openSaved).toBeVisible();
    await openSaved.click();
    await expect(page.getByRole('tab')).toHaveCount(2);
    await expect(page.getByRole('tab').filter({ hasText: 'Reusable PowerShell' })).toHaveCount(1);
    const sessionActions = page.locator('.saved-session-row').filter({ hasText: 'Reusable PowerShell' }).locator('details.saved-actions-menu');
    const sessionActionsTrigger = page.getByRole('button', { name: 'Actions for saved session Reusable PowerShell' });
    await sessionActionsTrigger.click();
    await expect(sessionActions).toHaveAttribute('open', '');
    await expect(sessionActionsTrigger).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(sessionActions).not.toHaveAttribute('open');
    await expect(sessionActionsTrigger).toHaveAttribute('aria-expanded', 'false');
    await expect(sessionActionsTrigger).toBeFocused();
    await sessionActionsTrigger.click();
    await expect(sessionActions).toHaveAttribute('open', '');
    const deleteSavedSession = page.getByRole('button', { name: 'Delete saved session Reusable PowerShell', exact: true });
    await expect(deleteSavedSession).toBeVisible();
    await expect(deleteSavedSession).toBeEnabled();
    page.once('dialog', dialog => { void dialog.accept(); });
    await deleteSavedSession.click({ timeout: 5_000 });
    await expect(page.getByText('No saved sessions match this search.')).toBeVisible();
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('1,000 saved sessions remain searchable, reopenable and deletable in the Windows workbench', async () => {
  test.setTimeout(120_000);
  const profile = await mkdtemp(join(tmpdir(), 'mrt-session-scale-e2e-'));
  const bundlePath = join(profile, 'one-thousand-sessions.json');
  const rootFolderId = randomUUID();
  const timestamp = new Date().toISOString();
  const bundle = createSessionFolderBundle({
    rootFolderId,
    exportedAt: timestamp,
    folders: [{ id: rootFolderId, parentId: null, name: 'P38 Scale' }],
    sessions: Array.from({ length: 999 }, (_, index) => ({
      id: randomUUID(), folderId: rootFolderId, kind: 'local' as const,
      name: `P38 Profile ${String(index + 1).padStart(4, '0')}`, shell: 'powershell' as const,
      favorite: false, createdAt: timestamp, updatedAt: timestamp
    }))
  });
  if (!bundle) throw new Error('Could not create the scale-test folder bundle.');
  await writeFile(bundlePath, JSON.stringify(bundle), 'utf8');
  const app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`], env: electronEnvironment() });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await expect(page.getByRole('searchbox', { name: 'Search saved sessions' })).toBeVisible();
    await app.evaluate(({ dialog: nativeDialog }, filePath) => {
      Object.defineProperty(nativeDialog, 'showOpenDialog', { configurable: true,
        value: async () => ({ canceled: false, filePaths: [filePath] }) });
    }, bundlePath);
    await page.getByRole('button', { name: 'Import a saved session folder', exact: true }).click();
    await expect(page.locator('.alert-strip > span')).toContainText('Imported 1 folder and 999 saved sessions', { timeout: 30_000 });
    await page.getByRole('button', { name: 'Save active session', exact: true }).click();
    const saveDialog = page.getByRole('dialog', { name: 'Save active session' });
    await saveDialog.getByLabel('Session name').fill('P38 Profile 0000');
    await saveDialog.getByRole('button', { name: 'Save session', exact: true }).click();

    const search = page.locator('#saved-session-search');
    await expect(page.locator('.saved-session-row').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel('1000 saved sessions')).toBeVisible();
    const catalogList = page.locator('.saved-session-list');
    await expect(catalogList.locator('.saved-session-row').first().locator('.saved-actions-panel')).toBeHidden();
    const initiallyRenderedRows = await catalogList.locator('.saved-session-row').count();
    expect(initiallyRenderedRows).toBeGreaterThan(0);
    expect(initiallyRenderedRows).toBeLessThan(1_000);

    await catalogList.evaluate(element => { element.scrollTop = 0; });
    await expect.poll(() => catalogList.evaluate(element => element.clientHeight)).toBeGreaterThan(0);
    const keyboardProbe = await focusVirtualizedListBoundary(catalogList, 'last');
    expect(keyboardProbe.focused).toBe(true);
    await page.keyboard.press('Tab');
    await expect.poll(() => page.evaluate(() => Number(document.activeElement?.closest('[data-virtual-index]')?.getAttribute('data-virtual-index'))))
      .toBe(keyboardProbe.index + 1);

    await catalogList.evaluate(element => { element.scrollTop = 1_500; });
    await expect.poll(() => catalogList.locator('[data-virtual-index]').first().getAttribute('data-virtual-index'))
      .not.toBe('0');
    const reverseKeyboardProbe = await focusVirtualizedListBoundary(catalogList, 'first');
    expect(reverseKeyboardProbe.focused).toBe(true);
    await page.keyboard.press('Shift+Tab');
    await expect.poll(() => page.evaluate(() => Number(document.activeElement?.closest('[data-virtual-index]')?.getAttribute('data-virtual-index'))))
      .toBe(reverseKeyboardProbe.index - 1);

    await catalogList.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(catalogList.locator('[data-virtual-index]').last()).toHaveAttribute('data-virtual-index', '1001');
    await catalogList.evaluate(element => { element.scrollTop = 0; });
    await expect(catalogList.locator('[data-virtual-index]').first()).toHaveAttribute('data-virtual-index', '0');
    const firstFocusableRow = await focusVirtualizedListBoundary(catalogList, 'first');
    expect(firstFocusableRow.index).toBe(1);
    expect(firstFocusableRow.focused).toBe(true);
    await page.keyboard.press('Shift+Tab');
    await expect(search).toBeFocused();
    const searchSamples: number[] = [];
    type P38SearchProbe = { readonly targetName: string; startedAt?: number; elapsedMs?: number };
    for (let index = 0; index < 20; index += 1) {
      const name = `P38 Profile ${index % 2 === 0 ? '0999' : '0998'}`;
      await page.evaluate(targetName => {
        const input = document.querySelector<HTMLInputElement>('#saved-session-search');
        if (!input) throw new Error('Saved-session search input was missing.');
        const probe: P38SearchProbe = { targetName };
        (window as Window & { __p38SearchProbe?: P38SearchProbe }).__p38SearchProbe = probe;
        input.addEventListener('input', () => {
          probe.startedAt = performance.now();
          const observer = new MutationObserver(() => {
            const matchingRow = Array.from(document.querySelectorAll<HTMLButtonElement>('.saved-session-open'))
              .some(button => button.getAttribute('aria-label') === `Open ${probe.targetName}`);
            if (!matchingRow || probe.startedAt === undefined) return;
            probe.elapsedMs = performance.now() - probe.startedAt;
            observer.disconnect();
          });
          observer.observe(document.body, { childList: true, subtree: true });
        }, { once: true });
      }, name);
      await search.fill(name);
      await expect(page.locator('.saved-session-row')).toHaveCount(1, { timeout: 5_000 });
      await expect(page.locator('.saved-session-open')).toHaveAttribute('aria-label', `Open ${name}`, { timeout: 5_000 });
      const elapsedMs = await page.evaluate(() => (window as Window & { __p38SearchProbe?: P38SearchProbe }).__p38SearchProbe?.elapsedMs);
      expect(elapsedMs).toBeGreaterThan(0);
      searchSamples.push(elapsedMs ?? Number.POSITIVE_INFINITY);
    }
    searchSamples.sort((left, right) => left - right);
    const searchP95Ms = searchSamples[Math.ceil(searchSamples.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
    console.log(`[P-38] Saved-session search p95: ${searchP95Ms.toFixed(1)} ms (n=${searchSamples.length}).`);
    expect(searchP95Ms).toBeLessThan(150);

    await search.fill('P38 Profile 0999');
    await expect(page.locator('.saved-session-row')).toHaveCount(1);
    await expect(page.locator('.saved-session-open')).toHaveAttribute('aria-label', 'Open P38 Profile 0999');
    const openProfile = page.getByRole('button', { name: 'Open P38 Profile 0999', exact: true });
    await expect(openProfile).toBeVisible();
    await openProfile.click();
    await expect(page.getByRole('tab').filter({ hasText: 'P38 Profile 0999' })).toHaveCount(1);

    await page.getByRole('button', { name: 'Actions for saved session P38 Profile 0999', exact: true }).click();
    const deleteProfile = page.getByRole('button', { name: 'Delete saved session P38 Profile 0999', exact: true });
    page.once('dialog', dialog => { void dialog.accept(); });
    await deleteProfile.click();
    await expect(page.getByText('No saved sessions match this search.')).toBeVisible();
    await expect(page.getByLabel('999 saved sessions')).toBeVisible();
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('RDP profiles persist and launch through the explicitly external viewer handoff', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'mrt-rdp-profile-e2e-'));
  const launch = () => electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`, '--mrt-e2e-rdp-viewer'],
    env: { ...electronEnvironment(), MRT_E2E: '1' } });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Connect to RDP desktop', exact: true }).first().click();
    const dialog = page.getByTestId('rdp-connect-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('External Windows Remote Desktop viewer');
    await expect(dialog).toContainText('does not store RDP credentials');
    const bypass = await page.evaluate(() => window.multiRemoteTerminal.launchRdpViewer('attacker.example.com', 3389));
    expect(bypass).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    await dialog.getByLabel('Host name or IP address').fill('desktop.example.com');
    await dialog.getByLabel('Port').fill('3390');
    await dialog.getByLabel('Saved profile name').fill('Lab desktop');
    await page.screenshot({ path: 'test-results/rdp-connection-dialog.png', fullPage: true });
    await dialog.getByRole('button', { name: 'Save profile', exact: true }).click();
    const savedRdp = page.getByRole('button', { name: 'Open Lab desktop', exact: true });
    await expect(savedRdp).toBeVisible();
    await expect(page.locator('.saved-session-row').filter({ hasText: 'Lab desktop' })).toContainText('RDP · external viewer');

    await savedRdp.click();
    const launchDialog = page.getByTestId('rdp-connect-dialog');
    await expect(launchDialog).toBeVisible();
    await expect(launchDialog.getByLabel('Host name or IP address')).toHaveValue('desktop.example.com');
    await expect(launchDialog.getByLabel('Port')).toHaveValue('3390');
    await page.keyboard.press('Escape');
    await expect(launchDialog).toHaveCount(0);
    await expect(savedRdp).toBeFocused();
    await savedRdp.click();
    await launchDialog.getByTestId('rdp-launch').click();
    await expect(launchDialog).toHaveCount(0);
    await expect(page.locator('.alert-strip > span')).toContainText('Connection status is not tracked here.');

    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Open Lab desktop', exact: true })).toBeVisible();
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('VNC profiles persist and launch through an explicitly trusted external TigerVNC handoff', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'mrt-vnc-profile-e2e-'));
  const launch = () => electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`, '--mrt-e2e-vnc-viewer'],
    env: { ...electronEnvironment(), MRT_E2E: '1' } });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Connect to VNC desktop', exact: true }).first().click();
    const dialog = page.getByTestId('vnc-connect-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('External TigerVNC viewer');
    await expect(dialog).toContainText('security and encryption depend on the server configuration');
    const bypass = await page.evaluate(() => window.multiRemoteTerminal.launchVncViewer('attacker.example.com', 5900));
    expect(bypass).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    await dialog.getByLabel('Host name or IP address').fill('vnc.example.com');
    await dialog.getByLabel('Port').fill('5901');
    await dialog.getByLabel('Saved profile name').fill('Lab VNC');
    await dialog.getByRole('button', { name: 'Save profile', exact: true }).click();
    const savedVnc = page.getByRole('button', { name: 'Open Lab VNC', exact: true });
    await expect(savedVnc).toBeVisible();
    await expect(page.locator('.saved-session-row').filter({ hasText: 'Lab VNC' })).toContainText('VNC · external viewer');

    await savedVnc.click();
    const launchDialog = page.getByTestId('vnc-connect-dialog');
    await expect(launchDialog).toBeVisible();
    await expect(launchDialog).toHaveAttribute('aria-busy', 'false');
    await expect(launchDialog.getByLabel('Host name or IP address')).toHaveValue('vnc.example.com');
    await expect(launchDialog.getByLabel('Port')).toHaveValue('5901');
    await expect(launchDialog.getByLabel('Host name or IP address')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(launchDialog).toHaveCount(0);
    await expect(savedVnc).toBeFocused();
    await savedVnc.click();
    await launchDialog.getByTestId('vnc-launch').click();
    await expect(launchDialog).toHaveCount(0);
    await expect(page.locator('.alert-strip > span')).toContainText('TigerVNC was opened outside this app');

    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Open Lab VNC', exact: true })).toBeVisible();
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('macro library creates, edits, persists and deletes typed steps', async () => {
  test.setTimeout(60_000);
  const profile = await mkdtemp(join(tmpdir(), 'mrt-macro-library-e2e-'));
  let app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`], env: electronEnvironment() });
  try {
    let page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    const openMacros = page.getByRole('button', { name: 'Macros', exact: true });
    await openMacros.click();
    let dialog = page.getByRole('dialog', { name: 'Macros' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('No macros saved yet.')).toBeVisible();
    await expect(dialog.getByText(/Keep secrets out of macro fields\./)).toBeVisible();
    await dialog.getByRole('button', { name: 'New macro', exact: true }).click();
    const name = dialog.getByLabel('Name', { exact: true });
    await expect(name).toBeFocused();
    await name.fill('Deploy checklist');
    await dialog.getByLabel('Description').fill('Review and deploy');
    await dialog.getByLabel('Step type to add').selectOption('waitForText');
    await dialog.getByRole('button', { name: 'Add step', exact: true }).click();
    await dialog.getByLabel('Text to wait for').fill('Ready');
    await dialog.getByLabel('Timeout (milliseconds)').fill('12000');
    await dialog.getByLabel('Step type to add').selectOption('send');
    await dialog.getByRole('button', { name: 'Add step', exact: true }).click();
    const command = dialog.getByLabel('Command', { exact: true });
    await command.fill('Write-Output deployed');
    await expect(command).toHaveValue('Write-Output deployed');
    await expect(dialog.getByRole('button', { name: 'Create macro', exact: true })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Create macro', exact: true }).click();
    const macroRow = dialog.getByRole('button', { name: /Deploy checklist/ });
    await expect(macroRow).toBeVisible();
    await expect(macroRow).toContainText('2 steps');
    await expect(dialog.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled();

    await dialog.getByLabel('Description').fill('Review, verify, and deploy');
    await dialog.getByLabel('Step type to add').selectOption('confirm');
    await dialog.getByRole('button', { name: 'Add step', exact: true }).click();
    await dialog.getByLabel('Confirmation message').fill('Proceed with deployment?');
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(dialog.getByRole('button', { name: /Deploy checklist/ })).toContainText('3 steps');
    await expect(dialog.getByRole('button', { name: /Deploy checklist/ })).toContainText('Review, verify, and deploy');
    await dialog.getByRole('button', { name: 'Close macro manager', exact: true }).click();
    await expect(openMacros).toBeFocused();

    await app.close();
    app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`], env: electronEnvironment() });
    page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Macros', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Macros' });
    await expect(dialog.getByRole('button', { name: /Deploy checklist/ })).toContainText('3 steps');
    await dialog.getByRole('button', { name: /Deploy checklist/ }).click();
    await expect(dialog.getByLabel('Description')).toHaveValue('Review, verify, and deploy');
    await expect(dialog.getByLabel('Confirmation message')).toHaveValue('Proceed with deployment?');
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await dialog.getByRole('button', { name: 'Delete macro', exact: true }).click();
    await expect(dialog.getByText('No macros saved yet.')).toBeVisible();
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('100 saved macro definitions survive restart and each replays through the Windows workbench', async () => {
  test.skip(process.platform !== 'win32', '100-definition macro acceptance is required on Windows');
  test.setTimeout(240_000);
  const profile = await mkdtemp(join(tmpdir(), 'mrt-100-macro-replay-e2e-'));
  const markerFile = join(profile, 'replayed-macros.txt');
  let app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`], env: electronEnvironment() });
  try {
    let page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    const terminalTitle = 'PowerShell session 1';

    const definitions = Array.from({ length: 100 }, (_, index) => {
      const sequence = String(index + 1).padStart(3, '0');
      const marker = `MRT-MACRO-REPLAY-${sequence}`;
      const codes = Array.from(marker, character => character.charCodeAt(0)).join(',');
      const escapedMarkerFile = markerFile.replaceAll("'", "''");
      const command = `$mrtMarker = -join ([char[]](${codes})); [System.IO.File]::AppendAllText('${escapedMarkerFile}', $mrtMarker + [Environment]::NewLine); Write-Output $mrtMarker`;
      return { name: `Replay ${sequence}`, marker, steps: [
        { kind: 'send' as const, text: command },
        { kind: 'waitForText' as const, text: marker, timeoutMs: 15_000 }
      ] };
    });

    const storedCount = await page.evaluate(async items => {
      let count = 0;
      for (const item of items) {
        const reply = await window.multiRemoteTerminal.createMacro({ name: item.name, steps: item.steps });
        if (!reply.ok) throw new Error(`Could not store ${item.name} (${reply.error.code}).`);
        count++;
      }
      return count;
    }, definitions);
    expect(storedCount).toBe(100);

    await app.close();
    app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`], env: electronEnvironment() });
    page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    const panel = await selectTerminal(page, terminalTitle);
    const sessionId = await panel.locator('.terminal-host').getAttribute('data-mrt-terminal-session-id');
    if (!sessionId) throw new Error('The default macro replay terminal has no session id.');
    const persistedCount = await page.evaluate(async () => {
      const reply = await window.multiRemoteTerminal.listMacros();
      if (!reply.ok) throw new Error(`Could not reload macros (${reply.error.code}).`);
      return reply.result.length;
    });
    expect(persistedCount).toBe(100);

    await page.getByRole('button', { name: 'Macros', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Macros' });
    const savedMacroList = dialog.getByRole('list', { name: 'Saved macros' });
    await expect(savedMacroList.getByRole('button')).toHaveCount(100, { timeout: 20_000 });
    for (const definition of definitions) {
      await savedMacroList.getByRole('button', { name: new RegExp(`^${definition.name}\\b`) }).click();
      await dialog.getByRole('button', { name: 'Review & run', exact: true }).click();
      const review = page.getByRole('dialog', { name: 'Review macro run' });
      await expect(review.getByLabel('Run on target')).toHaveValue(sessionId);
      await expect(review.getByRole('list', { name: 'Exact macro steps' })).toContainText(definition.marker);
      await review.getByRole('button', { name: 'Run macro', exact: true }).click();
      await expect(review.getByRole('status')).toContainText('Macro completed', { timeout: 20_000 });
      await review.getByRole('button', { name: 'Done', exact: true }).click();
      dialog = page.getByRole('dialog', { name: 'Macros' });
    }

    const replayed = (await readFile(markerFile, 'utf8')).trimEnd().split(/\r?\n/u);
    expect(replayed).toEqual(definitions.map(definition => definition.marker));
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('macro shortcuts persist and open exact review before explicit playback approval', async () => {
  test.skip(process.platform !== 'win32', 'macro shortcut acceptance is required on Windows');
  test.setTimeout(90_000);
  const profile = await mkdtemp(join(tmpdir(), 'mrt-macro-shortcut-e2e-'));
  const markerFile = join(profile, 'macro-shortcut-approved.txt');
  let app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`], env: electronEnvironment() });
  try {
    let page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    const marker = 'MRT-MACRO-SHORTCUT-APPROVED';
    const codes = Array.from(marker, character => character.charCodeAt(0)).join(',');
    const escapedMarkerFile = markerFile.replaceAll("'", "''");
    const command = `$mrtMarker = -join ([char[]](${codes})); [System.IO.File]::AppendAllText('${escapedMarkerFile}', $mrtMarker); Write-Output $mrtMarker`;
    const macroId = await page.evaluate(async ({ commandText, waitText }) => {
      const reply = await window.multiRemoteTerminal.createMacro({ name: 'Shortcut review', steps: [
        { kind: 'send', text: commandText }, { kind: 'waitForText', text: waitText, timeoutMs: 15_000 }
      ] });
      if (!reply.ok) throw new Error(`Could not save macro (${reply.error.code}).`);
      return reply.result.id;
    }, { commandText: command, waitText: marker });

    await page.getByRole('button', { name: 'Macros', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Macros' });
    await dialog.getByRole('list', { name: 'Saved macros' }).getByRole('button', { name: /^Shortcut review\b/u }).click();
    await dialog.getByRole('button', { name: 'Set shortcut for Shortcut review' }).click();
    await expect(dialog.getByRole('status')).toContainText('Press Ctrl+Alt+Shift');
    await page.keyboard.press('Control+Alt+Shift+F2');
    await expect(dialog.getByRole('status')).toContainText('Shortcut saved: Ctrl+Alt+Shift+F2.');
    await expect(dialog.locator('kbd')).toHaveText('Ctrl+Alt+Shift+F2');
    await dialog.getByRole('button', { name: 'Close macro manager', exact: true }).click();

    await app.close();
    app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`], env: electronEnvironment() });
    page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Macros', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Macros' });
    await dialog.getByRole('list', { name: 'Saved macros' }).getByRole('button', { name: /^Shortcut review\b/u }).click();
    await expect(dialog.locator('kbd')).toHaveText('Ctrl+Alt+Shift+F2');
    await dialog.getByRole('button', { name: 'Close macro manager', exact: true }).click();

    const firstPanel = await selectTerminal(page, 'PowerShell session 1');
    const firstSessionId = await firstPanel.locator('.terminal-host').getAttribute('data-mrt-terminal-session-id');
    if (!firstSessionId) throw new Error('The first PowerShell terminal has no session id.');
    await runPaletteCommand(page, 'New PowerShell terminal');
    const panel = await selectTerminal(page, 'PowerShell session 2');
    const sessionId = await panel.locator('.terminal-host').getAttribute('data-mrt-terminal-session-id');
    if (!sessionId) throw new Error('The shortcut playback terminal has no session id.');
    expect(sessionId).not.toBe(firstSessionId);
    await page.keyboard.press('Control+Alt+Shift+F2');
    const review = page.getByRole('dialog', { name: 'Review macro run' });
    await expect(review.getByText('Shortcut review', { exact: true })).toBeVisible();
    await expect(review.getByLabel('Run on target')).toHaveValue(sessionId);
    await expect.poll(async () => {
      try { return await readFile(markerFile, 'utf8'); }
      catch { return undefined; }
    }).toBeUndefined();

    await review.getByRole('button', { name: 'Run macro', exact: true }).click();
    await expect(review.getByRole('status')).toContainText('Macro completed', { timeout: 20_000 });
    expect(await readFile(markerFile, 'utf8')).toBe(marker);
    expect(macroId).toMatch(/^[0-9a-f-]{36}$/u);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('macro playback previews exact steps, confirms explicitly, cancels, and requires deliberate target selection after disconnect', async () => {
  test.setTimeout(90_000);
  const profile = await mkdtemp(join(tmpdir(), 'mrt-macro-playback-e2e-'));
  const app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`], env: electronEnvironment() });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await page.setViewportSize({ width: 1564, height: 1006 });
    const terminalTitle = 'PowerShell session 1';
    const panel = await selectTerminal(page, terminalTitle);
    const rows = panel.locator('.xterm-rows');
    await expect(page.getByRole('button', { name: `${terminalTitle} running` })).toBeVisible({ timeout: 15_000 });
    await sendLine(page, terminalTitle, "function prompt { 'PS> ' }", 'PS>');
    await sendLine(page, terminalTitle, 'Clear-Host', 'PS>');
    await page.getByRole('button', { name: 'Macros', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Macros' });

    async function newMacro(name: string): Promise<void> {
      await dialog.getByRole('button', { name: 'New macro', exact: true }).click();
      await dialog.getByLabel('Name', { exact: true }).fill(name);
    }
    async function addStep(kind: string): Promise<void> {
      await dialog.getByLabel('Step type to add').selectOption(kind);
      await dialog.getByRole('button', { name: 'Add step', exact: true }).click();
    }
    async function reviewSelectedMacro(expectedTargetPanel: Locator = panel): Promise<Locator> {
      const reviewButton = dialog.getByRole('button', { name: 'Review & run', exact: true });
      await expect(reviewButton).toBeEnabled({ timeout: 15_000 });
      await reviewButton.click();
      const review = page.getByRole('dialog', { name: 'Review macro run' });
      await expect(review.getByLabel('Run on target')).toHaveValue(await expectedTargetPanel.locator('.terminal-host').getAttribute('data-mrt-terminal-session-id') ?? '');
      return review;
    }

    await newMacro('Playback success');
    await addStep('send');
    await dialog.locator('#macro-step-0-text').fill("Write-Output ([string][char]77 + 'RT-PLAYBACK-READY')");
    await addStep('waitForText');
    await dialog.locator('#macro-step-1-text').fill('MRT-PLAYBACK-READY');
    await dialog.locator('#macro-step-1-timeout').fill('10000');
    await addStep('delay');
    await dialog.locator('#macro-step-2-duration').fill('100');
    await addStep('confirm');
    await dialog.locator('#macro-step-3-message').fill('Continue after the ready marker?');
    await addStep('send');
    await dialog.locator('#macro-step-4-text').fill("Write-Output ([string][char]77 + 'RT-PLAYBACK-DONE')");
    await dialog.getByRole('button', { name: 'Create macro', exact: true }).click();
    await expect(dialog.getByRole('button', { name: /Playback success/ })).toContainText('5 steps');
    let review = await reviewSelectedMacro();
    await expect(review.getByText("Write-Output ([string][char]77 + 'RT-PLAYBACK-READY')", { exact: true })).toBeVisible();
    await expect(review.getByText('MRT-PLAYBACK-READY', { exact: true })).toBeVisible();
    await expect(review.getByText('Continue after the ready marker?', { exact: true })).toBeVisible();
    await page.screenshot({ path: 'test-results/WP-06B2-playback-actual.png' });
    await review.getByRole('button', { name: 'Run macro', exact: true }).click();
    const confirmation = review.getByRole('group', { name: 'Confirm macro step' });
    await expect(confirmation).toContainText('Continue after the ready marker?', { timeout: 15_000 });
    await confirmation.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(review.getByRole('status')).toContainText('Macro completed', { timeout: 15_000 });
    await expect(rows).toContainText('MRT-PLAYBACK-DONE', { timeout: 15_000 });
    await review.getByRole('button', { name: 'Done', exact: true }).click();

    dialog = page.getByRole('dialog', { name: 'Macros' });
    await newMacro('Playback cancellation');
    await addStep('waitForText');
    await dialog.locator('#macro-step-0-text').fill('MRT-CANCEL-NEVER-ARRIVES');
    await dialog.locator('#macro-step-0-timeout').fill('120000');
    await addStep('send');
    await dialog.locator('#macro-step-1-text').fill("Write-Output 'MRT-CANCEL-LATER'");
    await dialog.getByRole('button', { name: 'Create macro', exact: true }).click();
    review = await reviewSelectedMacro();
    await review.getByRole('button', { name: 'Run macro', exact: true }).click();
    await expect(review.getByRole('status')).toContainText('waiting for terminal text', { timeout: 10_000 });
    await review.getByRole('button', { name: 'Cancel macro', exact: true }).click();
    await expect(review.getByRole('status')).toContainText('Playback stopped', { timeout: 5_000 });
    await expect(rows).not.toContainText('MRT-CANCEL-LATER');
    await review.getByRole('button', { name: 'Done', exact: true }).click();

    dialog = page.getByRole('dialog', { name: 'Macros' });
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await runPaletteCommand(page, 'New PowerShell terminal');
    const secondPanel = await selectTerminal(page, 'PowerShell session 2');
    const secondRows = secondPanel.locator('.xterm-rows');
    await expect(page.getByRole('button', { name: 'PowerShell session 2 running' })).toBeVisible({ timeout: 15_000 });
    const firstSessionId = await panel.locator('.terminal-host').getAttribute('data-mrt-terminal-session-id');
    const secondSessionId = await secondPanel.locator('.terminal-host').getAttribute('data-mrt-terminal-session-id');
    expect(firstSessionId).toBeTruthy();
    expect(secondSessionId).toBeTruthy();

    await page.getByRole('button', { name: 'Macros', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Macros' });
    await newMacro('Playback target safety');
    await addStep('send');
    await dialog.locator('#macro-step-0-text').fill("Write-Output 'MRT-EXPLICIT-ALTERNATE'");
    await dialog.getByRole('button', { name: 'Create macro', exact: true }).click();
    review = await reviewSelectedMacro();
    await expect(review.getByLabel('Run on target')).toHaveValue(firstSessionId!);
    const exitFirstTarget = await page.evaluate(async sessionId => {
      const terminalBridge = (window as unknown as { multiRemoteTerminal?: {
        writeTerminal?: (id: string, data: string) => Promise<{ ok: boolean; error?: { code: string } }>;
      } }).multiRemoteTerminal;
      if (!terminalBridge?.writeTerminal) throw new Error('Terminal write bridge is unavailable.');
      return terminalBridge.writeTerminal(sessionId, 'exit\r');
    }, firstSessionId!);
    expect(exitFirstTarget.ok).toBe(true);
    await expect(review.getByRole('status')).toContainText('selected terminal is no longer running', { timeout: 15_000 });
    await expect(review.getByRole('button', { name: 'Run macro', exact: true })).toBeDisabled();
    await expect(review.getByLabel('Run on target')).toHaveValue(firstSessionId!);
    await expect(review.getByLabel('Run on target').locator('option:checked')).toHaveText(/PowerShell session 1.*no longer running/);
    await review.getByLabel('Run on target').selectOption(secondSessionId!);
    await expect(review.getByRole('button', { name: 'Run macro', exact: true })).toBeEnabled();
    await review.getByRole('button', { name: 'Run macro', exact: true }).click();
    await expect(review.getByRole('status')).toContainText('Macro completed', { timeout: 15_000 });
    await expect(secondRows).toContainText('MRT-EXPLICIT-ALTERNATE', { timeout: 15_000 });
    await review.getByRole('button', { name: 'Done', exact: true }).click();

    dialog = page.getByRole('dialog', { name: 'Macros' });
    await newMacro('Playback disconnect');
    await addStep('send');
    await dialog.locator('#macro-step-0-text').fill('exit');
    await addStep('waitForText');
    await dialog.locator('#macro-step-1-text').fill('MRT-DISCONNECT-NEVER-ARRIVES');
    await dialog.locator('#macro-step-1-timeout').fill('120000');
    await addStep('send');
    await dialog.locator('#macro-step-2-text').fill("Write-Output 'MRT-DISCONNECT-LATER'");
    await dialog.getByRole('button', { name: 'Create macro', exact: true }).click();
    review = await reviewSelectedMacro(secondPanel);
    await review.getByRole('button', { name: 'Run macro', exact: true }).click();
    await expect(review.getByRole('status')).toContainText('UNAVAILABLE', { timeout: 10_000 });
    await expect(secondRows).not.toContainText('MRT-DISCONNECT-LATER');
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('macro playback sends reviewed steps through a trusted SSH terminal', async () => {
  test.skip(process.platform !== 'win32', 'SSH macro playback acceptance is required on Windows');
  test.setTimeout(90_000);
  const profile = await mkdtemp(join(tmpdir(), 'mrt-macro-ssh-playback-e2e-'));
  const ssh2 = createRequire(resolve('apps/desktop/package.json'))('ssh2') as Ssh2FixturePackage;
  const keyPair = ssh2.utils.generateKeyPairSync('ed25519');
  const command = 'echo MRT-SSH-MACRO-PLAYBACK-OK';
  const receivedLines: string[] = [];
  const fixtureErrors: string[] = [];
  const clients = new Set<Ssh2FixtureClient>();
  let shuttingDown = false;
  const server = new ssh2.Server({ hostKeys: [keyPair.private] }, rawClient => {
    const client = rawClient as Ssh2FixtureClient;
    clients.add(client);
    client.once('close', () => clients.delete(client));
    client.on('error', error => { if (!shuttingDown) fixtureErrors.push(error.message); });
    client.on('authentication', (rawContext: unknown) => {
      const context = rawContext as Ssh2AuthenticationContext;
      if (context.method === 'password' && context.username === 'mrt-e2e-user' && context.password === 'sftp-e2e-secret') context.accept();
      else context.reject();
    });
    client.on('ready', () => client.on('session', (acceptSession: () => Ssh2FixtureSession) => {
      const session = acceptSession();
      session.on('pty', (accept: () => void) => accept());
      session.on('shell', (acceptShell: () => Ssh2FixtureStream) => {
        const stream = acceptShell();
        stream.write('MRT-SSH-MACRO-PLAYBACK-READY\r\n');
        let pending = '';
        stream.on('data', (raw: unknown) => {
          pending += Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
          const lines = pending.split(/\r\n|\r|\n/u);
          pending = lines.pop() ?? '';
          for (const received of lines) {
            if (!received) continue;
            receivedLines.push(received);
            if (received === command) stream.write('MRT-SSH-MACRO-PLAYBACK-OK\r\n');
          }
        });
      });
    }));
  });
  server.on('error', error => { if (!shuttingDown) fixtureErrors.push(`server: ${error.message}`); });
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  let listening = false;
  try {
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(0, '127.0.0.1', () => { listening = true; resolveListen(); });
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('The SSH macro playback fixture did not bind a TCP address.');
    app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`, '--mrt-e2e-ssh-credentials'],
      env: { ...electronEnvironment(), MRT_E2E: '1' } });
    const page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Connect to SSH', exact: true }).first().click();
    const connect = page.getByRole('dialog', { name: 'Connect to an SSH server' });
    await connect.getByLabel('Host name or IP address').fill('127.0.0.1');
    await connect.getByLabel('Port').fill(String(address.port));
    await connect.getByRole('button', { name: 'Connect', exact: true }).click();
    const trust = page.getByRole('dialog', { name: 'Verify this SSH host' });
    await expect(trust).toBeVisible({ timeout: 15_000 });
    await expect(trust.locator('.ssh-host-facts')).toContainText(`127.0.0.1:${address.port}`);
    await trust.getByRole('button', { name: 'Trust key and connect' }).click();
    const tab = page.getByRole('tab').filter({ hasText: `127.0.0.1:${address.port} - SSH` }).first();
    await expect(tab).toBeVisible({ timeout: 20_000 });
    const panelId = await tab.getAttribute('aria-controls');
    if (!panelId) throw new Error('Missing SSH macro playback terminal panel.');
    const panel = page.locator(`#${panelId}`);
    await expect(panel.locator('.xterm-rows')).toContainText('MRT-SSH-MACRO-PLAYBACK-READY', { timeout: 10_000 });
    const sessionId = await panel.locator('.terminal-host').getAttribute('data-mrt-terminal-session-id');
    if (!sessionId) throw new Error('The SSH macro playback terminal has no session id.');

    const macroId = await page.evaluate(async ({ commandText }) => {
      const reply = await window.multiRemoteTerminal.createMacro({ name: 'SSH playback', steps: [
        { kind: 'send', text: commandText }, { kind: 'waitForText', text: 'MRT-SSH-MACRO-PLAYBACK-OK', timeoutMs: 15_000 }
      ] });
      if (!reply.ok) throw new Error(`Could not create SSH playback macro (${reply.error.code}).`);
      return reply.result.id;
    }, { commandText: command });

    await page.getByRole('button', { name: 'Macros', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Macros' });
    await dialog.getByRole('list', { name: 'Saved macros' }).getByRole('button', { name: /^SSH playback\b/u }).click();
    await dialog.getByRole('button', { name: 'Review & run', exact: true }).click();
    const review = page.getByRole('dialog', { name: 'Review macro run' });
    await expect(review.getByLabel('Run on target')).toHaveValue(sessionId);
    await expect(review.getByRole('list', { name: 'Exact macro steps' })).toContainText(command);
    expect(receivedLines).toEqual([]);
    await review.getByRole('button', { name: 'Run macro', exact: true }).click();
    await expect(review.getByRole('status')).toContainText('Macro completed', { timeout: 20_000 });
    await expect(panel.locator('.xterm-rows')).toContainText('MRT-SSH-MACRO-PLAYBACK-OK', { timeout: 10_000 });
    expect(receivedLines).toEqual([command]);
    expect(fixtureErrors).toEqual([]);
    expect(macroId).toMatch(/^[0-9a-f-]{36}$/u);
  } finally {
    shuttingDown = true;
    await app?.close();
    for (const client of clients) client.end();
    if (listening) await new Promise<void>(resolveClose => server.close(() => resolveClose()));
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('macro playback sends reviewed steps through an explicitly acknowledged Telnet terminal', async () => {
  test.skip(process.platform !== 'win32', 'Telnet macro playback acceptance is required on Windows');
  test.setTimeout(90_000);
  const profile = await mkdtemp(join(tmpdir(), 'mrt-macro-telnet-playback-e2e-'));
  const command = 'echo MRT-TELNET-MACRO-PLAYBACK-OK';
  const commandBytes = Buffer.from(`${command}\r`, 'utf8');
  const sockets = new Set<Socket>();
  const fixtureErrors: string[] = [];
  let receivedCount = 0;
  const server = createServer(socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('error', error => { if (server.listening) fixtureErrors.push(error.message); });
    socket.write(Buffer.from([255, 251, 1, 255, 251, 3, 255, 253, 3, 255, 251, 0, 255, 253, 0, 255, 253, 24, 255, 253, 31]));
    socket.write(Buffer.from([255, 250, 24, 1, 255, 240]));
    socket.write('MRT-TELNET-MACRO-PLAYBACK-READY\r\n');
    let pending = Buffer.alloc(0);
    socket.on('data', data => {
      pending = Buffer.concat([pending, data]);
      while (true) {
        const index = pending.indexOf(commandBytes);
        if (index < 0) break;
        receivedCount++;
        pending = pending.subarray(index + commandBytes.length);
        socket.write('MRT-TELNET-MACRO-PLAYBACK-OK\r\n');
      }
      if (pending.byteLength > 8_192) pending = pending.subarray(-commandBytes.byteLength);
    });
  });
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(0, '127.0.0.1', resolveListen);
    });
    const address = server.address() as AddressInfo;
    app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`], env: electronEnvironment() });
    const page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Connect to Telnet (plaintext)', exact: true }).first().click();
    const connect = page.getByRole('dialog', { name: 'Connect to a Telnet server' });
    await expect(connect.getByText('Telnet traffic is sent in plaintext.')).toBeVisible();
    await connect.getByLabel('Host name or IP address').fill('127.0.0.1');
    await connect.getByLabel('Port').fill(String(address.port));
    await connect.getByRole('button', { name: 'Connect', exact: true }).click();
    const tab = page.getByRole('tab').filter({ hasText: /Telnet \(plaintext\)/u }).first();
    await expect(tab).toBeVisible({ timeout: 15_000 });
    const panelId = await tab.getAttribute('aria-controls');
    if (!panelId) throw new Error('Missing Telnet macro playback terminal panel.');
    const panel = page.locator(`#${panelId}`);
    await expect(panel.locator('.xterm-rows')).toContainText('MRT-TELNET-MACRO-PLAYBACK-READY', { timeout: 10_000 });
    const sessionId = await panel.locator('.terminal-host').getAttribute('data-mrt-terminal-session-id');
    if (!sessionId) throw new Error('The Telnet macro playback terminal has no session id.');

    const macroId = await page.evaluate(async ({ commandText }) => {
      const reply = await window.multiRemoteTerminal.createMacro({ name: 'Telnet playback', steps: [
        { kind: 'send', text: commandText }, { kind: 'waitForText', text: 'MRT-TELNET-MACRO-PLAYBACK-OK', timeoutMs: 15_000 }
      ] });
      if (!reply.ok) throw new Error(`Could not create Telnet playback macro (${reply.error.code}).`);
      return reply.result.id;
    }, { commandText: command });

    await page.getByRole('button', { name: 'Macros', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Macros' });
    await dialog.getByRole('list', { name: 'Saved macros' }).getByRole('button', { name: /^Telnet playback\b/u }).click();
    await dialog.getByRole('button', { name: 'Review & run', exact: true }).click();
    const review = page.getByRole('dialog', { name: 'Review macro run' });
    await expect(review.getByLabel('Run on target')).toHaveValue(sessionId);
    await expect(review.getByRole('list', { name: 'Exact macro steps' })).toContainText(command);
    expect(receivedCount).toBe(0);
    await review.getByRole('button', { name: 'Run macro', exact: true }).click();
    await expect(review.getByRole('status')).toContainText('Macro completed', { timeout: 20_000 });
    await expect(panel.locator('.xterm-rows')).toContainText('MRT-TELNET-MACRO-PLAYBACK-OK', { timeout: 10_000 });
    expect(receivedCount).toBe(1);
    expect(fixtureErrors).toEqual([]);
    expect(macroId).toMatch(/^[0-9a-f-]{36}$/u);
  } finally {
    await app?.close();
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise<void>(resolveClose => server.close(() => resolveClose()));
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('MultiExec reviews the exact line and sends only after confirmation to three running terminals', async () => {
  test.skip(process.platform !== 'win32', 'MultiExec terminal acceptance evidence is required on Windows');
  test.setTimeout(90_000);
  const profile = await mkdtemp(join(tmpdir(), 'mrt-multiexec-e2e-'));
  const app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`], env: electronEnvironment() });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await expect(page.getByRole('tab', { name: /PowerShell session 1/ })).toBeVisible({ timeout: 15_000 });
    for (const title of ['PowerShell session 2', 'PowerShell session 3']) {
      await runPaletteCommand(page, 'New PowerShell terminal');
      await expect(page.getByRole('tab', { name: new RegExp(title) })).toBeVisible({ timeout: 15_000 });
    }

    const line = "Write-Output ([string][char]77 + 'RT-MULTIEXEC-OK')";
    const output = 'MRT-MULTIEXEC-OK';
    const outputRows = await page.locator('.terminal-panel .xterm-rows').all();
    expect(outputRows).toHaveLength(3);

    await page.getByRole('button', { name: 'MultiExec', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Send to terminals' });
    await expect(dialog.getByLabel('One-line input')).toBeFocused();
    await dialog.getByLabel('One-line input').fill(line);
    for (const title of ['PowerShell session 1', 'PowerShell session 2', 'PowerShell session 3']) {
      await dialog.getByRole('checkbox', { name: new RegExp(title) }).check();
    }
    await dialog.getByRole('button', { name: 'Review send', exact: true }).click();
    await expect(dialog.getByText(line, { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Send line to 3 terminals', exact: true })).toBeFocused();
    for (const rows of outputRows) await expect(rows).not.toContainText(output);

    await dialog.getByRole('button', { name: 'Send line to 3 terminals', exact: true }).click();
    await expect(dialog.getByRole('list', { name: 'Per-terminal send results' }).locator('.multi-exec-result-status'))
      .toHaveText(['Input sent', 'Input sent', 'Input sent']);
    await expect(dialog.getByRole('status')).toContainText('3 sent, 0 uncertain, 0 failed.');
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    for (const title of ['PowerShell session 1', 'PowerShell session 2', 'PowerShell session 3']) {
      const panel = await selectTerminal(page, title);
      await expect(panel.locator('.xterm-rows')).toContainText(output, { timeout: 20_000 });
    }
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('MultiExec sends the reviewed line to three independent SSH hosts', async () => {
  test.skip(process.platform !== 'win32', 'MultiExec terminal acceptance evidence is required on Windows');
  test.setTimeout(120_000);
  const profile = await mkdtemp(join(tmpdir(), 'mrt-multiexec-ssh-e2e-'));
  const ssh2 = createRequire(resolve('apps/desktop/package.json'))('ssh2') as Ssh2FixturePackage;
  const line = "echo MRT-MULTIEXEC-SSH-EXACT";
  const fixtureErrors: string[] = [];
  let shuttingDown = false;
  const hosts = ['one', 'two', 'three'].map(name => {
    const keyPair = ssh2.utils.generateKeyPairSync('ed25519');
    const receivedLines: string[] = [];
    const clients = new Set<Ssh2FixtureClient>();
    const server = new ssh2.Server({ hostKeys: [keyPair.private] }, rawClient => {
      const client = rawClient as Ssh2FixtureClient;
      clients.add(client);
      client.once('close', () => clients.delete(client));
      client.on('error', error => { if (!shuttingDown) fixtureErrors.push(`${name}: ${error.message}`); });
      client.on('authentication', (rawContext: unknown) => {
        const context = rawContext as Ssh2AuthenticationContext;
        if (context.method === 'password' && context.username === 'mrt-e2e-user' && context.password === 'sftp-e2e-secret') context.accept();
        else context.reject();
      });
      client.on('ready', () => client.on('session', (acceptSession: () => Ssh2FixtureSession) => {
        const session = acceptSession();
        session.on('pty', (accept: () => void) => accept());
        session.on('shell', (acceptShell: () => Ssh2FixtureStream) => {
          const stream = acceptShell();
          stream.write(`MRT-MULTIEXEC-SSH-${name}-READY\r\n`);
          let pending = '';
          stream.on('data', (raw: unknown) => {
            pending += Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
            const lines = pending.split(/\r\n|\r|\n/u);
            pending = lines.pop() ?? '';
            for (const received of lines) {
              if (!received) continue;
              receivedLines.push(received);
              if (received === line) stream.write(`MRT-MULTIEXEC-SSH-${name}-OK\r\n`);
            }
          });
        });
      }));
    });
    server.on('error', error => { if (!shuttingDown) fixtureErrors.push(`${name} server: ${error.message}`); });
    return { name, server, clients, receivedLines, port: 0 as number };
  });
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  const listening: typeof hosts = [];
  try {
    for (const host of hosts) {
      await new Promise<void>((resolveListen, rejectListen) => {
        host.server.once('error', rejectListen);
        host.server.listen(0, '127.0.0.1', () => {
          const address = host.server.address();
          if (!address || typeof address === 'string') { rejectListen(new Error(`SSH fixture ${host.name} did not bind a TCP address`)); return; }
          host.port = address.port;
          listening.push(host);
          resolveListen();
        });
      });
    }

    app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`, '--mrt-e2e-ssh-credentials'],
      env: { ...electronEnvironment(), MRT_E2E: '1' } });
    const page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    for (const host of hosts) {
      await page.getByRole('button', { name: 'Connect to SSH', exact: true }).first().click();
      const connect = page.getByRole('dialog', { name: 'Connect to an SSH server' });
      await connect.getByLabel('Host name or IP address').fill('127.0.0.1');
      await connect.getByLabel('Port').fill(String(host.port));
      await connect.getByRole('button', { name: 'Connect', exact: true }).click();
      const trust = page.getByRole('dialog', { name: 'Verify this SSH host' });
      await expect(trust).toBeVisible({ timeout: 15_000 });
      await expect(trust.locator('.ssh-host-facts')).toContainText(`127.0.0.1:${host.port}`);
      await trust.getByRole('button', { name: 'Trust key and connect' }).click();
      const tab = page.getByRole('tab').filter({ hasText: `127.0.0.1:${host.port} - SSH` }).first();
      await expect(tab).toBeVisible({ timeout: 20_000 });
      const panelId = await tab.getAttribute('aria-controls');
      if (!panelId) throw new Error(`Missing SSH terminal panel for fixture ${host.name}`);
      await expect(page.locator(`#${panelId} .xterm-rows`)).toContainText(`MRT-MULTIEXEC-SSH-${host.name}-READY`, { timeout: 10_000 });
    }

    await page.getByRole('button', { name: 'MultiExec', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Send to terminals' });
    await dialog.getByLabel('One-line input').fill(line);
    for (const host of hosts) await dialog.getByRole('checkbox', { name: new RegExp(`127\\.0\\.0\\.1:${host.port}`) }).check();
    await dialog.getByRole('button', { name: 'Review send', exact: true }).click();
    await expect(dialog.getByText(line, { exact: true })).toBeVisible();
    const reviewedDestinations = dialog.getByRole('list', { name: 'Reviewed terminal destinations' });
    await expect(reviewedDestinations.getByText('SSH', { exact: false })).toHaveCount(3);
    for (const host of hosts) await expect(reviewedDestinations).toContainText(`127.0.0.1:${host.port}`);
    for (const host of hosts) expect(host.receivedLines).toEqual([]);

    await dialog.getByRole('button', { name: 'Send line to 3 terminals', exact: true }).click();
    await expect(dialog.getByRole('list', { name: 'Per-terminal send results' }).locator('.multi-exec-result-status'))
      .toHaveText(['Input sent', 'Input sent', 'Input sent']);
    await expect(dialog.getByRole('status')).toContainText('3 sent, 0 uncertain, 0 failed.');
    await expect(dialog.getByRole('status')).toBeFocused();
    await expect.poll(() => hosts.map(host => host.receivedLines.filter(received => received === line).length)).toEqual([1, 1, 1]);
    for (const host of hosts) expect(host.receivedLines).toEqual([line]);
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toBeFocused();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    for (const host of hosts) {
      const panel = await selectTerminal(page, `127.0.0.1:${host.port} - SSH`);
      await expect(panel.locator('.xterm-rows')).toContainText(`MRT-MULTIEXEC-SSH-${host.name}-OK`, { timeout: 15_000 });
    }
    expect(fixtureErrors).toEqual([]);
  } finally {
    shuttingDown = true;
    await app?.close();
    for (const host of hosts) for (const client of host.clients) client.end();
    for (const host of listening) await new Promise<void>(resolveClose => host.server.close(() => resolveClose()));
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('macro recorder captures completed terminal lines and suppresses a recognized password prompt', async () => {
  test.setTimeout(60_000);
  const profile = await mkdtemp(join(tmpdir(), 'mrt-macro-recording-e2e-'));
  const app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`], env: electronEnvironment() });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Macros', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Macros' });
    await dialog.getByLabel('New recording name').fill('Secret-safe recording');
    await dialog.getByRole('button', { name: 'Start recording', exact: true }).click();
    const banner = page.getByRole('region', { name: 'Macro recording controls' });
    await expect(banner).toBeVisible();

    const title = 'PowerShell session 1';
    const tab = page.getByRole('tab', { name: new RegExp(title) });
    const panelId = await tab.getAttribute('aria-controls');
    if (!panelId) throw new Error('The default recording target has no terminal panel.');
    const panel = page.locator(`#${panelId}`);
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(panel.locator('.xterm-helper-textarea')).toBeFocused();

    const secret = 'never-store-this-secret';
    const promptCommand = "$mrtSecret = Read-Host -Prompt 'Password' -AsSecureString; Write-Output 'MRT-RECORDER-READY'";
    const pastedCommand = "Write-Output 'MRT-RECORDER-PASTE-OMITTED'";
    await app.evaluate(({ clipboard }, value) => clipboard.writeText(value), pastedCommand);
    await page.keyboard.press('Control+V');
    await page.keyboard.press('Enter');
    await expect(panel.locator('.xterm-rows')).toContainText('MRT-RECORDER-PASTE-OMITTED', { timeout: 15_000 });
    await expect(banner).toContainText('0 complete lines');
    await page.keyboard.type(promptCommand);
    await page.keyboard.press('Enter');
    await expect(panel.locator('.xterm-rows')).toContainText('Password:', { timeout: 15_000 });
    await expect(banner.getByRole('status')).toContainText('recognized secret prompt');
    await expect(banner).toContainText('1 complete line');
    await page.keyboard.type(secret);
    await page.keyboard.press('Enter');
    await expect(panel.locator('.xterm-rows')).toContainText('MRT-RECORDER-READY', { timeout: 15_000 });
    await expect(banner).toContainText('Recording paused');

    const verificationCommand = "$mrtCode = Read-Host -Prompt 'Verification code'; Write-Output 'MRT-RECORDER-CODE-READY'";
    const verificationCode = 'never-store-this-code';
    await page.keyboard.type(verificationCommand);
    await page.keyboard.press('Enter');
    await expect(panel.locator('.xterm-rows')).toContainText('Verification code:', { timeout: 15_000 });
    await expect(banner.getByRole('status')).toContainText('recognized secret prompt');
    await banner.getByRole('button', { name: 'Resume recording', exact: true }).click();
    await expect(banner.getByRole('status')).toContainText('recognized secret prompt');
    await expect(banner).toContainText('Recording paused');
    await banner.getByRole('button', { name: 'Resume recording', exact: true }).click();
    await expect(banner.getByRole('button', { name: 'Resume recording', exact: true })).toBeVisible();
    await expect(banner.getByRole('status')).toContainText('recognized secret prompt');
    await page.keyboard.type(verificationCode);
    await page.keyboard.press('Enter');
    await expect(panel.locator('.xterm-rows')).toContainText('MRT-RECORDER-CODE-READY', { timeout: 15_000 });
    await expect(banner).toContainText('Recording paused');
    await banner.getByRole('button', { name: 'Resume recording', exact: true }).click();
    await expect(banner.locator('[role="status"]')).toHaveCount(0);
    await expect(panel.locator('.xterm-helper-textarea')).toBeFocused();
    await page.keyboard.type("Write-Output 'MRT-RECORDER-SAFE'");
    await page.keyboard.press('Enter');
    await expect(panel.locator('.xterm-rows')).toContainText('MRT-RECORDER-SAFE', { timeout: 15_000 });
    await expect(banner).toContainText('2 complete lines');

    await banner.getByRole('button', { name: 'Stop and save', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Recording saved');
    await page.getByRole('button', { name: 'Macros', exact: true }).click();
    const saved = page.getByRole('dialog', { name: 'Macros' });
    const macro = saved.getByRole('button', { name: /Secret-safe recording/ });
    await expect(macro).toContainText('2 steps');
    await macro.click();
    const first = saved.locator('#macro-step-0-text');
    const second = saved.locator('#macro-step-1-text');
    await expect(first).toHaveValue(promptCommand);
    await expect(second).toHaveValue("Write-Output 'MRT-RECORDER-SAFE'");
    await expect(first).not.toHaveValue(new RegExp(secret));
    await expect(second).not.toHaveValue(new RegExp(secret));
    await expect(first).not.toHaveValue(new RegExp(verificationCode));
    await expect(second).not.toHaveValue(new RegExp(verificationCode));
    await expect(second).not.toHaveValue(verificationCommand);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('macro recorder protects a recognized password prompt already open when recording starts', async () => {
  test.setTimeout(60_000);
  const profile = await mkdtemp(join(tmpdir(), 'mrt-macro-open-prompt-e2e-'));
  const app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`], env: electronEnvironment() });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    const title = 'PowerShell session 1';
    const panel = await selectTerminal(page, title);
    await panel.locator('.terminal-host').click({ position: { x: 80, y: 60 } });
    await expect(panel.locator('.xterm-helper-textarea')).toBeFocused();

    const secret = 'never-store-this-open-prompt-secret';
    const promptCommand = "$mrtSecret = Read-Host -Prompt 'Password' -AsSecureString; Write-Output 'MRT-OPEN-PROMPT-READY'";
    await page.keyboard.type(promptCommand);
    await page.keyboard.press('Enter');
    await expect(panel.locator('.xterm-rows')).toContainText('Password:', { timeout: 15_000 });

    await page.getByRole('button', { name: 'Macros', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Macros' });
    await dialog.getByLabel('New recording name').fill('Open prompt recording');
    await dialog.getByRole('button', { name: 'Start recording', exact: true }).click();
    const banner = page.getByRole('region', { name: 'Macro recording controls' });
    await expect(banner).toBeVisible();
    await expect(banner.getByRole('status')).toContainText('recognized secret prompt');
    await expect(panel.locator('.xterm-helper-textarea')).toBeFocused();

    await page.keyboard.type(secret);
    await page.keyboard.press('Enter');
    await expect(panel.locator('.xterm-rows')).toContainText('MRT-OPEN-PROMPT-READY', { timeout: 15_000 });
    await expect(banner).toContainText('Recording paused');
    await banner.getByRole('button', { name: 'Resume recording', exact: true }).click();
    await expect(panel.locator('.xterm-helper-textarea')).toBeFocused();
    await page.keyboard.type("Write-Output 'MRT-OPEN-PROMPT-SAFE'");
    await page.keyboard.press('Enter');
    await expect(panel.locator('.xterm-rows')).toContainText('MRT-OPEN-PROMPT-SAFE', { timeout: 15_000 });
    await expect(banner).toContainText('1 complete line');

    await banner.getByRole('button', { name: 'Stop and save', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Recording saved');
    await page.getByRole('button', { name: 'Macros', exact: true }).click();
    const saved = page.getByRole('dialog', { name: 'Macros' });
    const macro = saved.getByRole('button', { name: /Open prompt recording/ });
    await expect(macro).toContainText('1 step');
    await macro.click();
    await expect(saved.locator('#macro-step-0-text')).toHaveValue("Write-Output 'MRT-OPEN-PROMPT-SAFE'");
    await expect(saved.locator('#macro-step-0-text')).not.toHaveValue(new RegExp(secret));
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('terminal tabs close by Ctrl+W or middle-click and expose terminal-only actions', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'mrt-terminal-tab-actions-e2e-'));
  const app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`], env: electronEnvironment() });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    const title = 'PowerShell session 1';
    const marker = 'MRT-TAB-CONTEXT-CLEARED';
    const { rows } = await sendLine(page, title, `Write-Output '${marker}'`, marker);
    const tab = page.getByRole('tab', { name: new RegExp(title) });

    await tab.click({ button: 'right' });
    const menu = page.getByRole('menu', { name: `Terminal actions for ${title}` });
    await expect(menu).toBeVisible();
    await page.screenshot({ path: 'test-results/terminal-tab-context-menu.png', fullPage: true });
    await expect(menu.getByRole('menuitem', { name: 'Copy selection' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(menu).toHaveCount(0);
    await expect(tab).toBeFocused();

    await tab.click({ button: 'right' });
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(tab).toBeFocused();

    await tab.click({ button: 'right' });
    await expect(menu).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.setSize(1060, 720));
    await expect(menu).toHaveCount(0);
    await expect(tab).toBeFocused();

    const outputMarker = rows.getByText(marker, { exact: true });
    const markerBoundsRef: { current: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null } = { current: null };
    await expect.poll(async () => {
      markerBoundsRef.current = await outputMarker.boundingBox();
      return markerBoundsRef.current;
    }, { timeout: 5_000 }).not.toBeNull();
    const markerBounds = markerBoundsRef.current;
    if (!markerBounds) throw new Error('The terminal output marker is not visible for clipboard selection.');
    await page.mouse.move(markerBounds.x + 1, markerBounds.y + markerBounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(markerBounds.x + markerBounds.width + 2, markerBounds.y + markerBounds.height / 2);
    await page.mouse.up();
    await tab.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Copy selection' }).click();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(marker);

    await tab.click({ button: 'right' });
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Clear terminal' }).click();
    await expect(rows).not.toContainText(marker);

    await page.locator('.terminal-host').click({ position: { x: 80, y: 60 } });
    await page.keyboard.press('Control+W');
    let confirmation = page.getByRole('alertdialog');
    await expect(confirmation).toContainText(title);
    await confirmation.getByRole('button', { name: 'Keep terminal' }).click();
    await expect(tab).toBeVisible();

    await tab.click({ button: 'middle' });
    confirmation = page.getByRole('alertdialog');
    await expect(confirmation).toContainText(title);
    await confirmation.getByRole('button', { name: 'Keep terminal' }).click();
    await expect(tab).toBeVisible();

    await tab.click({ button: 'right' });
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Close terminal' }).click();
    confirmation = page.getByRole('alertdialog');
    await expect(confirmation).toContainText(title);
    await confirmation.getByRole('button', { name: 'Close terminal' }).click();
    await expect(page.getByRole('tab')).toHaveCount(0);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('saved-session folders create, nest, move, rename, delete safely and persist across restart', async () => {
  test.setTimeout(60_000);
  const profile = await mkdtemp(join(tmpdir(), 'mrt-session-folders-e2e-'));
  let app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`], env: electronEnvironment() });
  try {
    let page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await expect(page.getByRole('tab', { name: /PowerShell session 1/ })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Save active session', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Save active session' });
    await dialog.getByLabel('Session name').fill('Folder saved shell');
    await dialog.getByRole('button', { name: 'Save session', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open Folder saved shell', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Save active session', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Save active session' });
    await dialog.getByLabel('Session name').fill('Second saved shell');
    await dialog.getByRole('button', { name: 'Save session', exact: true }).click();
    await expect(page.locator('.saved-session-count')).toHaveText('2');
    await page.getByRole('searchbox', { name: 'Search saved sessions' }).fill('Folder saved shell');
    await expect(page.locator('.saved-session-open')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Open Folder saved shell', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open Second saved shell', exact: true })).toHaveCount(0);
    await expect(page.locator('.saved-session-count')).toHaveText('2');
    await page.getByRole('searchbox', { name: 'Search saved sessions' }).clear();
    await expect(page.locator('.saved-session-open')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Open Second saved shell', exact: true })).toBeVisible();

    await page.getByRole('button', { name: '+ Folder', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Create folder' });
    await dialog.getByLabel('Folder name').fill('Work');
    await dialog.getByRole('button', { name: 'Create folder', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Collapse folder Work', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Actions for folder Work' }).click();
    await page.getByRole('button', { name: 'Create subfolder in Work', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Create folder' });
    await dialog.getByLabel('Folder name').fill('Lab');
    await dialog.getByRole('button', { name: 'Create folder', exact: true }).click();

    await page.getByRole('button', { name: 'Actions for saved session Folder saved shell' }).click();
    await page.getByRole('button', { name: 'Move saved session Folder saved shell', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Move Folder saved shell' });
    await dialog.getByLabel('Move to').selectOption({ label: 'Work / Lab' });
    await dialog.getByRole('button', { name: 'Move', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open Folder saved shell', exact: true })).toBeVisible();
    await page.screenshot({ path: 'test-results/saved-session-folders.png', fullPage: true });
    await page.getByRole('button', { name: 'Open Folder saved shell', exact: true }).click();
    await expect(page.getByRole('tab').filter({ hasText: 'Folder saved shell' })).toHaveCount(1);

    await page.getByRole('button', { name: 'Actions for folder Work' }).click();
    await page.getByRole('button', { name: 'Rename folder Work', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Rename Work' });
    await dialog.getByLabel('Folder name').fill('Projects');
    await dialog.getByRole('button', { name: 'Save name', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Collapse folder Projects', exact: true })).toBeVisible();

    await page.getByRole('button', { name: '+ Folder', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Create folder' });
    await dialog.getByLabel('Folder name').fill('Archive');
    await dialog.getByRole('button', { name: 'Create folder', exact: true }).click();
    await page.getByRole('button', { name: 'Actions for folder Projects' }).click();
    await page.getByRole('button', { name: 'Move folder Projects', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Move Projects' });
    await dialog.getByLabel('Move under').selectOption({ label: 'Archive' });
    await dialog.getByRole('button', { name: 'Move', exact: true }).click();
    await page.getByRole('button', { name: 'Actions for folder Archive' }).click();
    await page.getByRole('button', { name: 'Rename folder Archive', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Rename Archive' });
    await dialog.getByLabel('Folder name').fill('Team');
    await dialog.getByRole('button', { name: 'Save name', exact: true }).click();
    await page.getByRole('button', { name: 'Actions for folder Team' }).click();
    page.once('dialog', nativeDialog => nativeDialog.accept());
    await page.getByRole('button', { name: 'Delete folder Team', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Collapse folder Projects', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Collapse folder Lab', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open Folder saved shell', exact: true })).toBeVisible();

    await app.close();
    app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`], env: electronEnvironment() });
    page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Collapse folder Projects', exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Expand folder Lab', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Expand folder Lab', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Collapse folder Lab', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Open Folder saved shell', exact: true }).click();
    await expect(page.getByRole('tab').filter({ hasText: 'Folder saved shell' })).toHaveCount(1);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('saved-folder JSON export imports into a fresh profile and stays persisted after restart', async () => {
  test.setTimeout(90_000);
  const sourceProfile = await mkdtemp(join(tmpdir(), 'mrt-folder-export-source-'));
  const targetProfile = await mkdtemp(join(tmpdir(), 'mrt-folder-export-target-'));
  const bundleDirectory = await mkdtemp(join(tmpdir(), 'mrt-folder-export-file-'));
  const bundlePath = join(bundleDirectory, 'portable.mrt-session-folder.json');
  let app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${sourceProfile}`], env: electronEnvironment() });
  try {
    let page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Save active session', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Save active session' });
    await dialog.getByLabel('Session name').fill('Portable shell');
    await dialog.getByRole('button', { name: 'Save session', exact: true }).click();
    await page.getByRole('button', { name: '+ Folder', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Create folder' });
    await dialog.getByLabel('Folder name').fill('Portable');
    await dialog.getByRole('button', { name: 'Create folder', exact: true }).click();
    await page.getByRole('button', { name: 'Actions for saved session Portable shell' }).click();
    await page.getByRole('button', { name: 'Move saved session Portable shell', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Move Portable shell' });
    await dialog.getByLabel('Move to').selectOption({ label: 'Portable' });
    await dialog.getByRole('button', { name: 'Move', exact: true }).click();

    await app.evaluate(({ dialog: nativeDialog }, filePath) => {
      Object.defineProperty(nativeDialog, 'showSaveDialog', { configurable: true,
        value: async () => ({ canceled: false, filePath }) });
    }, bundlePath);
    await page.getByRole('button', { name: 'Actions for folder Portable' }).click();
    await page.getByRole('button', { name: 'Export folder Portable', exact: true }).click();
    await expect(page.locator('.alert-strip > span')).toContainText('Exported 1 folder and 1 saved session.');
    const bundleText = await readFile(bundlePath, 'utf8');
    expect(bundleText).toContain('multiremote-terminal/session-folder');
    expect(bundleText).toContain('Portable shell');
    expect(bundleText).not.toMatch(/password|credential|privateKey/i);
    await app.close();

    app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${targetProfile}`], env: electronEnvironment() });
    page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await app.evaluate(({ dialog: nativeDialog }, filePath) => {
      Object.defineProperty(nativeDialog, 'showOpenDialog', { configurable: true,
        value: async () => ({ canceled: false, filePaths: [filePath] }) });
    }, bundlePath);
    await page.getByRole('button', { name: 'Import a saved session folder', exact: true }).click();
    await expect(page.locator('.alert-strip > span')).toContainText('Imported 1 folder and 1 saved session (1 folders and 1 sessions added).');
    await expect(page.getByRole('button', { name: 'Collapse folder Portable', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open Portable shell', exact: true })).toBeVisible();
    await expect(page.getByLabel('1 saved session')).toBeVisible();

    await app.close();
    app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${targetProfile}`], env: electronEnvironment() });
    page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Collapse folder Portable', exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Open Portable shell', exact: true })).toBeVisible();
  } finally {
    await app.close();
    await rm(sourceProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    await rm(targetProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    await rm(bundleDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('a timed-out saved-session write must be checked before retrying, even after dialog dismissal', async () => {
  test.setTimeout(30_000);
  const profile = await mkdtemp(join(tmpdir(), 'mrt-session-timeout-e2e-'));
  const app = await electron.launch({
    args: [resolve('apps/desktop'), `--user-data-dir=${profile}`, '--mrt-e2e-delay-first-session-create-reply'],
    env: { ...electronEnvironment(), MRT_E2E: '1' }
  });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await expect(page.getByRole('tab', { name: /PowerShell session 1/ })).toBeVisible({ timeout: 15_000 });
    const saveButton = page.getByRole('button', { name: 'Save active session', exact: true });
    await saveButton.click();
    let dialog = page.getByRole('dialog', { name: 'Save active session' });
    await dialog.getByLabel('Session name').fill('Timed save reconciliation');
    await dialog.getByRole('button', { name: 'Save session', exact: true }).click();

    dialog = page.getByRole('dialog', { name: 'Check save status' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByRole('alert')).toHaveText('Saving could not be confirmed. Check Saved sessions before trying again.');
    await expect(dialog.getByLabel('Session name')).toBeDisabled();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    await saveButton.click();
    dialog = page.getByRole('dialog', { name: 'Check save status' });
    await expect(dialog).toBeVisible();
    const checkButton = dialog.getByRole('button', { name: 'Check saved sessions', exact: true });
    await expect(checkButton).toBeFocused();
    await expect(dialog.getByRole('button', { name: 'Save session', exact: true })).toHaveCount(0);
    await checkButton.click();

    await expect(page.locator('.alert-strip > span')).toHaveText('This session is already saved. Open it from Saved sessions instead of saving it again.');
    await expect(page.getByRole('button', { name: 'Open Timed save reconciliation', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Actions for saved session Timed save reconciliation' }).click();
    await expect(page.getByRole('button', { name: 'Delete saved session Timed save reconciliation', exact: true })).toHaveCount(1);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('SQLite storage worker migrates host trust and shuts down inside Electron', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'mrt-storage-worker-e2e-'));
  const app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`], env: electronEnvironment() });
  const databasePath = join(profile, 'storage-smoke.sqlite');
  const algorithm = 'ssh-ed25519';
  const algorithmBytes = Buffer.from(algorithm, 'ascii');
  const publicKey = Buffer.concat([Buffer.from([0, 0, 0, algorithmBytes.length]), algorithmBytes, Buffer.alloc(32, 41)]);
  const fingerprint = `SHA256:${createHash('sha256').update(publicKey).digest('base64').replace(/=+$/, '')}`;
  const identity = {
    endpoint: { host: 'storage.example', port: 2222 }, algorithm, fingerprint,
    publicKey: Uint8Array.from(publicKey), trustedAt: 1_800_000_000_041, approvalSource: 'user'
  } as const;
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    const reply = await app.evaluate(async ({ utilityProcess }, { workerPath, appRoot, databasePath, identity }) => new Promise<unknown>((resolveReply, rejectReply) => {
      const requestIds = Array.from({ length: 8 }, (_unused, index) => `00000000-0000-4000-8000-${String(index + 2).padStart(12, '0')}`);
      const replies: { imported?: unknown; found?: unknown; created?: unknown; searched?: unknown; favorited?: unknown; favoriteChecked?: unknown; removed?: unknown; shutdown?: unknown } = {};
      const child = utilityProcess.fork(workerPath, [], { cwd: appRoot, env: { MRT_STORAGE_DB_PATH: databasePath }, stdio: 'ignore' });
      const send = (index: number, command: string, payload: Record<string, unknown> = {}) => child.postMessage({
        version: 1, type: 'request', requestId: requestIds[index], command, ...payload
      });
      const observed: string[] = [];
      let settled = false;
      const finish = (error?: Error, value?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) rejectReply(error);
        else resolveReply(value);
      };
      const timer = setTimeout(() => { child.kill(); finish(new Error(`SQLite storage worker did not shut down; replies: ${observed.join(', ') || 'none'}`)); }, 10_000);
      child.once('error', error => finish(new Error(String(error))));
      child.once('exit', code => replies.shutdown ? finish(undefined, replies) : finish(new Error(`SQLite storage worker exited before replying (${code})`)));
      child.on('message', value => {
        const message = value as { type?: unknown; requestId?: unknown; ok?: unknown; result?: { kind?: unknown; value?: unknown } };
        observed.push(message.type === 'reply' ? `${String(message.requestId)}:${String(message.ok)}` : String(message.type));
        if (message.type === 'ready') send(0, 'hostTrust.importLegacy', { identities: [identity] });
        else if (message.type === 'startup-error') finish(new Error('SQLite storage worker failed to initialize'));
        else if (typeof message.requestId === 'string' && message.ok !== true) finish(new Error(`SQLite storage worker rejected ${message.requestId}`));
        else if (message.requestId === requestIds[0] && message.ok === true) {
          replies.imported = message.result?.value;
          send(1, 'hostTrust.find', { endpoint: identity.endpoint });
        } else if (message.requestId === requestIds[1] && message.ok === true) {
          const saved = message.result?.value as typeof identity | null | undefined;
          replies.found = saved ? {
            endpoint: saved.endpoint, algorithm: saved.algorithm, fingerprint: saved.fingerprint,
            publicKeyBase64: Buffer.from(saved.publicKey).toString('base64'), trustedAt: saved.trustedAt,
            approvalSource: saved.approvalSource
          } : null;
          send(2, 'session.create', { draft: { kind: 'ssh', name: 'Storage gateway', host: 'catalog.example', port: 2200 } });
        } else if (message.requestId === requestIds[2] && message.ok === true) {
          const saved = message.result?.value as { id?: unknown; kind?: unknown; name?: unknown; host?: unknown; port?: unknown; favorite?: unknown };
          replies.created = saved;
          if (typeof saved?.id !== 'string') { finish(new Error('SQLite storage worker returned an invalid saved session')); return; }
          send(3, 'session.list', { query: 'CATALOG.EXAMPLE' });
        } else if (message.requestId === requestIds[3] && message.ok === true) {
          replies.searched = message.result?.value;
          const saved = replies.created as { id: string };
          send(4, 'session.favorite', { id: saved.id, favorite: true });
        } else if (message.requestId === requestIds[4] && message.ok === true) {
          replies.favorited = message.result?.value;
          send(5, 'session.list', { query: '' });
        } else if (message.requestId === requestIds[5] && message.ok === true) {
          const saved = replies.created as { id: string };
          const items = message.result?.value as { id?: string; favorite?: boolean }[];
          replies.favoriteChecked = items.find(item => item.id === saved.id)?.favorite;
          send(6, 'session.remove', { id: saved.id });
        } else if (message.requestId === requestIds[6] && message.ok === true) {
          replies.removed = message.result?.value;
          send(7, 'shutdown');
        } else if (message.requestId === requestIds[7] && message.ok === true) {
          replies.shutdown = message.result;
          child.kill();
        }
      });
    }), { workerPath: resolve('dist/host/apps/desktop/src/workers/storage-worker.js'), appRoot: resolve('apps/desktop'), databasePath, identity });
    expect(reply).toEqual({
      imported: { sourceCount: 1, verifiedCount: 1 },
      found: { endpoint: identity.endpoint, algorithm, fingerprint, publicKeyBase64: publicKey.toString('base64'),
        trustedAt: identity.trustedAt, approvalSource: 'user' },
      created: expect.objectContaining({ kind: 'ssh', name: 'Storage gateway', host: 'catalog.example', port: 2200, favorite: false }),
      searched: [expect.objectContaining({ name: 'Storage gateway', host: 'catalog.example' })],
      favorited: true, favoriteChecked: true, removed: true,
      shutdown: { kind: 'shutdown' }
    });
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      expect((database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(2);
      expect((database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ssh_host_keys'").get())).toBeTruthy();
      expect(database.prepare('SELECT count(*) AS count FROM ssh_host_keys').get()).toEqual({ count: 1 });
      expect(database.prepare('SELECT count(*) AS count FROM session_definitions').get()).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('Windows multi-tab terminal dimensions track a resized Electron window', async () => {
  test.skip(process.platform !== 'win32', 'ConPTY resize acceptance evidence is required on Windows');
  const profile = await mkdtemp(join(tmpdir(), 'mrt-terminal-resize-e2e-'));
  const app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`, '--force-device-scale-factor=2'], env: electronEnvironment() });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await expect(page.getByRole('tab', { name: /PowerShell session 1/ })).toBeVisible();
    for (let index = 0; index < 8; index++) {
      await runPaletteCommand(page, 'New PowerShell terminal');
      await expect(page.getByRole('tab').filter({ hasText: /PowerShell session/ })).toHaveCount(index + 2);
    }
    await expect(page.getByRole('tab')).toHaveCount(9);
    for (let index = 1; index <= 9; index++) {
      const tab = page.getByRole('tab').filter({ hasText: new RegExp(`PowerShell session ${index}\\b`) });
      await expect(tab.locator('.state-dot')).toHaveClass(/running/);
    }
    await expect(page.locator('.terminal-workspace')).toHaveAttribute('data-opening', 'false');
    const originalViewport = await page.evaluate(() => ({ innerWidth, innerHeight }));
    const originalWidth = originalViewport.innerWidth;
    const otherShellSize = await readPowerShellSize(page, 'PowerShell session 8');
    const largeShellSize = await readPowerShellSize(page, 'PowerShell session 9');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(900, 600));
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(originalWidth);
    await expect.poll(() => page.evaluate(() => innerHeight)).toBeLessThan(originalViewport.innerHeight);
    await expect.poll(async () => {
      const resized = await readPowerShellSize(page, 'PowerShell session 9');
      return { columns: resized.columns < largeShellSize.columns, rows: resized.rows < largeShellSize.rows };
    }, { timeout: 10_000, intervals: [250] }).toEqual({ columns: true, rows: true });
    await expect.poll(async () => {
      const resized = await readPowerShellSize(page, 'PowerShell session 8');
      return { columns: resized.columns < otherShellSize.columns, rows: resized.rows < otherShellSize.rows };
    }, { timeout: 10_000, intervals: [250] }).toEqual({ columns: true, rows: true });
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('Windows local terminal workbench operates real shells, handles 10 tabs and closes their processes', async () => {
  test.skip(process.platform !== 'win32', 'ConPTY acceptance evidence is required on Windows');
  test.setTimeout(180_000);
  const profile = await mkdtemp(join(tmpdir(), 'mrt-terminal-e2e-'));
  const existingPowerShellPids = new Set(powerShellProcessIds());
  const app = await electron.launch({
    args: [resolve('apps/desktop'), `--user-data-dir=${profile}`, '--force-device-scale-factor=2', '--mrt-e2e-delay-first-terminal-open'],
    env: { ...electronEnvironment(), MRT_E2E: '1' }
  });
  try {
    const page = await app.firstWindow();
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    expect(await app.evaluate(() => process.argv.includes('--mrt-e2e-delay-first-terminal-open'))).toBe(true);
    const openingCancel = page.getByRole('button', { name: 'Cancel opening PowerShell terminal' });
    await expect(openingCancel).toBeVisible({ timeout: 15_000 });
    const newPowerShellPids = () => powerShellProcessIds().filter(pid => !existingPowerShellPids.has(pid));
    await expect.poll(() => newPowerShellPids().length, { timeout: 10_000, intervals: [100, 250, 500] }).toBeGreaterThan(0);
    await openingCancel.click();
    await expect(page.getByRole('tab')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'No terminal is open' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Opening terminals' })).toHaveCount(0, { timeout: 15_000 });
    await expect.poll(() => newPowerShellPids(), { timeout: 10_000, intervals: [100, 250, 500] }).toEqual([]);
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await runPaletteCommand(page, 'New PowerShell terminal');
    await expect(page.getByRole('tab', { name: /PowerShell session 1/ })).toBeVisible();
    await expect(page.getByRole('tabpanel')).toBeVisible();

    const isolation = await page.evaluate(async () => {
      const globals = globalThis as unknown as Record<string, unknown>;
      return { require: typeof globals.require, process: typeof globals.process, Buffer: typeof globals.Buffer,
        bridge: Object.keys(window.multiRemoteTerminal), snapshot: await window.multiRemoteTerminal.describe() };
    });
    expect(isolation.require).toBe('undefined');
    expect(isolation.process).toBe('undefined');
    expect(isolation.Buffer).toBe('undefined');
    expect(isolation.bridge).toEqual(['describe', 'openTerminal', 'writeTerminal', 'previewPowerShellProfileScript', 'applyPowerShellProfileScript',
      'pasteTerminal', 'resizeTerminal', 'acknowledgeTerminalOutput', 'closeTerminal',
      'openSshTerminal', 'openSftpFiles', 'writeSshTerminal', 'pasteSshTerminal', 'resizeSshTerminal', 'acknowledgeSshTerminalOutput', 'closeSshTerminal', 'closeSftpFiles',
      'openTelnetTerminal', 'writeTelnetTerminal', 'pasteTelnetTerminal', 'resizeTelnetTerminal', 'acknowledgeTelnetTerminalOutput', 'closeTelnetTerminal',
      'listSerialPorts', 'openSerialTerminal', 'writeSerialTerminal', 'pasteSerialTerminal', 'resizeSerialTerminal', 'acknowledgeSerialTerminalOutput', 'closeSerialTerminal',
      'approveSshHost', 'rejectSshHost', 'revokeSshHost', 'listSshDirectory',
      'uploadSshFile', 'downloadSshFile', 'cancelSshTransfer',
      'openFtpFiles', 'listFtpDirectory', 'uploadFtpFile', 'downloadFtpFile', 'cancelFtpTransfer', 'closeFtpFiles',
      'listSavedSessions', 'listMacros', 'createMacro', 'updateMacro', 'deleteMacro', 'listMacroShortcuts', 'setMacroShortcut', 'deleteMacroShortcut',
      'createSavedSession', 'setSavedSessionFavorite', 'deleteSavedSession',
      'listSavedSessionFolders', 'createSavedSessionFolder', 'renameSavedSessionFolder', 'moveSavedSessionFolder', 'deleteSavedSessionFolder',
      'exportSavedSessionFolder', 'importSavedSessionFolder', 'moveSavedSession',
      'listSshTunnels', 'saveSshTunnel', 'deleteTunnel', 'startTunnel', 'stopTunnel',
      'onTerminalEvent', 'onSshTrustEvent', 'onTunnelStatus', 'onFtpTransferProgress', 'onSshTransferProgress']);
    expect(isolation.snapshot.ok).toBe(true);
    const rendererProcesses = await app.evaluate(({ app }) => app.getAppMetrics().filter(metric => metric.type === 'Tab'));
    expect(rendererProcesses.length).toBeGreaterThan(0);
    expect(rendererProcesses.every(renderer => renderer.sandboxed)).toBe(true);

    const invalidShell = await page.evaluate(() => window.multiRemoteTerminal.openTerminal(crypto.randomUUID(), { shell: 'sh' } as never, 80, 24));
    expect(invalidShell.ok).toBe(false);
    if (!invalidShell.ok) expect(invalidShell.error.code).toBe('INVALID_REQUEST');

    const unicodeCommand = `$u='${unicodeSample}'; Write-Output ('MRT-UNICODE:' + $u.Length + ':' + $u)`;
    await app.evaluate(({ clipboard }, value) => clipboard.writeText(value), unicodeCommand);
    const firstPanel = await selectTerminal(page, 'PowerShell session 1');
    await firstPanel.locator('.terminal-host').click({ position: { x: 80, y: 60 } });
    await page.keyboard.press('Control+V');
    await expect(firstPanel.locator('.xterm-rows')).toContainText('MRT-UNICODE:');
    await page.keyboard.press('Enter');
    await expect(firstPanel.locator('.xterm-rows')).toContainText(`MRT-UNICODE:4:${unicodeSample}`, { timeout: 15_000 });

    await app.evaluate(({ clipboard }, value) => clipboard.writeText(value), "Write-Output ('MRT-' + 'PASTE:clipboard-ok')");
    await firstPanel.locator('.terminal-host').click({ position: { x: 80, y: 60 } });
    await page.keyboard.press('Control+V');
    await page.keyboard.press('Enter');
    await expect(firstPanel.locator('.xterm-rows')).toContainText('MRT-PASTE:clipboard-ok', { timeout: 15_000 });

    await page.keyboard.press('Control+Shift+P');
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
    await expect(page.locator('#palette-search')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('button', { name: 'New cmd terminal' })).toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('tab', { name: /cmd session 1/ })).toBeVisible();
    await sendLine(page, 'cmd session 1', 'echo MRT-CMD:%RANDOM%', /MRT-CMD:\d+/);

    for (let index = 0; index < 8; index++) {
      await runPaletteCommand(page, 'New PowerShell terminal');
      await expect(page.getByRole('tab').filter({ hasText: /PowerShell session/ })).toHaveCount(index + 2);
    }
    await expect(page.getByRole('tab')).toHaveCount(10);
    const sessionTabs = page.getByRole('tab');
    const sessionNineTab = page.getByRole('tab', { name: /PowerShell session 9/ });
    await expect(sessionNineTab).toHaveAttribute('aria-selected', 'true');
    const selectedBefore = await sessionTabs.evaluateAll(tabs => tabs.findIndex(tab => tab.getAttribute('aria-selected') === 'true'));
    const nextTab = sessionTabs.nth((selectedBefore + 1) % await sessionTabs.count());
    await page.keyboard.press('Control+Tab');
    await expect(nextTab).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Control+Shift+Tab');
    await expect(sessionNineTab).toHaveAttribute('aria-selected', 'true');
    await sessionNineTab.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('tab', { name: /PowerShell session 8/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: /PowerShell session 8/ })).toBeFocused();

    const processIds: number[] = [];
    for (let index = 1; index <= 9; index++) processIds.push(await readPowerShellPid(page, `PowerShell session ${index}`));
    expect(new Set(processIds).size).toBe(9);

    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await expect(page.locator('.workbench')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f3f6fa');
    await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBe(2);
    const originalWidth = await page.evaluate(() => innerWidth);
    const largeShellSize = await readPowerShellSize(page, 'PowerShell session 9');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(900, 700));
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(originalWidth);
    let narrowShellColumns = largeShellSize.columns;
    await expect.poll(async () => {
      narrowShellColumns = (await readPowerShellSize(page, 'PowerShell session 9')).columns;
      return narrowShellColumns;
    }, { timeout: 10_000, intervals: [250] }).toBeLessThan(largeShellSize.columns);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1180, 800));
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeGreaterThan(originalWidth - 5);
    await page.screenshot({ path: 'test-results/terminal-light-200pct.png', fullPage: true });
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#142231');
    await page.screenshot({ path: 'test-results/terminal-dark-200pct.png', fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(pageErrors).toEqual([]);

    await selectTerminal(page, 'cmd session 1');
    await page.getByRole('button', { name: 'Close active terminal' }).click();
    const firstConfirmation = page.getByRole('alertdialog');
    await expect(firstConfirmation).toContainText('cmd session 1');
    await expect(firstConfirmation.getByRole('button', { name: 'Keep terminal' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(firstConfirmation.getByRole('button', { name: 'Close terminal' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(firstConfirmation).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /cmd session 1/ })).toBeVisible();
    await confirmCloseActiveTerminal(page, 'cmd session 1');
    await expect(page.getByRole('tab', { name: /cmd session 1/ })).toHaveCount(0);
    for (let index = 9; index >= 1; index--) {
      await selectTerminal(page, `PowerShell session ${index}`);
      await confirmCloseActiveTerminal(page, `PowerShell session ${index}`);
      await expect(page.getByRole('tab', { name: new RegExp(`PowerShell session ${index}\\b`) })).toHaveCount(0);
    }
    await expect(page.getByRole('heading', { name: 'No terminal is open' })).toBeVisible();
    await Promise.all(processIds.map(pid => expect.poll(() => processIsRunning(pid), { timeout: 12_000, intervals: [100, 250, 500] }).toBe(false)));

    for (let index = 0; index < 3; index++) {
      const title = `PowerShell session ${10 + index}`;
      await runPaletteCommand(page, 'New PowerShell terminal');
      await expect(page.getByRole('tab', { name: new RegExp(title) })).toBeVisible();
      const pid = await readPowerShellPid(page, title);
      await confirmCloseActiveTerminal(page, title);
      await expect(page.getByRole('tab', { name: new RegExp(title) })).toHaveCount(0);
      await expect.poll(() => processIsRunning(pid), { timeout: 12_000, intervals: [100, 250, 500] }).toBe(false);
    }

    const crashTitle = 'PowerShell session 13';
    await runPaletteCommand(page, 'New PowerShell terminal');
    await expect(page.getByRole('tab', { name: new RegExp(crashTitle) })).toBeVisible();
    const crashShellPid = await readPowerShellPid(page, crashTitle);
    const workerPid = parentProcessId(crashShellPid);
    expect(workerPid).toBeGreaterThan(0);
    expect(workerPid).not.toBe(await app.evaluate(() => process.pid));
    expect(processIsRunning(workerPid)).toBe(true);
    execFileSync(systemExecutable('taskkill.exe'), ['/F', '/PID', String(workerPid)], { encoding: 'utf8', windowsHide: true });
    await expect(page.getByRole('alert')).toContainText('UNAVAILABLE', { timeout: 15_000 });
    await expect(page.locator('.status-bar')).toContainText('failed');
    await expect.poll(() => processIsRunning(crashShellPid), { timeout: 12_000, intervals: [100, 250, 500] }).toBe(false);

    await runPaletteCommand(page, 'New PowerShell terminal');
    await expect(page.getByRole('tab', { name: /PowerShell session 14/ })).toBeVisible();
    await sendLine(page, 'PowerShell session 14', "Write-Output ('MRT-WORKER:' + 'restarted')", 'MRT-WORKER:restarted');
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('Git Bash runs in a local terminal and saved Bash sessions reopen', async () => {
  test.skip(process.platform !== 'win32', 'ConPTY acceptance evidence is required on Windows');
  test.skip(!installedGitBashExecutable(), 'Install Git for Windows to run the Bash acceptance test');
  const profile = await mkdtemp(join(tmpdir(), 'mrt-bash-e2e-'));
  const app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`], env: electronEnvironment() });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Workbench settings' });
    await settings.getByRole('checkbox', { name: 'Color shell commands at prompts' }).check();
    await settings.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(settings.getByText('Settings saved.', { exact: true })).toBeVisible();
    await settings.getByRole('button', { name: 'Close', exact: true }).click();
    await runPaletteCommand(page, 'New Bash terminal');
    await expect(page.getByRole('tab', { name: /Bash session 1/ })).toBeVisible({ timeout: 15_000 });
    const versionCommand = "printf 'MRT-BASH:%s\\n' \"$BASH_VERSION\"";
    await sendLine(page, 'Bash session 1', "printf 'MRT-BASH-OUTPUT:%s\\n' $'\\U0001F642'", `MRT-BASH-OUTPUT:${String.fromCodePoint(0x1f642)}`);

    await sendLine(page, 'Bash session 1', "PS1=$'mrt \\u276f '", 'mrt ❯');
    const syntaxPanel = await selectTerminal(page, 'Bash session 1');
    await syntaxPanel.locator('.terminal-host').click({ position: { x: 80, y: 60 } });
    await expect(syntaxPanel.locator('.xterm-helper-textarea')).toBeFocused();
    await page.keyboard.type('if true; then echo MRT-SHELL-COLOR; fi');
    const syntaxRows = syntaxPanel.locator('.xterm-rows');
    await expect.poll(() => syntaxRows.locator('span.xterm-decoration-top').evaluateAll(spans => {
      const glyphs = spans.map(span => ({ text: span.textContent ?? '', color: getComputedStyle(span).color }));
      const rendered = glyphs.map(glyph => glyph.text).join('');
      const hasColor = (token: string, color: string) => {
        const start = rendered.lastIndexOf(token);
        return start >= 0 && glyphs.slice(start, start + token.length).every(glyph => glyph.color === color);
      };
      return hasColor('if', 'rgb(223, 143, 255)') && hasColor('true', 'rgb(84, 215, 212)');
    })).toBe(true);
    await page.screenshot({ path: 'test-results/bash-shell-syntax-prompt.png' });
    await page.keyboard.press('Control+C');
    await expect.poll(() => syntaxRows.locator('span.xterm-decoration-top').count()).toBe(0);

    const bashPanel = await selectTerminal(page, 'Bash session 1');
    const pasteCommand = `printf 'MRT-UNICODE:%s\\n' '${bashUnicodeSample}'`;
    await app.evaluate(({ clipboard }, value) => clipboard.writeText(value), pasteCommand);
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(pasteCommand);
    await bashPanel.locator('.terminal-host').click({ position: { x: 80, y: 60 } });
    await expect(bashPanel.locator('.xterm-helper-textarea')).toBeFocused();
    await page.keyboard.press('Control+V');
    await expect(bashPanel.locator('.xterm-rows')).toContainText('MRT-UNICODE:');
    await page.keyboard.press('Enter');
    await expect(bashPanel.locator('.xterm-rows')).toContainText(`MRT-UNICODE:${bashUnicodeSample}`, { timeout: 15_000 });

    const initialWidth = await page.evaluate(() => innerWidth);
    const initialSizeCommand = "printf 'MRT-BASH-SIZE:%s\\n' \"$(stty size)\"";
    const initialSize = await sendLine(page, 'Bash session 1', initialSizeCommand, /MRT-BASH-SIZE:\d+ \d+/);
    const initialSizeMatch = (await initialSize.rows.innerText()).match(/MRT-BASH-SIZE:(\d+) (\d+)/);
    const initialColumns = Number(initialSizeMatch?.[2]);
    expect(Number.isSafeInteger(initialColumns) && initialColumns > 1).toBe(true);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(900, 700));
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(initialWidth);
    let resizedColumns = initialColumns;
    await expect.poll(async () => {
      const resized = await sendLine(page, 'Bash session 1', initialSizeCommand, /MRT-BASH-SIZE:\d+ \d+/);
      resizedColumns = Number((await resized.rows.innerText()).match(/MRT-BASH-SIZE:(\d+) (\d+)/)?.[2]);
      return resizedColumns;
    }, { timeout: 10_000, intervals: [250] }).toBeLessThan(initialColumns);

    await page.getByRole('button', { name: 'Save active session', exact: true }).click();
    const saveDialog = page.getByRole('dialog', { name: 'Save active session' });
    await saveDialog.getByLabel('Session name').fill('Reusable Bash');
    await saveDialog.getByRole('button', { name: 'Save session', exact: true }).click();
    const openSaved = page.getByRole('button', { name: 'Open Reusable Bash', exact: true });
    await expect(openSaved).toBeVisible();
    await openSaved.click();
    await expect(page.getByRole('tab', { name: 'Reusable Bash', exact: true })).toBeVisible({ timeout: 15_000 });
    await sendLine(page, 'Reusable Bash', versionCommand, /MRT-BASH:\d+\.\d+/);

    await runPaletteCommand(page, 'New Bash terminal');
    const bashTabs = page.getByRole('tab').filter({ hasText: /Bash session \d+/ });
    await expect(bashTabs).toHaveCount(2, { timeout: 15_000 });
    await bashTabs.last().focus();
    await page.keyboard.press('Control+W');
    const closeConfirmation = page.getByRole('alertdialog');
    await expect(closeConfirmation).toContainText('Bash session');
    await closeConfirmation.getByRole('button', { name: 'Close terminal' }).click();
    await expect(bashTabs).toHaveCount(1);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('Git Bash supplementary Unicode paste survives a full command round trip', async () => {
  test.skip(process.platform !== 'win32', 'ConPTY compatibility evidence is required on Windows');
  test.skip(!installedGitBashExecutable(), 'Install Git for Windows to run the Bash compatibility check');
  const profile = await mkdtemp(join(tmpdir(), 'mrt-bash-unicode-e2e-'));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`], env: electronEnvironment() });
    const page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await runPaletteCommand(page, 'New Bash terminal');
    await expect(page.getByRole('tab', { name: /Bash session 1/ })).toBeVisible({ timeout: 15_000 });

    const supplementarySample = String.fromCodePoint(0x1f642);
    const pasteCommand = `printf 'MRT-OUT%s\\n' 'PUT:${supplementarySample}'`;
    await app.evaluate(({ clipboard }, value) => clipboard.writeText(value), pasteCommand);
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(pasteCommand);
    const panel = await selectTerminal(page, 'Bash session 1');
    await panel.locator('.terminal-host').click({ position: { x: 80, y: 60 } });
    await expect(panel.locator('.xterm-helper-textarea')).toBeFocused();
    await page.keyboard.press('Control+V');
    await expect(panel.locator('.xterm-rows')).toContainText('MRT-OUT%s');
    await page.keyboard.press('Enter');
    await expect(panel.locator('.xterm-rows')).toContainText('MRT-OUTPUT:', { timeout: 15_000 });

    const terminalText = await panel.locator('.xterm-rows').innerText();
    if (terminalText.includes('MRT-OUTPUT:\uFFFD')) {
      test.fail(true, 'Git for Windows Bash 2.53.0 replaces a supplementary pasted character with U+FFFD through system ConPTY on this Windows host.');
    }
    await expect(panel.locator('.xterm-rows')).toContainText(`MRT-OUTPUT:${supplementarySample}`);
  } finally {
    try {
      if (app) await app.close();
    } finally {
      await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }
});

test('WSL terminals require an explicit distribution and saved profiles reopen the same target', async () => {
  test.skip(process.platform !== 'win32', 'WSL integration flow requires the Windows E2E harness');
  test.setTimeout(60_000);
  const profile = await mkdtemp(join(tmpdir(), 'mrt-wsl-terminal-e2e-'));
  const launch = () => electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`, '--mrt-e2e-wsl-harness'],
    env: { ...electronEnvironment(), MRT_E2E: '1' } });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    const paletteButton = page.getByRole('button', { name: /^Command palette/ });
    const dialog = page.getByRole('dialog', { name: 'Open a WSL terminal' });
    await paletteButton.click();
    await page.getByRole('dialog', { name: 'Command palette' }).getByRole('button', { name: 'New WSL terminal', exact: true }).click();
    await expect(dialog).toBeVisible();
    const ubuntu = dialog.getByRole('radio', { name: 'Ubuntu', exact: true });
    const debian = dialog.getByRole('radio', { name: 'Debian Dev', exact: true });
    await expect(ubuntu).toBeVisible();
    await expect(debian).toBeVisible();
    await expect(ubuntu).not.toBeChecked();
    await expect(debian).not.toBeChecked();
    await page.screenshot({ path: 'test-results/wsl-distribution-picker.png' });
    const openSelected = dialog.getByRole('button', { name: 'Open selected distribution', exact: true });
    await expect(openSelected).toBeDisabled();
    await expect(dialog).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Refresh', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(ubuntu).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(paletteButton).toBeFocused();
    await paletteButton.click();
    await page.getByRole('dialog', { name: 'Command palette' }).getByRole('button', { name: 'New WSL terminal', exact: true }).click();
    await expect(dialog).toBeVisible();
    await debian.check();
    await expect(openSelected).toBeEnabled();
    await openSelected.click();

    const tabTitle = 'Debian Dev (WSL)';
    const panel = await selectTerminal(page, tabTitle);
    const expectedLaunch = JSON.stringify([win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'wsl.exe'),
      '--distribution', 'Debian Dev', '--exec', 'bash', '--login']).toLocaleLowerCase('en-US');
    const terminalRows = panel.locator('.xterm-rows');
    await expect.poll(async () => (await terminalRows.innerText()).toLocaleLowerCase('en-US'), { timeout: 15_000 })
      .toContain(`wsl harness: ${expectedLaunch}`);
    await page.screenshot({ path: 'test-results/wsl-distribution-terminal.png' });

    await page.getByRole('button', { name: 'Save active session', exact: true }).click();
    const saveDialog = page.getByRole('dialog', { name: 'Save active session' });
    await saveDialog.getByLabel('Session name').fill('Persisted Debian WSL');
    await saveDialog.getByRole('button', { name: 'Save session', exact: true }).click();
    const savedSession = page.getByRole('button', { name: 'Open Persisted Debian WSL', exact: true });
    await expect(savedSession).toBeVisible();
    await expect(page.getByText('WSL · Debian Dev', { exact: true })).toBeVisible();

    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Open Persisted Debian WSL', exact: true }).click();
    const reopenedPanel = await selectTerminal(page, 'Persisted Debian WSL');
    await expect.poll(async () => (await reopenedPanel.locator('.xterm-rows').innerText()).toLocaleLowerCase('en-US'),
      { timeout: 15_000 }).toContain(`wsl harness: ${expectedLaunch}`);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('100% scale themes render and CSP/Electron policy deny injected capabilities', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'mrt-security-'));
  let networkProbeRequests = 0;
  const networkProbe = createHttpServer((_request, response) => {
    networkProbeRequests += 1;
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.end('ok');
  });
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await new Promise<void>((resolveListen, rejectListen) => {
      networkProbe.once('error', rejectListen);
      networkProbe.listen(0, '127.0.0.1', resolveListen);
    });
    const address = networkProbe.address();
    expect(address).not.toBeNull();
    const networkProbeUrl = `http://127.0.0.1:${(address as AddressInfo).port}/csp-probe`;
    app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`, '--force-device-scale-factor=1'], env: electronEnvironment() });
    const page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await expect(page.getByRole('tab', { name: /PowerShell session 1/ })).toBeVisible();
    await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBe(1);
    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await expect(page.locator('.workbench')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f3f6fa');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/terminal-light-100pct.png', fullPage: true });
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await expect(page.locator('.workbench')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#142231');
    await page.screenshot({ path: 'test-results/terminal-dark-100pct.png', fullPage: true });
    const result = await page.evaluate(async (probeUrl) => {
      const globals = globalThis as unknown as Record<string, unknown>;
      globals.injectionExecuted = false;
      const dynamicTerminalStylesApplied = [...document.querySelectorAll<HTMLStyleElement>('.xterm style')].some(style => {
        try { return (style.sheet?.cssRules.length ?? 0) > 0; } catch { return false; }
      });
      const script = document.createElement('script');
      script.textContent = 'globalThis.injectionExecuted = true';
      document.body.append(script);
      const sample = document.querySelector('.terminal-host');
      if (sample) sample.innerHTML = '<img src=x onerror="globalThis.injectionExecuted = true">';
      const blockedFileFetch = await fetch('file:///C:/Windows/win.ini').then(() => false, () => true);
      let networkDeniedByCsp = false;
      const cspListener = (event: SecurityPolicyViolationEvent) => {
        if (event.effectiveDirective === 'connect-src') networkDeniedByCsp = true;
      };
      document.addEventListener('securitypolicyviolation', cspListener);
      const blockedNetworkFetch = await fetch(probeUrl, { signal: AbortSignal.timeout(2_000) }).then(() => false, () => true);
      await new Promise(resolveTick => setTimeout(resolveTick, 0));
      document.removeEventListener('securitypolicyviolation', cspListener);
      const popup = window.open('https://example.com');
      const permission = await navigator.permissions.query({ name: 'geolocation' });
      return { injected: globals.injectionExecuted, blockedFileFetch, blockedNetworkFetch, networkDeniedByCsp,
        popup: popup === null, permission: permission.state, dynamicTerminalStylesApplied };
    }, networkProbeUrl);
    expect(result).toEqual({ injected: false, blockedFileFetch: true, blockedNetworkFetch: true, networkDeniedByCsp: true,
      popup: true, permission: 'denied', dynamicTerminalStylesApplied: true });
    expect(networkProbeRequests).toBe(0);
    await page.evaluate(() => {
      const link = document.createElement('a'); link.href = 'https://example.com'; document.body.append(link); link.click();
    });
    const retained = await app.evaluate(async ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.executeJavaScript(
      '({ url: location.href, wordmark: document.querySelector(".wordmark")?.textContent })'));
    expect(retained).toEqual({ url: 'mrt://app/index.html', wordmark: 'MultiRemoteTerminal' });
    expect(app.windows()).toHaveLength(1);
    const badRequest = await app.evaluate(async ({ net }) => (await net.fetch('mrt://app/private.db')).status);
    expect(badRequest).toBe(403);
    const foreignReply = await app.evaluate(async ({ BrowserWindow }, preload) => {
      const foreign = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false } });
      try {
        await foreign.loadURL('mrt://app/index.html');
        return await foreign.webContents.executeJavaScript('window.multiRemoteTerminal.describe()');
      } finally { foreign.destroy(); }
    }, resolve('dist/preload/bridge.cjs'));
    expect(foreignReply.ok).toBe(false);
    if (!foreignReply.ok) expect(foreignReply.error.code).toBe('UNAVAILABLE');
  } finally {
    await app?.close();
    if (networkProbe.listening) await new Promise<void>(resolveClose => networkProbe.close(() => resolveClose()));
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('offline help opens from the workbench and command palette, filters topics, and restores focus', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'mrt-help-e2e-'));
  const app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`], env: electronEnvironment() });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });

    const helpButton = page.getByRole('button', { name: 'Help', exact: true });
    await helpButton.click();
    const help = page.getByRole('dialog', { name: 'Help & keyboard shortcuts' });
    await expect(help).toBeVisible();
    await expect(help.getByRole('heading', { name: 'Open a connection' })).toBeVisible();
    await expect(help.getByRole('heading', { name: 'Troubleshooting' })).toBeVisible();
    const shortcutRows = help.getByRole('row');
    await expect(shortcutRows).toHaveCount(14);
    for (const shortcut of ['Ctrl+Shift+P', 'Ctrl+W / Ctrl+Shift+W', 'Ctrl+Tab', 'Ctrl+Shift+Tab',
      'Ctrl+Alt+Shift, then assigned key', 'Ctrl+V / Ctrl+Shift+V / Shift+Insert', '← / →, Home / End (tab focused)',
      '↑ / ↓, Home / End (tab menu focused)', 'Esc / Tab (terminal tab menu)', '↑ / ↓, Enter, Esc, Tab (palette)',
      'Tab / Shift+Tab (dialog open)', 'Esc (SSH host prompt)', 'Tab / Shift+Tab / Esc (help open)']) {
      await expect(help.getByRole('row', { name: new RegExp(shortcut.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })).toBeVisible();
    }
    await expect(help.locator('#help-search')).toBeFocused();
    await page.screenshot({ path: 'test-results/offline-help-dark.png' });

    await page.keyboard.press('Shift+Tab');
    await expect(help.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(help.locator('#help-search')).toBeFocused();
    const helpTopics = help.getByRole('region', { name: 'Help topics' });
    await page.keyboard.press('Tab');
    await expect(helpTopics).toBeFocused();
    await page.keyboard.press('End');
    await expect.poll(() => helpTopics.evaluate(element => element.scrollTop + element.clientHeight >= element.scrollHeight - 2)).toBe(true);
    await help.locator('#help-search').fill('Ctrl+Shift+Tab');
    await expect(help.getByRole('row', { name: /Ctrl\+Shift\+Tab/ })).toBeVisible();
    await expect(help.getByRole('heading', { name: 'Open a connection' })).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(help).toHaveCount(0);
    await expect(helpButton).toBeFocused();

    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await expect(page.locator('.workbench')).toHaveAttribute('data-theme', 'light');
    await helpButton.click();
    await expect(help).toBeVisible();
    await page.screenshot({ path: 'test-results/offline-help-light.png' });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(620, 760));
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(700);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await help.locator('.help-topics').first().evaluate(element =>
      getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length)).toBe(1);
    await page.screenshot({ path: 'test-results/offline-help-narrow.png' });
    await help.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(help).toHaveCount(0);
    await expect(helpButton).toBeFocused();

    await page.keyboard.press('Control+Shift+P');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await palette.getByRole('button', { name: 'Help and keyboard shortcuts', exact: true }).click();
    await expect(help).toBeVisible();
    await expect(help.locator('#help-search')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(helpTopics).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(help).toHaveCount(0);
    await expect(helpButton).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('custom Unicode startup greeting saves, dismisses, clears, and persists across restart', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'mrt-preferences-e2e-'));
  const launch = () => electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`], env: electronEnvironment() });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });

    const settingsButton = page.getByRole('button', { name: 'Settings', exact: true });
    await settingsButton.click();
    const settings = page.getByRole('dialog', { name: 'Workbench settings' });
    await expect(settings).toBeVisible();
    const greeting = 'Terminal ready — Добро пожаловать · こんにちは 👋';
    const greetingInput = settings.getByLabel('Startup greeting');
    await greetingInput.fill('x'.repeat(513));
    await expect(settings.getByRole('alert')).toHaveText('Use no more than 512 Unicode characters.');
    await expect(settings.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await greetingInput.fill(greeting);
    await settings.getByRole('button', { name: 'Save changes' }).click();
    await expect(settings.getByRole('status')).toHaveText('Settings saved.');
    const banner = page.getByRole('region', { name: 'Startup greeting' });
    await expect(banner).toContainText(greeting);
    await settings.getByRole('button', { name: 'Close', exact: true }).click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(620, 760));
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(700);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/startup-greeting.png' });
    await banner.getByRole('button', { name: 'Dismiss greeting' }).click();
    await expect(banner).toHaveCount(0);

    await settingsButton.focus();
    await page.keyboard.press('Control+Shift+P');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await palette.getByRole('button', { name: 'Workbench settings', exact: true }).click();
    await expect(settings).toBeVisible();
    await page.screenshot({ path: 'test-results/startup-settings-dialog-narrow.png' });
    await page.keyboard.press('Escape');
    await expect(settings).toHaveCount(0);
    await expect(settingsButton).toBeFocused();

    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    const reopenedBanner = page.getByRole('region', { name: 'Startup greeting' });
    await expect(reopenedBanner).toContainText(greeting);

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const reopenedSettings = page.getByRole('dialog', { name: 'Workbench settings' });
    await expect(reopenedSettings).toBeVisible();
    await reopenedSettings.getByLabel('Startup greeting').fill('');
    await reopenedSettings.getByRole('button', { name: 'Save changes' }).click();
    await expect(reopenedSettings.getByRole('status')).toHaveText('Settings saved.');
    await expect(reopenedBanner).toHaveCount(0);
    await reopenedSettings.getByRole('button', { name: 'Close', exact: true }).click();

    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'Startup greeting' })).toHaveCount(0);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('PowerShell profile text persists, stays idle on startup, and runs only after explicit preview and action', async () => {
  test.skip(process.platform !== 'win32', 'PowerShell profile execution acceptance requires Windows');
  test.setTimeout(90_000);
  const profile = await mkdtemp(join(tmpdir(), 'mrt-powershell-profile-e2e-'));
  const launch = () => electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`], env: electronEnvironment() });
  let app = await launch();
  const marker = `MRT-PS-PROFILE-${randomUUID()}`;
  const script = `Write-Output '${marker}'`;
  try {
    let page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await expect(page.getByRole('tab', { name: /PowerShell session 1/ })).toBeVisible();
    const firstPanel = await selectTerminal(page, 'PowerShell session 1');

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    let settings = page.getByRole('dialog', { name: 'Workbench settings' });
    await settings.getByLabel('Saved PowerShell script').fill(script);
    await settings.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(settings.getByText('Settings saved.', { exact: true })).toBeVisible();
    await settings.getByRole('button', { name: 'Close', exact: true }).click();

    await runPaletteCommand(page, 'New PowerShell terminal');
    const panel = await selectTerminal(page, 'PowerShell session 2');
    const rows = panel.locator('.xterm-rows');
    await expect(page.getByRole('button', { name: 'PowerShell session 2 running' })).toBeVisible({ timeout: 15_000 });
    await expect(rows).not.toContainText(marker);
    await expect(firstPanel.locator('.xterm-rows')).not.toContainText(marker);

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    settings = page.getByRole('dialog', { name: 'Workbench settings' });
    await expect(settings.getByLabel('Saved PowerShell script')).toHaveValue(script);
    const preview = settings.getByRole('button', { name: 'Preview saved script', exact: true });
    await expect(preview).toBeEnabled();
    await preview.click();
    const previewPanel = settings.locator('.settings-profile-preview');
    await expect(previewPanel).toBeVisible();
    await expect(previewPanel.locator('pre')).toHaveText(script);
    await expect(rows).not.toContainText(marker);
    const runProfile = settings.getByRole('button', { name: 'Run in this PowerShell session', exact: true });
    await runProfile.focus();
    await runProfile.press('Enter');
    await expect(settings.getByText('Script sent to the active PowerShell session.', { exact: true })).toBeVisible();
    await expect(rows).toContainText(marker, { timeout: 15_000 });
    await settings.getByRole('button', { name: 'Close', exact: true }).click();

    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    const restartedPanel = await selectTerminal(page, 'PowerShell session 1');
    await expect(restartedPanel.locator('.xterm-rows')).not.toContainText(marker);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const restoredSettings = page.getByRole('dialog', { name: 'Workbench settings' });
    await expect(restoredSettings.getByLabel('Saved PowerShell script')).toHaveValue(script);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('local shell tool visibility persists and controls command palette entries after restart', async () => {
  test.skip(process.platform !== 'win32', 'Local shell tool preference acceptance requires Windows');
  const profile = await mkdtemp(join(tmpdir(), 'mrt-local-shell-tools-e2e-'));
  const launch = (delayPreferences = false) => electron.launch({
    args: [resolve('apps/desktop'), `--user-data-dir=${profile}`,
      ...(delayPreferences ? ['--mrt-e2e-delay-first-workbench-preferences-read'] : [])],
    env: delayPreferences ? { ...electronEnvironment(), MRT_E2E: '1' } : electronEnvironment()
  });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Workbench settings' });
    await page.screenshot({ path: 'test-results/local-shell-tools-settings.png' });
    const powershell = settings.getByRole('checkbox', { name: 'Show PowerShell in command palette' });
    await expect(powershell).toBeChecked();
    await powershell.uncheck();
    await settings.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(settings.getByText('Settings saved.', { exact: true })).toBeVisible();
    await settings.getByRole('button', { name: 'Close', exact: true }).click();
    await page.keyboard.press('Control+Shift+P');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette.getByRole('button', { name: 'New PowerShell terminal', exact: true })).toHaveCount(0);
    await expect(palette.getByRole('button', { name: 'New cmd terminal', exact: true })).toBeVisible();

    await app.close();
    app = await launch(true);
    page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await page.keyboard.press('Control+Shift+P');
    const delayedPalette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(delayedPalette.getByRole('button', { name: 'New cmd terminal', exact: true })).toHaveCount(0);
    await expect(delayedPalette.getByRole('button', { name: 'New PowerShell terminal', exact: true })).toHaveCount(0);
    await delayedPalette.locator('#palette-search').focus();
    await page.keyboard.press('ArrowDown');
    const sftpCommand = delayedPalette.getByRole('button', { name: 'Connect to SFTP files', exact: true });
    await expect(sftpCommand).toHaveAttribute('aria-current', 'true');
    await expect(delayedPalette.getByRole('button', { name: 'New cmd terminal', exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(delayedPalette.getByRole('button', { name: 'New PowerShell terminal', exact: true })).toHaveCount(0);
    await expect(sftpCommand).toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('Enter');
    const sftpDialog = page.getByRole('dialog', { name: 'Connect to SFTP files' });
    await expect(sftpDialog).toBeVisible();
    await sftpDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(sftpDialog).toHaveCount(0);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const restoredSettings = page.getByRole('dialog', { name: 'Workbench settings' });
    const restoredPowerShell = restoredSettings.getByRole('checkbox', { name: 'Show PowerShell in command palette' });
    await expect(restoredPowerShell).not.toBeChecked();
    await restoredPowerShell.check();
    await restoredSettings.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(restoredSettings.getByText('Settings saved.', { exact: true })).toBeVisible();
    await restoredSettings.getByRole('button', { name: 'Close', exact: true }).click();
    const tabsBeforePowerShellLaunch = await page.getByRole('tab').count();
    await runPaletteCommand(page, 'New PowerShell terminal');
    await expect(page.getByRole('tab')).toHaveCount(tabsBeforePowerShellLaunch + 1);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('opt-in automatically remembers opened terminal sessions and deduplicates them after restart', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'mrt-auto-save-sessions-e2e-'));
  const launch = () => electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`], env: electronEnvironment() });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await expect(page.getByText('No saved sessions yet.')).toBeVisible();

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    let settings = page.getByRole('dialog', { name: 'Workbench settings' });
    await settings.getByRole('checkbox', { name: 'Automatically save connections I open' }).check();
    await page.screenshot({ path: 'test-results/auto-save-session-settings.png' });
    await settings.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(settings.getByRole('status')).toHaveText('Settings saved.');
    await settings.getByRole('button', { name: 'Close', exact: true }).click();

    await page.keyboard.press('Control+Shift+P');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await palette.getByRole('button', { name: 'New PowerShell terminal', exact: true }).click();
    const openSavedPowerShell = page.getByRole('button', { name: 'Open PowerShell', exact: true });
    await expect(openSavedPowerShell).toBeVisible();
    await expect(page.getByLabel('1 saved session')).toBeVisible();

    await page.keyboard.press('Control+Shift+P');
    await page.getByRole('dialog', { name: 'Command palette' }).getByRole('button', { name: 'New PowerShell terminal', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open PowerShell', exact: true })).toHaveCount(1);
    await expect(page.getByLabel('1 saved session')).toBeVisible();

    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Open PowerShell', exact: true })).toBeVisible();
    await expect(page.getByLabel('1 saved session')).toBeVisible();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    settings = page.getByRole('dialog', { name: 'Workbench settings' });
    await expect(settings.getByRole('checkbox', { name: 'Automatically save connections I open' })).toBeChecked();
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('terminal keyword highlighting saves rules, preserves ANSI colors, and restores settings after restart', async () => {
  test.setTimeout(60_000);
  const profile = await mkdtemp(join(tmpdir(), 'mrt-terminal-highlights-e2e-'));
  const launch = () => electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`], env: electronEnvironment() });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    let settings = page.getByRole('dialog', { name: 'Workbench settings' });
    await settings.getByRole('checkbox', { name: 'Color shell commands at prompts' }).check();
    await settings.getByRole('checkbox', { name: 'Highlight matching terminal text' }).check();
    await settings.getByRole('button', { name: 'Add rule', exact: true }).click();
    await settings.getByLabel('Rule 1 pattern').fill('MRT-HIGHLIGHT-\\w+');
    await settings.getByLabel('Rule 1 color').selectOption('cyan');
    await page.screenshot({ path: 'test-results/terminal-highlight-settings.png' });
    await settings.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(settings.getByText('Settings saved.', { exact: true })).toBeVisible();
    await settings.getByRole('button', { name: 'Close', exact: true }).click();

    const title = 'PowerShell session 1';
    const command = "$mrtEsc = [char]27; [Console]::Write($mrtEsc + '[31m' + 'ANSI-KEEP-RED' + $mrtEsc + '[0m'); $mrtTag = 'MRT-HIGHLIGHT-' + 'OUTPUT'; Write-Output $mrtTag";
    const { panel, rows } = await sendLine(page, title, command, 'MRT-HIGHLIGHT-OUTPUT');
    await expect.poll(() => rows.locator('span.xterm-decoration-top').evaluateAll(spans => {
      const glyphs = spans.map(span => ({ text: span.textContent ?? '', color: getComputedStyle(span).color }));
      const rendered = glyphs.map(glyph => glyph.text).join('');
      const start = rendered.indexOf('MRT-HIGHLIGHT-OUTPUT');
      return start >= 0 && glyphs.slice(start, start + 'MRT-HIGHLIGHT-OUTPUT'.length)
        .every(glyph => glyph.color === 'rgb(84, 215, 212)');
    })).toBe(true);
    await expect.poll(() => rows.locator('span.xterm-fg-1').evaluateAll(spans => spans.some(span =>
      span.textContent?.includes('ANSI-KEEP-RED') && getComputedStyle(span).color === 'rgb(255, 104, 104)'))).toBe(true);
    await expect(panel.locator('.xterm-decoration-container .xterm-decoration').first()).toBeVisible();

    const resizeRun = await sendLine(page, title, "Write-Output (('PAD-' * 30) + ' MRT-HIGHLIGHT-RESIZE')", 'MRT-HIGHLIGHT-RESIZE');
    const hasCyanResizeTag = () => resizeRun.rows.locator('span.xterm-decoration-top').evaluateAll(spans => {
      const glyphs = spans.map(span => ({ text: span.textContent ?? '', color: getComputedStyle(span).color }));
      const rendered = glyphs.map(glyph => glyph.text).join('');
      const start = rendered.indexOf('MRT-HIGHLIGHT-RESIZE');
      return start >= 0 && glyphs.slice(start, start + 'MRT-HIGHLIGHT-RESIZE'.length)
        .every(glyph => glyph.color === 'rgb(84, 215, 212)');
    });
    await expect.poll(hasCyanResizeTag).toBe(true);
    const initialWindowWidth = await page.evaluate(() => innerWidth);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(860, 700));
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(initialWindowWidth);
    await expect.poll(hasCyanResizeTag).toBe(true);

    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    settings = page.getByRole('dialog', { name: 'Workbench settings' });
    await expect(settings.getByRole('checkbox', { name: 'Color shell commands at prompts' })).toBeChecked();
    await expect(settings.getByRole('checkbox', { name: 'Highlight matching terminal text' })).toBeChecked();
    await expect(settings.getByLabel('Rule 1 pattern')).toHaveValue('MRT-HIGHLIGHT-\\w+');
    await settings.getByRole('button', { name: 'Close', exact: true }).click();
    const reopened = await sendLine(page, title, "$mrtTag = 'MRT-HIGHLIGHT-' + 'RESTART'; Write-Output $mrtTag", 'MRT-HIGHLIGHT-RESTART');
    await expect.poll(() => reopened.rows.locator('span.xterm-decoration-top').evaluateAll(spans => {
      const glyphs = spans.map(span => ({ text: span.textContent ?? '', color: getComputedStyle(span).color }));
      const rendered = glyphs.map(glyph => glyph.text).join('');
      const start = rendered.indexOf('MRT-HIGHLIGHT-RESTART');
      return start >= 0 && glyphs.slice(start, start + 'MRT-HIGHLIGHT-RESTART'.length)
        .every(glyph => glyph.color === 'rgb(84, 215, 212)');
    })).toBe(true);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('custom workbench logo is bounded, persists across restart, and resets to the built-in wordmark', async () => {
  test.setTimeout(90_000);
  const profile = await mkdtemp(join(tmpdir(), 'mrt-custom-logo-e2e-'));
  const logoPath = join(profile, 'selected-logo.png');
  const validPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOQm/D/PwAFKgKti6zvbAAAAABJRU5ErkJggg==', 'base64');
  const launch = () => electron.launch({
    args: [resolve('apps/desktop'), `--user-data-dir=${profile}`, '--mrt-e2e-custom-logo', `--mrt-e2e-custom-logo-file=${logoPath}`],
    env: { ...electronEnvironment(), MRT_E2E: '1' }
  });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await writeFile(logoPath, validPng);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    let settings = page.getByRole('dialog', { name: 'Workbench settings' });
    await settings.getByRole('button', { name: 'Choose PNG logo', exact: true }).click();
    const preview = settings.getByRole('img', { name: 'Selected workbench logo' });
    await expect(preview).toBeVisible();
    await expect(preview).toHaveJSProperty('naturalWidth', 1);
    await page.screenshot({ path: 'test-results/custom-logo-settings.png' });
    await settings.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(settings.getByText('Settings saved.', { exact: true })).toBeVisible();
    await expect(page.getByTestId('custom-workbench-logo')).toBeVisible();
    await settings.getByRole('button', { name: 'Close', exact: true }).click();

    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await expect(page.getByTestId('custom-workbench-logo')).toBeVisible();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    settings = page.getByRole('dialog', { name: 'Workbench settings' });
    await expect(settings.getByRole('img', { name: 'Selected workbench logo' })).toBeVisible();

    await writeFile(logoPath, Buffer.from('not a PNG image'));
    await settings.getByRole('button', { name: 'Choose PNG logo', exact: true }).click();
    await expect(settings.getByRole('alert')).toContainText('Choose a valid PNG image');
    await expect(settings.getByRole('img', { name: 'Selected workbench logo' })).toBeVisible();
    await settings.getByRole('button', { name: 'Use built-in wordmark', exact: true }).click();
    await settings.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(settings.getByText('Settings saved.', { exact: true })).toBeVisible();
    await expect(page.getByTestId('custom-workbench-logo')).toHaveCount(0);
    await settings.getByRole('button', { name: 'Close', exact: true }).click();

    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await expect(page.getByTestId('custom-workbench-logo')).toHaveCount(0);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
