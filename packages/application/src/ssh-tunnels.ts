import { failure } from '../../domain/src/errors.ts';
import type { ErrorCode, Outcome } from '../../domain/src/errors.ts';
import type { SshTunnelDefinition, SshTunnelDraft, TunnelRunStatus } from '../../domain/src/ssh-tunnel.ts';
import { isTunnelId, normalizeSshTunnelDraft } from '../../domain/src/ssh-tunnel.ts';
import { isSessionDefinitionId } from '../../domain/src/session-definition.ts';
import type { SavedSessionDefinition } from '../../domain/src/session-definition.ts';
import type { CancellationSignal } from './cancellation.ts';
import type { SshTerminalController } from './ssh-terminals.ts';
import type { StorageOperationKind } from './storage-errors.ts';
import { StorageOperationError } from './storage-errors.ts';

export interface SshTunnelCatalog {
  listSshTunnels(): Promise<readonly SshTunnelDefinition[]>;
  getSshTunnel(id: string): Promise<SshTunnelDefinition | undefined>;
  saveSshTunnel(draft: SshTunnelDraft): Promise<SshTunnelDefinition>;
  removeSshTunnel(id: string): Promise<boolean>;
}

export interface SavedSessionReader {
  getSessionDefinition(id: string): Promise<SavedSessionDefinition | undefined>;
}

export interface SshTunnelForwardProvider {
  startForward(sessionId: string, tunnelId: string, definition: SshTunnelDefinition): Promise<number>;
  stopForward(sessionId: string, tunnelId: string): Promise<void>;
}

export interface SshTunnelSnapshot {
  readonly definition: SshTunnelDefinition;
  readonly status: TunnelRunStatus;
}

export interface SshTunnelController {
  list(): Promise<Outcome<readonly SshTunnelSnapshot[]>>;
  save(draft: unknown): Promise<Outcome<SshTunnelDefinition>>;
  remove(id: unknown): Promise<Outcome<Record<string, never>>>;
  start(id: unknown, cancellation?: CancellationSignal): Promise<Outcome<TunnelRunStatus>>;
  stop(id: unknown): Promise<Outcome<TunnelRunStatus>>;
  beginSessionRemoval(sessionId: string): boolean;
  endSessionRemoval(sessionId: string): void;
  closeAll(): Promise<void>;
  subscribe(listener: (status: TunnelRunStatus) => void): () => void;
  dispose(): Promise<void>;
}

interface RuntimeTunnel {
  readonly definition: SshTunnelDefinition;
  readonly sshSessionId: string;
  status: TunnelRunStatus;
  startPromise?: Promise<Outcome<TunnelRunStatus>>;
  stopPromise?: Promise<Outcome<TunnelRunStatus>>;
  stopRequested: boolean;
  bound: boolean;
  failureCode?: ErrorCode;
}

interface StartAttempt {
  cancelled: boolean;
  sessionId?: string;
  runtime?: RuntimeTunnel;
  promise: Promise<Outcome<TunnelRunStatus>>;
}

const EMPTY_RESULT: Record<string, never> = Object.freeze({});
const TERMINAL_ERROR_CODES: readonly ErrorCode[] = ['INVALID_REQUEST', 'UNKNOWN_COMMAND', 'FORBIDDEN', 'UNAVAILABLE', 'NOT_SUPPORTED',
  'TIMEOUT', 'BUSY', 'NOT_FOUND', 'CONFLICT', 'CANCELLED', 'OUTPUT_LIMIT', 'AUTHENTICATION_FAILED', 'HOST_KEY_REJECTED', 'HOST_KEY_CHANGED'];

export function createSshTunnelController(
  catalog: SshTunnelCatalog,
  profiles: SavedSessionReader,
  ssh: Pick<SshTerminalController, 'openFiles' | 'close' | 'subscribe'>,
  forwarding: SshTunnelForwardProvider,
  newId: () => string,
): SshTunnelController {
  const runtimes = new Map<string, RuntimeTunnel>();
  const startingRequests = new Map<string, StartAttempt>();
  const profilesBeingRemoved = new Set<string>();
  const statuses = new Map<string, TunnelRunStatus>();
  const listeners = new Set<(status: TunnelRunStatus) => void>();
  let disposed = false;

  const stopSshEvents = ssh.subscribe(event => {
    if (event.kind !== 'exit' && event.kind !== 'failure') return;
    const runtime = [...runtimes.values()].find(candidate => candidate.sshSessionId === event.sessionId);
    if (!runtime || runtime.stopRequested || runtime.status.state === 'stopped' || runtime.status.state === 'failed') return;
    runtime.failureCode = event.kind === 'failure' && TERMINAL_ERROR_CODES.includes(event.error.code) ? event.error.code : 'UNAVAILABLE';
    if (runtime.status.state === 'starting') return;
    void failRuntime(runtime, runtime.failureCode);
  });

  function publish(status: TunnelRunStatus): void {
    for (const listener of listeners) {
      try { listener(status); } catch { /* Status observers cannot interrupt transport cleanup. */ }
    }
  }

  function setStatus(runtime: RuntimeTunnel, status: TunnelRunStatus): void {
    runtime.status = status;
    statuses.set(runtime.definition.id, status);
    publish(status);
  }

  async function closeRuntimeResources(runtime: RuntimeTunnel): Promise<void> {
    if (runtime.bound) {
      runtime.bound = false;
      await forwarding.stopForward(runtime.sshSessionId, runtime.definition.id).catch(() => undefined);
    }
    await ssh.close(runtime.sshSessionId).catch(() => undefined);
  }

  async function failRuntime(runtime: RuntimeTunnel, code: ErrorCode): Promise<void> {
    if (runtime.status.state === 'failed' || runtime.status.state === 'stopped') return;
    runtime.stopRequested = true;
    await closeRuntimeResources(runtime);
    setStatus(runtime, { tunnelId: runtime.definition.id, state: 'failed', errorCode: code });
    if (runtimes.get(runtime.definition.id) === runtime) runtimes.delete(runtime.definition.id);
  }

  async function list(): Promise<Outcome<readonly SshTunnelSnapshot[]>> {
    if (disposed) return failure('CANCELLED');
    try {
      const definitions = await catalog.listSshTunnels();
      return { ok: true, result: definitions.map(definition => ({ definition,
        status: statuses.get(definition.id) ?? { tunnelId: definition.id, state: 'stopped' as const } })) };
    } catch (error) { return failure(storageErrorCode(error)); }
  }

  async function save(input: unknown): Promise<Outcome<SshTunnelDefinition>> {
    if (disposed) return failure('CANCELLED');
    const draft = normalizeSshTunnelDraft(input);
    if (!draft) return failure('INVALID_REQUEST');
    if (draft.id && (runtimes.has(draft.id) || startingRequests.has(draft.id))) return failure('BUSY', 'terminal');
    try {
      const profile = await profiles.getSessionDefinition(draft.sessionId);
      if (!profile) return failure('NOT_FOUND');
      if (profile.kind !== 'ssh' && profile.kind !== 'sftp') return failure('INVALID_REQUEST');
      return { ok: true, result: await catalog.saveSshTunnel(draft) };
    } catch (error) { return failure(storageErrorCode(error)); }
  }

  async function remove(id: unknown): Promise<Outcome<Record<string, never>>> {
    if (disposed) return failure('CANCELLED');
    if (!isTunnelId(id)) return failure('INVALID_REQUEST');
    if (runtimes.has(id) || startingRequests.has(id)) return failure('BUSY', 'terminal');
    try {
      const removed = await catalog.removeSshTunnel(id);
      if (!removed) return failure('NOT_FOUND');
      statuses.delete(id);
      return { ok: true, result: EMPTY_RESULT };
    }
    catch (error) { return failure(storageErrorCode(error)); }
  }

  function start(id: unknown, cancellation?: CancellationSignal): Promise<Outcome<TunnelRunStatus>> {
    if (disposed) return Promise.resolve(failure('CANCELLED'));
    if (cancellation?.aborted) return Promise.resolve(failure('CANCELLED', 'terminal'));
    if (!isTunnelId(id)) return Promise.resolve(failure('INVALID_REQUEST'));
    const pending = startingRequests.get(id);
    if (pending) return observeStart(pending, cancellation);
    const current = runtimes.get(id);
    if (current) {
      if (current.status.state !== 'starting' || !current.startPromise) return Promise.resolve(failure('BUSY', 'terminal'));
      const attempt = { cancelled: false, runtime: current, promise: current.startPromise };
      return observeStart(attempt, cancellation);
    }

    const attempt: StartAttempt = { cancelled: false, promise: Promise.resolve(failure('UNAVAILABLE')) };
    startingRequests.set(id, attempt);
    attempt.promise = performStartRequest(id, attempt).finally(() => {
      if (startingRequests.get(id) === attempt) startingRequests.delete(id);
    });
    return observeStart(attempt, cancellation);
  }

  function observeStart(attempt: StartAttempt, cancellation?: CancellationSignal): Promise<Outcome<TunnelRunStatus>> {
    if (!cancellation) return attempt.promise;
    const cancel = () => cancelAttempt(attempt);
    cancellation.addEventListener('abort', cancel, { once: true });
    if (cancellation.aborted) cancel();
    return attempt.promise.finally(() => cancellation.removeEventListener('abort', cancel));
  }

  function cancelAttempt(attempt: StartAttempt): void {
    if (attempt.cancelled) return;
    attempt.cancelled = true;
    if (attempt.runtime) void requestStop(attempt.runtime);
    else {
      for (const [id, candidate] of startingRequests) {
        if (candidate === attempt) startingRequests.delete(id);
      }
    }
  }

  async function performStartRequest(id: string, attempt: StartAttempt): Promise<Outcome<TunnelRunStatus>> {
    if (disposed || attempt.cancelled) return failure('CANCELLED', 'terminal');
    let definition: SshTunnelDefinition | undefined;
    let profile: SavedSessionDefinition | undefined;
    try {
      definition = await catalog.getSshTunnel(id);
      if (disposed || attempt.cancelled) return failure('CANCELLED', 'terminal');
      if (!definition) return failure('NOT_FOUND');
      attempt.sessionId = definition.sessionId;
      if (profilesBeingRemoved.has(definition.sessionId)) return failure('BUSY');
      profile = await profiles.getSessionDefinition(definition.sessionId);
    } catch (error) {
      return disposed || attempt.cancelled ? failure('CANCELLED', 'terminal') : failure(storageErrorCode(error));
    }
    if (disposed || attempt.cancelled) return failure('CANCELLED', 'terminal');
    if (profilesBeingRemoved.has(definition.sessionId)) return failure('BUSY');
    if (!profile) return failure('NOT_FOUND');
    if ((profile.kind !== 'ssh' && profile.kind !== 'sftp') || !profile.host || !profile.port) return failure('INVALID_REQUEST');

    const runtime: RuntimeTunnel = { definition, sshSessionId: newId(), status: { tunnelId: id, state: 'starting' }, stopRequested: false, bound: false };
    if (!isTunnelId(runtime.sshSessionId)) return failure('UNAVAILABLE');
    attempt.runtime = runtime;
    runtimes.set(id, runtime);
    setStatus(runtime, runtime.status);
    const operation = performStart(runtime, profile.host, profile.port);
    runtime.startPromise = operation;
    return operation;
  }

  async function performStart(runtime: RuntimeTunnel, host: string, port: number): Promise<Outcome<TunnelRunStatus>> {
    try {
      const opened = await ssh.openFiles(runtime.sshSessionId, host, port);
      if (!opened.ok) {
        await closeRuntimeResources(runtime);
        const status: TunnelRunStatus = runtime.stopRequested ? { tunnelId: runtime.definition.id, state: 'stopped' }
          : { tunnelId: runtime.definition.id, state: 'failed', errorCode: runtime.failureCode ?? opened.error.code };
        setStatus(runtime, status);
        if (runtimes.get(runtime.definition.id) === runtime) runtimes.delete(runtime.definition.id);
        return runtime.stopRequested ? failure('CANCELLED', 'terminal') : { ok: false, error: opened.error };
      }
      if (runtime.stopRequested || runtime.failureCode || opened.result.state !== 'running') {
        await closeRuntimeResources(runtime);
        const code = runtime.failureCode ?? (runtime.stopRequested ? 'CANCELLED' : 'UNAVAILABLE');
        const status: TunnelRunStatus = runtime.stopRequested ? { tunnelId: runtime.definition.id, state: 'stopped' }
          : { tunnelId: runtime.definition.id, state: 'failed', errorCode: code };
        setStatus(runtime, status);
        if (runtimes.get(runtime.definition.id) === runtime) runtimes.delete(runtime.definition.id);
        return runtime.stopRequested ? failure('CANCELLED', 'terminal') : failure(code, 'terminal');
      }
      const portAssigned = await forwarding.startForward(runtime.sshSessionId, runtime.definition.id, runtime.definition);
      runtime.bound = true;
      if (!Number.isSafeInteger(portAssigned) || portAssigned < 1 || portAssigned > 65_535) throw new Error('Invalid listener result');
      if (runtime.stopRequested || runtime.failureCode) {
        const code = runtime.failureCode ?? 'CANCELLED';
        await closeRuntimeResources(runtime);
        const status: TunnelRunStatus = runtime.stopRequested ? { tunnelId: runtime.definition.id, state: 'stopped' }
          : { tunnelId: runtime.definition.id, state: 'failed', errorCode: code };
        setStatus(runtime, status);
        if (runtimes.get(runtime.definition.id) === runtime) runtimes.delete(runtime.definition.id);
        return runtime.stopRequested ? failure('CANCELLED', 'terminal') : failure(code, 'terminal');
      }
      const status: TunnelRunStatus = { tunnelId: runtime.definition.id, state: 'active', bindHost: '127.0.0.1', bindPort: portAssigned };
      setStatus(runtime, status);
      return { ok: true, result: status };
    } catch (error) {
      const code = runtime.stopRequested ? 'CANCELLED' : runtime.failureCode ?? providerErrorCode(error);
      await closeRuntimeResources(runtime);
      const status: TunnelRunStatus = runtime.stopRequested ? { tunnelId: runtime.definition.id, state: 'stopped' }
        : { tunnelId: runtime.definition.id, state: 'failed', errorCode: code };
      setStatus(runtime, status);
      if (runtimes.get(runtime.definition.id) === runtime) runtimes.delete(runtime.definition.id);
      return runtime.stopRequested ? failure('CANCELLED', 'terminal') : failure(code, 'terminal');
    } finally { delete runtime.startPromise; }
  }

  function stop(id: unknown): Promise<Outcome<TunnelRunStatus>> {
    if (disposed) return Promise.resolve(failure('CANCELLED'));
    if (!isTunnelId(id)) return Promise.resolve(failure('INVALID_REQUEST'));
    const runtime = runtimes.get(id);
    if (!runtime) return Promise.resolve({ ok: true, result: { tunnelId: id, state: 'stopped' } });
    return requestStop(runtime);
  }

  function beginSessionRemoval(sessionId: string): boolean {
    if (!isSessionDefinitionId(sessionId) || profilesBeingRemoved.has(sessionId)) return false;
    profilesBeingRemoved.add(sessionId);
    const hasInFlightTunnel = [...startingRequests.values()].some(attempt => attempt.sessionId === sessionId) ||
      [...runtimes.values()].some(runtime => runtime.definition.sessionId === sessionId);
    if (hasInFlightTunnel) {
      profilesBeingRemoved.delete(sessionId);
      return false;
    }
    return true;
  }

  function endSessionRemoval(sessionId: string): void {
    profilesBeingRemoved.delete(sessionId);
  }

  function requestStop(runtime: RuntimeTunnel): Promise<Outcome<TunnelRunStatus>> {
    if (runtime.stopPromise) return runtime.stopPromise;
    const operation = performStop(runtime).finally(() => { delete runtime.stopPromise; });
    runtime.stopPromise = operation;
    return operation;
  }

  async function performStop(runtime: RuntimeTunnel): Promise<Outcome<TunnelRunStatus>> {
    const id = runtime.definition.id;
    if (runtime.status.state === 'stopped') return { ok: true, result: runtime.status };
    const previousState = runtime.status.state;
    runtime.stopRequested = true;
    setStatus(runtime, { tunnelId: id, state: 'stopping' });
    if (previousState === 'starting') {
      await ssh.close(runtime.sshSessionId).catch(() => undefined);
      const starting = runtime.startPromise;
      if (starting) await starting;
      if (runtimes.get(id) === runtime) {
        await closeRuntimeResources(runtime);
        setStatus(runtime, { tunnelId: id, state: 'stopped' });
        runtimes.delete(id);
      }
      return { ok: true, result: { tunnelId: id, state: 'stopped' } };
    }
    await closeRuntimeResources(runtime);
    const stopped: TunnelRunStatus = { tunnelId: id, state: 'stopped' };
    setStatus(runtime, stopped);
    runtimes.delete(id);
    return { ok: true, result: stopped };
  }

  return {
    list,
    save,
    remove,
    start,
    stop,
    beginSessionRemoval,
    endSessionRemoval,
    async closeAll() {
      for (const attempt of startingRequests.values()) cancelAttempt(attempt);
      await Promise.all([...runtimes.values()].map(runtime => requestStop(runtime)));
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async dispose() {
      if (disposed) return;
      disposed = true;
      for (const attempt of startingRequests.values()) cancelAttempt(attempt);
      const active = [...runtimes.values()];
      await Promise.all(active.map(runtime => requestStop(runtime)));
      stopSshEvents();
      listeners.clear();
    }
  };

}

function storageErrorCode(error: unknown): ErrorCode {
  if (error instanceof StorageOperationError) return mapStorageKind(error.kind);
  return 'UNAVAILABLE';
}

function mapStorageKind(kind: StorageOperationKind): ErrorCode {
  if (kind === 'busy') return 'BUSY';
  if (kind === 'cancelled') return 'CANCELLED';
  if (kind === 'conflict') return 'CONFLICT';
  if (kind === 'not-found') return 'NOT_FOUND';
  if (kind === 'invalid') return 'INVALID_REQUEST';
  return 'UNAVAILABLE';
}

function providerErrorCode(error: unknown): ErrorCode {
  if (typeof error === 'object' && error !== null && 'code' in error && TERMINAL_ERROR_CODES.includes((error as { code?: ErrorCode }).code as ErrorCode)) {
    return (error as { code: ErrorCode }).code;
  }
  return 'UNAVAILABLE';
}
