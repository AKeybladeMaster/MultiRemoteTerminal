import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, powerMonitor, protocol, safeStorage, session, utilityProcess } from 'electron';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { failure } from '../../../../packages/domain/src/errors.ts';
import { describeWorkbench } from '../../../../packages/application/src/workbench.ts';
import { createLocalTerminalController } from '../../../../packages/application/src/local-terminals.ts';
import type { LocalTerminalController } from '../../../../packages/application/src/local-terminals.ts';
import { createHostTrustManager } from '../../../../packages/application/src/host-trust.ts';
import type { HostTrustRuntime } from '../../../../packages/application/src/host-trust.ts';
import { createSessionCatalog } from '../../../../packages/application/src/session-catalog.ts';
import { createSshTerminalController } from '../../../../packages/application/src/ssh-terminals.ts';
import type { SshTerminalController } from '../../../../packages/application/src/ssh-terminals.ts';
import { APP_URL, CANCEL_CATALOG_COMMAND_CHANNEL, COMMAND_CHANNEL, PASTE_GESTURE_CHANNEL, isAppDocument, parseCatalogCancellationRequest, parsePasteGestureRequest, parseRequest,
  SSH_TRUST_EVENT_CHANNEL, TERMINAL_EVENT_CHANNEL } from '../../../../packages/contracts/src/commands.ts';
import { dispatchCommand } from './broker.ts';
import { TerminalWorkerHost } from './terminal-worker-host.ts';
import { serveAsset } from './assets.ts';
import { SafeStorageSecretVault } from '../adapters/safe-storage-secret-vault.ts';
import { SqliteStorageStore } from '../adapters/sqlite-storage-store.ts';
import { createWindowsCredentialPrompt } from '../adapters/windows-credential-prompt.ts';
import { SshTerminalWorkerHost } from '../adapters/ssh-terminal-worker-host.ts';
import { VaultIdleLock } from '../../../../packages/application/src/vault-idle-lock.ts';
import { PasteGestureGate } from './paste-gesture.ts';

app.setName('MultiRemoteTerminal');
app.setAppUserModelId('io.github.akeyblademaster.multiremote-terminal');
app.enableSandbox();
protocol.registerSchemesAsPrivileged([{ scheme: 'mrt', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

// Compiled location: dist/host/apps/desktop/src/main; assets remain immutable build outputs.
const here = fileURLToPath(new URL('.', import.meta.url));
const dist = resolve(here, '../../../../../');
const loadNative = createRequire(import.meta.url);
let window: BrowserWindow | undefined;
let windowReady = false;
let stopActiveTerminals = (): void => {};
let focusRequested = false;
const pasteGestures = new PasteGestureGate();
const ownsSingleInstance = app.requestSingleInstanceLock();
interface PendingCatalogCommand {
  readonly cancellation: AbortController;
  readonly settled: Promise<void>;
  complete(): void;
}
const pendingCatalogCommands = new Map<number, Map<string, Set<PendingCatalogCommand>>>();

if (!ownsSingleInstance) app.quit();
else app.on('second-instance', focusWindow);

function createWindow(): void {
  const current = new BrowserWindow({
    title: 'MultiRemoteTerminal', width: 1180, height: 800, minWidth: 700, minHeight: 480,
    backgroundColor: '#142231', show: false,
    webPreferences: {
      preload: join(dist, 'preload/bridge.cjs'), sandbox: true, contextIsolation: true,
      nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false,
      webviewTag: false, navigateOnDragDrop: false
    }
  });
  window = current;
  windowReady = false;
  const webContentsId = current.webContents.id;
  current.webContents.once('destroyed', () => pasteGestures.clear(webContentsId));
  current.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  current.webContents.on('will-navigate', event => event.preventDefault());
  current.webContents.on('will-frame-navigate', event => event.preventDefault());
  current.webContents.on('will-attach-webview', event => event.preventDefault());
  current.once('ready-to-show', () => {
    windowReady = true;
    current.show();
    if (focusRequested) focusWindow();
  });
  current.on('closed', () => {
    if (window === current) {
      window = undefined;
      windowReady = false;
    }
    stopActiveTerminals();
  });
  current.webContents.on('render-process-gone', () => stopActiveTerminals());
  void current.loadURL(APP_URL);
}

function focusWindow(): void {
  const current = window;
  if (!current || current.isDestroyed() || !windowReady) {
    focusRequested = true;
    return;
  }
  focusRequested = false;
  if (current.isMinimized()) current.restore();
  if (!current.isVisible()) current.show();
  current.focus();
}

function canWriteClipboard(contents: Electron.WebContents | null, mainFrame: boolean, requestingUrl: string): boolean {
  const current = window;
  return Boolean(current && !current.isDestroyed() && contents === current.webContents && !contents.isDestroyed() && mainFrame &&
    isAppDocument(requestingUrl) && isAppDocument(contents.getURL()));
}

async function cancelCatalogCommand(event: Electron.IpcMainInvokeEvent, input: unknown): Promise<void> {
  const current = window;
  const requestId = parseCatalogCancellationRequest(input, {
    ownerWindow: Boolean(current && !current.isDestroyed() && event.sender === current.webContents),
    mainFrame: event.senderFrame === event.sender.mainFrame,
    url: event.senderFrame?.url ?? ''
  });
  if (!requestId) return;
  const cancellations = pendingCatalogCommands.get(event.sender.id)?.get(requestId);
  if (cancellations) {
    for (const cancellation of cancellations) cancellation.cancellation.abort();
    await Promise.all([...cancellations].map(cancellation => cancellation.settled));
  }
}

function trackCatalogCommand(senderId: number, requestId: string, cancellation: PendingCatalogCommand, add: boolean): void {
  let senderCommands = pendingCatalogCommands.get(senderId);
  if (add) {
    if (!senderCommands) { senderCommands = new Map(); pendingCatalogCommands.set(senderId, senderCommands); }
    let requests = senderCommands.get(requestId);
    if (!requests) { requests = new Set(); senderCommands.set(requestId, requests); }
    requests.add(cancellation);
    return;
  }
  const requests = senderCommands?.get(requestId);
  requests?.delete(cancellation);
  if (requests?.size === 0) senderCommands?.delete(requestId);
  if (senderCommands?.size === 0) pendingCatalogCommands.delete(senderId);
}

function boot(): void {
  const userData = app.getPath('userData');
  const credentialVault = new SafeStorageSecretVault(join(userData, 'credentials.json'), safeStorage);
  const idleLock = new VaultIdleLock(() => credentialVault.lock(), scheduleTimeout);
  const lockVaultForSystemEvent = () => credentialVault.lock();
  powerMonitor.on('lock-screen', lockVaultForSystemEvent);
  powerMonitor.on('suspend', lockVaultForSystemEvent);
  idleLock.start();
  void credentialVault.initialize().catch(() => undefined);

  let delayFirstOpenReply = process.argv.includes('--mrt-e2e-delay-first-terminal-open');
  let delayFirstSessionCreateReply = process.argv.includes('--mrt-e2e-delay-first-session-create-reply');
  const openReplyBarrier = delayFirstOpenReply ? async (): Promise<void> => {
    if (!delayFirstOpenReply) return;
    delayFirstOpenReply = false;
    await new Promise<void>(resolveDelay => setTimeout(resolveDelay, 750));
  } : undefined;
  const terminalHost = new TerminalWorkerHost(
    join(dist, 'host/apps/desktop/src/workers/terminal-worker.js'), app.getAppPath(), openReplyBarrier
  );
  const terminals: LocalTerminalController = createLocalTerminalController(terminalHost);
  const sshTrustRuntime: HostTrustRuntime = {
    createToken: randomUUID,
    monotonicNow: () => performance.now(),
    wallNow: () => Date.now(),
    schedule: scheduleTimeout
  };
  const storageStore = new SqliteStorageStore(
    join(userData, 'multiremote-terminal.sqlite'), join(userData, 'ssh-host-keys.json'),
    join(dist, 'host/apps/desktop/src/workers/storage-worker.js'), app.getAppPath(),
    (workerPath, args, options) => utilityProcess.fork(workerPath, args, options)
  );
  const hostTrust = createHostTrustManager(storageStore, sshTrustRuntime);
  const bundleDialog = {
    async selectExportPath(folderName: string): Promise<string | undefined> {
      const options: Electron.SaveDialogOptions = {
        title: 'Export saved session folder',
        defaultPath: `${safeFileStem(folderName)}.mrt-session-folder.json`,
        buttonLabel: 'Export',
        filters: [{ name: 'Session folder bundle', extensions: ['json'] }]
      };
      const current = window;
      const result = current && !current.isDestroyed() ? await dialog.showSaveDialog(current, options) : await dialog.showSaveDialog(options);
      return result.canceled ? undefined : result.filePath;
    },
    async selectImportPath(): Promise<string | undefined> {
      const options: Electron.OpenDialogOptions = {
        title: 'Import saved session folder',
        buttonLabel: 'Import',
        properties: ['openFile'],
        filters: [{ name: 'Session folder bundle', extensions: ['json'] }]
      };
      const current = window;
      const result = current && !current.isDestroyed() ? await dialog.showOpenDialog(current, options) : await dialog.showOpenDialog(options);
      return result.canceled ? undefined : result.filePaths[0];
    }
  };
  const sessionCatalog = createSessionCatalog(storageStore, bundleDialog);
  const systemDirectory = {
    getSystemDirectory(): string {
      const bridge = loadNative(join(dist, 'native/system_directory.node')) as { getSystemDirectory(): string };
      return bridge.getSystemDirectory();
    }
  };
  const credentialPrompt = createWindowsCredentialPrompt({
    systemDirectory,
    helperPath: join(dist, 'host/apps/desktop/src/adapters/credential-prompt.ps1')
  });
  const sshProvider = new SshTerminalWorkerHost(
    join(dist, 'host/apps/desktop/src/workers/ssh-worker.js'), app.getAppPath(),
    (workerPath, args, options) => utilityProcess.fork(workerPath, args, options)
  );
  const sshTerminals: SshTerminalController = createSshTerminalController(sshProvider, credentialPrompt, hostTrust);
  let shutdownPromise: Promise<void> | undefined;
  let quitRequested = false;
  const stopTerminals = (): Promise<void> => {
    if (!shutdownPromise) {
      shutdownPromise = Promise.all([terminals.closeAll(), sshTerminals.closeAll()]).then(() => undefined).catch(() => undefined)
        .finally(() => { shutdownPromise = undefined; });
    }
    return shutdownPromise;
  };
  stopActiveTerminals = () => { void stopTerminals(); };

  Menu.setApplicationMenu(null);
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const trustedMainFrame = 'requestingUrl' in details && 'isMainFrame' in details &&
      canWriteClipboard(contents, details.isMainFrame, details.requestingUrl);
    callback(permission === 'clipboard-sanitized-write' && trustedMainFrame);
  });
  session.defaultSession.setPermissionCheckHandler((contents, permission, requestingOrigin, details) =>
    permission === 'clipboard-sanitized-write' && requestingOrigin === 'mrt://app' &&
    canWriteClipboard(contents, details.isMainFrame, details.requestingUrl ?? ''));
  session.defaultSession.on('will-download', event => event.preventDefault());
  // Defense in depth: the app makes no external requests in WP-01, including subresources.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !details.url.startsWith('mrt://app/') });
  });
  protocol.handle('mrt', request => serveAsset(join(dist, 'renderer'), request));
  terminals.subscribe(event => {
    const current = window;
    if (current && !current.isDestroyed() && !current.webContents.isDestroyed()) current.webContents.send(TERMINAL_EVENT_CHANNEL, event);
  });
  sshTerminals.subscribe(event => {
    const current = window;
    if (current && !current.isDestroyed() && !current.webContents.isDestroyed()) current.webContents.send(TERMINAL_EVENT_CHANNEL, event);
  });
  sshTerminals.subscribeTrust(event => {
    const current = window;
    if (current && !current.isDestroyed() && !current.webContents.isDestroyed()) current.webContents.send(SSH_TRUST_EVENT_CHANNEL, event);
  });
  ipcMain.handle(COMMAND_CHANNEL, async (event, input: unknown) => {
    const owned = window !== undefined && !window.isDestroyed() && event.sender === window.webContents;
    const cancellation = new AbortController();
    const cancelIfSenderCloses = () => cancellation.abort();
    const mainFrame = owned && event.senderFrame === event.sender.mainFrame;
    const frameUrl = event.senderFrame?.url ?? '';
    const parsed = parseRequest(input);
    const catalogRequest = parsed.ok && parsed.result.command.startsWith('session.') && owned && mainFrame && isAppDocument(frameUrl);
    const pasteRequest = parsed.ok && (parsed.result.command === 'terminal.paste' || parsed.result.command === 'ssh.paste') &&
      owned && mainFrame && isAppDocument(frameUrl);
    const requestId = parsed.ok ? parsed.result.requestId : undefined;
    const trackedRequestId = catalogRequest && requestId !== undefined && !event.sender.isDestroyed() ? requestId : undefined;
    const observeSenderLifecycle = catalogRequest || pasteRequest;
    let completePending!: () => void;
    const pending: PendingCatalogCommand = {
      cancellation,
      settled: new Promise<void>(resolve => { completePending = resolve; }),
      complete: () => completePending()
    };
    if (trackedRequestId) {
      trackCatalogCommand(event.sender.id, trackedRequestId, pending, true);
    }
    if (observeSenderLifecycle && !event.sender.isDestroyed()) {
      event.sender.once('destroyed', cancelIfSenderCloses);
      event.sender.once('render-process-gone', cancelIfSenderCloses);
    } else if (event.sender.isDestroyed()) cancelIfSenderCloses();
    try {
      const reply = await dispatchCommand({ owned, mainFrame, url: frameUrl }, input, {
        describe: () => describeWorkbench({ version: app.getVersion(), platform: process.platform }),
        noteUserActivity: () => idleLock.noteUserActivity(), readClipboardText: () => clipboard.readText(),
        authorizeClipboardPaste: sessionId => pasteGestures.consume(event.sender.id, sessionId),
        async confirmMultilinePaste() {
          const options: Electron.MessageBoxOptions = {
            type: 'warning', title: 'Confirm multiline paste',
            message: 'This clipboard contains multiple lines.',
            detail: 'Pasting multiple lines into a terminal can run several commands. Continue?',
            buttons: ['Paste', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true
          };
          const currentWindow = window;
          const result = currentWindow && !currentWindow.isDestroyed()
            ? await dialog.showMessageBox(currentWindow, options)
            : await dialog.showMessageBox(options);
          return result.response === 0;
        },
        terminals, sshTerminals, sessionCatalog, cancellation: cancellation.signal
      }, () => { /* Diagnostics are off by default; no payload or exception is logged. */ });
      if (delayFirstSessionCreateReply && parsed.ok && parsed.result.command === 'session.create' && reply.ok) {
        delayFirstSessionCreateReply = false;
        if (!cancellation.signal.aborted) {
          await new Promise<void>(resolveOnCancel => cancellation.signal.addEventListener('abort', () => resolveOnCancel(), { once: true }));
        }
        return { requestId: parsed.result.requestId, ...failure('CANCELLED') };
      }
      return reply;
    } finally {
      if (observeSenderLifecycle) {
        event.sender.removeListener('destroyed', cancelIfSenderCloses);
        event.sender.removeListener('render-process-gone', cancelIfSenderCloses);
      }
      if (trackedRequestId) {
        trackCatalogCommand(event.sender.id, trackedRequestId, pending, false);
        pending.complete();
      }
    }
  });
  ipcMain.handle(PASTE_GESTURE_CHANNEL, (event, input: unknown) => {
    const current = window;
    const owned = current !== undefined && !current.isDestroyed() && event.sender === current.webContents;
    const mainFrame = owned && event.senderFrame === event.sender.mainFrame;
    if (!mainFrame || !isAppDocument(event.senderFrame?.url ?? '')) return false;
    const sessionId = parsePasteGestureRequest(input);
    if (!sessionId) return false;
    pasteGestures.issue(event.sender.id, sessionId);
    return true;
  });
  ipcMain.handle(CANCEL_CATALOG_COMMAND_CHANNEL, cancelCatalogCommand);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (quitRequested) return;
    event.preventDefault();
    quitRequested = true;
    idleLock.stop();
    credentialVault.lock();
    void Promise.all([terminals.dispose(), sshTerminals.dispose()]).then(() => storageStore.shutdown())
      .catch(() => undefined).finally(() => app.quit());
  });
  app.on('will-quit', () => {
    powerMonitor.removeListener('lock-screen', lockVaultForSystemEvent);
    powerMonitor.removeListener('suspend', lockVaultForSystemEvent);
    ipcMain.removeHandler(CANCEL_CATALOG_COMMAND_CHANNEL);
    ipcMain.removeHandler(PASTE_GESTURE_CHANNEL);
    ipcMain.removeHandler(COMMAND_CHANNEL);
    protocol.unhandle('mrt');
  });
}

function scheduleTimeout(callback: () => void, delayMs: number): () => void {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
}

function safeFileStem(value: string): string {
  const safe = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').slice(0, 96).trim();
  return safe.length > 0 ? safe : 'saved-sessions';
}

// Do not await readiness at ESM top level: Electron 45 delays ready until module evaluation completes.
if (ownsSingleInstance) void app.whenReady().then(boot).catch(() => app.exit(1));
