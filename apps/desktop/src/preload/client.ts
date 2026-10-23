import { CONTRACT_VERSION, isCommandReply, isTerminalEvent } from '../../../../packages/contracts/src/commands.ts';
import type { CommandReply, CommandRequest, DesktopBridge, DescribeReply, OpenTerminalReply, TerminalActionReply } from '../../../../packages/contracts/src/commands.ts';
import type { LocalShell } from '../../../../packages/domain/src/local-terminal.ts';
import { MAX_QUEUED_TERMINAL_INPUT_CHARS, MAX_TERMINAL_INPUT_CHARS } from '../../../../packages/domain/src/local-terminal.ts';
import { failure } from '../../../../packages/domain/src/errors.ts';
import type { LocalTerminalEvent } from '../../../../packages/application/src/local-terminals.ts';

type Invoke = (request: CommandRequest) => Promise<unknown>;
type Listen = (listener: (value: unknown) => void) => () => void;
const MAX_PENDING_REQUESTS = 256;

export function createBridge(invoke: Invoke, makeId: () => string, listen: Listen = () => () => {}): DesktopBridge {
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
        timer = setTimeout(() => resolve({ requestId, ...failure('TIMEOUT') }), timeoutMs);
      })]);
    } finally {
      // The underlying invocation owns its slot until it settles, even after this bounded wait times out.
      void received.finally(() => clearTimeout(timer));
    }
  }

  function requestId(): string { return makeId(); }
  function voidRequest(command: 'terminal.write' | 'terminal.resize' | 'terminal.ack' | 'terminal.close', payload: Record<string, unknown>): CommandRequest {
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
    onTerminalEvent(listener: (event: LocalTerminalEvent) => void): () => void {
      if (typeof listener !== 'function') return () => {};
      try {
        return listen(value => {
          if (isTerminalEvent(value)) {
            try { listener(value); } catch { /* Presentation errors do not affect IPC ownership. */ }
          }
        });
      } catch { return () => {}; }
    }
  });
}
