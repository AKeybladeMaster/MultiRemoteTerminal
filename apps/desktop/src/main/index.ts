import { app, BrowserWindow, ipcMain, Menu, protocol, session } from 'electron';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { describeWorkbench } from '../../../../packages/application/src/workbench.ts';
import { APP_URL, COMMAND_CHANNEL } from '../../../../packages/contracts/src/commands.ts';
import { dispatchCommand } from './broker.ts';
import { serveAsset } from './assets.ts';

app.setName('MultiRemoteTerminal');
app.setAppUserModelId('io.github.akeyblademaster.multiremote-terminal');
app.enableSandbox();
protocol.registerSchemesAsPrivileged([{ scheme: 'mrt', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

// Compiled location: dist/host/apps/desktop/src/main; assets remain immutable build outputs.
const here = fileURLToPath(new URL('.', import.meta.url));
const dist = resolve(here, '../../../../../');
let window: BrowserWindow | undefined;

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
  current.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  current.webContents.on('will-navigate', event => event.preventDefault());
  current.webContents.on('will-frame-navigate', event => event.preventDefault());
  current.webContents.on('will-attach-webview', event => event.preventDefault());
  current.once('ready-to-show', () => current.show());
  current.on('closed', () => { if (window === current) window = undefined; });
  void current.loadURL(APP_URL);
}

function boot(): void {
Menu.setApplicationMenu(null);
session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
session.defaultSession.setPermissionCheckHandler(() => false);
session.defaultSession.on('will-download', event => event.preventDefault());
// Defense in depth: the app makes no external requests in WP-00, including subresources.
session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
  callback({ cancel: !details.url.startsWith('mrt://app/') });
});
protocol.handle('mrt', request => serveAsset(join(dist, 'renderer'), request));
ipcMain.handle(COMMAND_CHANNEL, (event, input: unknown) => {
  const owned = window !== undefined && !window.isDestroyed() && event.sender === window.webContents;
  return dispatchCommand({ owned, mainFrame: owned && event.senderFrame === event.sender.mainFrame,
    url: event.senderFrame?.url ?? '' }, input,
  () => describeWorkbench({ version: app.getVersion(), platform: process.platform }),
  () => { /* Diagnostics are off by default; no payload or exception is logged. */ });
});
createWindow();
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { ipcMain.removeHandler(COMMAND_CHANNEL); protocol.unhandle('mrt'); });
}

// Do not await readiness at ESM top level: Electron 45 delays ready until module evaluation completes.
void app.whenReady().then(boot).catch(() => app.exit(1));
