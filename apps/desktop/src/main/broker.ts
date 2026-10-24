import { isAppDocument, parseRequest, requestIdOf } from '../../../../packages/contracts/src/commands.ts';
import type { CommandReply } from '../../../../packages/contracts/src/commands.ts';
import type { LocalTerminalController } from '../../../../packages/application/src/local-terminals.ts';
import type { SshTerminalController } from '../../../../packages/application/src/ssh-terminals.ts';
import type { TelnetTerminalController } from '../../../../packages/application/src/telnet-terminals.ts';
import type { FtpFilesController } from '../../../../packages/application/src/ftp-files.ts';
import type { SessionCatalog } from '../../../../packages/application/src/session-catalog.ts';
import type { WorkbenchSnapshot } from '../../../../packages/application/src/workbench.ts';
import type { CancellationSignal } from '../../../../packages/application/src/cancellation.ts';
import { failure } from '../../../../packages/domain/src/errors.ts';
import type { Outcome } from '../../../../packages/domain/src/errors.ts';
import { MAX_TERMINAL_INPUT_CHARS } from '../../../../packages/domain/src/local-terminal.ts';

export interface CommandSender {
  readonly owned: boolean;
  readonly mainFrame: boolean;
  readonly url: string;
}

export interface AuditEvent {
  readonly kind: 'ipc.rejected' | 'application.unavailable';
  readonly code: string;
}

export interface CommandActions {
  readonly describe: () => WorkbenchSnapshot;
  readonly noteUserActivity: () => void;
  readonly readClipboardText: () => Promise<string>;
  readonly authorizeClipboardPaste: (sessionId: string) => boolean;
  readonly authorizeTelnetConsent: (sessionId: string) => boolean;
  readonly authorizeFtpConsent: (sessionId: string) => boolean;
  readonly confirmMultilinePaste: () => Promise<boolean>;
  readonly cancellation?: CancellationSignal;
  readonly terminals: Pick<LocalTerminalController, 'open' | 'write' | 'resize' | 'acknowledgeOutput' | 'close'>;
  readonly sshTerminals: Pick<SshTerminalController, 'open' | 'write' | 'resize' | 'acknowledgeOutput' | 'listRemoteDirectory' | 'close' | 'approveHostKey' | 'rejectHostKey' | 'revokeHostKey'>;
  readonly telnetTerminals: Pick<TelnetTerminalController, 'open' | 'write' | 'resize' | 'acknowledgeOutput' | 'close'>;
  readonly ftpFiles: Pick<FtpFilesController, 'open' | 'listDirectory' | 'close'>;
  readonly sessionCatalog: Pick<SessionCatalog, 'list' | 'create' | 'setFavorite' | 'remove' | 'listFolders' | 'createFolder' | 'renameFolder' | 'moveFolder' | 'removeFolder' | 'moveSession' | 'exportFolder' | 'importFolder'>;
}

async function pasteFromClipboard(
  requestId: string,
  sessionId: string,
  actions: Pick<CommandActions, 'readClipboardText' | 'confirmMultilinePaste' | 'cancellation'>,
  write: (sessionId: string, data: string) => Promise<Outcome<Record<string, never>>>,
): Promise<CommandReply<Record<string, never>>> {
  if (actions.cancellation?.aborted) return { requestId, ...failure('CANCELLED', 'terminal') };
  const data = await actions.readClipboardText();
  if (actions.cancellation?.aborted) return { requestId, ...failure('CANCELLED', 'terminal') };
  if (data.length > MAX_TERMINAL_INPUT_CHARS) return { requestId, ...failure('OUTPUT_LIMIT', 'terminal') };
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
        parsed.result.command === 'telnet.open' || parsed.result.command === 'telnet.write' || parsed.result.command === 'telnet.close' ||
        parsed.result.command === 'ftp.open' || parsed.result.command === 'ftp.files.list' || parsed.result.command === 'ftp.close') actions.noteUserActivity();
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
        const { sessionId, host, port, columns, rows } = parsed.result.payload;
        return { requestId, ...await actions.sshTerminals.open(sessionId, host, port, { columns, rows }) };
      }
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
      case 'ftp.open': {
        const { sessionId, host, port, secure } = parsed.result.payload;
        if (!secure && !actions.authorizeFtpConsent(sessionId)) return { requestId, ...failure('FORBIDDEN') };
        return { requestId, ...await actions.ftpFiles.open(sessionId, host, port, secure, actions.cancellation) };
      }
      case 'ftp.files.list': {
        const { sessionId, path } = parsed.result.payload;
        return { requestId, ...await actions.ftpFiles.listDirectory(sessionId, path, actions.cancellation) };
      }
      case 'ftp.close': return { requestId, ...await actions.ftpFiles.close(parsed.result.payload.sessionId) };
      case 'session.list': return { requestId, ...await actions.sessionCatalog.list(parsed.result.payload.query, actions.cancellation) };
      case 'session.create': return { requestId, ...await actions.sessionCatalog.create(parsed.result.payload, actions.cancellation) };
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
    }
  } catch {
    audit({ kind: 'application.unavailable', code: 'UNAVAILABLE' });
    return { requestId, ...failure('UNAVAILABLE') };
  }
}
