import { channel } from 'node:diagnostics_channel';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import type { UtilityProcess } from 'electron';
import { HostTrustStoreError } from '../../../../packages/application/src/host-trust.ts';
import type { HostTrustInsertResult, HostTrustStore } from '../../../../packages/application/src/host-trust.ts';
import type { SessionCatalogStore } from '../../../../packages/application/src/session-catalog.ts';
import { StorageOperationError } from '../../../../packages/application/src/storage-errors.ts';
import type { SshTunnelCatalog, SavedSessionReader } from '../../../../packages/application/src/ssh-tunnels.ts';
import type { CancellationSignal } from '../../../../packages/application/src/cancellation.ts';
import type { CredentialPromptCancellation } from '../../../../packages/application/src/credential-prompt.ts';
import type { SshHostEndpoint, TrustedHostKey } from '../../../../packages/domain/src/host-trust.ts';
import { isSessionDefinitionId, isSessionFolderId, normalizeSavedSessionDraft, normalizeSessionSearch } from '../../../../packages/domain/src/session-definition.ts';
import type { SavedSessionDefinition, SavedSessionDraft } from '../../../../packages/domain/src/session-definition.ts';
import { normalizeSessionFolderDraft, normalizeSessionFolderName } from '../../../../packages/domain/src/session-folder.ts';
import type { SavedSessionFolder, SavedSessionFolderDraft } from '../../../../packages/domain/src/session-folder.ts';
import { isTunnelId, normalizeSshTunnelDraft } from '../../../../packages/domain/src/ssh-tunnel.ts';
import type { SshTunnelDefinition, SshTunnelDraft } from '../../../../packages/domain/src/ssh-tunnel.ts';
import type { SessionFolderExportResult, SessionFolderImportResult } from '../../../../packages/domain/src/session-folder-bundle.ts';
import { HostTrustJsonStore } from './host-trust-json-store.ts';
import { parseStorageWorkerMessage, STORAGE_WORKER_PROTOCOL_VERSION } from '../workers/storage-protocol.ts';
import type { StorageWorkerErrorCode } from '../workers/storage-protocol.ts';
import type { StorageWorkerRequest, StorageWorkerResult } from '../workers/storage-protocol.ts';
import { basename, dirname, isAbsolute, join } from 'node:path';

const REQUEST_TIMEOUT_MS = 8_000;
const START_TIMEOUT_MS = 5_000;
const MAX_PENDING_REQUESTS = 128;
export const STORAGE_DIAGNOSTICS_CHANNEL_NAME = 'multi-remote-terminal.storage';
const storageDiagnostics = channel(STORAGE_DIAGNOSTICS_CHANNEL_NAME);

type StorageDiagnosticEvent = {
  readonly component: 'storage';
  readonly event: 'protocol-invalid' | 'request-cancelled' | 'request-timeout' | 'startup-error' | 'startup-timeout' | 'worker-exit';
  readonly code: 'BUSY' | 'CANCELLED' | 'CONFLICT' | 'CORRUPT' | 'INVALID_BUNDLE' | 'NOT_FOUND' | 'UNAVAILABLE';
};

function publishStorageDiagnostic(event: StorageDiagnosticEvent['event'], code: StorageDiagnosticEvent['code']): void {
  if (!storageDiagnostics.hasSubscribers) return;
  try { storageDiagnostics.publish(Object.freeze({ component: 'storage', event, code })); }
  catch { /* Observability subscribers cannot interrupt storage cleanup or error handling. */ }
}

export type StorageWorkerLaunchOptions = {
  readonly cwd: string;
  readonly env: { readonly MRT_STORAGE_DB_PATH: string };
  readonly serviceName: string;
  readonly stdio: 'ignore';
};
export type StorageWorkerLauncher = (workerPath: string, args: string[], options: StorageWorkerLaunchOptions) => UtilityProcess;

interface PendingRequest {
  readonly resolve: (result: StorageWorkerResult) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly cancellation?: CredentialPromptCancellation;
  readonly temporaryPath?: string;
  abortListener?: () => void;
}

interface CancellationSource {
  readonly token: CredentialPromptCancellation;
  cancel(): void;
}

interface SharedMigration {
  readonly operation: Promise<void>;
  readonly cancellation: CancellationSource;
  waiters: number;
  settled: boolean;
}

type StorageWorkerCommand = StorageWorkerRequest extends infer Request
  ? Request extends { readonly type: 'request' }
    ? Omit<Request, 'version' | 'type' | 'requestId'>
    : never
  : never;

export class SqliteStorageStore implements HostTrustStore, SessionCatalogStore, SshTunnelCatalog, SavedSessionReader {
  private readonly legacyStore: HostTrustJsonStore;
  private readonly worker: StorageWorkerClient;
  private migration: SharedMigration | undefined;
  private migrated = false;

  constructor(databasePath: string, legacyFilePath: string, workerPath: string, appRoot: string, launchWorker: StorageWorkerLauncher,
    removeTemporaryFile: (path: string) => Promise<void> = path => rm(path, { force: true })) {
    this.legacyStore = new HostTrustJsonStore(legacyFilePath);
    this.worker = new StorageWorkerClient(databasePath, workerPath, appRoot, launchWorker, removeTemporaryFile);
  }

  async find(endpoint: SshHostEndpoint, cancellation?: CredentialPromptCancellation): Promise<TrustedHostKey | undefined> {
    await this.ensureMigrated(cancellation);
    const result = await this.worker.request({ command: 'hostTrust.find', endpoint }, cancellation);
    if (result.kind !== 'identity') throw new HostTrustStoreError('corrupt');
    return result.value ?? undefined;
  }

  async trustIfAbsent(identity: TrustedHostKey, cancellation?: CredentialPromptCancellation): Promise<HostTrustInsertResult> {
    await this.ensureMigrated(cancellation);
    const result = await this.worker.request({ command: 'hostTrust.trustIfAbsent', identity }, cancellation);
    if (result.kind !== 'insert') throw new HostTrustStoreError('corrupt');
    return result.value;
  }

  async remove(endpoint: SshHostEndpoint, cancellation?: CredentialPromptCancellation): Promise<boolean> {
    await this.ensureMigrated(cancellation);
    const result = await this.worker.request({ command: 'hostTrust.remove', endpoint }, cancellation);
    if (result.kind !== 'removed') throw new HostTrustStoreError('corrupt');
    return result.value;
  }

  async listSessions(query: string, cancellation?: CancellationSignal): Promise<readonly SavedSessionDefinition[]> {
    const normalized = normalizeSessionSearch(query);
    if (normalized === undefined) throw new HostTrustStoreError('unavailable');
    await this.ensureMigrated(cancellation);
    const result = await this.worker.request({ command: 'session.list', query: normalized }, cancellation);
    if (result.kind !== 'sessions') throw new HostTrustStoreError('corrupt');
    return result.value;
  }

  async getSessionDefinition(id: string): Promise<SavedSessionDefinition | undefined> {
    await this.ensureMigrated();
    const result = await this.worker.request({ command: 'session.get', id });
    if (result.kind !== 'sessionLookup') throw new StorageOperationError('corrupt');
    return result.value ?? undefined;
  }

  async createSession(input: SavedSessionDraft, cancellation?: CancellationSignal): Promise<SavedSessionDefinition> {
    const draft = normalizeSavedSessionDraft(input);
    if (!draft) throw new HostTrustStoreError('unavailable');
    await this.ensureMigrated(cancellation);
    const result = await this.worker.request({ command: 'session.create', draft }, cancellation);
    if (result.kind !== 'session') throw new HostTrustStoreError('corrupt');
    return result.value;
  }

  async setFavorite(id: string, favorite: boolean, cancellation?: CancellationSignal): Promise<boolean> {
    await this.ensureMigrated(cancellation);
    const result = await this.worker.request({ command: 'session.favorite', id, favorite }, cancellation);
    if (result.kind !== 'changed') throw new HostTrustStoreError('corrupt');
    return result.value;
  }

  async removeSession(id: string, cancellation?: CancellationSignal): Promise<boolean> {
    await this.ensureMigrated(cancellation);
    const result = await this.worker.request({ command: 'session.remove', id }, cancellation);
    if (result.kind !== 'changed') throw new HostTrustStoreError('corrupt');
    return result.value;
  }

  async listFolders(cancellation?: CancellationSignal): Promise<readonly SavedSessionFolder[]> {
    await this.ensureMigrated(cancellation);
    const result = await this.worker.request({ command: 'session.folder.list' }, cancellation);
    if (result.kind !== 'folders') throw new HostTrustStoreError('corrupt');
    return result.value;
  }

  async createFolder(input: SavedSessionFolderDraft, cancellation?: CancellationSignal): Promise<SavedSessionFolder> {
    const draft = normalizeSessionFolderDraft(input);
    if (!draft) throw new HostTrustStoreError('unavailable');
    await this.ensureMigrated(cancellation);
    const result = await this.worker.request({ command: 'session.folder.create', draft }, cancellation);
    if (result.kind !== 'folder') throw new HostTrustStoreError('corrupt');
    return result.value;
  }

  async renameFolder(id: string, nameInput: string, cancellation?: CancellationSignal): Promise<boolean> {
    const name = normalizeSessionFolderName(nameInput);
    if (!isSessionFolderId(id) || !name) throw new HostTrustStoreError('unavailable');
    await this.ensureMigrated(cancellation);
    const result = await this.worker.request({ command: 'session.folder.rename', id, name }, cancellation);
    if (result.kind !== 'changed') throw new HostTrustStoreError('corrupt');
    return result.value;
  }

  async moveFolder(id: string, parentId: string | null, cancellation?: CancellationSignal): Promise<boolean> {
    if (!isSessionFolderId(id) || !(parentId === null || isSessionFolderId(parentId))) throw new HostTrustStoreError('unavailable');
    await this.ensureMigrated(cancellation);
    const result = await this.worker.request({ command: 'session.folder.move', id, parentId }, cancellation);
    if (result.kind !== 'changed') throw new HostTrustStoreError('corrupt');
    return result.value;
  }

  async removeFolder(id: string, cancellation?: CancellationSignal): Promise<boolean> {
    if (!isSessionFolderId(id)) throw new HostTrustStoreError('unavailable');
    await this.ensureMigrated(cancellation);
    const result = await this.worker.request({ command: 'session.folder.remove', id }, cancellation);
    if (result.kind !== 'changed') throw new HostTrustStoreError('corrupt');
    return result.value;
  }

  async moveSession(id: string, folderId: string | null, cancellation?: CancellationSignal): Promise<boolean> {
    if (!isSessionDefinitionId(id) || !(folderId === null || isSessionFolderId(folderId))) throw new HostTrustStoreError('unavailable');
    await this.ensureMigrated(cancellation);
    const result = await this.worker.request({ command: 'session.move', id, folderId }, cancellation);
    if (result.kind !== 'changed') throw new HostTrustStoreError('corrupt');
    return result.value;
  }

  async listSshTunnels(): Promise<readonly SshTunnelDefinition[]> {
    await this.ensureMigrated();
    const result = await this.worker.request({ command: 'tunnel.list' });
    if (result.kind !== 'tunnels') throw new StorageOperationError('corrupt');
    return result.value;
  }

  async getSshTunnel(id: string): Promise<SshTunnelDefinition | undefined> {
    if (!isTunnelId(id)) throw new StorageOperationError('invalid');
    await this.ensureMigrated();
    const result = await this.worker.request({ command: 'tunnel.get', id });
    if (result.kind !== 'tunnelLookup') throw new StorageOperationError('corrupt');
    return result.value ?? undefined;
  }

  async saveSshTunnel(input: SshTunnelDraft): Promise<SshTunnelDefinition> {
    const draft = normalizeSshTunnelDraft(input);
    if (!draft) throw new StorageOperationError('invalid');
    await this.ensureMigrated();
    const result = await this.worker.request({ command: 'tunnel.save', draft });
    if (result.kind !== 'tunnel') throw new StorageOperationError('corrupt');
    return result.value;
  }

  async removeSshTunnel(id: string): Promise<boolean> {
    if (!isTunnelId(id)) throw new StorageOperationError('invalid');
    await this.ensureMigrated();
    const result = await this.worker.request({ command: 'tunnel.remove', id });
    if (result.kind !== 'removed') throw new StorageOperationError('corrupt');
    return result.value;
  }

  async exportFolderToFile(folderId: string, path: string, cancellation?: CancellationSignal): Promise<SessionFolderExportResult> {
    if (!isSessionFolderId(folderId) || !isFilePath(path)) throw new HostTrustStoreError('invalid');
    await this.ensureMigrated(cancellation);
    const temporaryPath = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
    const result = await this.worker.request({ command: 'session.folder.export', folderId, path, temporaryPath }, cancellation);
    if (result.kind !== 'folderExport') throw new HostTrustStoreError('corrupt');
    return result.value;
  }

  async importFolderFromFile(path: string, cancellation?: CancellationSignal): Promise<SessionFolderImportResult> {
    if (!isFilePath(path)) throw new HostTrustStoreError('invalid');
    await this.ensureMigrated(cancellation);
    const result = await this.worker.request({ command: 'session.folder.import', path }, cancellation);
    if (result.kind !== 'folderImport') throw new HostTrustStoreError('corrupt');
    return result.value;
  }

  async shutdown(): Promise<void> {
    await this.worker.shutdown();
  }

  private async ensureMigrated(cancellation?: CredentialPromptCancellation): Promise<void> {
    if (this.migrated) { throwIfCancelled(cancellation); return; }
    throwIfCancelled(cancellation);
    let migration = this.migration;
    if (!migration) {
      const internalCancellation = createCancellationSource();
      const operation = this.migrateLegacyHostTrust(internalCancellation.token);
      migration = { operation, cancellation: internalCancellation, waiters: 0, settled: false };
      this.migration = migration;
      const currentMigration = migration;
      void operation.then(
        () => this.finishMigration(currentMigration),
        () => this.finishMigration(currentMigration)
      );
    }
    await this.waitForMigration(migration, cancellation);
  }

  private async waitForMigration(migration: SharedMigration, cancellation?: CredentialPromptCancellation): Promise<void> {
    throwIfCancelled(cancellation);
    migration.waiters += 1;
    try {
      await awaitWithCancellation(migration.operation, cancellation);
    } finally {
      migration.waiters -= 1;
      if (!migration.settled && migration.waiters === 0) migration.cancellation.cancel();
    }
  }

  private finishMigration(migration: SharedMigration): void {
    migration.settled = true;
    if (this.migration === migration) this.migration = undefined;
  }

  private async migrateLegacyHostTrust(cancellation: CredentialPromptCancellation): Promise<void> {
    const snapshot = await this.legacyStore.exportForMigration(cancellation);
    const result = await this.worker.request({ command: 'hostTrust.importLegacy', identities: snapshot.entries }, cancellation);
    if (result.kind !== 'migrated' || result.value.sourceCount !== snapshot.entries.length || result.value.verifiedCount !== snapshot.entries.length) {
      throw new HostTrustStoreError('corrupt');
    }
    await this.legacyStore.retireAfterMigration(snapshot.sourceSha256, cancellation);
    this.migrated = true;
  }
}

class StorageWorkerClient {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly exportTemporaryPaths = new Set<string>();
  private readonly databasePath: string;
  private readonly workerPath: string;
  private readonly appRoot: string;
  private readonly launchWorker: StorageWorkerLauncher;
  private readonly removeTemporaryFile: (path: string) => Promise<void>;
  private worker: UtilityProcess | undefined;
  private shuttingDown = false;
  private requesters = 0;
  private starting: Promise<UtilityProcess> | undefined;
  private workerExit: Promise<void> | undefined;
  private resolveWorkerExit: (() => void) | undefined;
  private readyResolve: (() => void) | undefined;
  private readyReject: ((error: Error) => void) | undefined;

  constructor(databasePath: string, workerPath: string, appRoot: string, launchWorker: StorageWorkerLauncher,
    removeTemporaryFile: (path: string) => Promise<void>) {
    this.databasePath = databasePath;
    this.workerPath = workerPath;
    this.appRoot = appRoot;
    this.launchWorker = launchWorker;
    this.removeTemporaryFile = removeTemporaryFile;
  }

  async request(command: StorageWorkerCommand, cancellation?: CredentialPromptCancellation): Promise<StorageWorkerResult> {
    if (this.shuttingDown && command.command !== 'shutdown') throw new HostTrustStoreError('unavailable');
    throwIfCancelled(cancellation);
    this.requesters += 1;
    try {
      const worker = await awaitWithCancellation(this.ensureWorker(), cancellation);
      throwIfCancelled(cancellation);
      if (this.pending.size >= MAX_PENDING_REQUESTS) throw new HostTrustStoreError('busy');
      const requestId = randomUUID();
      const request = { version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'request', requestId, ...command } as StorageWorkerRequest;
      return await new Promise<StorageWorkerResult>((resolve, reject) => {
        const rejectAfterCleanup = (error: HostTrustStoreError): void => {
          void this.terminate(worker).then(() => reject(error), () => reject(error));
        };
        const timeoutMs = request.command === 'hostTrust.importLegacy' ? 15_000 :
          request.command === 'session.folder.import' || request.command === 'session.folder.export' ? 60_000 : REQUEST_TIMEOUT_MS;
        const timer = setTimeout(() => {
          const pending = this.pending.get(requestId);
          if (!pending) return;
          this.clearPending(requestId, pending);
          publishStorageDiagnostic('request-timeout', 'BUSY');
          rejectAfterCleanup(new HostTrustStoreError('busy'));
        }, timeoutMs);
        const pending: PendingRequest = {
          resolve, reject, timer,
          ...(cancellation ? { cancellation } : {}),
          ...(command.command === 'session.folder.export' ? { temporaryPath: command.temporaryPath } : {})
        };
        this.pending.set(requestId, pending);
        if (cancellation) {
          const abortListener = () => {
            if (this.pending.get(requestId) !== pending) return;
            this.clearPending(requestId, pending);
            publishStorageDiagnostic('request-cancelled', 'CANCELLED');
            rejectAfterCleanup(new HostTrustStoreError('cancelled'));
          };
          pending.abortListener = abortListener;
          cancellation.addEventListener('abort', abortListener, { once: true });
          if (cancellation.aborted) { abortListener(); return; }
        }
        if (pending.temporaryPath) this.exportTemporaryPaths.add(pending.temporaryPath);
        try { worker.postMessage(request); }
        catch {
          if (pending.temporaryPath) this.exportTemporaryPaths.delete(pending.temporaryPath);
          this.clearPending(requestId, pending);
          reject(new HostTrustStoreError('unavailable'));
          void this.terminate(worker);
        }
      });
    } catch (error) {
      if (error instanceof HostTrustStoreError && error.kind === 'cancelled' && this.requesters === 1 && this.pending.size === 0) {
        const worker = this.worker;
        if (worker) await this.terminate(worker);
        else if (this.workerExit) await this.workerExit;
      }
      throw error;
    } finally {
      this.requesters -= 1;
    }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    const exit = this.workerExit;
    if (exit) { await exit; return; }
    const worker = this.worker;
    if (!worker) return;
    try { await this.request({ command: 'shutdown' }); }
    catch { /* A failed shutdown is completed by killing this owned worker. */ }
    if (this.worker === worker) await this.terminate(worker);
  }

  private ensureWorker(): Promise<UtilityProcess> {
    if (this.workerExit) return this.workerExit.then(() => {
      if (this.shuttingDown) throw new HostTrustStoreError('unavailable');
      return this.ensureWorker();
    });
    if (this.starting) return this.starting;
    const current = this.worker;
    if (current) return Promise.resolve(current);
    if (this.shuttingDown) return Promise.reject(new HostTrustStoreError('unavailable'));

    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    this.readyResolve = resolveReady;
    this.readyReject = rejectReady;
    const worker = this.launchWorker(this.workerPath, [], {
      cwd: this.appRoot,
      env: { MRT_STORAGE_DB_PATH: this.databasePath },
      serviceName: 'MultiRemoteTerminal SQLite storage provider',
      stdio: 'ignore'
    });
    this.worker = worker;
    worker.on('message', value => this.receive(worker, value));
    worker.on('exit', () => this.onExit(worker));
    const starting = ready.then(() => worker).finally(() => {
      if (this.starting === starting) this.starting = undefined;
      if (this.readyResolve === resolveReady) this.readyResolve = undefined;
      if (this.readyReject === rejectReady) this.readyReject = undefined;
    });
    this.starting = starting;
    const timer = setTimeout(() => {
      if (this.worker !== worker || this.readyResolve !== resolveReady) return;
      publishStorageDiagnostic('startup-timeout', 'UNAVAILABLE');
      this.readyReject?.(new HostTrustStoreError('unavailable'));
      void this.terminate(worker);
    }, START_TIMEOUT_MS);
    void ready.finally(() => clearTimeout(timer)).catch(() => undefined);
    return starting;
  }

  private receive(worker: UtilityProcess, value: unknown): void {
    if (this.worker !== worker) return;
    const message = parseStorageWorkerMessage(value);
    if (!message) { publishStorageDiagnostic('protocol-invalid', 'CORRUPT'); void this.terminate(worker); return; }
    if (message.type === 'ready') { this.readyResolve?.(); return; }
    if (message.type === 'startup-error') {
      publishStorageDiagnostic('startup-error', message.errorCode);
      this.readyReject?.(storeError(message.errorCode));
      return;
    }
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    this.clearPending(message.requestId, pending);
    if (pending.temporaryPath) this.exportTemporaryPaths.delete(pending.temporaryPath);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(storeError(message.errorCode));
  }

  private onExit(worker: UtilityProcess): void {
    if (this.worker !== worker) return;
    if (!this.workerExit) publishStorageDiagnostic('worker-exit', 'UNAVAILABLE');
    this.worker = undefined;
    if (!this.workerExit) {
      this.workerExit = new Promise<void>(resolveExit => { this.resolveWorkerExit = resolveExit; });
    }
    const error = new HostTrustStoreError('unavailable');
    this.readyReject?.(error);
    const temporaryPaths = [...this.exportTemporaryPaths];
    this.exportTemporaryPaths.clear();
    void Promise.all(temporaryPaths.map(async path => {
      try { await this.removeTemporaryFile(path); } catch { /* Failed best-effort cleanup cannot block worker recovery. */ }
    })).then(() => {
      for (const [requestId, pending] of this.pending) {
        this.clearPending(requestId, pending);
        pending.reject(error);
      }
      const resolveExit = this.resolveWorkerExit;
      this.resolveWorkerExit = undefined;
      this.workerExit = undefined;
      resolveExit?.();
    });
  }

  private clearPending(requestId: string, pending: PendingRequest): void {
    clearTimeout(pending.timer);
    if (pending.abortListener && pending.cancellation) {
      pending.cancellation.removeEventListener('abort', pending.abortListener);
    }
    this.pending.delete(requestId);
  }

  private terminate(worker: UtilityProcess): Promise<void> {
    if (this.worker !== worker) return this.workerExit ?? Promise.resolve();
    const exitPromise = this.workerExit ?? new Promise<void>(resolveExit => { this.resolveWorkerExit = resolveExit; });
    this.workerExit = exitPromise;
    // DatabaseSync runs synchronously, so terminating the worker is the interrupt mechanism.
    // Any other in-flight request fails on exit; SQLite transactions retain crash atomicity.
    try { worker.kill(); } catch { /* The exit event owns final cleanup. */ }
    return exitPromise;
  }
}

function storeError(code: StorageWorkerErrorCode): HostTrustStoreError {
  if (code === 'CONFLICT') return new HostTrustStoreError('conflict');
  if (code === 'NOT_FOUND') return new HostTrustStoreError('not-found');
  if (code === 'INVALID_BUNDLE') return new HostTrustStoreError('invalid');
  return new HostTrustStoreError(code.toLowerCase() as 'busy' | 'corrupt' | 'unavailable');
}

function isFilePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 32_767 && !value.includes('\0') && isAbsolute(value);
}

function throwIfCancelled(cancellation?: CredentialPromptCancellation): void {
  if (cancellation?.aborted) throw new HostTrustStoreError('cancelled');
}

function createCancellationSource(): CancellationSource {
  let aborted = false;
  const listeners = new Set<() => void>();
  const token: CredentialPromptCancellation = {
    get aborted() { return aborted; },
    addEventListener(_type, listener) {
      if (aborted) { listener(); return; }
      listeners.add(listener);
    },
    removeEventListener(_type, listener) { listeners.delete(listener); }
  };
  return {
    token,
    cancel() {
      if (aborted) return;
      aborted = true;
      const pendingListeners = [...listeners];
      listeners.clear();
      for (const listener of pendingListeners) listener();
    }
  };
}

function awaitWithCancellation<T>(operation: Promise<T>, cancellation?: CredentialPromptCancellation): Promise<T> {
  if (!cancellation) return operation;
  if (cancellation.aborted) return Promise.reject(new HostTrustStoreError('cancelled'));
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      cancellation.removeEventListener('abort', abort);
      complete();
    };
    const abort = () => finish(() => reject(new HostTrustStoreError('cancelled')));
    cancellation.addEventListener('abort', abort, { once: true });
    operation.then(value => finish(() => resolve(value)), error => finish(() => reject(error instanceof Error ? error : new Error('Storage operation failed'))));
    if (cancellation.aborted) abort();
  });
}
