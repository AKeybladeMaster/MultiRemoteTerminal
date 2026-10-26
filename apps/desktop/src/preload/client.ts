import { CONTRACT_VERSION, isCommandReply, isFtpTransferEvent, isSshTransferEvent, isSshTrustEvent, isTerminalEvent, isTunnelStatusEvent } from '../../../../packages/contracts/src/commands.ts';
import type { CommandReply, CommandRequest, CountSessionsReply, CreateSessionFolderReply, CreateSessionReply, DesktopBridge, DescribeReply, ListSessionFoldersReply, ListSessionsReply,
  ExportSessionFolderReply, ImportSessionFolderReply, ListSshDirectoryReply, ListSshTunnelsReply, SaveSshTunnelReply, TunnelStatusReply,
  OpenSshTerminalReply, OpenTelnetTerminalReply, OpenTerminalReply, OpenSerialTerminalReply, ListSerialPortsReply, TerminalActionReply } from '../../../../packages/contracts/src/commands.ts';
import type { LaunchRdpViewerReply } from '../../../../packages/contracts/src/commands.ts';
import type { LaunchVncViewerReply } from '../../../../packages/contracts/src/commands.ts';
import type { FtpTransferReply, ListFtpDirectoryReply, OpenFtpFilesReply, SshTransferReply } from '../../../../packages/contracts/src/commands.ts';
import type { SshTextFileReply, SshTextFileSaveReply } from '../../../../packages/contracts/src/commands.ts';
import type { ListMacrosReply, MacroDefinitionReply, ListMacroShortcutsReply, MacroShortcutReply } from '../../../../packages/contracts/src/commands.ts';
import type { WorkbenchPreferencesReply } from '../../../../packages/contracts/src/commands.ts';
import type { CredentialVaultStateReply, SessionCredentialPresenceReply } from '../../../../packages/contracts/src/commands.ts';
import type { OpenSftpFilesReply } from '../../../../packages/contracts/src/commands.ts';
import type { OpenSerialTerminalResult } from '../../../../packages/contracts/src/commands.ts';
import type { LocalTextFileReply, LocalTextFileSaveReply } from '../../../../packages/contracts/src/commands.ts';
import type { LocalShell } from '../../../../packages/domain/src/local-terminal.ts';
import type { SavedSessionDraft } from '../../../../packages/domain/src/session-definition.ts';
import type { SavedSessionFolderDraft } from '../../../../packages/domain/src/session-folder.ts';
import type { MacroDraft } from '../../../../packages/domain/src/macro.ts';
import type { MacroShortcutCode } from '../../../../packages/domain/src/macro-shortcut.ts';
import type { WorkbenchPreferences } from '../../../../packages/domain/src/workbench-preferences.ts';
import type { SerialConfiguration } from '../../../../packages/domain/src/serial.ts';
import { MAX_SERIAL_INPUT_CHARS, SERIAL_WRITE_TIMEOUT_MAX_MS, serialWriteTimeoutMs } from '../../../../packages/domain/src/serial.ts';
import { MAX_QUEUED_TERMINAL_INPUT_CHARS, MAX_TERMINAL_INPUT_CHARS } from '../../../../packages/domain/src/local-terminal.ts';
import { failure } from '../../../../packages/domain/src/errors.ts';
import type { LocalTerminalEvent } from '../../../../packages/application/src/local-terminals.ts';
import type { SshTrustEvent } from '../../../../packages/application/src/ssh-terminals.ts';
import type { FtpTransferProgress } from '../../../../packages/domain/src/ftp.ts';
import type { FileTransferProgress } from '../../../../packages/domain/src/file-transfer.ts';
import type { SshTunnelDraft, TunnelRunStatus } from '../../../../packages/domain/src/ssh-tunnel.ts';
import { MAX_SSH_GATEWAY_HOPS } from '../../../../packages/domain/src/ssh-route.ts';

type Invoke = (request: CommandRequest) => Promise<unknown>;
type Listen = (listener: (value: unknown) => void) => () => void;
type CancelCatalogRequest = (requestId: string) => void | Promise<unknown>;
type ConsumePasteGesture = (sessionId: string) => boolean | Promise<boolean>;
type ConsumeTelnetConsent = (sessionId: string, host: string, port: number) => boolean | Promise<boolean>;
type ConsumeFtpConsent = (sessionId: string, host: string, port: number, secure: boolean) => boolean | Promise<boolean>;
type ConsumeRdpLaunch = (host: string, port: number) => boolean | Promise<boolean>;
type ConsumeVncLaunch = (host: string, port: number) => boolean | Promise<boolean>;
type ListenFtpTransfer = Listen;
type ListenSshTransfer = Listen;
type ListenTunnelStatus = Listen;
const MAX_PENDING_REQUESTS = 256;
const SSH_OPEN_TIMEOUT_MS = 275_000;
const SSH_CREDENTIAL_PROMPT_TIMEOUT_MS = 120_000;
const SESSION_CREDENTIAL_TIMEOUT_MS = 130_000;
const SSH_WORKER_OPEN_TIMEOUT_MS = 140_000;
// Covers two bounded catalog reads, worker startup, and IPC scheduling after three sequential prompts.
const SSH_ROUTE_OPEN_MARGIN_MS = 40_000;
const SSH_DIRECTORY_TIMEOUT_MS = 35_000;
const SSH_TEXT_FILE_TIMEOUT_MS = 60_000;
const LOCAL_TEXT_FILE_TIMEOUT_MS = 20_000;
const TELNET_OPEN_TIMEOUT_MS = 20_000;
const SERIAL_OPEN_TIMEOUT_MS = 20_000;
const SERIAL_LIST_TIMEOUT_MS = 10_000;
const FTP_OPEN_TIMEOUT_MS = 180_000;
const FTP_LIST_TIMEOUT_MS = 25_000;
const FTP_CANCEL_TIMEOUT_MS = 45_000;
const SSH_TRANSFER_TIMEOUT_MS = 60 * 60_000 + 5_000;
const SSH_CANCEL_TIMEOUT_MS = 45_000;
interface TerminalInputBarrier {
  tail: Promise<void>;
  readonly pendingWrites: Set<Promise<void>>;
  pendingPaste: boolean;
  closing: boolean;
  closePromise?: Promise<TerminalActionReply>;
}

export function createBridge(invoke: Invoke, makeId: () => string, listen: Listen = () => () => {}, listenSshTrust: Listen = () => () => {},
  cancelCatalogRequest: CancelCatalogRequest = () => {}, consumePasteGesture: ConsumePasteGesture = () => false,
  consumeTelnetConsent: ConsumeTelnetConsent = () => false, consumeFtpConsent: ConsumeFtpConsent = () => false,
  listenFtpTransfer: ListenFtpTransfer = () => () => {}, listenSshTransfer: ListenSshTransfer = () => () => {},
  listenTunnelStatus: ListenTunnelStatus = () => () => {}, consumeRdpLaunch: ConsumeRdpLaunch = () => false,
  consumeVncLaunch: ConsumeVncLaunch = () => false): DesktopBridge {
  let inFlight = 0;
  let queuedInputOperations = 0;
  const terminalInputBarriers = new Map<string, TerminalInputBarrier>();
  const activeTerminalWrites = new Map<string, Set<Promise<void>>>();
  const pendingInputChars = new Map<string, number>();
  const serialConfigurations = new Map<string, SerialConfiguration>();

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
          if (request.command.startsWith('session.') || request.command.startsWith('macro.') || request.command.startsWith('preferences.') ||
              request.command.startsWith('ssh.files.') || request.command.startsWith('ftp.')) {
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
  function sshOpenTimeout(gatewayCount = 0): number {
    if (gatewayCount === 0) return SSH_OPEN_TIMEOUT_MS;
    const prompts = Math.min(gatewayCount, MAX_SSH_GATEWAY_HOPS) + 1;
    return prompts * SSH_CREDENTIAL_PROMPT_TIMEOUT_MS + SSH_WORKER_OPEN_TIMEOUT_MS + SSH_ROUTE_OPEN_MARGIN_MS;
  }

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

  function writeTerminalInput(sessionId: string, data: string, command: 'terminal.write' | 'ssh.write' | 'telnet.write' | 'serial.write',
    timeoutMs = 5_000, maxChars = MAX_TERMINAL_INPUT_CHARS): Promise<TerminalActionReply> {
    if (typeof data !== 'string' || data.length > maxChars || data.length > MAX_TERMINAL_INPUT_CHARS) return Promise.resolve({ requestId: requestId(), ...failure('INVALID_REQUEST') });
    if (inFlight >= MAX_PENDING_REQUESTS) return Promise.resolve({ requestId: requestId(), ...failure('BUSY') });
    const barrier = terminalInputBarriers.get(sessionId);
    if (barrier?.closing) return Promise.resolve({ requestId: requestId(), ...failure('CANCELLED', 'terminal') });
    if (!reserveInputChars(sessionId, data.length)) return Promise.resolve({ requestId: requestId(), ...failure('BUSY', 'terminal') });
    const request = voidRequest(command, { sessionId, data });
    const release = reserveRelease(sessionId, data.length);
    if (!barrier) {
      const invocation = createSettlementSignal();
      const reply = sendReservedInput(request, release, timeoutMs, invocation.settle);
      trackTerminalWrite(sessionId, invocation.promise);
      return reply;
    }
    if (queuedInputOperations >= MAX_PENDING_REQUESTS) {
      release();
      return Promise.resolve({ requestId: request.requestId, ...failure('BUSY', 'terminal') });
    }
    queuedInputOperations++;
    const invocation = createSettlementSignal();
    const queued = barrier.tail.then(() => sendReservedInput(request, release, timeoutMs, invocation.settle))
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

  function pasteTerminalInput(sessionId: string, command: 'terminal.paste' | 'ssh.paste' | 'telnet.paste' | 'serial.paste',
    maxChars = MAX_TERMINAL_INPUT_CHARS, timeoutMs?: number): Promise<TerminalActionReply> {
    const existing = terminalInputBarriers.get(sessionId);
    if (existing?.closing) return Promise.resolve({ requestId: requestId(), ...failure('CANCELLED', 'terminal') });
    if (existing && (existing.pendingPaste || existing.pendingWrites.size > 0)) {
      return Promise.resolve({ requestId: requestId(), ...failure('BUSY', 'terminal') });
    }
    if (inFlight >= MAX_PENDING_REQUESTS) return Promise.resolve({ requestId: requestId(), ...failure('BUSY') });
    if (queuedInputOperations >= MAX_PENDING_REQUESTS || !reserveInputChars(sessionId, maxChars)) {
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
    const release = reserveRelease(sessionId, maxChars);
    const paste = barrier.tail.then(async () => {
      if (!await authorization) return { requestId: request.requestId, ...failure('FORBIDDEN') };
      return sendReservedInput(request, release, timeoutMs);
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
    'ssh.write' | 'ssh.paste' | 'ssh.resize' | 'ssh.ack' | 'ssh.close' | 'sftp.close' |
    'telnet.write' | 'telnet.paste' | 'telnet.resize' | 'telnet.ack' | 'telnet.close' |
    'serial.write' | 'serial.paste' | 'serial.resize' | 'serial.ack' | 'serial.close' |
    'ssh.host.approve' | 'ssh.host.reject' | 'ssh.host.revoke' | 'session.favorite' | 'session.delete' | 'session.folder.rename' | 'session.folder.move' |
    'session.folder.delete' | 'session.move' | 'ssh.files.cancel' | 'ftp.files.cancel' | 'ftp.close' | 'tunnel.delete' | 'macro.delete' | 'macro.shortcut.delete',
    payload: Record<string, unknown>): CommandRequest {
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
    openSshTerminal(sessionId: string, host: string, port: number, columns: number, rows: number,
      gatewayProfileIds?: readonly string[], savedProfileId?: string): Promise<OpenSshTerminalReply> {
      return send({ command: 'ssh.open', requestId: requestId(), contractVersion: CONTRACT_VERSION,
        payload: { sessionId, host, port, columns, rows, ...(gatewayProfileIds === undefined ? {} : { gatewayProfileIds }),
          ...(savedProfileId === undefined ? {} : { profileId: savedProfileId }) } },
      sshOpenTimeout(gatewayProfileIds?.length ?? 0));
    },
    openSftpFiles(sessionId: string, host: string, port: number): Promise<OpenSftpFilesReply> {
      return send({ command: 'sftp.open', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: { sessionId, host, port } }, SSH_OPEN_TIMEOUT_MS);
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
    closeSftpFiles(sessionId: string): Promise<TerminalActionReply> {
      return send(voidRequest('sftp.close', { sessionId }), 8_000);
    },
    openTelnetTerminal(sessionId: string, host: string, port: number, columns: number, rows: number): Promise<OpenTelnetTerminalReply> {
      const id = requestId();
      return Promise.resolve().then(() => consumeTelnetConsent(sessionId, host, port)).then(authorized => {
        if (!authorized) return { requestId: id, ...failure('FORBIDDEN') };
        return send({ command: 'telnet.open', requestId: id, contractVersion: CONTRACT_VERSION,
          payload: { sessionId, host, port, columns, rows } }, TELNET_OPEN_TIMEOUT_MS);
      }, () => ({ requestId: id, ...failure('FORBIDDEN') }));
    },
    writeTelnetTerminal(sessionId: string, data: string): Promise<TerminalActionReply> {
      return writeTerminalInput(sessionId, data, 'telnet.write');
    },
    pasteTelnetTerminal(sessionId: string): Promise<TerminalActionReply> {
      return pasteTerminalInput(sessionId, 'telnet.paste');
    },
    resizeTelnetTerminal(sessionId: string, columns: number, rows: number): Promise<TerminalActionReply> {
      return send(voidRequest('telnet.resize', { sessionId, columns, rows }), 5_000);
    },
    acknowledgeTelnetTerminalOutput(sessionId: string, sequence: number): Promise<TerminalActionReply> {
      return send(voidRequest('telnet.ack', { sessionId, sequence }), 5_000);
    },
    closeTelnetTerminal(sessionId: string): Promise<TerminalActionReply> {
      const request = voidRequest('telnet.close', { sessionId });
      return closeTerminalInputQueue(sessionId, () => send(request, 8_000));
    },
    listSerialPorts(): Promise<ListSerialPortsReply> {
      return send({ command: 'serial.ports.list', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: {} }, SERIAL_LIST_TIMEOUT_MS);
    },
    openSerialTerminal(sessionId: string, configuration: SerialConfiguration, columns: number, rows: number): Promise<OpenSerialTerminalReply> {
      const request: Extract<CommandRequest, { command: 'serial.open' }> = {
        command: 'serial.open', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: { sessionId, configuration, columns, rows }
      };
      return send<OpenSerialTerminalResult>(request, SERIAL_OPEN_TIMEOUT_MS).then(reply => {
        if (reply.ok) serialConfigurations.set(sessionId, reply.result.configuration);
        return reply;
      });
    },
    writeSerialTerminal(sessionId: string, data: string): Promise<TerminalActionReply> {
      const configuration = serialConfigurations.get(sessionId);
      if (!configuration) return Promise.resolve({ requestId: requestId(), ...failure('NOT_FOUND', 'terminal') });
      if (typeof data !== 'string') return Promise.resolve({ requestId: requestId(), ...failure('INVALID_REQUEST') });
      return writeTerminalInput(sessionId, data, 'serial.write', serialWriteTimeoutMs(configuration, data.length), MAX_SERIAL_INPUT_CHARS);
    },
    pasteSerialTerminal(sessionId: string): Promise<TerminalActionReply> {
      if (!serialConfigurations.has(sessionId)) return Promise.resolve({ requestId: requestId(), ...failure('NOT_FOUND', 'terminal') });
      return pasteTerminalInput(sessionId, 'serial.paste', MAX_SERIAL_INPUT_CHARS, SERIAL_WRITE_TIMEOUT_MAX_MS);
    },
    resizeSerialTerminal(sessionId: string, columns: number, rows: number): Promise<TerminalActionReply> {
      return send(voidRequest('serial.resize', { sessionId, columns, rows }), 5_000);
    },
    acknowledgeSerialTerminalOutput(sessionId: string, sequence: number): Promise<TerminalActionReply> {
      return send(voidRequest('serial.ack', { sessionId, sequence }), 5_000);
    },
    closeSerialTerminal(sessionId: string): Promise<TerminalActionReply> {
      const request = voidRequest('serial.close', { sessionId });
      return closeTerminalInputQueue(sessionId, () => send<Record<string, never>>(request, 8_000).then(reply => {
        serialConfigurations.delete(sessionId);
        return reply;
      }));
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
      return send({ command: 'ssh.files.list', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: { sessionId, path } }, SSH_DIRECTORY_TIMEOUT_MS);
    },
    uploadSshFile(sessionId: string, operationId: string, remoteDirectory: string): Promise<SshTransferReply> {
      return send({ command: 'ssh.files.upload', requestId: requestId(), contractVersion: CONTRACT_VERSION,
        payload: { sessionId, operationId, remoteDirectory } }, SSH_TRANSFER_TIMEOUT_MS);
    },
    downloadSshFile(sessionId: string, operationId: string, remotePath: string): Promise<SshTransferReply> {
      return send({ command: 'ssh.files.download', requestId: requestId(), contractVersion: CONTRACT_VERSION,
        payload: { sessionId, operationId, remotePath } }, SSH_TRANSFER_TIMEOUT_MS);
    },
    readSshTextFile(sessionId: string, operationId: string, remotePath: string): Promise<SshTextFileReply> {
      return send({ command: 'ssh.files.read-text', requestId: requestId(), contractVersion: CONTRACT_VERSION,
        payload: { sessionId, operationId, remotePath } }, SSH_TEXT_FILE_TIMEOUT_MS);
    },
    saveSshTextFile(sessionId: string, operationId: string, remotePath: string, content: string, expectedRevision: string): Promise<SshTextFileSaveReply> {
      return send({ command: 'ssh.files.write-text', requestId: requestId(), contractVersion: CONTRACT_VERSION,
        payload: { sessionId, operationId, remotePath, content, expectedRevision } }, SSH_TEXT_FILE_TIMEOUT_MS);
    },
    cancelSshTransfer(sessionId: string, operationId: string): Promise<TerminalActionReply> {
      return send(voidRequest('ssh.files.cancel', { sessionId, operationId }), SSH_CANCEL_TIMEOUT_MS);
    },
    openLocalTextFile(): Promise<LocalTextFileReply> {
      return send({ command: 'local-text.open', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: {} });
    },
    reloadLocalTextFile(selectionId: string): Promise<LocalTextFileReply> {
      return send({ command: 'local-text.reload', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: { selectionId } }, LOCAL_TEXT_FILE_TIMEOUT_MS);
    },
    saveLocalTextFile(selectionId: string, content: string, expectedRevision: string): Promise<LocalTextFileSaveReply> {
      return send({ command: 'local-text.save', requestId: requestId(), contractVersion: CONTRACT_VERSION,
        payload: { selectionId, content, expectedRevision } }, LOCAL_TEXT_FILE_TIMEOUT_MS);
    },
    closeLocalTextFile(selectionId: string): Promise<TerminalActionReply> {
      return send({ command: 'local-text.close', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: { selectionId } }, LOCAL_TEXT_FILE_TIMEOUT_MS);
    },
    openFtpFiles(sessionId: string, host: string, port: number, secure: boolean): Promise<OpenFtpFilesReply> {
      const id = requestId();
      const request = { command: 'ftp.open', requestId: id, contractVersion: CONTRACT_VERSION,
        payload: { sessionId, host, port, secure } } as const;
      if (secure) return send(request, FTP_OPEN_TIMEOUT_MS);
      return Promise.resolve().then(() => consumeFtpConsent(sessionId, host, port, secure)).then(authorized =>
        authorized ? send(request, FTP_OPEN_TIMEOUT_MS) : { requestId: id, ...failure('FORBIDDEN') },
      () => ({ requestId: id, ...failure('FORBIDDEN') }));
    },
    listFtpDirectory(sessionId: string, path: string): Promise<ListFtpDirectoryReply> {
      return send({ command: 'ftp.files.list', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: { sessionId, path } }, FTP_LIST_TIMEOUT_MS);
    },
    uploadFtpFile(sessionId: string, operationId: string, remoteDirectory: string): Promise<FtpTransferReply> {
      return send({ command: 'ftp.files.upload', requestId: requestId(), contractVersion: CONTRACT_VERSION,
        payload: { sessionId, operationId, remoteDirectory } });
    },
    downloadFtpFile(sessionId: string, operationId: string, remotePath: string): Promise<FtpTransferReply> {
      return send({ command: 'ftp.files.download', requestId: requestId(), contractVersion: CONTRACT_VERSION,
        payload: { sessionId, operationId, remotePath } });
    },
    cancelFtpTransfer(sessionId: string, operationId: string): Promise<TerminalActionReply> {
      return send(voidRequest('ftp.files.cancel', { sessionId, operationId }), FTP_CANCEL_TIMEOUT_MS);
    },
    closeFtpFiles(sessionId: string): Promise<TerminalActionReply> {
      return send(voidRequest('ftp.close', { sessionId }), 8_000);
    },
    launchRdpViewer(host: string, port: number): Promise<LaunchRdpViewerReply> {
      const id = requestId();
      return Promise.resolve().then(() => consumeRdpLaunch(host, port)).then(authorized => authorized
        ? send({ command: 'rdp.launch', requestId: id, contractVersion: CONTRACT_VERSION, payload: { host, port } }, 8_000)
        : { requestId: id, ...failure('FORBIDDEN') }, () => ({ requestId: id, ...failure('FORBIDDEN') }));
    },
    launchVncViewer(host: string, port: number): Promise<LaunchVncViewerReply> {
      const id = requestId();
      return Promise.resolve().then(() => consumeVncLaunch(host, port)).then(authorized => authorized
        ? send({ command: 'vnc.launch', requestId: id, contractVersion: CONTRACT_VERSION, payload: { host, port } }, 8_000)
        : { requestId: id, ...failure('FORBIDDEN') }, () => ({ requestId: id, ...failure('FORBIDDEN') }));
    },
    listSavedSessions(query: string): Promise<ListSessionsReply> {
      return send({ command: 'session.list', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: { query } }, 8_000);
    },
    countSavedSessions(): Promise<CountSessionsReply> {
      return send({ command: 'session.count', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: {} }, 8_000);
    },
    listMacros(): Promise<ListMacrosReply> {
      return send({ command: 'macro.list', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: {} }, 8_000);
    },
    createMacro(draft: MacroDraft): Promise<MacroDefinitionReply> {
      return send({ command: 'macro.create', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: draft }, 8_000);
    },
    updateMacro(id: string, draft: MacroDraft): Promise<MacroDefinitionReply> {
      return send({ command: 'macro.update', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: { id, ...draft } }, 8_000);
    },
    deleteMacro(id: string): Promise<TerminalActionReply> {
      return send(voidRequest('macro.delete', { id }), 8_000);
    },
    listMacroShortcuts(): Promise<ListMacroShortcutsReply> {
      return send({ command: 'macro.shortcut.list', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: {} }, 8_000);
    },
    setMacroShortcut(macroId: string, code: MacroShortcutCode): Promise<MacroShortcutReply> {
      return send({ command: 'macro.shortcut.set', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: { macroId, code } }, 8_000);
    },
    deleteMacroShortcut(macroId: string): Promise<TerminalActionReply> {
      return send(voidRequest('macro.shortcut.delete', { macroId }), 8_000);
    },
    getWorkbenchPreferences(): Promise<WorkbenchPreferencesReply> {
      return send({ command: 'preferences.get', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: {} }, 8_000);
    },
    saveWorkbenchPreferences(preferences: WorkbenchPreferences): Promise<WorkbenchPreferencesReply> {
      return send({ command: 'preferences.save', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: { preferences } }, 8_000);
    },
    createSavedSession(draft: SavedSessionDraft): Promise<CreateSessionReply> {
      return send({ command: 'session.create', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: draft }, 8_000);
    },
    rememberSavedSession(draft: SavedSessionDraft): Promise<CreateSessionReply> {
      return send({ command: 'session.remember', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: draft }, 8_000);
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
    hasSavedSshCredential(id: string): Promise<SessionCredentialPresenceReply> {
      return send({ command: 'session.credential.has', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: { id } }, 8_000);
    },
    saveSshCredential(id: string): Promise<TerminalActionReply> {
      return send({ command: 'session.credential.save', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: { id } }, SESSION_CREDENTIAL_TIMEOUT_MS);
    },
    forgetSshCredential(id: string): Promise<TerminalActionReply> {
      return send({ command: 'session.credential.forget', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: { id } }, 8_000);
    },
    getCredentialVaultState(): Promise<CredentialVaultStateReply> {
      return send({ command: 'vault.state', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: {} }, 8_000);
    },
    lockCredentialVault(): Promise<TerminalActionReply> {
      return send({ command: 'vault.lock', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: {} }, 8_000);
    },
    unlockCredentialVault(): Promise<CredentialVaultStateReply> {
      return send({ command: 'vault.unlock', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: {} }, 180_000);
    },
    enableMasterPasswordVault(): Promise<CredentialVaultStateReply> {
      return send({ command: 'vault.master.enable', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: {} }, 300_000);
    },
    disableMasterPasswordVault(): Promise<CredentialVaultStateReply> {
      return send({ command: 'vault.master.disable', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: {} }, 180_000);
    },
    resetCredentialVault(): Promise<CredentialVaultStateReply> {
      return send({ command: 'vault.reset', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: {} }, 30_000);
    },
    listSshTunnels(): Promise<ListSshTunnelsReply> {
      return send({ command: 'tunnel.list', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: {} }, 8_000);
    },
    saveSshTunnel(draft: SshTunnelDraft): Promise<SaveSshTunnelReply> {
      return send({ command: 'tunnel.save', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: draft }, 8_000);
    },
    deleteTunnel(id: string): Promise<TerminalActionReply> {
      return send(voidRequest('tunnel.delete', { id }), 8_000);
    },
    startTunnel(id: string): Promise<TunnelStatusReply> {
      return send({ command: 'tunnel.start', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: { id } }, SSH_OPEN_TIMEOUT_MS);
    },
    stopTunnel(id: string): Promise<TunnelStatusReply> {
      return send({ command: 'tunnel.stop', requestId: requestId(), contractVersion: CONTRACT_VERSION, payload: { id } }, 10_000);
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
    },
    onTunnelStatus(listener: (status: TunnelRunStatus) => void): () => void {
      if (typeof listener !== 'function') return () => {};
      try {
        return listenTunnelStatus(value => {
          if (isTunnelStatusEvent(value)) {
            try { listener(value); } catch { /* Runtime observers cannot affect forwarding cleanup. */ }
          }
        });
      } catch { return () => {}; }
    },
    onFtpTransferProgress(listener: (event: FtpTransferProgress) => void): () => void {
      if (typeof listener !== 'function') return () => {};
      try {
        return listenFtpTransfer(value => {
          if (isFtpTransferEvent(value)) {
            try { listener(value); } catch { /* A renderer progress handler cannot interrupt IPC ownership. */ }
          }
        });
      } catch { return () => {}; }
    },
    onSshTransferProgress(listener: (event: FileTransferProgress) => void): () => void {
      if (typeof listener !== 'function') return () => {};
      try {
        return listenSshTransfer(value => {
          if (isSshTransferEvent(value)) {
            try { listener(value); } catch { /* A renderer progress handler cannot interrupt IPC ownership. */ }
          }
        });
      } catch { return () => {}; }
    }
  });
}
