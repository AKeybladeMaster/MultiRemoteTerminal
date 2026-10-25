import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, powerMonitor, protocol, safeStorage, session, utilityProcess } from 'electron';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { failure } from '../../../../packages/domain/src/errors.ts';
import { describeWorkbench } from '../../../../packages/application/src/workbench.ts';
import { createLocalTerminalController } from '../../../../packages/application/src/local-terminals.ts';
import type { LocalTerminalController } from '../../../../packages/application/src/local-terminals.ts';
import { createHostTrustManager } from '../../../../packages/application/src/host-trust.ts';
import type { HostTrustRuntime } from '../../../../packages/application/src/host-trust.ts';
import { createSessionCatalog } from '../../../../packages/application/src/session-catalog.ts';
import { createMacroCatalog } from '../../../../packages/application/src/macros.ts';
import { createWorkbenchPreferencesManager } from '../../../../packages/application/src/workbench-preferences.ts';
import { createSshTerminalController } from '../../../../packages/application/src/ssh-terminals.ts';
import type { SshTerminalController } from '../../../../packages/application/src/ssh-terminals.ts';
import { createSshTunnelController } from '../../../../packages/application/src/ssh-tunnels.ts';
import type { SshTunnelController } from '../../../../packages/application/src/ssh-tunnels.ts';
import { createTelnetTerminalController } from '../../../../packages/application/src/telnet-terminals.ts';
import { APP_URL, CANCEL_CATALOG_COMMAND_CHANNEL, COMMAND_CHANNEL, FTP_CONSENT_GESTURE_CHANNEL, FTP_TRANSFER_EVENT_CHANNEL, PASTE_GESTURE_CHANNEL, SSH_TRANSFER_EVENT_CHANNEL, TELNET_CONSENT_GESTURE_CHANNEL, isAppDocument, parseCatalogCancellationRequest,
  parseFtpConsentGestureRequest, parsePasteGestureRequest, parseTelnetConsentGestureRequest, parseRequest,
  SSH_TRUST_EVENT_CHANNEL, TERMINAL_EVENT_CHANNEL, TUNNEL_STATUS_EVENT_CHANNEL } from '../../../../packages/contracts/src/commands.ts';
import { dispatchCommand } from './broker.ts';
import { TerminalWorkerHost } from './terminal-worker-host.ts';
import { serveAsset } from './assets.ts';
import { SafeStorageSecretVault } from '../adapters/safe-storage-secret-vault.ts';
import { SqliteStorageStore } from '../adapters/sqlite-storage-store.ts';
import { createWindowsCredentialPrompt } from '../adapters/windows-credential-prompt.ts';
import type { CredentialPrompt } from '../../../../packages/application/src/credential-prompt.ts';
import { SshTerminalWorkerHost } from '../adapters/ssh-terminal-worker-host.ts';
import { TelnetTerminalWorkerHost } from '../adapters/telnet-terminal-worker-host.ts';
import { createFtpFilesController } from '../../../../packages/application/src/ftp-files.ts';
import type { FtpFilesController } from '../../../../packages/application/src/ftp-files.ts';
import { FtpFilesWorkerHost } from '../adapters/ftp-files-worker-host.ts';
import { VaultIdleLock } from '../../../../packages/application/src/vault-idle-lock.ts';
import { RendererGestureGate } from './renderer-gesture-gate.ts';
import { bindRendererRequestCancellation } from './renderer-request-cancellation.ts';
import { resolvePortableUserDataDirectory } from './portable-user-data.ts';
import { createNetworkWorkerEnvironment } from './network-worker-environment.ts';
import type { FtpTransferConflictPolicy, FtpTransferDirection, FtpTransferProgress } from '../../../../packages/domain/src/ftp.ts';
import type { FileTransferConflictPolicy, FileTransferDirection, FileTransferProgress } from '../../../../packages/domain/src/file-transfer.ts';

app.setName('MultiRemoteTerminal');
app.setAppUserModelId('io.github.akeyblademaster.multiremote-terminal');
app.enableSandbox();
protocol.registerSchemesAsPrivileged([{ scheme: 'mrt', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

let portableProfileInitializationFailed = false;
try {
  const portableUserData = resolvePortableUserDataDirectory(app.isPackaged, process.env);
  if (portableUserData) {
    const sessionData = join(portableUserData, 'session-data');
    mkdirSync(sessionData, { recursive: true });
    app.setPath('userData', portableUserData);
    app.setPath('sessionData', sessionData);
  }
} catch {
  console.error(JSON.stringify({
    component: 'main',
    event: 'portable_profile_initialization_failed',
    code: 'PORTABLE_PROFILE_INIT_FAILED'
  }));
  portableProfileInitializationFailed = true;
}

// Compiled location: dist/host/apps/desktop/src/main; assets remain immutable build outputs.
const here = fileURLToPath(new URL('.', import.meta.url));
const dist = resolve(here, '../../../../../');
const loadNative = createRequire(import.meta.url);
let window: BrowserWindow | undefined;
let windowReady = false;
let stopActiveTerminals = (): void => {};
let focusRequested = false;
const rendererGestures = new RendererGestureGate();
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
  current.webContents.once('destroyed', () => rendererGestures.clear(webContentsId));
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
  app.focus();
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
    // Leave enough time for Windows process discovery in the E2E cancellation test under full-suite load.
    await new Promise<void>(resolveDelay => setTimeout(resolveDelay, 5_000));
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
  const systemDirectory = {
    getSystemDirectory(): string {
      const bridge = loadNative(join(dist, 'native/system_directory.node')) as { getSystemDirectory(): string };
      return bridge.getSystemDirectory();
    }
  };
  const e2eSshCredentials = !app.isPackaged && process.env.MRT_E2E === '1' && process.argv.includes('--mrt-e2e-ssh-credentials');
  const e2eFtpCredentials = !app.isPackaged && process.env.MRT_E2E === '1' && process.argv.includes('--mrt-e2e-ftp-credentials');
  const credentialPrompt: CredentialPrompt = e2eSshCredentials || e2eFtpCredentials
    ? { async prompt(purpose) {
      if (purpose === 'ssh-password' && e2eSshCredentials) return { kind: 'provided', username: 'mrt-e2e-user', secret: 'sftp-e2e-secret' };
      if (purpose === 'ftp-account' && e2eFtpCredentials) return { kind: 'provided', username: 'mrt-e2e-user', secret: 'ftp-e2e-secret' };
      return { kind: 'unavailable' };
    } }
    : createWindowsCredentialPrompt({
      systemDirectory,
      helperPath: app.isPackaged
        ? join(process.resourcesPath, 'credential-prompt.ps1')
        : join(dist, 'host/apps/desktop/src/adapters/credential-prompt.ps1')
    });
  const sshProvider = new SshTerminalWorkerHost(
    join(dist, 'host/apps/desktop/src/workers/ssh-worker.js'), app.getAppPath(),
    (workerPath, args, options) => utilityProcess.fork(workerPath, args, {
      ...options,
      env: createNetworkWorkerEnvironment(options.env.MRT_APP_ROOT, process.env)
    })
  );
  const sshTerminals: SshTerminalController = createSshTerminalController(sshProvider, credentialPrompt, hostTrust);
  const tunnels: SshTunnelController = createSshTunnelController(storageStore, storageStore, sshTerminals, sshProvider, randomUUID);
  const sessionCatalog = createSessionCatalog(storageStore, bundleDialog, tunnels);
  const macros = createMacroCatalog(storageStore);
  const preferences = createWorkbenchPreferencesManager(storageStore);
  const telnetTerminals = createTelnetTerminalController(new TelnetTerminalWorkerHost(
    join(dist, 'host/apps/desktop/src/workers/telnet-worker.js'), app.getAppPath(),
    (workerPath, args, options) => utilityProcess.fork(workerPath, args, { ...options, env: { ...process.env, MRT_APP_ROOT: app.getAppPath() } })
  ));
  const ftpFiles: FtpFilesController = createFtpFilesController(new FtpFilesWorkerHost(
    join(dist, 'host/apps/desktop/src/workers/ftp-worker.js'), app.getAppPath(),
    (workerPath, args, options) => utilityProcess.fork(workerPath, args, {
      ...options,
      env: createNetworkWorkerEnvironment(options.env.MRT_APP_ROOT, process.env)
    })
  ), credentialPrompt);
  let shutdownPromise: Promise<void> | undefined;
  let quitRequested = false;
  const stopTerminals = (): Promise<void> => {
    if (!shutdownPromise) {
      shutdownPromise = tunnels.closeAll().then(() => Promise.all([terminals.closeAll(), sshTerminals.closeAll(), telnetTerminals.closeAll(), ftpFiles.closeAll()]))
        .then(() => undefined).catch(() => undefined)
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
  telnetTerminals.subscribe(event => {
    const current = window;
    if (current && !current.isDestroyed() && !current.webContents.isDestroyed()) current.webContents.send(TERMINAL_EVENT_CHANNEL, event);
  });
  sshTerminals.subscribeTrust(event => {
    const current = window;
    if (current && !current.isDestroyed() && !current.webContents.isDestroyed()) current.webContents.send(SSH_TRUST_EVENT_CHANNEL, event);
  });
  tunnels.subscribe(status => {
    const current = window;
    if (current && !current.isDestroyed() && !current.webContents.isDestroyed()) current.webContents.send(TUNNEL_STATUS_EVENT_CHANNEL, status);
  });
  ipcMain.handle(COMMAND_CHANNEL, async (event, input: unknown) => {
    const owned = window !== undefined && !window.isDestroyed() && event.sender === window.webContents;
    const cancellation = new AbortController();
    const mainFrame = owned && event.senderFrame === event.sender.mainFrame;
    const frameUrl = event.senderFrame?.url ?? '';
    const parsed = parseRequest(input);
    const catalogRequest = parsed.ok && (parsed.result.command.startsWith('session.') || parsed.result.command.startsWith('macro.') ||
      parsed.result.command.startsWith('preferences.') || parsed.result.command.startsWith('tunnel.') || parsed.result.command === 'ssh.files.list' ||
      parsed.result.command === 'ftp.open' || parsed.result.command === 'ftp.files.list') && owned && mainFrame && isAppDocument(frameUrl);
    const transferRequest = parsed.ok && (parsed.result.command === 'ftp.files.upload' || parsed.result.command === 'ftp.files.download') &&
      owned && mainFrame && isAppDocument(frameUrl);
    const sshTransferRequest = parsed.ok && (parsed.result.command === 'ssh.files.upload' || parsed.result.command === 'ssh.files.download') &&
      owned && mainFrame && isAppDocument(frameUrl);
    const pasteRequest = parsed.ok && (parsed.result.command === 'terminal.paste' || parsed.result.command === 'ssh.paste' || parsed.result.command === 'telnet.paste') &&
      owned && mainFrame && isAppDocument(frameUrl);
    const fileListRequest = parsed.ok && (parsed.result.command === 'ssh.files.list' || parsed.result.command === 'ftp.files.list') && owned && mainFrame && isAppDocument(frameUrl);
    const requestId = parsed.ok ? parsed.result.requestId : undefined;
    const trackedRequestId = (catalogRequest || transferRequest || sshTransferRequest) && requestId !== undefined && !event.sender.isDestroyed() ? requestId : undefined;
    const observeSenderLifecycle = catalogRequest || pasteRequest || fileListRequest || transferRequest || sshTransferRequest;
    let completePending!: () => void;
    const pending: PendingCatalogCommand = {
      cancellation,
      settled: new Promise<void>(resolve => { completePending = resolve; }),
      complete: () => completePending()
    };
    if (trackedRequestId) {
      trackCatalogCommand(event.sender.id, trackedRequestId, pending, true);
    }
    const unbindSenderCancellation = observeSenderLifecycle
      ? bindRendererRequestCancellation(event.sender, cancellation)
      : () => {};
    try {
      const reply = await dispatchCommand({ owned, mainFrame, url: frameUrl }, input, {
        describe: () => describeWorkbench({ version: app.getVersion(), platform: process.platform }),
        noteUserActivity: () => idleLock.noteUserActivity(), readClipboardText: () => clipboard.readText(),
        authorizeClipboardPaste: sessionId => rendererGestures.consume(event.sender.id, sessionId),
        authorizeTelnetConsent: sessionId => rendererGestures.consume(event.sender.id, sessionId, 'telnet-plaintext-consent'),
        authorizeFtpConsent: sessionId => rendererGestures.consume(event.sender.id, sessionId, 'ftp-plaintext-consent'),
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
        async selectFtpUploadFile() {
          const e2ePath = e2eTransferPath('--mrt-e2e-ftp-upload-file=', '--mrt-e2e-ftp-transfers');
          if (e2ePath) return { localPath: e2ePath, fileName: basename(e2ePath) };
          const options: Electron.OpenDialogOptions = {
            title: 'Choose a file to upload', buttonLabel: 'Upload', properties: ['openFile']
          };
          const currentWindow = window;
          const result = currentWindow && !currentWindow.isDestroyed()
            ? await dialog.showOpenDialog(currentWindow, options)
            : await dialog.showOpenDialog(options);
          if (result.canceled || !result.filePaths[0]) return undefined;
          const localPath = result.filePaths[0];
          return { localPath, fileName: basename(localPath) };
        },
        async selectFtpDownloadPath(fileName: string) {
          const e2eRoot = e2eTransferPath('--mrt-e2e-ftp-download-root=', '--mrt-e2e-ftp-transfers');
          if (e2eRoot) return join(e2eRoot, safeFtpDownloadName(fileName));
          const options: Electron.SaveDialogOptions = {
            title: 'Save downloaded file', defaultPath: safeFtpDownloadName(fileName), buttonLabel: 'Download'
          };
          const currentWindow = window;
          const result = currentWindow && !currentWindow.isDestroyed()
            ? await dialog.showSaveDialog(currentWindow, options)
            : await dialog.showSaveDialog(options);
          return result.canceled ? undefined : result.filePath;
        },
        async resolveFtpTransferConflict(direction: FtpTransferDirection, fileName: string): Promise<FtpTransferConflictPolicy | undefined> {
          if (e2eTransferPath('--mrt-e2e-ftp-upload-file=', '--mrt-e2e-ftp-transfers') ||
              e2eTransferPath('--mrt-e2e-ftp-download-root=', '--mrt-e2e-ftp-transfers')) return 'rename';
          const options: Electron.MessageBoxOptions = {
            type: 'question', title: 'FTP transfer options',
            message: `${direction === 'upload' ? 'Upload' : 'Download'} ${fileName}`,
            detail: 'Choose what to do if a file with this name already exists. Rename keeps the existing file and adds a numbered copy.',
            buttons: ['Overwrite', 'Rename copy', 'Skip existing file', 'Cancel'], defaultId: 1, cancelId: 3, noLink: true
          };
          const currentWindow = window;
          const result = currentWindow && !currentWindow.isDestroyed()
            ? await dialog.showMessageBox(currentWindow, options)
            : await dialog.showMessageBox(options);
          return result.response === 0 ? 'overwrite' : result.response === 1 ? 'rename' : result.response === 2 ? 'skip' : undefined;
        },
        reportFtpTransferProgress(progress: FtpTransferProgress) {
          const current = window;
          if (current && !current.isDestroyed() && !current.webContents.isDestroyed()) current.webContents.send(FTP_TRANSFER_EVENT_CHANNEL, progress);
        },
        async selectSshUploadFile() {
          const e2ePath = e2eTransferPath('--mrt-e2e-sftp-upload-file=', '--mrt-e2e-sftp-transfers');
          if (e2ePath) return { localPath: e2ePath, fileName: basename(e2ePath) };
          const options: Electron.OpenDialogOptions = {
            title: 'Choose a file to upload', buttonLabel: 'Upload', properties: ['openFile']
          };
          const currentWindow = window;
          const result = currentWindow && !currentWindow.isDestroyed()
            ? await dialog.showOpenDialog(currentWindow, options)
            : await dialog.showOpenDialog(options);
          if (result.canceled || !result.filePaths[0]) return undefined;
          const localPath = result.filePaths[0];
          return { localPath, fileName: basename(localPath) };
        },
        async selectSshDownloadPath(fileName: string) {
          const e2eRoot = e2eTransferPath('--mrt-e2e-sftp-download-root=', '--mrt-e2e-sftp-transfers');
          if (e2eRoot) return join(e2eRoot, safeFtpDownloadName(fileName));
          const options: Electron.SaveDialogOptions = {
            title: 'Save downloaded file', defaultPath: safeFtpDownloadName(fileName), buttonLabel: 'Download'
          };
          const currentWindow = window;
          const result = currentWindow && !currentWindow.isDestroyed()
            ? await dialog.showSaveDialog(currentWindow, options)
            : await dialog.showSaveDialog(options);
          return result.canceled ? undefined : result.filePath;
        },
        async resolveSshTransferConflict(direction: FileTransferDirection, fileName: string): Promise<FileTransferConflictPolicy | undefined> {
          if (e2eTransferPath('--mrt-e2e-sftp-upload-file=', '--mrt-e2e-sftp-transfers') ||
              e2eTransferPath('--mrt-e2e-sftp-download-root=', '--mrt-e2e-sftp-transfers')) return 'rename';
          const options: Electron.MessageBoxOptions = {
            type: 'question', title: 'SFTP transfer options',
            message: `${direction === 'upload' ? 'Upload' : 'Download'} ${fileName}`,
            detail: 'Choose what to do if a file with this name already exists. Rename keeps the existing file and adds a numbered copy.',
            buttons: ['Overwrite', 'Rename copy', 'Skip existing file', 'Cancel'], defaultId: 1, cancelId: 3, noLink: true
          };
          const currentWindow = window;
          const result = currentWindow && !currentWindow.isDestroyed()
            ? await dialog.showMessageBox(currentWindow, options)
            : await dialog.showMessageBox(options);
          return result.response === 0 ? 'overwrite' : result.response === 1 ? 'rename' : result.response === 2 ? 'skip' : undefined;
        },
        reportSshTransferProgress(progress: FileTransferProgress) {
          const current = window;
          if (current && !current.isDestroyed() && !current.webContents.isDestroyed()) current.webContents.send(SSH_TRANSFER_EVENT_CHANNEL, progress);
        },
        terminals, sshTerminals, telnetTerminals, ftpFiles, sessionCatalog, macros, preferences, tunnels, cancellation: cancellation.signal
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
      unbindSenderCancellation();
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
    rendererGestures.issue(event.sender.id, sessionId);
    return true;
  });
  ipcMain.handle(TELNET_CONSENT_GESTURE_CHANNEL, (event, input: unknown) => {
    const current = window;
    const owned = current !== undefined && !current.isDestroyed() && event.sender === current.webContents;
    const mainFrame = owned && event.senderFrame === event.sender.mainFrame;
    if (!mainFrame || !isAppDocument(event.senderFrame?.url ?? '')) return false;
    const sessionId = parseTelnetConsentGestureRequest(input);
    if (!sessionId) return false;
    rendererGestures.issue(event.sender.id, sessionId, 'telnet-plaintext-consent');
    return true;
  });
  ipcMain.handle(FTP_CONSENT_GESTURE_CHANNEL, (event, input: unknown) => {
    const current = window;
    const owned = current !== undefined && !current.isDestroyed() && event.sender === current.webContents;
    const mainFrame = owned && event.senderFrame === event.sender.mainFrame;
    if (!mainFrame || !isAppDocument(event.senderFrame?.url ?? '')) return false;
    const sessionId = parseFtpConsentGestureRequest(input);
    if (!sessionId) return false;
    rendererGestures.issue(event.sender.id, sessionId, 'ftp-plaintext-consent');
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
    void tunnels.dispose().then(() => Promise.all([terminals.dispose(), sshTerminals.dispose(), telnetTerminals.dispose(), ftpFiles.dispose()]))
      .then(() => storageStore.shutdown())
      .catch(() => undefined).finally(() => app.quit());
  });
  app.on('will-quit', () => {
    powerMonitor.removeListener('lock-screen', lockVaultForSystemEvent);
    powerMonitor.removeListener('suspend', lockVaultForSystemEvent);
    ipcMain.removeHandler(CANCEL_CATALOG_COMMAND_CHANNEL);
    ipcMain.removeHandler(PASTE_GESTURE_CHANNEL);
    ipcMain.removeHandler(TELNET_CONSENT_GESTURE_CHANNEL);
    ipcMain.removeHandler(FTP_CONSENT_GESTURE_CHANNEL);
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

function safeFtpDownloadName(value: string): string {
  const cleaned = [...value.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_').replace(/[ .]+$/u, '')].slice(0, 180).join('');
  const name = cleaned || 'download';
  return /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu.test(name) ? `_${name}` : name;
}

function e2eTransferPath(prefix: string, testModeFlag: string): string | undefined {
  if (app.isPackaged || process.env.MRT_E2E !== '1' || !process.argv.includes(testModeFlag)) return undefined;
  const value = process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length);
  return value && resolve(value) === value ? value : undefined;
}

// Do not await readiness at ESM top level: Electron 45 delays ready until module evaluation completes.
if (ownsSingleInstance) void app.whenReady().then(() => {
  if (portableProfileInitializationFailed) {
    dialog.showErrorBox('Portable data folder unavailable', 'MultiRemoteTerminal could not prepare its portable data folder beside the portable executable. Move the executable to a writable folder and try again.');
    app.quit();
    return;
  }
  boot();
}).catch(() => app.exit(1));
