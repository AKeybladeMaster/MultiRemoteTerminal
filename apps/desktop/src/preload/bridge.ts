import { contextBridge, ipcRenderer } from 'electron';
import { CANCEL_CATALOG_COMMAND_CHANNEL, COMMAND_CHANNEL, PASTE_GESTURE_CHANNEL, TELNET_CONSENT_GESTURE_CHANNEL, SSH_TRUST_EVENT_CHANNEL, TERMINAL_EVENT_CHANNEL } from '../../../../packages/contracts/src/commands.ts';
import { createBridge } from './client.ts';
import { installTelnetConsentGestureStore, installTerminalPasteGestureStore } from './paste-gesture.ts';

const pasteGestures = installTerminalPasteGestureStore(document, async sessionId =>
  await ipcRenderer.invoke(PASTE_GESTURE_CHANNEL, { sessionId }) === true);
const telnetConsentGestures = installTelnetConsentGestureStore(document, async sessionId =>
  await ipcRenderer.invoke(TELNET_CONSENT_GESTURE_CHANNEL, { sessionId }) === true);

const bridge = createBridge(request => ipcRenderer.invoke(COMMAND_CHANNEL, request), () => globalThis.crypto.randomUUID(), listener => {
  const receive = (_event: Electron.IpcRendererEvent, value: unknown) => listener(value);
  ipcRenderer.on(TERMINAL_EVENT_CHANNEL, receive);
  return () => ipcRenderer.removeListener(TERMINAL_EVENT_CHANNEL, receive);
}, listener => {
  const receive = (_event: Electron.IpcRendererEvent, value: unknown) => listener(value);
  ipcRenderer.on(SSH_TRUST_EVENT_CHANNEL, receive);
  return () => ipcRenderer.removeListener(SSH_TRUST_EVENT_CHANNEL, receive);
}, requestId => ipcRenderer.invoke(CANCEL_CATALOG_COMMAND_CHANNEL, { requestId }), sessionId => pasteGestures.consume(sessionId),
  (sessionId, host, port) => telnetConsentGestures.consume(sessionId, host, port));
contextBridge.exposeInMainWorld('multiRemoteTerminal', bridge);
