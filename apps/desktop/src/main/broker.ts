import { basename } from 'node:path';
import { isAppDocument, parseRequest, requestIdOf } from '../../../../packages/contracts/src/commands.ts';
import type { CommandReply } from '../../../../packages/contracts/src/commands.ts';
import type { LocalTerminalController } from '../../../../packages/application/src/local-terminals.ts';
import type { SshTerminalController } from '../../../../packages/application/src/ssh-terminals.ts';
import type { TelnetTerminalController } from '../../../../packages/application/src/telnet-terminals.ts';
import type { SerialTerminalController } from '../../../../packages/application/src/serial-terminals.ts';
import type { FtpFilesController } from '../../../../packages/application/src/ftp-files.ts';
import type { RdpViewerController } from '../../../../packages/application/src/rdp-viewer.ts';
import type { VncViewerController } from '../../../../packages/application/src/vnc-viewer.ts';
import type { FtpTransferConflictPolicy, FtpTransferDirection, FtpTransferProgress } from '../../../../packages/domain/src/ftp.ts';
import type { FileTransferConflictPolicy, FileTransferDirection, FileTransferProgress } from '../../../../packages/domain/src/file-transfer.ts';
import type { SessionCatalog } from '../../../../packages/application/src/session-catalog.ts';
import type { MacroCatalog } from '../../../../packages/application/src/macros.ts';
import type { WorkbenchPreferencesManager } from '../../../../packages/application/src/workbench-preferences.ts';
import type { SshTunnelController } from '../../../../packages/application/src/ssh-tunnels.ts';
import type { SessionCredentialManager } from '../../../../packages/application/src/session-credentials.ts';
import type { WorkbenchSnapshot } from '../../../../packages/application/src/workbench.ts';
import type { CancellationSignal } from '../../../../packages/application/src/cancellation.ts';
import type { SshHostEndpoint } from '../../../../packages/domain/src/host-trust.ts';
import { normalizeSshGatewayRoute } from '../../../../packages/domain/src/ssh-route.ts';
import { failure } from '../../../../packages/domain/src/errors.ts';
import type { Outcome } from '../../../../packages/domain/src/errors.ts';
import { MAX_TERMINAL_INPUT_CHARS } from '../../../../packages/domain/src/local-terminal.ts';
import { MAX_SERIAL_INPUT_CHARS } from '../../../../packages/domain/src/serial.ts';

const EMPTY_RESULT: Record<string, never> = Object.freeze({});

export interface CommandSender {
  readonly owned: boolean;
  readonly mainFrame: boolean;
  readonly url: string;
}

export interface AuditEvent {
  readonly kind: 'ipc.rejected' | 'application.unavailable';
  readonly code: string;
}

export interface FtpUploadSelection {
  readonly localPath: string;
  readonly fileName: string;
}

export type SshUploadSelection = FtpUploadSelection;

export interface CommandActions {
  readonly describe: () => WorkbenchSnapshot;
  readonly noteUserActivity: () => void;
  readonly readClipboardText: () => Promise<string>;
  readonly authorizeClipboardPaste: (sessionId: string) => boolean;
  readonly authorizeTelnetConsent: (sessionId: string) => boolean;
  readonly authorizeFtpConsent: (sessionId: string) => boolean;
  readonly authorizeRdpLaunch: (host: string, port: number) => boolean;
  readonly authorizeVncLaunch: (host: string, port: number) => boolean;
  readonly confirmMultilinePaste: () => Promise<boolean>;
  readonly selectFtpUploadFile: () => Promise<FtpUploadSelection | undefined>;
  readonly selectFtpDownloadPath: (fileName: string) => Promise<string | undefined>;
  readonly resolveFtpTransferConflict: (direction: FtpTransferDirection, fileName: string) => Promise<FtpTransferConflictPolicy | undefined>;
  readonly reportFtpTransferProgress: (progress: FtpTransferProgress) => void;
  readonly selectSshUploadFile: () => Promise<SshUploadSelection | undefined>;
  readonly selectSshDownloadPath: (fileName: string) => Promise<string | undefined>;
  readonly resolveSshTransferConflict: (direction: FileTransferDirection, fileName: string) => Promise<FileTransferConflictPolicy | undefined>;
  readonly reportSshTransferProgress: (progress: FileTransferProgress) => void;
  readonly cancellation?: CancellationSignal;
  readonly terminals: Pick<LocalTerminalController, 'open' | 'write' | 'resize' | 'acknowledgeOutput' | 'close'>;
  readonly sshTerminals: Pick<SshTerminalController, 'open' | 'openFiles' | 'write' | 'resize' | 'acknowledgeOutput' | 'listRemoteDirectory' | 'uploadRemoteFile' |
    'downloadRemoteFile' | 'readRemoteTextFile' | 'saveRemoteTextFile' | 'cancelTransfer' | 'close' | 'approveHostKey' | 'rejectHostKey' | 'revokeHostKey'>;
  readonly telnetTerminals: Pick<TelnetTerminalController, 'open' | 'write' | 'resize' | 'acknowledgeOutput' | 'close'>;
  readonly serialTerminals: Pick<SerialTerminalController, 'listPorts' | 'open' | 'write' | 'resize' | 'acknowledgeOutput' | 'close'>;
  readonly ftpFiles: Pick<FtpFilesController, 'open' | 'listDirectory' | 'uploadFile' | 'downloadFile' | 'cancelTransfer' | 'close'>;
  readonly rdpViewer: Pick<RdpViewerController, 'launch'>;
  readonly vncViewer: Pick<VncViewerController, 'launch'>;
  readonly sessionCatalog: Pick<SessionCatalog, 'list' | 'count' | 'get' | 'create' | 'remember' | 'setFavorite' | 'remove' | 'listFolders' | 'createFolder' | 'renameFolder' | 'moveFolder' | 'removeFolder' | 'moveSession' | 'exportFolder' | 'importFolder'>;
  readonly sessionCredentials: Pick<SessionCredentialManager, 'state' | 'lock' | 'unlock' | 'enableMasterPassword' | 'disableMasterPassword' | 'resetVault' |
    'hasSshCredential' | 'saveSshCredential' | 'forgetSshCredential' | 'resolveSshCredential'>;
  readonly macros: Pick<MacroCatalog, 'list' | 'create' | 'update' | 'remove' | 'listShortcuts' | 'setShortcut' | 'removeShortcut'>;
  readonly preferences: Pick<WorkbenchPreferencesManager, 'read' | 'save'>;
  readonly tunnels: Pick<SshTunnelController, 'list' | 'save' | 'remove' | 'start' | 'stop'>;
}

async function pasteFromClipboard(
  requestId: string,
  sessionId: string,
  actions: Pick<CommandActions, 'readClipboardText' | 'confirmMultilinePaste' | 'cancellation'>,
  write: (sessionId: string, data: string) => Promise<Outcome<Record<string, never>>>,
  maxChars = MAX_TERMINAL_INPUT_CHARS,
): Promise<CommandReply<Record<string, never>>> {
  if (actions.cancellation?.aborted) return { requestId, ...failure('CANCELLED', 'terminal') };
  const data = await actions.readClipboardText();
  if (actions.cancellation?.aborted) return { requestId, ...failure('CANCELLED', 'terminal') };
  if (data.length > maxChars) return { requestId, ...failure('OUTPUT_LIMIT', 'terminal') };
  if (data.includes('\0')) return { requestId, ...failure('INVALID_REQUEST') };
  if (/[\r\n]/u.test(data) && !await actions.confirmMultilinePaste()) return { requestId, ...failure('CANCELLED', 'terminal') };
  if (actions.cancellation?.aborted) return { requestId, ...failure('CANCELLED', 'terminal') };
  return { requestId, ...await write(sessionId, data) };
}

export async function dispatchCommand(
  sender: CommandSender,
  input: unknown,
  actions: CommandActions,
  audit: (event: AuditEvent) => void,
): Promise<CommandReply<unknown>> {
  if (!sender.owned || !sender.mainFrame || !isAppDocument(sender.url)) {
    audit({ kind: 'ipc.rejected', code: 'FORBIDDEN' });
    return { requestId: '', ...failure('FORBIDDEN') };
  }
  const parsed = parseRequest(input);
  if (!parsed.ok) {
    audit({ kind: 'ipc.rejected', code: parsed.error.code });
    return { requestId: requestIdOf(input), ...parsed };
  }

  const { requestId } = parsed.result;
  try {
    if (parsed.result.command === 'terminal.open' || parsed.result.command === 'terminal.write' || parsed.result.command === 'terminal.close' ||
        parsed.result.command === 'ssh.open' || parsed.result.command === 'ssh.write' || parsed.result.command === 'ssh.close' ||
        parsed.result.command === 'sftp.open' || parsed.result.command === 'sftp.close' ||
        parsed.result.command === 'ssh.files.upload' || parsed.result.command === 'ssh.files.download' || parsed.result.command === 'ssh.files.read-text' ||
        parsed.result.command === 'ssh.files.write-text' || parsed.result.command === 'ssh.files.cancel' ||
        parsed.result.command === 'session.remember' ||
        parsed.result.command === 'telnet.open' || parsed.result.command === 'telnet.write' || parsed.result.command === 'telnet.close' ||
        parsed.result.command === 'serial.open' || parsed.result.command === 'serial.write' || parsed.result.command === 'serial.close' ||
        parsed.result.command === 'ftp.open' || parsed.result.command === 'ftp.files.list' || parsed.result.command === 'ftp.files.upload' ||
        parsed.result.command === 'ftp.files.download' || parsed.result.command === 'ftp.files.cancel' || parsed.result.command === 'ftp.close' ||
        parsed.result.command === 'tunnel.start' || parsed.result.command === 'tunnel.stop' || parsed.result.command === 'rdp.launch' || parsed.result.command === 'vnc.launch' ||
        parsed.result.command.startsWith('macro.')) actions.noteUserActivity();
    switch (parsed.result.command) {
      case 'app.describe': return { requestId, ok: true, result: actions.describe() };
      case 'terminal.open': {
        const { sessionId, shell, columns, rows } = parsed.result.payload;
        return { requestId, ...await actions.terminals.open(sessionId, shell, { columns, rows }) };
      }
      case 'terminal.write': {
        const { sessionId, data } = parsed.result.payload;
        return { requestId, ...await actions.terminals.write(sessionId, data) };
      }
      case 'terminal.paste': {
        if (!actions.authorizeClipboardPaste(parsed.result.payload.sessionId)) return { requestId, ...failure('FORBIDDEN') };
        actions.noteUserActivity();
        return pasteFromClipboard(requestId, parsed.result.payload.sessionId, actions, actions.terminals.write);
      }
      case 'terminal.resize': {
        const { sessionId, columns, rows } = parsed.result.payload;
        return { requestId, ...await actions.terminals.resize(sessionId, { columns, rows }) };
      }
      case 'terminal.ack': {
        const { sessionId, sequence } = parsed.result.payload;
        return { requestId, ...await actions.terminals.acknowledgeOutput(sessionId, sequence) };
      }
      case 'terminal.close': {
        return { requestId, ...await actions.terminals.close(parsed.result.payload.sessionId) };
      }
      case 'ssh.open': {
        const { sessionId, host, port, columns, rows, gatewayProfileIds = [], profileId } = parsed.result.payload;
        const endpoints: SshHostEndpoint[] = [];
        for (const gatewayProfileId of gatewayProfileIds) {
          const result = await actions.sessionCatalog.get(gatewayProfileId, actions.cancellation);
          if (!result.ok) return { requestId, ...result };
          if (result.result.kind !== 'ssh') return { requestId, ...failure('INVALID_REQUEST') };
          endpoints.push({ host: result.result.host, port: result.result.port });
        }
        const route = normalizeSshGatewayRoute(endpoints, { host, port });
        if (!route) return { requestId, ...failure('INVALID_REQUEST') };
        let savedCredentials;
        if (profileId) {
          const credential = await actions.sessionCredentials.resolveSshCredential(profileId, host, port, actions.cancellation);
          if (!credential.ok) return { requestId, ...credential };
          savedCredentials = credential.result;
        }
        try {
          return { requestId, ...await actions.sshTerminals.open(sessionId, host, port, { columns, rows }, route, savedCredentials) };
        } finally {
          if (savedCredentials) {
            savedCredentials.username = '';
            savedCredentials.password = '';
          }
        }
      }
      case 'sftp.open': {
        const { sessionId, host, port } = parsed.result.payload;
        return { requestId, ...await actions.sshTerminals.openFiles(sessionId, host, port) };
      }
      case 'sftp.close': return { requestId, ...await actions.sshTerminals.close(parsed.result.payload.sessionId) };
      case 'ssh.write': {
        const { sessionId, data } = parsed.result.payload;
        return { requestId, ...await actions.sshTerminals.write(sessionId, data) };
      }
      case 'ssh.paste': {
        if (!actions.authorizeClipboardPaste(parsed.result.payload.sessionId)) return { requestId, ...failure('FORBIDDEN') };
        actions.noteUserActivity();
        return pasteFromClipboard(requestId, parsed.result.payload.sessionId, actions, actions.sshTerminals.write);
      }
      case 'ssh.resize': {
        const { sessionId, columns, rows } = parsed.result.payload;
        return { requestId, ...await actions.sshTerminals.resize(sessionId, { columns, rows }) };
      }
      case 'ssh.ack': {
        const { sessionId, sequence } = parsed.result.payload;
        return { requestId, ...await actions.sshTerminals.acknowledgeOutput(sessionId, sequence) };
      }
      case 'ssh.close': {
        return { requestId, ...await actions.sshTerminals.close(parsed.result.payload.sessionId) };
      }
      case 'ssh.host.approve': {
        return { requestId, ...await actions.sshTerminals.approveHostKey(parsed.result.payload.token) };
      }
      case 'ssh.host.reject': {
        return { requestId, ...actions.sshTerminals.rejectHostKey(parsed.result.payload.token) };
      }
      case 'ssh.host.revoke': {
        return { requestId, ...await actions.sshTerminals.revokeHostKey(parsed.result.payload.host, parsed.result.payload.port) };
      }
      case 'ssh.files.list': {
        return { requestId, ...await actions.sshTerminals.listRemoteDirectory(parsed.result.payload.sessionId, parsed.result.payload.path, actions.cancellation) };
      }
      case 'ssh.files.upload': {
        const { sessionId, operationId, remoteDirectory } = parsed.result.payload;
        const selection = await actions.selectSshUploadFile();
        if (!selection || actions.cancellation?.aborted) return { requestId, ...failure('CANCELLED') };
        const conflictPolicy = await actions.resolveSshTransferConflict('upload', selection.fileName);
        if (!conflictPolicy || actions.cancellation?.aborted) return { requestId, ...failure('CANCELLED') };
        return { requestId, ...await actions.sshTerminals.uploadRemoteFile(sessionId, operationId, selection.localPath, remoteDirectory,
          selection.fileName, conflictPolicy, actions.cancellation, actions.reportSshTransferProgress) };
      }
      case 'ssh.files.download': {
        const { sessionId, operationId, remotePath } = parsed.result.payload;
        const fileName = remotePath.slice(remotePath.lastIndexOf('/') + 1);
        const localPath = await actions.selectSshDownloadPath(fileName);
        if (!localPath || actions.cancellation?.aborted) return { requestId, ...failure('CANCELLED') };
        const conflictPolicy = await actions.resolveSshTransferConflict('download', basename(localPath));
        if (!conflictPolicy || actions.cancellation?.aborted) return { requestId, ...failure('CANCELLED') };
        return { requestId, ...await actions.sshTerminals.downloadRemoteFile(sessionId, operationId, remotePath, localPath,
          conflictPolicy, actions.cancellation, actions.reportSshTransferProgress) };
      }
      case 'ssh.files.read-text': {
        const { sessionId, operationId, remotePath } = parsed.result.payload;
        return { requestId, ...await actions.sshTerminals.readRemoteTextFile(sessionId, operationId, remotePath,
          actions.cancellation, actions.reportSshTransferProgress) };
      }
      case 'ssh.files.write-text': {
        const { sessionId, operationId, remotePath, content, expectedRevision } = parsed.result.payload;
        return { requestId, ...await actions.sshTerminals.saveRemoteTextFile(sessionId, operationId, remotePath, content, expectedRevision,
          actions.cancellation, actions.reportSshTransferProgress) };
      }
      case 'ssh.files.cancel': {
        const { sessionId, operationId } = parsed.result.payload;
        return { requestId, ...await actions.sshTerminals.cancelTransfer(sessionId, operationId) };
      }
      case 'telnet.open': {
        const { sessionId, host, port, columns, rows } = parsed.result.payload;
        if (!actions.authorizeTelnetConsent(sessionId)) return { requestId, ...failure('FORBIDDEN') };
        return { requestId, ...await actions.telnetTerminals.open(sessionId, host, port, { columns, rows }) };
      }
      case 'telnet.write': {
        const { sessionId, data } = parsed.result.payload;
        return { requestId, ...await actions.telnetTerminals.write(sessionId, data) };
      }
      case 'telnet.paste': {
        if (!actions.authorizeClipboardPaste(parsed.result.payload.sessionId)) return { requestId, ...failure('FORBIDDEN') };
        actions.noteUserActivity();
        return pasteFromClipboard(requestId, parsed.result.payload.sessionId, actions, actions.telnetTerminals.write);
      }
      case 'telnet.resize': {
        const { sessionId, columns, rows } = parsed.result.payload;
        return { requestId, ...await actions.telnetTerminals.resize(sessionId, { columns, rows }) };
      }
      case 'telnet.ack': {
        const { sessionId, sequence } = parsed.result.payload;
        return { requestId, ...await actions.telnetTerminals.acknowledgeOutput(sessionId, sequence) };
      }
      case 'telnet.close': return { requestId, ...await actions.telnetTerminals.close(parsed.result.payload.sessionId) };
      case 'serial.ports.list': return { requestId, ...await actions.serialTerminals.listPorts() };
      case 'serial.open': {
        const { sessionId, configuration, columns, rows } = parsed.result.payload;
        return { requestId, ...await actions.serialTerminals.open(sessionId, configuration, { columns, rows }) };
      }
      case 'serial.write': {
        const { sessionId, data } = parsed.result.payload;
        return { requestId, ...await actions.serialTerminals.write(sessionId, data) };
      }
      case 'serial.paste': {
        if (!actions.authorizeClipboardPaste(parsed.result.payload.sessionId)) return { requestId, ...failure('FORBIDDEN') };
        actions.noteUserActivity();
        return pasteFromClipboard(requestId, parsed.result.payload.sessionId, actions, actions.serialTerminals.write, MAX_SERIAL_INPUT_CHARS);
      }
      case 'serial.resize': {
        const { sessionId, columns, rows } = parsed.result.payload;
        return { requestId, ...await actions.serialTerminals.resize(sessionId, { columns, rows }) };
      }
      case 'serial.ack': {
        const { sessionId, sequence } = parsed.result.payload;
        return { requestId, ...await actions.serialTerminals.acknowledgeOutput(sessionId, sequence) };
      }
      case 'serial.close': return { requestId, ...await actions.serialTerminals.close(parsed.result.payload.sessionId) };
      case 'ftp.open': {
        const { sessionId, host, port, secure } = parsed.result.payload;
        if (!secure && !actions.authorizeFtpConsent(sessionId)) return { requestId, ...failure('FORBIDDEN') };
        return { requestId, ...await actions.ftpFiles.open(sessionId, host, port, secure, actions.cancellation) };
      }
      case 'ftp.files.list': {
        const { sessionId, path } = parsed.result.payload;
        return { requestId, ...await actions.ftpFiles.listDirectory(sessionId, path, actions.cancellation) };
      }
      case 'ftp.files.upload': {
        const { sessionId, operationId, remoteDirectory } = parsed.result.payload;
        const selection = await actions.selectFtpUploadFile();
        if (!selection || actions.cancellation?.aborted) return { requestId, ...failure('CANCELLED') };
        const conflictPolicy = await actions.resolveFtpTransferConflict('upload', selection.fileName);
        if (!conflictPolicy || actions.cancellation?.aborted) return { requestId, ...failure('CANCELLED') };
        return { requestId, ...await actions.ftpFiles.uploadFile(sessionId, operationId, selection.localPath, remoteDirectory,
          selection.fileName, conflictPolicy, actions.cancellation, actions.reportFtpTransferProgress) };
      }
      case 'ftp.files.download': {
        const { sessionId, operationId, remotePath } = parsed.result.payload;
        const fileName = remotePath.slice(remotePath.lastIndexOf('/') + 1);
        const localPath = await actions.selectFtpDownloadPath(fileName);
        if (!localPath || actions.cancellation?.aborted) return { requestId, ...failure('CANCELLED') };
        const conflictPolicy = await actions.resolveFtpTransferConflict('download', basename(localPath));
        if (!conflictPolicy || actions.cancellation?.aborted) return { requestId, ...failure('CANCELLED') };
        return { requestId, ...await actions.ftpFiles.downloadFile(sessionId, operationId, remotePath, localPath,
          conflictPolicy, actions.cancellation, actions.reportFtpTransferProgress) };
      }
      case 'ftp.files.cancel': {
        const { sessionId, operationId } = parsed.result.payload;
        return { requestId, ...await actions.ftpFiles.cancelTransfer(sessionId, operationId) };
      }
      case 'ftp.close': return { requestId, ...await actions.ftpFiles.close(parsed.result.payload.sessionId) };
      case 'rdp.launch': {
        const { host, port } = parsed.result.payload;
        if (!actions.authorizeRdpLaunch(host, port)) return { requestId, ...failure('FORBIDDEN') };
        return { requestId, ...await actions.rdpViewer.launch(host, port, actions.cancellation) };
      }
      case 'vnc.launch': {
        const { host, port } = parsed.result.payload;
        if (!actions.authorizeVncLaunch(host, port)) return { requestId, ...failure('FORBIDDEN') };
        return { requestId, ...await actions.vncViewer.launch(host, port, actions.cancellation) };
      }
      case 'session.list': return { requestId, ...await actions.sessionCatalog.list(parsed.result.payload.query, actions.cancellation) };
      case 'session.count': return { requestId, ...await actions.sessionCatalog.count(actions.cancellation) };
      case 'session.create': return { requestId, ...await actions.sessionCatalog.create(parsed.result.payload, actions.cancellation) };
      case 'session.remember': {
        const preferences = await actions.preferences.read(actions.cancellation);
        if (!preferences.ok) return { requestId, ...preferences };
        if (!preferences.result.autoSaveSessions) return { requestId, ...failure('FORBIDDEN') };
        return { requestId, ...await actions.sessionCatalog.remember(parsed.result.payload, actions.cancellation) };
      }
      case 'session.favorite': return { requestId, ...await actions.sessionCatalog.setFavorite(parsed.result.payload.id, parsed.result.payload.favorite, actions.cancellation) };
      case 'session.delete': return { requestId, ...await actions.sessionCatalog.remove(parsed.result.payload.id, actions.cancellation) };
      case 'session.folder.list': return { requestId, ...await actions.sessionCatalog.listFolders(actions.cancellation) };
      case 'session.folder.create': return { requestId, ...await actions.sessionCatalog.createFolder(parsed.result.payload, actions.cancellation) };
      case 'session.folder.rename': return { requestId, ...await actions.sessionCatalog.renameFolder(parsed.result.payload.id, parsed.result.payload.name, actions.cancellation) };
      case 'session.folder.move': return { requestId, ...await actions.sessionCatalog.moveFolder(parsed.result.payload.id, parsed.result.payload.parentId, actions.cancellation) };
      case 'session.folder.delete': return { requestId, ...await actions.sessionCatalog.removeFolder(parsed.result.payload.id, actions.cancellation) };
      case 'session.folder.export': return { requestId, ...await actions.sessionCatalog.exportFolder(parsed.result.payload.id, actions.cancellation) };
      case 'session.folder.import': return { requestId, ...await actions.sessionCatalog.importFolder(actions.cancellation) };
      case 'session.move': return { requestId, ...await actions.sessionCatalog.moveSession(parsed.result.payload.id, parsed.result.payload.folderId, actions.cancellation) };
      case 'session.credential.has': return { requestId, ...await actions.sessionCredentials.hasSshCredential(parsed.result.payload.id, actions.cancellation) };
      case 'session.credential.save': return { requestId, ...await actions.sessionCredentials.saveSshCredential(parsed.result.payload.id, actions.cancellation) };
      case 'session.credential.forget': return { requestId, ...await actions.sessionCredentials.forgetSshCredential(parsed.result.payload.id, actions.cancellation) };
      case 'vault.state': return { requestId, ok: true, result: actions.sessionCredentials.state() };
      case 'vault.lock':
        actions.sessionCredentials.lock();
        return { requestId, ok: true, result: EMPTY_RESULT };
      case 'vault.unlock': return { requestId, ...await actions.sessionCredentials.unlock() };
      case 'vault.master.enable': return { requestId, ...await actions.sessionCredentials.enableMasterPassword() };
      case 'vault.master.disable': return { requestId, ...await actions.sessionCredentials.disableMasterPassword() };
      case 'vault.reset': return { requestId, ...await actions.sessionCredentials.resetVault() };
      case 'macro.list': return { requestId, ...await actions.macros.list(actions.cancellation) };
      case 'macro.create': return { requestId, ...await actions.macros.create(parsed.result.payload, actions.cancellation) };
      case 'macro.update': {
        const { id, ...draft } = parsed.result.payload;
        return { requestId, ...await actions.macros.update(id, draft, actions.cancellation) };
      }
      case 'macro.delete': return { requestId, ...await actions.macros.remove(parsed.result.payload.id, actions.cancellation) };
      case 'macro.shortcut.list': return { requestId, ...await actions.macros.listShortcuts(actions.cancellation) };
      case 'macro.shortcut.set': return { requestId, ...await actions.macros.setShortcut(parsed.result.payload.macroId, parsed.result.payload.code, actions.cancellation) };
      case 'macro.shortcut.delete': return { requestId, ...await actions.macros.removeShortcut(parsed.result.payload.macroId, actions.cancellation) };
      case 'preferences.get': return { requestId, ...await actions.preferences.read(actions.cancellation) };
      case 'preferences.save': return { requestId, ...await actions.preferences.save(parsed.result.payload.preferences, actions.cancellation) };
      case 'tunnel.list': return { requestId, ...await actions.tunnels.list() };
      case 'tunnel.save': return { requestId, ...await actions.tunnels.save(parsed.result.payload) };
      case 'tunnel.delete': return { requestId, ...await actions.tunnels.remove(parsed.result.payload.id) };
      case 'tunnel.start': return { requestId, ...await actions.tunnels.start(parsed.result.payload.id, actions.cancellation) };
      case 'tunnel.stop': return { requestId, ...await actions.tunnels.stop(parsed.result.payload.id) };
    }
  } catch {
    audit({ kind: 'application.unavailable', code: 'UNAVAILABLE' });
    return { requestId, ...failure('UNAVAILABLE') };
  }
}
