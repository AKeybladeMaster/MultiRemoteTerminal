import { app, BrowserWindow, ipcMain, Menu, powerMonitor, protocol, safeStorage, session, utilityProcess } from 'electron';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { describeWorkbench } from '../../../../packages/application/src/workbench.ts';
import { createLocalTerminalController } from '../../../../packages/application/src/local-terminals.ts';
import type { LocalTerminalController } from '../../../../packages/application/src/local-terminals.ts';
import { createHostTrustManager } from '../../../../packages/application/src/host-trust.ts';
import type { HostTrustRuntime } from '../../../../packages/application/src/host-trust.ts';
import { createSessionCatalog } from '../../../../packages/application/src/session-catalog.ts';
import { createSshTerminalController } from '../../../../packages/application/src/ssh-terminals.ts';
import type { SshTerminalController } from '../../../../packages/application/src/ssh-terminals.ts';
import { APP_URL, COMMAND_CHANNEL, SSH_TRUST_EVENT_CHANNEL, TERMINAL_EVENT_CHANNEL } from '../../../../packages/contracts/src/commands.ts';
import { dispatchCommand } from './broker.ts';
import { TerminalWorkerHost } from './terminal-worker-host.ts';
import { serveAsset } from './assets.ts';
import { SafeStorageSecretVault } from '../adapters/safe-storage-secret-vault.ts';
import { SqliteStorageStore } from '../adapters/sqlite-host-trust-store.ts';
import { createWindowsCredentialPrompt } from '../adapters/windows-credential-prompt.ts';
import { SshTerminalWorkerHost } from '../adapters/ssh-terminal-worker-host.ts';
import { VaultIdleLock } from '../../../../packages/application/src/vault-idle-lock.ts';

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
const ownsSingleInstance = app.requestSingleInstanceLock();

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
  const sessionCatalog = createSessionCatalog(storageStore);
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
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
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
  ipcMain.handle(COMMAND_CHANNEL, (event, input: unknown) => {
    const owned = window !== undefined && !window.isDestroyed() && event.sender === window.webContents;
    return dispatchCommand({ owned, mainFrame: owned && event.senderFrame === event.sender.mainFrame,
      url: event.senderFrame?.url ?? '' }, input, {
      describe: () => describeWorkbench({ version: app.getVersion(), platform: process.platform }),
      noteUserActivity: () => idleLock.noteUserActivity(), terminals, sshTerminals, sessionCatalog
    }, () => { /* Diagnostics are off by default; no payload or exception is logged. */ });
  });
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
    ipcMain.removeHandler(COMMAND_CHANNEL);
    protocol.unhandle('mrt');
  });
}

function scheduleTimeout(callback: () => void, delayMs: number): () => void {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
}

// Do not await readiness at ESM top level: Electron 45 delays ready until module evaluation completes.
if (ownsSingleInstance) void app.whenReady().then(boot).catch(() => app.exit(1));
