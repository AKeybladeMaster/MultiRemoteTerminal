import { isAppDocument, parseRequest, requestIdOf } from '../../../../packages/contracts/src/commands.ts';
import type { CommandReply } from '../../../../packages/contracts/src/commands.ts';
import type { LocalTerminalController } from '../../../../packages/application/src/local-terminals.ts';
import type { SshTerminalController } from '../../../../packages/application/src/ssh-terminals.ts';
import type { SessionCatalog } from '../../../../packages/application/src/session-catalog.ts';
import type { WorkbenchSnapshot } from '../../../../packages/application/src/workbench.ts';
import type { CancellationSignal } from '../../../../packages/application/src/cancellation.ts';
import { failure } from '../../../../packages/domain/src/errors.ts';

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
  readonly cancellation?: CancellationSignal;
  readonly terminals: Pick<LocalTerminalController, 'open' | 'write' | 'resize' | 'acknowledgeOutput' | 'close'>;
  readonly sshTerminals: Pick<SshTerminalController, 'open' | 'write' | 'resize' | 'acknowledgeOutput' | 'close' | 'approveHostKey' | 'rejectHostKey' | 'revokeHostKey'>;
  readonly sessionCatalog: Pick<SessionCatalog, 'list' | 'create' | 'setFavorite' | 'remove' | 'listFolders' | 'createFolder' | 'renameFolder' | 'moveFolder' | 'removeFolder' | 'moveSession' | 'exportFolder' | 'importFolder'>;
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
    if (parsed.result.command === 'terminal.open' || parsed.result.command === 'terminal.write' ||
        parsed.result.command === 'terminal.close' || parsed.result.command === 'ssh.open' || parsed.result.command === 'ssh.write' || parsed.result.command === 'ssh.close') actions.noteUserActivity();
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
