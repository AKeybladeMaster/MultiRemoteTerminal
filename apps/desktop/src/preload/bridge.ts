import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { CANCEL_CATALOG_COMMAND_CHANNEL, COMMAND_CHANNEL, CONTRACT_VERSION, FTP_CONSENT_GESTURE_CHANNEL, FTP_TRANSFER_EVENT_CHANNEL, PASTE_GESTURE_CHANNEL, POWERSHELL_PROFILE_SCRIPT_GESTURE_CHANNEL, REMOTE_FILE_DROP_CHANNEL, REMOTE_FILE_DROP_TEST_CHANNEL, RDP_LAUNCH_GESTURE_CHANNEL,
  SSH_TRANSFER_EVENT_CHANNEL, SSH_X11_CONSENT_GESTURE_CHANNEL, TELNET_CONSENT_GESTURE_CHANNEL, TFTP_SERVER_ACTION_GESTURE_CHANNEL, TFTP_SERVER_STATUS_EVENT_CHANNEL,
  VNC_LAUNCH_GESTURE_CHANNEL, XDMCP_LAUNCH_GESTURE_CHANNEL,
  SSH_SESSION_LOG_CONSENT_GESTURE_CHANNEL, SSH_SESSION_LOG_STATUS_EVENT_CHANNEL, SSH_TRUST_EVENT_CHANNEL, TERMINAL_EVENT_CHANNEL, TUNNEL_STATUS_EVENT_CHANNEL } from '../../../../packages/contracts/src/commands.ts';
import type { RemoteFileDropContext } from '../../../../packages/contracts/src/commands.ts';
import { createBridge } from './client.ts';
import { installRemoteFileDropStore } from './remote-file-drop.ts';
import { installExternalViewerLaunchGestureStore, installFtpConsentGestureStore, installTelnetConsentGestureStore, installTerminalPasteGestureStore,
  installTftpServerActionGestureStore, installPowerShellProfileGestureStore, installSshSessionLogConsentGestureStore, installSshX11ConsentGestureStore,
  installXdmcpLaunchGestureStore } from './paste-gesture.ts';

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
const tftpServerActionGestures = installTftpServerActionGestureStore(document, async (action, selectionId, port) =>
  await ipcRenderer.invoke(TFTP_SERVER_ACTION_GESTURE_CHANNEL, action === 'choose-root' ? { action } : { action, selectionId, port }) === true);
const powerShellProfileGestures = installPowerShellProfileGestureStore(document, async sessionId =>
  await ipcRenderer.invoke(POWERSHELL_PROFILE_SCRIPT_GESTURE_CHANNEL, { sessionId }) === true);
const sshSessionLogConsentGestures = installSshSessionLogConsentGestureStore(document, async (sessionId, host, port, gatewayProfileIds) =>
  await ipcRenderer.invoke(SSH_SESSION_LOG_CONSENT_GESTURE_CHANNEL, { sessionId, host, port, gatewayProfileIds }) === true);
const sshX11ConsentGestures = installSshX11ConsentGestureStore(document, async (host, port, gatewayProfileIds) =>
  await ipcRenderer.invoke(SSH_X11_CONSENT_GESTURE_CHANNEL, { host, port, gatewayProfileIds }) === true);
const xdmcpLaunchGestures = installXdmcpLaunchGestureStore(document, async host =>
  await ipcRenderer.invoke(XDMCP_LAUNCH_GESTURE_CHANNEL, { host }) === true);
const remoteFileDrops = installRemoteFileDropStore(document, file => webUtils.getPathForFile(file as File), request =>
  ipcRenderer.invoke(REMOTE_FILE_DROP_CHANNEL, request), (context: RemoteFileDropContext, tokens: readonly string[]) =>
    ipcRenderer.invoke(COMMAND_CHANNEL, { command: 'files.drop.discard', requestId: globalThis.crypto.randomUUID(), contractVersion: CONTRACT_VERSION,
      payload: { sessionId: context.sessionId, transport: context.transport, remoteDirectory: context.remoteDirectory, tokens } }));
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
  (action, selectionId, port) => tftpServerActionGestures.consume(action, selectionId, port),
  listener => remoteFileDrops.subscribe(listener), listener => {
    const receive = (_event: Electron.IpcRendererEvent, value: unknown) => listener(value);
    ipcRenderer.on(TFTP_SERVER_STATUS_EVENT_CHANNEL, receive);
    return () => ipcRenderer.removeListener(TFTP_SERVER_STATUS_EVENT_CHANNEL, receive);
  }, sessionId => powerShellProfileGestures.consume(sessionId), listener => {
    const receive = (_event: Electron.IpcRendererEvent, value: unknown) => listener(value);
    ipcRenderer.on(SSH_SESSION_LOG_STATUS_EVENT_CHANNEL, receive);
    return () => ipcRenderer.removeListener(SSH_SESSION_LOG_STATUS_EVENT_CHANNEL, receive);
  }, (sessionId, host, port, gatewayProfileIds) => sshSessionLogConsentGestures.consume(sessionId, host, port, gatewayProfileIds),
  (host, port, gatewayProfileIds) => sshX11ConsentGestures.consume(host, port, gatewayProfileIds),
  host => xdmcpLaunchGestures.consume(host));
contextBridge.exposeInMainWorld('multiRemoteTerminal', bridge);
