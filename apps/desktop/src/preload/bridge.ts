import { contextBridge, ipcRenderer } from 'electron';
import { COMMAND_CHANNEL, SSH_TRUST_EVENT_CHANNEL, TERMINAL_EVENT_CHANNEL } from '../../../../packages/contracts/src/commands.ts';
import { createBridge } from './client.ts';

const bridge = createBridge(request => ipcRenderer.invoke(COMMAND_CHANNEL, request), () => globalThis.crypto.randomUUID(), listener => {
  const receive = (_event: Electron.IpcRendererEvent, value: unknown) => listener(value);
  ipcRenderer.on(TERMINAL_EVENT_CHANNEL, receive);
  return () => ipcRenderer.removeListener(TERMINAL_EVENT_CHANNEL, receive);
}, listener => {
  const receive = (_event: Electron.IpcRendererEvent, value: unknown) => listener(value);
  ipcRenderer.on(SSH_TRUST_EVENT_CHANNEL, receive);
  return () => ipcRenderer.removeListener(SSH_TRUST_EVENT_CHANNEL, receive);
});
contextBridge.exposeInMainWorld('multiRemoteTerminal', bridge);
