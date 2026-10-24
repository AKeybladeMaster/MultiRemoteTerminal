import { CONTRACT_VERSION, isCommandReply, isSshTrustEvent, isTerminalEvent } from '../../../../packages/contracts/src/commands.ts';
import type { CommandReply, CommandRequest, CreateSessionFolderReply, CreateSessionReply, DesktopBridge, DescribeReply, ListSessionFoldersReply, ListSessionsReply,
  ExportSessionFolderReply, ImportSessionFolderReply, ListSshDirectoryReply, OpenSshTerminalReply, OpenTerminalReply, TerminalActionReply } from '../../../../packages/contracts/src/commands.ts';
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
type ConsumePasteGesture = (sessionId: string) => boolean | Promise<boolean>;
const MAX_PENDING_REQUESTS = 256;
const SSH_OPEN_TIMEOUT_MS = 275_000;
interface TerminalInputBarrier {
  tail: Promise<void>;
  readonly pendingWrites: Set<Promise<void>>;
  pendingPaste: boolean;
  closing: boolean;
  closePromise?: Promise<TerminalActionReply>;
}

export function createBridge(invoke: Invoke, makeId: () => string, listen: Listen = () => () => {}, listenSshTrust: Listen = () => () => {},
  cancelCatalogRequest: CancelCatalogRequest = () => {}, consumePasteGesture: ConsumePasteGesture = () => false): DesktopBridge {
  let inFlight = 0;
  let queuedInputOperations = 0;
  const terminalInputBarriers = new Map<string, TerminalInputBarrier>();
  const activeTerminalWrites = new Map<string, Set<Promise<void>>>();
  const pendingInputChars = new Map<string, number>();

  function send<T>(request: CommandRequest, timeoutMs?: number, onSettled?: () => void): Promise<CommandReply<T>> {
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
    if (timeoutMs === undefined) return received;
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
  function reserveInputChars(sessionId: string, chars: number): boolean {
    const pending = pendingInputChars.get(sessionId) ?? 0;
    if (pending + chars > MAX_QUEUED_TERMINAL_INPUT_CHARS) return false;
    pendingInputChars.set(sessionId, pending + chars);
    return true;
  }

  function releaseInputChars(sessionId: string, chars: number): void {
    const remaining = (pendingInputChars.get(sessionId) ?? chars) - chars;
    if (remaining > 0) pendingInputChars.set(sessionId, remaining);
    else pendingInputChars.delete(sessionId);
  }

  function reserveRelease(sessionId: string, chars: number): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      releaseInputChars(sessionId, chars);
    };
  }

  function createSettlementSignal(): { readonly promise: Promise<void>; settle(): void } {
    let resolve!: () => void;
    let settled = false;
    const promise = new Promise<void>(complete => { resolve = complete; });
    return { promise, settle() { if (settled) return; settled = true; resolve(); } };
  }

  function sendReservedInput(request: CommandRequest, release: () => void, timeoutMs?: number, onInvocationSettled: () => void = () => {}): Promise<TerminalActionReply> {
    // A reply timeout only bounds the renderer wait; ordering remains held until invoke itself settles.
    const inFlightBeforeSend = inFlight;
    const settle = () => { release(); onInvocationSettled(); };
    const sent = send<Record<string, never>>(request, timeoutMs, settle);
    if (inFlight === inFlightBeforeSend) settle();
    return sent;
  }

  function trackTerminalWrite(sessionId: string, invocationSettled: Promise<void>): void {
    let active = activeTerminalWrites.get(sessionId);
    if (!active) {
      active = new Set();
      activeTerminalWrites.set(sessionId, active);
    }
    const tracked = invocationSettled.then(() => {
      active?.delete(tracked);
      if (active?.size === 0 && activeTerminalWrites.get(sessionId) === active) activeTerminalWrites.delete(sessionId);
    });
    active.add(tracked);
  }

  function waitForActiveWrites(sessionId: string): Promise<void> {
    const active = activeTerminalWrites.get(sessionId);
    return active ? Promise.all([...active].map(write => write.then(() => undefined, () => undefined))).then(() => undefined) : Promise.resolve();
  }

  function finishBarrierOperation(sessionId: string, barrier: TerminalInputBarrier): void {
    queuedInputOperations--;
    if (!barrier.pendingPaste && barrier.pendingWrites.size === 0 && !barrier.closing && terminalInputBarriers.get(sessionId) === barrier) {
      terminalInputBarriers.delete(sessionId);
    }
  }

  function createInputBarrier(sessionId: string): TerminalInputBarrier {
    return { tail: waitForActiveWrites(sessionId), pendingWrites: new Set(), pendingPaste: false, closing: false };
  }

  function writeTerminalInput(sessionId: string, data: string, command: 'terminal.write' | 'ssh.write'): Promise<TerminalActionReply> {
    if (typeof data !== 'string' || data.length > MAX_TERMINAL_INPUT_CHARS) return Promise.resolve({ requestId: requestId(), ...failure('INVALID_REQUEST') });
    if (inFlight >= MAX_PENDING_REQUESTS) return Promise.resolve({ requestId: requestId(), ...failure('BUSY') });
    const barrier = terminalInputBarriers.get(sessionId);
    if (barrier?.closing) return Promise.resolve({ requestId: requestId(), ...failure('CANCELLED', 'terminal') });
    if (!reserveInputChars(sessionId, data.length)) return Promise.resolve({ requestId: requestId(), ...failure('BUSY', 'terminal') });
    const request = voidRequest(command, { sessionId, data });
    const release = reserveRelease(sessionId, data.length);
    if (!barrier) {
      const invocation = createSettlementSignal();
      const reply = sendReservedInput(request, release, 5_000, invocation.settle);
      trackTerminalWrite(sessionId, invocation.promise);
      return reply;
    }
    if (queuedInputOperations >= MAX_PENDING_REQUESTS) {
      release();
      return Promise.resolve({ requestId: request.requestId, ...failure('BUSY', 'terminal') });
    }
    queuedInputOperations++;
    const invocation = createSettlementSignal();
    const queued = barrier.tail.then(() => sendReservedInput(request, release, 5_000, invocation.settle))
      .catch(() => {
        release();
        invocation.settle();
        return { requestId: request.requestId, ...failure('UNAVAILABLE', 'terminal') };
      });
    const finished = queued.then(() => invocation.promise).then(() => {
        barrier.pendingWrites.delete(invocation.promise);
        finishBarrierOperation(sessionId, barrier);
      });
    barrier.pendingWrites.add(invocation.promise);
    barrier.tail = finished;
    return queued;
  }

  function pasteTerminalInput(sessionId: string, command: 'terminal.paste' | 'ssh.paste'): Promise<TerminalActionReply> {
    const existing = terminalInputBarriers.get(sessionId);
    if (existing?.closing) return Promise.resolve({ requestId: requestId(), ...failure('CANCELLED', 'terminal') });
    if (existing && (existing.pendingPaste || existing.pendingWrites.size > 0)) {
      return Promise.resolve({ requestId: requestId(), ...failure('BUSY', 'terminal') });
    }
    if (inFlight >= MAX_PENDING_REQUESTS) return Promise.resolve({ requestId: requestId(), ...failure('BUSY') });
    if (queuedInputOperations >= MAX_PENDING_REQUESTS || !reserveInputChars(sessionId, MAX_TERMINAL_INPUT_CHARS)) {
      return Promise.resolve({ requestId: requestId(), ...failure('BUSY', 'terminal') });
    }
    const barrier = existing ?? createInputBarrier(sessionId);
    terminalInputBarriers.set(sessionId, barrier);
    barrier.pendingPaste = true;
    queuedInputOperations++;
    const request = voidRequest(command, { sessionId });
    let authorization: Promise<boolean>;
    try { authorization = Promise.resolve(consumePasteGesture(sessionId)).then(value => value === true, () => false); }
    catch { authorization = Promise.resolve(false); }
    const release = reserveRelease(sessionId, MAX_TERMINAL_INPUT_CHARS);
    const paste = barrier.tail.then(async () => {
      if (!await authorization) return { requestId: request.requestId, ...failure('FORBIDDEN') };
      return sendReservedInput(request, release);
    }).catch(() => {
      release();
      return { requestId: request.requestId, ...failure('UNAVAILABLE', 'terminal') };
    }).then(reply => {
      release();
      barrier.pendingPaste = false;
      finishBarrierOperation(sessionId, barrier);
      return reply;
    });
    barrier.tail = paste.then(() => undefined);
    return paste;
  }

  function closeTerminalInputQueue(sessionId: string, operation: () => Promise<TerminalActionReply>): Promise<TerminalActionReply> {
    let barrier = terminalInputBarriers.get(sessionId);
    if (!barrier && !activeTerminalWrites.has(sessionId)) return operation();
    if (!barrier) {
      barrier = createInputBarrier(sessionId);
      terminalInputBarriers.set(sessionId, barrier);
    }
    if (barrier.closePromise) return barrier.closePromise;
    barrier.closing = true;
    const closing = Promise.all([barrier.tail, ...barrier.pendingWrites]).then(operation)
      .catch(() => ({ requestId: requestId(), ...failure('UNAVAILABLE', 'terminal') }));
    barrier.closePromise = closing;
    barrier.tail = closing.then(() => {
      if (terminalInputBarriers.get(sessionId) === barrier) terminalInputBarriers.delete(sessionId);
    });
    return closing;
  }

  function voidRequest(command: 'terminal.write' | 'terminal.paste' | 'terminal.resize' | 'terminal.ack' | 'terminal.close' |
    'ssh.write' | 'ssh.paste' | 'ssh.resize' | 'ssh.ack' | 'ssh.close' |
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
      return writeTerminalInput(sessionId, data, 'terminal.write');
    },
    pasteTerminal(sessionId: string): Promise<TerminalActionReply> {
      return pasteTerminalInput(sessionId, 'terminal.paste');
    },
    resizeTerminal(sessionId: string, columns: number, rows: number): Promise<TerminalActionReply> {
      return send(voidRequest('terminal.resize', { sessionId, columns, rows }), 5_000);
    },
    acknowledgeTerminalOutput(sessionId: string, sequence: number): Promise<TerminalActionReply> {
      return send(voidRequest('terminal.ack', { sessionId, sequence }), 5_000);
    },
    closeTerminal(sessionId: string): Promise<TerminalActionReply> {
      const request = voidRequest('terminal.close', { sessionId });
      return closeTerminalInputQueue(sessionId, () => send(request, 8_000));
    },
    openSshTerminal(sessionId: string, host: string, port: number, columns: number, rows: number): Promise<OpenSshTerminalReply> {
      return send({ command: 'ssh.open', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: { sessionId, host, port, columns, rows } }, SSH_OPEN_TIMEOUT_MS);
    },
    writeSshTerminal(sessionId: string, data: string): Promise<TerminalActionReply> {
      return writeTerminalInput(sessionId, data, 'ssh.write');
    },
    pasteSshTerminal(sessionId: string): Promise<TerminalActionReply> {
      return pasteTerminalInput(sessionId, 'ssh.paste');
    },
    resizeSshTerminal(sessionId: string, columns: number, rows: number): Promise<TerminalActionReply> {
      return send(voidRequest('ssh.resize', { sessionId, columns, rows }), 5_000);
    },
    acknowledgeSshTerminalOutput(sessionId: string, sequence: number): Promise<TerminalActionReply> {
      return send(voidRequest('ssh.ack', { sessionId, sequence }), 5_000);
    },
    closeSshTerminal(sessionId: string): Promise<TerminalActionReply> {
      const request = voidRequest('ssh.close', { sessionId });
      return closeTerminalInputQueue(sessionId, () => send(request, 8_000));
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
    listSshDirectory(sessionId: string, path: string): Promise<ListSshDirectoryReply> {
      return send({ command: 'ssh.files.list', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: { sessionId, path } }, 25_000);
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
      return send({ command: 'session.folder.export', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: { id } });
    },
    importSavedSessionFolder(): Promise<ImportSessionFolderReply> {
      return send({ command: 'session.folder.import', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: {} });
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
