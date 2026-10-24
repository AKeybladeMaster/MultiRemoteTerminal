import { failure } from '../../domain/src/errors.ts';
import type { ErrorCode, Outcome } from '../../domain/src/errors.ts';
import { isMacroId, normalizeMacroDraft } from '../../domain/src/macro.ts';
import type { MacroDefinition, MacroDraft } from '../../domain/src/macro.ts';
import type { CancellationSignal } from './cancellation.ts';
import { StorageOperationError } from './storage-errors.ts';

export interface MacroCatalogStore {
  listMacros(cancellation?: CancellationSignal): Promise<readonly MacroDefinition[]>;
  createMacro(draft: MacroDraft, cancellation?: CancellationSignal): Promise<MacroDefinition>;
  updateMacro(id: string, draft: MacroDraft, cancellation?: CancellationSignal): Promise<MacroDefinition | undefined>;
  removeMacro(id: string, cancellation?: CancellationSignal): Promise<boolean>;
}

export interface MacroCatalog {
  list(cancellation?: CancellationSignal): Promise<Outcome<readonly MacroDefinition[]>>;
  create(draft: unknown, cancellation?: CancellationSignal): Promise<Outcome<MacroDefinition>>;
  update(id: unknown, draft: unknown, cancellation?: CancellationSignal): Promise<Outcome<MacroDefinition>>;
  remove(id: unknown, cancellation?: CancellationSignal): Promise<Outcome<Record<string, never>>>;
}

const EMPTY_RESULT: Record<string, never> = Object.freeze({});

export function createMacroCatalog(store: MacroCatalogStore): MacroCatalog {
  return {
    async list(cancellation?: CancellationSignal): Promise<Outcome<readonly MacroDefinition[]>> {
      if (cancellation?.aborted) return failure('CANCELLED');
      try { return { ok: true, result: await store.listMacros(cancellation) }; }
      catch (error) { return failure(errorCode(error)); }
    },
    async create(input: unknown, cancellation?: CancellationSignal): Promise<Outcome<MacroDefinition>> {
      const draft = normalizeMacroDraft(input);
      if (!draft) return failure('INVALID_REQUEST');
      if (cancellation?.aborted) return failure('CANCELLED');
      try { return { ok: true, result: await store.createMacro(draft, cancellation) }; }
      catch (error) { return failure(errorCode(error)); }
    },
    async update(id: unknown, input: unknown, cancellation?: CancellationSignal): Promise<Outcome<MacroDefinition>> {
      const draft = normalizeMacroDraft(input);
      if (!isMacroId(id) || !draft) return failure('INVALID_REQUEST');
      if (cancellation?.aborted) return failure('CANCELLED');
      try {
        const result = await store.updateMacro(id, draft, cancellation);
        return result ? { ok: true, result } : failure('NOT_FOUND');
      } catch (error) { return failure(errorCode(error)); }
    },
    async remove(id: unknown, cancellation?: CancellationSignal): Promise<Outcome<Record<string, never>>> {
      if (!isMacroId(id)) return failure('INVALID_REQUEST');
      if (cancellation?.aborted) return failure('CANCELLED');
      try { return await store.removeMacro(id, cancellation) ? { ok: true, result: EMPTY_RESULT } : failure('NOT_FOUND'); }
      catch (error) { return failure(errorCode(error)); }
    }
  };
}

function errorCode(error: unknown): ErrorCode {
  if (!(error instanceof StorageOperationError)) return 'UNAVAILABLE';
  if (error.kind === 'busy') return 'BUSY';
  if (error.kind === 'invalid') return 'INVALID_REQUEST';
  if (error.kind === 'cancelled') return 'CANCELLED';
  if (error.kind === 'conflict') return 'CONFLICT';
  if (error.kind === 'not-found') return 'NOT_FOUND';
  return 'UNAVAILABLE';
}
