import { contextBridge, ipcRenderer } from 'electron';
import { COMMAND_CHANNEL } from '../../../../packages/contracts/src/commands.ts';
import { createBridge } from './client.ts';

const bridge = createBridge(request => ipcRenderer.invoke(COMMAND_CHANNEL, request), () => globalThis.crypto.randomUUID());
contextBridge.exposeInMainWorld('multiRemoteTerminal', bridge);
