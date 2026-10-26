import { failure } from '../../domain/src/errors.ts';
import type { ErrorCode, Outcome } from '../../domain/src/errors.ts';
import { isLocalTextFile, isLocalTextFileSaveResult, isLocalTextSelectionId } from '../../domain/src/local-text-file.ts';
import type { LocalTextFile, LocalTextFileSaveResult } from '../../domain/src/local-text-file.ts';
import { isRemoteTextRevision, remoteTextByteLength } from '../../domain/src/remote-text-file.ts';
import type { CancellationSignal } from './cancellation.ts';

export type LocalTextFileProviderErrorCode = 'INVALID_REQUEST' | 'UNAVAILABLE' | 'TIMEOUT' | 'BUSY' | 'NOT_FOUND' | 'CONFLICT' |
  'FORBIDDEN' | 'NOT_SUPPORTED' | 'OUTPUT_LIMIT' | 'CANCELLED';

export class LocalTextFileProviderError extends Error {
  readonly code: LocalTextFileProviderErrorCode;
  constructor(code: LocalTextFileProviderErrorCode) {
    super('Local text file operation failed');
    this.name = 'LocalTextFileProviderError';
    this.code = code;
  }
}

export interface LocalTextFilePayload {
  readonly fileName: string;
  readonly content: string;
  readonly revision: string;
  readonly bytes: number;
}

export interface LocalTextFileSelection {
  readonly absolutePath: string;
  readonly fileName: string;
}

export interface LocalTextFileProvider {
  read(absolutePath: string): Promise<LocalTextFilePayload>;
  save(absolutePath: string, content: string, expectedRevision: string): Promise<LocalTextFileSaveResult>;
  shutdown(): Promise<void>;
}

export interface LocalTextEditorController {
  open(cancellation?: CancellationSignal): Promise<Outcome<LocalTextFile>>;
  reload(selectionId: string, cancellation?: CancellationSignal): Promise<Outcome<LocalTextFile>>;
  save(selectionId: string, content: string, expectedRevision: string, cancellation?: CancellationSignal): Promise<Outcome<LocalTextFileSaveResult>>;
  close(selectionId: string): Outcome<Record<string, never>>;
  closeAll(): Promise<void>;
}

const EMPTY_RESULT: Record<string, never> = Object.freeze({});

export function createLocalTextEditorController(
  provider: LocalTextFileProvider,
  selectFile: () => Promise<LocalTextFileSelection | undefined>,
  makeId: () => string,
): LocalTextEditorController {
  let activeSelection: { readonly id: string; readonly absolutePath: string; readonly fileName: string; revision: string } | undefined;
  let operating = false;
  let disposed = false;
  let shutdownPromise: Promise<void> | undefined;

  async function run<T>(operation: () => Promise<Outcome<T>>): Promise<Outcome<T>> {
    if (disposed) return failure('CANCELLED');
    if (operating) return failure('BUSY');
    operating = true;
    try { return await operation(); }
    catch (error) { return failure(error instanceof LocalTextFileProviderError ? error.code : 'UNAVAILABLE'); }
    finally { operating = false; }
  }

  async function read(selectionId: string, absolutePath: string, fileName: string, cancellation?: CancellationSignal): Promise<Outcome<LocalTextFile>> {
    if (cancellation?.aborted) return failure('CANCELLED');
    let payload: LocalTextFilePayload;
    try { payload = await provider.read(absolutePath); }
    catch (error) { return providerFailure(error); }
    if (cancellation?.aborted) return failure('CANCELLED');
    if (payload.fileName !== fileName) return failure('UNAVAILABLE');
    const file: LocalTextFile = { selectionId, fileName, content: payload.content, revision: payload.revision, bytes: payload.bytes };
    if (!isLocalTextFile(file)) return failure('UNAVAILABLE');
    return { ok: true, result: file };
  }

  return {
    open(cancellation) {
      return run(async () => {
        if (cancellation?.aborted) return failure('CANCELLED');
        let selected: LocalTextFileSelection | undefined;
        try { selected = await selectFile(); }
        catch { return failure('UNAVAILABLE'); }
        if (!selected) return failure('CANCELLED');
        if (cancellation?.aborted) return failure('CANCELLED');
        if (typeof selected.absolutePath !== 'string' || selected.absolutePath.length === 0 || selected.absolutePath.includes('\0') ||
            typeof selected.fileName !== 'string' || selected.fileName.length === 0 || selected.fileName.length > 255 || /[\\/\0\r\n]/u.test(selected.fileName)) {
          return failure('INVALID_REQUEST');
        }
        const selectionId = makeId();
        if (!isLocalTextSelectionId(selectionId)) return failure('UNAVAILABLE');
        const result = await read(selectionId, selected.absolutePath, selected.fileName, cancellation);
        if (!result.ok) return result;
        activeSelection = { id: selectionId, absolutePath: selected.absolutePath, fileName: selected.fileName, revision: result.result.revision };
        return result;
      });
    },
    reload(selectionId, cancellation) {
      return run(async () => {
        const selected = activeSelection;
        if (!selected || selected.id !== selectionId) return failure('NOT_FOUND');
        const result = await read(selected.id, selected.absolutePath, selected.fileName, cancellation);
        if (result.ok && activeSelection === selected) selected.revision = result.result.revision;
        return result;
      });
    },
    save(selectionId, content, expectedRevision, cancellation) {
      return run<LocalTextFileSaveResult>(async () => {
        const selected = activeSelection;
        const bytes = typeof content === 'string' ? remoteTextByteLength(content) : undefined;
        if (!selected || selected.id !== selectionId) return failure('NOT_FOUND');
        if (bytes === undefined || !isRemoteTextRevision(expectedRevision)) return failure('INVALID_REQUEST');
        if (expectedRevision !== selected.revision) return failure('CONFLICT');
        if (cancellation?.aborted) return failure('CANCELLED');
        try {
          const result = await provider.save(selected.absolutePath, content, expectedRevision);
          if (!isLocalTextFileSaveResult(result) || result.bytesSaved !== bytes) return failure('UNAVAILABLE');
          if (cancellation?.aborted) return failure('CANCELLED');
          if (activeSelection === selected) selected.revision = result.revision;
          return { ok: true, result };
        } catch (error) { return providerFailure(error); }
      });
    },
    close(selectionId) {
      if (disposed) return failure('CANCELLED');
      if (operating) return failure('BUSY');
      if (!activeSelection || activeSelection.id !== selectionId) return failure('NOT_FOUND');
      activeSelection = undefined;
      return { ok: true, result: EMPTY_RESULT };
    },
    closeAll() {
      if (shutdownPromise) return shutdownPromise;
      disposed = true;
      activeSelection = undefined;
      shutdownPromise = provider.shutdown();
      return shutdownPromise;
    }
  };
}

function providerFailure(error: unknown): Outcome<never> {
  const code: ErrorCode = error instanceof LocalTextFileProviderError ? error.code : 'UNAVAILABLE';
  return failure(code);
}
