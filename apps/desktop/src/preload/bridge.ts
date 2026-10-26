import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { CANCEL_CATALOG_COMMAND_CHANNEL, COMMAND_CHANNEL, FTP_CONSENT_GESTURE_CHANNEL, FTP_TRANSFER_EVENT_CHANNEL, PASTE_GESTURE_CHANNEL, REMOTE_FILE_DROP_CHANNEL, REMOTE_FILE_DROP_TEST_CHANNEL, RDP_LAUNCH_GESTURE_CHANNEL,
  SSH_TRANSFER_EVENT_CHANNEL, TELNET_CONSENT_GESTURE_CHANNEL, VNC_LAUNCH_GESTURE_CHANNEL,
  SSH_TRUST_EVENT_CHANNEL, TERMINAL_EVENT_CHANNEL, TUNNEL_STATUS_EVENT_CHANNEL } from '../../../../packages/contracts/src/commands.ts';
import { createBridge } from './client.ts';
import { installRemoteFileDropStore } from './remote-file-drop.ts';
import { installExternalViewerLaunchGestureStore, installFtpConsentGestureStore, installTelnetConsentGestureStore, installTerminalPasteGestureStore } from './paste-gesture.ts';

const pasteGestures = installTerminalPasteGestureStore(document, async sessionId =>
  await ipcRenderer.invoke(PASTE_GESTURE_CHANNEL, { sessionId }) === true);
const telnetConsentGestures = installTelnetConsentGestureStore(document, async sessionId =>
  await ipcRenderer.invoke(TELNET_CONSENT_GESTURE_CHANNEL, { sessionId }) === true);
const ftpConsentGestures = installFtpConsentGestureStore(document, async sessionId =>
  await ipcRenderer.invoke(FTP_CONSENT_GESTURE_CHANNEL, { sessionId }) === true);
const rdpLaunchGestures = installExternalViewerLaunchGestureStore(document, 'rdp', async (host, port) =>
  await ipcRenderer.invoke(RDP_LAUNCH_GESTURE_CHANNEL, { host, port }) === true);
const vncLaunchGestures = installExternalViewerLaunchGestureStore(document, 'vnc', async (host, port) =>
  await ipcRenderer.invoke(VNC_LAUNCH_GESTURE_CHANNEL, { host, port }) === true);
const remoteFileDrops = installRemoteFileDropStore(document, file => webUtils.getPathForFile(file as File), request =>
  ipcRenderer.invoke(REMOTE_FILE_DROP_CHANNEL, request));
void ipcRenderer.invoke(REMOTE_FILE_DROP_TEST_CHANNEL).then(enabled => {
  if (enabled !== true) return;
  contextBridge.exposeInMainWorld('__mrtE2EFileDrop', Object.freeze({
    dropFromInput(inputSelector: string, targetSelector: string): boolean {
      if (typeof inputSelector !== 'string' || inputSelector.length > 256 || typeof targetSelector !== 'string' || targetSelector.length > 512) return false;
      try {
        const input = document.querySelector(inputSelector);
        const target = document.querySelector(targetSelector);
        if (!(input instanceof HTMLInputElement) || !input.files || !target || input.files.length === 0) return false;
        remoteFileDrops.simulateDropFromTest(Array.from(input.files), target);
        return true;
      } catch { return false; }
    }
  }));
}).catch(() => {});

const bridge = createBridge(request => ipcRenderer.invoke(COMMAND_CHANNEL, request), () => globalThis.crypto.randomUUID(), listener => {
  const receive = (_event: Electron.IpcRendererEvent, value: unknown) => listener(value);
  ipcRenderer.on(TERMINAL_EVENT_CHANNEL, receive);
  return () => ipcRenderer.removeListener(TERMINAL_EVENT_CHANNEL, receive);
}, listener => {
  const receive = (_event: Electron.IpcRendererEvent, value: unknown) => listener(value);
  ipcRenderer.on(SSH_TRUST_EVENT_CHANNEL, receive);
  return () => ipcRenderer.removeListener(SSH_TRUST_EVENT_CHANNEL, receive);
}, requestId => ipcRenderer.invoke(CANCEL_CATALOG_COMMAND_CHANNEL, { requestId }), sessionId => pasteGestures.consume(sessionId),
  (sessionId, host, port) => telnetConsentGestures.consume(sessionId, host, port),
  (sessionId, host, port, secure) => ftpConsentGestures.consume(sessionId, host, port, secure), listener => {
    const receive = (_event: Electron.IpcRendererEvent, value: unknown) => listener(value);
    ipcRenderer.on(FTP_TRANSFER_EVENT_CHANNEL, receive);
    return () => ipcRenderer.removeListener(FTP_TRANSFER_EVENT_CHANNEL, receive);
  }, listener => {
    const receive = (_event: Electron.IpcRendererEvent, value: unknown) => listener(value);
    ipcRenderer.on(SSH_TRANSFER_EVENT_CHANNEL, receive);
    return () => ipcRenderer.removeListener(SSH_TRANSFER_EVENT_CHANNEL, receive);
}, listener => {
    const receive = (_event: Electron.IpcRendererEvent, value: unknown) => listener(value);
    ipcRenderer.on(TUNNEL_STATUS_EVENT_CHANNEL, receive);
    return () => ipcRenderer.removeListener(TUNNEL_STATUS_EVENT_CHANNEL, receive);
}, (host, port) => rdpLaunchGestures.consume(host, port), (host, port) => vncLaunchGestures.consume(host, port),
  listener => remoteFileDrops.subscribe(listener));
contextBridge.exposeInMainWorld('multiRemoteTerminal', bridge);
