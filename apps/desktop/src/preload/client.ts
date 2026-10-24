import { CONTRACT_VERSION, isCommandReply, isSshTrustEvent, isTerminalEvent } from '../../../../packages/contracts/src/commands.ts';
import type { CommandReply, CommandRequest, CreateSessionFolderReply, CreateSessionReply, DesktopBridge, DescribeReply, ListSessionFoldersReply, ListSessionsReply,
  ExportSessionFolderReply, ImportSessionFolderReply, OpenSshTerminalReply, OpenTerminalReply, TerminalActionReply } from '../../../../packages/contracts/src/commands.ts';
import type { LocalShell } from '../../../../packages/domain/src/local-terminal.ts';
import type { SavedSessionDraft } from '../../../../packages/domain/src/session-definition.ts';
import type { SavedSessionFolderDraft } from '../../../../packages/domain/src/session-folder.ts';
import { MAX_QUEUED_TERMINAL_INPUT_CHARS, MAX_TERMINAL_INPUT_CHARS } from '../../../../packages/domain/src/local-terminal.ts';
import { failure } from '../../../../packages/domain/src/errors.ts';
import type { LocalTerminalEvent } from '../../../../packages/application/src/local-terminals.ts';
import type { SshTrustEvent } from '../../../../packages/application/src/ssh-terminals.ts';

type Invoke = (request: CommandRequest) => Promise<unknown>;
type Listen = (listener: (value: unknown) => void) => () => void;
type CancelCatalogRequest = (requestId: string) => void | Promise<unknown>;
const MAX_PENDING_REQUESTS = 256;
const SSH_OPEN_TIMEOUT_MS = 275_000;

export function createBridge(invoke: Invoke, makeId: () => string, listen: Listen = () => () => {}, listenSshTrust: Listen = () => () => {},
  cancelCatalogRequest: CancelCatalogRequest = () => {}): DesktopBridge {
  let inFlight = 0;
  const pendingWriteChars = new Map<string, number>();

  function send<T>(request: CommandRequest, timeoutMs: number, onSettled?: () => void): Promise<CommandReply<T>> {
    const requestId = request.requestId;
    if (inFlight >= MAX_PENDING_REQUESTS) return Promise.resolve({ requestId, ...failure('BUSY') });
    inFlight++;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const received = Promise.resolve().then(() => invoke(request))
      .then(reply => isCommandReply(reply, request) ? reply as CommandReply<T> : { requestId, ...failure('UNAVAILABLE') },
        () => ({ requestId, ...failure('UNAVAILABLE') }))
      .finally(() => {
        inFlight--;
        onSettled?.();
      });
    try {
      return Promise.race([received, new Promise<CommandReply<T>>(resolve => {
        timer = setTimeout(() => {
          if (request.command.startsWith('session.')) {
            const reportTimeout = () => resolve({ requestId, ...failure('TIMEOUT') });
            try { void Promise.resolve(cancelCatalogRequest(requestId)).then(reportTimeout, reportTimeout); }
            catch { reportTimeout(); }
          } else {
            resolve({ requestId, ...failure('TIMEOUT') });
          }
        }, timeoutMs);
      })]);
    } finally {
      // The underlying invocation owns its slot until it settles, even after this bounded wait times out.
      void received.finally(() => clearTimeout(timer));
    }
  }

  function requestId(): string { return makeId(); }
  function voidRequest(command: 'terminal.write' | 'terminal.resize' | 'terminal.ack' | 'terminal.close' | 'ssh.write' | 'ssh.resize' | 'ssh.ack' | 'ssh.close' |
    'ssh.host.approve' | 'ssh.host.reject' | 'ssh.host.revoke' | 'session.favorite' | 'session.delete' | 'session.folder.rename' | 'session.folder.move' |
    'session.folder.delete' | 'session.move', payload: Record<string, unknown>): CommandRequest {
    return { command, requestId: requestId(), contractVersion: CONTRACT_VERSION, payload } as CommandRequest;
  }

  return Object.freeze({
    describe(): Promise<DescribeReply> {
      return send({ command: 'app.describe', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: {} }, 3_000);
    },
    openTerminal(sessionId: string, shell: LocalShell, columns: number, rows: number): Promise<OpenTerminalReply> {
      return send({ command: 'terminal.open', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: { sessionId, shell, columns, rows } }, 20_000);
    },
    writeTerminal(sessionId: string, data: string): Promise<TerminalActionReply> {
      const pending = pendingWriteChars.get(sessionId) ?? 0;
      if (typeof data !== 'string' || data.length > MAX_TERMINAL_INPUT_CHARS) return Promise.resolve({ requestId: requestId(), ...failure('INVALID_REQUEST') });
      if (inFlight >= MAX_PENDING_REQUESTS) return Promise.resolve({ requestId: requestId(), ...failure('BUSY') });
      if (pending + data.length > MAX_QUEUED_TERMINAL_INPUT_CHARS) return Promise.resolve({ requestId: requestId(), ...failure('BUSY', 'terminal') });
      pendingWriteChars.set(sessionId, pending + data.length);
      const settle = () => {
        const remaining = (pendingWriteChars.get(sessionId) ?? data.length) - data.length;
        if (remaining > 0) pendingWriteChars.set(sessionId, remaining);
        else pendingWriteChars.delete(sessionId);
      };
      return send(voidRequest('terminal.write', { sessionId, data }), 5_000, settle);
    },
    resizeTerminal(sessionId: string, columns: number, rows: number): Promise<TerminalActionReply> {
      return send(voidRequest('terminal.resize', { sessionId, columns, rows }), 5_000);
    },
    acknowledgeTerminalOutput(sessionId: string, sequence: number): Promise<TerminalActionReply> {
      return send(voidRequest('terminal.ack', { sessionId, sequence }), 5_000);
    },
    closeTerminal(sessionId: string): Promise<TerminalActionReply> {
      pendingWriteChars.delete(sessionId);
      return send(voidRequest('terminal.close', { sessionId }), 8_000);
    },
    openSshTerminal(sessionId: string, host: string, port: number, columns: number, rows: number): Promise<OpenSshTerminalReply> {
      return send({ command: 'ssh.open', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: { sessionId, host, port, columns, rows } }, SSH_OPEN_TIMEOUT_MS);
    },
    writeSshTerminal(sessionId: string, data: string): Promise<TerminalActionReply> {
      const pending = pendingWriteChars.get(sessionId) ?? 0;
      if (typeof data !== 'string' || data.length > MAX_TERMINAL_INPUT_CHARS) return Promise.resolve({ requestId: requestId(), ...failure('INVALID_REQUEST') });
      if (inFlight >= MAX_PENDING_REQUESTS) return Promise.resolve({ requestId: requestId(), ...failure('BUSY') });
      if (pending + data.length > MAX_QUEUED_TERMINAL_INPUT_CHARS) return Promise.resolve({ requestId: requestId(), ...failure('BUSY', 'terminal') });
      pendingWriteChars.set(sessionId, pending + data.length);
      const settle = () => {
        const remaining = (pendingWriteChars.get(sessionId) ?? data.length) - data.length;
        if (remaining > 0) pendingWriteChars.set(sessionId, remaining);
        else pendingWriteChars.delete(sessionId);
      };
      return send(voidRequest('ssh.write', { sessionId, data }), 5_000, settle);
    },
    resizeSshTerminal(sessionId: string, columns: number, rows: number): Promise<TerminalActionReply> {
      return send(voidRequest('ssh.resize', { sessionId, columns, rows }), 5_000);
    },
    acknowledgeSshTerminalOutput(sessionId: string, sequence: number): Promise<TerminalActionReply> {
      return send(voidRequest('ssh.ack', { sessionId, sequence }), 5_000);
    },
    closeSshTerminal(sessionId: string): Promise<TerminalActionReply> {
      pendingWriteChars.delete(sessionId);
      return send(voidRequest('ssh.close', { sessionId }), 8_000);
    },
    approveSshHost(token: string): Promise<TerminalActionReply> {
      return send(voidRequest('ssh.host.approve', { token }), 20_000);
    },
    rejectSshHost(token: string): Promise<TerminalActionReply> {
      return send(voidRequest('ssh.host.reject', { token }), 5_000);
    },
    revokeSshHost(host: string, port: number): Promise<TerminalActionReply> {
      return send(voidRequest('ssh.host.revoke', { host, port }), 8_000);
    },
    listSavedSessions(query: string): Promise<ListSessionsReply> {
      return send({ command: 'session.list', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: { query } }, 8_000);
    },
    createSavedSession(draft: SavedSessionDraft): Promise<CreateSessionReply> {
      return send({ command: 'session.create', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: draft }, 8_000);
    },
    setSavedSessionFavorite(id: string, favorite: boolean): Promise<TerminalActionReply> {
      return send(voidRequest('session.favorite', { id, favorite }), 8_000);
    },
    deleteSavedSession(id: string): Promise<TerminalActionReply> {
      return send(voidRequest('session.delete', { id }), 8_000);
    },
    listSavedSessionFolders(): Promise<ListSessionFoldersReply> {
      return send({ command: 'session.folder.list', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: {} }, 8_000);
    },
    createSavedSessionFolder(draft: SavedSessionFolderDraft): Promise<CreateSessionFolderReply> {
      return send({ command: 'session.folder.create', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: draft }, 8_000);
    },
    renameSavedSessionFolder(id: string, name: string): Promise<TerminalActionReply> {
      return send(voidRequest('session.folder.rename', { id, name }), 8_000);
    },
    moveSavedSessionFolder(id: string, parentId: string | null): Promise<TerminalActionReply> {
      return send(voidRequest('session.folder.move', { id, parentId }), 8_000);
    },
    deleteSavedSessionFolder(id: string): Promise<TerminalActionReply> {
      return send(voidRequest('session.folder.delete', { id }), 8_000);
    },
    exportSavedSessionFolder(id: string): Promise<ExportSessionFolderReply> {
      return send({ command: 'session.folder.export', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: { id } }, 75_000);
    },
    importSavedSessionFolder(): Promise<ImportSessionFolderReply> {
      return send({ command: 'session.folder.import', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: {} }, 75_000);
    },
    moveSavedSession(id: string, folderId: string | null): Promise<TerminalActionReply> {
      return send(voidRequest('session.move', { id, folderId }), 8_000);
    },
    onTerminalEvent(listener: (event: LocalTerminalEvent) => void): () => void {
      if (typeof listener !== 'function') return () => {};
      try {
        return listen(value => {
          if (isTerminalEvent(value)) {
            try { listener(value); } catch { /* Presentation errors do not affect IPC ownership. */ }
          }
        });
      } catch { return () => {}; }
    },
    onSshTrustEvent(listener: (event: SshTrustEvent) => void): () => void {
      if (typeof listener !== 'function') return () => {};
      try {
        return listenSshTrust(value => {
          if (isSshTrustEvent(value)) {
            try { listener(value); } catch { /* A trust decision listener cannot interrupt transport ownership. */ }
          }
        });
      } catch { return () => {}; }
    }
  });
}
