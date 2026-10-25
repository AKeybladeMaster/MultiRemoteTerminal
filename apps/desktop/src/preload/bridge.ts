import { contextBridge, ipcRenderer } from 'electron';
import { CANCEL_CATALOG_COMMAND_CHANNEL, COMMAND_CHANNEL, FTP_CONSENT_GESTURE_CHANNEL, FTP_TRANSFER_EVENT_CHANNEL, PASTE_GESTURE_CHANNEL, RDP_LAUNCH_GESTURE_CHANNEL,
  SSH_TRANSFER_EVENT_CHANNEL, TELNET_CONSENT_GESTURE_CHANNEL,
  SSH_TRUST_EVENT_CHANNEL, TERMINAL_EVENT_CHANNEL, TUNNEL_STATUS_EVENT_CHANNEL } from '../../../../packages/contracts/src/commands.ts';
import { createBridge } from './client.ts';
import { installFtpConsentGestureStore, installRdpLaunchGestureStore, installTelnetConsentGestureStore, installTerminalPasteGestureStore } from './paste-gesture.ts';

const pasteGestures = installTerminalPasteGestureStore(document, async sessionId =>
  await ipcRenderer.invoke(PASTE_GESTURE_CHANNEL, { sessionId }) === true);
const telnetConsentGestures = installTelnetConsentGestureStore(document, async sessionId =>
  await ipcRenderer.invoke(TELNET_CONSENT_GESTURE_CHANNEL, { sessionId }) === true);
const ftpConsentGestures = installFtpConsentGestureStore(document, async sessionId =>
  await ipcRenderer.invoke(FTP_CONSENT_GESTURE_CHANNEL, { sessionId }) === true);
const rdpLaunchGestures = installRdpLaunchGestureStore(document, async (host, port) =>
  await ipcRenderer.invoke(RDP_LAUNCH_GESTURE_CHANNEL, { host, port }) === true);

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
}, (host, port) => rdpLaunchGestures.consume(host, port));
contextBridge.exposeInMainWorld('multiRemoteTerminal', bridge);
