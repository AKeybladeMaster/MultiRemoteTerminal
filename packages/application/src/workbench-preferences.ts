import { failure } from '../../domain/src/errors.ts';
import type { ErrorCode, Outcome } from '../../domain/src/errors.ts';
import { normalizeWorkbenchPreferences } from '../../domain/src/workbench-preferences.ts';
import type { WorkbenchPreferences } from '../../domain/src/workbench-preferences.ts';
import type { CancellationSignal } from './cancellation.ts';
import { StorageOperationError } from './storage-errors.ts';

/**
 * Local-profile persistence port for the exact workbench preference schema.
 *
 * Success: reads return the stored normalized value or an empty greeting when the row is absent; saves atomically upsert and return the normalized value.
 * Cancellation: an already-aborted signal rejects without a request. In-flight cancellation is forwarded to the worker and settles after worker termination and cleanup.
 * Timeout: the SQLite adapter bounds ordinary requests to eight seconds and worker startup to five seconds; a request timeout is reported as `busy` after worker cleanup.
 * Authentication: these settings require no authentication and accept no credentials.
 * State: reads do not mutate state; saves change only the `workbench` settings row, not session or terminal state.
 * Resource ownership: the adapter and storage worker own the database connection; callers own their cancellation signal and receive only the preference value.
 */
export interface WorkbenchPreferencesStore {
  readWorkbenchPreferences(cancellation?: CancellationSignal): Promise<WorkbenchPreferences>;
  saveWorkbenchPreferences(preferences: WorkbenchPreferences, cancellation?: CancellationSignal): Promise<WorkbenchPreferences>;
}

export interface WorkbenchPreferencesManager {
  read(cancellation?: CancellationSignal): Promise<Outcome<WorkbenchPreferences>>;
  save(value: unknown, cancellation?: CancellationSignal): Promise<Outcome<WorkbenchPreferences>>;
}

export function createWorkbenchPreferencesManager(store: WorkbenchPreferencesStore): WorkbenchPreferencesManager {
  return {
    async read(cancellation?: CancellationSignal): Promise<Outcome<WorkbenchPreferences>> {
      if (cancellation?.aborted) return failure('CANCELLED');
      try { return { ok: true, result: await store.readWorkbenchPreferences(cancellation) }; }
      catch (error) { return failure(storageErrorCode(error)); }
    },
    async save(value: unknown, cancellation?: CancellationSignal): Promise<Outcome<WorkbenchPreferences>> {
      const preferences = normalizeWorkbenchPreferences(value);
      if (!preferences) return failure('INVALID_REQUEST');
      if (cancellation?.aborted) return failure('CANCELLED');
      try { return { ok: true, result: await store.saveWorkbenchPreferences(preferences, cancellation) }; }
      catch (error) { return failure(storageErrorCode(error)); }
    }
  };
}

function storageErrorCode(error: unknown): ErrorCode {
  if (!(error instanceof StorageOperationError)) return 'UNAVAILABLE';
  if (error.kind === 'busy') return 'BUSY';
  if (error.kind === 'invalid') return 'INVALID_REQUEST';
  if (error.kind === 'cancelled') return 'CANCELLED';
  if (error.kind === 'conflict') return 'CONFLICT';
  if (error.kind === 'corrupt') return 'CORRUPT';
  if (error.kind === 'not-found') return 'NOT_FOUND';
  return 'UNAVAILABLE';
}
