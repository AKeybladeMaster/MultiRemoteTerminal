import { failure } from '../../domain/src/errors.ts';
import type { ErrorCode, Outcome } from '../../domain/src/errors.ts';
import { isTftpPort } from '../../domain/src/tftp.ts';
import type { TftpServerStatus } from '../../domain/src/tftp.ts';
import type { CancellationSignal } from './cancellation.ts';

export type TftpServerProviderErrorCode = 'INVALID_REQUEST' | 'UNAVAILABLE' | 'TIMEOUT' | 'BUSY' | 'FORBIDDEN' | 'NOT_FOUND' | 'OUTPUT_LIMIT';

export class TftpServerProviderError extends Error {
  readonly code: TftpServerProviderErrorCode;

  constructor(code: TftpServerProviderErrorCode) {
    super('Local TFTP server operation failed');
    this.name = 'TftpServerProviderError';
    this.code = code;
  }
}

export interface TftpServerProvider {
  start(rootDirectory: string, port: number): Promise<number>;
  stop(): Promise<void>;
  shutdown(): Promise<void>;
  subscribeToExit(listener: () => void): () => void;
}

export interface TftpRootDirectory {
  readonly absolutePath: string;
  readonly folderName: string;
}

export interface TftpServerController {
  getStatus(): TftpServerStatus;
  subscribe(listener: (status: TftpServerStatus) => void): () => void;
  start(root: TftpRootDirectory, port: number, cancellation?: CancellationSignal): Promise<Outcome<TftpServerStatus>>;
  stop(): Promise<Outcome<Record<string, never>>>;
  closeAll(): Promise<void>;
}

const STOPPED: TftpServerStatus = Object.freeze({ state: 'stopped' });
const EMPTY_RESULT: Record<string, never> = Object.freeze({});

export function createTftpServerController(provider: TftpServerProvider): TftpServerController {
  let status: TftpServerStatus = STOPPED;
  const listeners = new Set<(status: TftpServerStatus) => void>();
  let operation: 'starting' | 'stopping' | undefined;
  let disposed = false;
  let operationSettled: Promise<void> | undefined;
  let settleOperation: (() => void) | undefined;
  let providerExitGeneration = 0;
  let closePromise: Promise<void> | undefined;

  function setStatus(next: TftpServerStatus): void {
    if (status.state === next.state && (status.state === 'stopped' ||
        next.state === 'running' && status.address === next.address && status.port === next.port && status.folderName === next.folderName)) return;
    status = next;
    for (const listener of listeners) {
      try { listener(status); } catch { /* Observers cannot interrupt server lifecycle cleanup. */ }
    }
  }

  const unsubscribe = provider.subscribeToExit(() => {
    providerExitGeneration++;
    setStatus(STOPPED);
  });

  async function start(root: TftpRootDirectory, port: number, cancellation?: CancellationSignal): Promise<Outcome<TftpServerStatus>> {
    if (!root || typeof root.absolutePath !== 'string' || root.absolutePath.length === 0 || typeof root.folderName !== 'string' ||
        root.folderName.length === 0 || root.folderName.length > 255 || !isTftpPort(port)) return failure('INVALID_REQUEST');
    if (disposed) return failure('UNAVAILABLE');
    if (operation || status.state === 'running') return failure('BUSY');
    if (cancellation?.aborted) return failure('CANCELLED');
    operation = 'starting';
    const currentExitGeneration = providerExitGeneration;
    operationSettled = new Promise<void>(resolve => { settleOperation = resolve; });
    try {
      const assignedPort = await provider.start(root.absolutePath, port);
      if (providerExitGeneration !== currentExitGeneration) {
        await provider.stop().catch(() => undefined);
        setStatus(STOPPED);
        return failure('UNAVAILABLE');
      }
      if (disposed || cancellation?.aborted) {
        await provider.stop().catch(() => undefined);
        setStatus(STOPPED);
        return failure('CANCELLED');
      }
      if (!Number.isSafeInteger(assignedPort) || assignedPort < 1 || assignedPort > 65_535) {
        await provider.stop().catch(() => undefined);
        setStatus(STOPPED);
        return failure('UNAVAILABLE');
      }
      setStatus({ state: 'running', address: '127.0.0.1', port: assignedPort, folderName: root.folderName });
      return { ok: true, result: status };
    } catch (error) {
      setStatus(STOPPED);
      return failure(error instanceof TftpServerProviderError ? error.code as ErrorCode : 'UNAVAILABLE');
    } finally {
      operation = undefined;
      settleOperation?.();
      operationSettled = undefined;
      settleOperation = undefined;
    }
  }

  async function stop(): Promise<Outcome<Record<string, never>>> {
    if (disposed) return failure('UNAVAILABLE');
    if (operation) return failure('BUSY');
    if (status.state === 'stopped') return { ok: true, result: EMPTY_RESULT };
    operation = 'stopping';
    operationSettled = new Promise<void>(resolve => { settleOperation = resolve; });
    try {
      await provider.stop();
      setStatus(STOPPED);
      return { ok: true, result: EMPTY_RESULT };
    } catch (error) {
      setStatus(STOPPED);
      return failure(error instanceof TftpServerProviderError ? error.code as ErrorCode : 'UNAVAILABLE');
    } finally {
      operation = undefined;
      settleOperation?.();
      operationSettled = undefined;
      settleOperation = undefined;
    }
  }

  function closeAll(): Promise<void> {
    if (closePromise) return closePromise;
    disposed = true;
    closePromise = (async () => {
      await operationSettled?.catch(() => undefined);
      setStatus(STOPPED);
      try { await provider.stop(); } catch { /* Worker shutdown below remains the final cleanup barrier. */ }
      try { await provider.shutdown(); } catch { /* App shutdown continues after the bounded worker host deadline. */ }
      unsubscribe();
      listeners.clear();
    })();
    return closePromise;
  }

  return { getStatus: () => status, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, start, stop, closeAll };
}
