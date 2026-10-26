export interface CancellationSignal {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void, options?: { readonly once?: boolean }): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

export interface CancellationSource extends CancellationSignal {
  abort(): void;
}

/** Stops waiting for an operation when cancelled without cancelling the underlying work. */
export function awaitWithCancellation<T>(operation: Promise<T>, cancellation: CancellationSignal | undefined,
  cancellationError: () => Error): Promise<T> {
  if (!cancellation) return operation;
  if (cancellation.aborted) return Promise.reject(cancellationError());
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (rejected: boolean, result: unknown): void => {
      if (settled) return;
      settled = true;
      cancellation.removeEventListener('abort', onAbort);
      if (rejected) reject(result);
      else resolve(result as T);
    };
    const onAbort = (): void => finish(true, cancellationError());
    cancellation.addEventListener('abort', onAbort, { once: true });
    if (cancellation.aborted) { onAbort(); return; }
    operation.then(value => finish(false, value), error => finish(true, error));
  });
}

export function createCancellationSource(): CancellationSource {
  let aborted = false;
  const listeners = new Set<() => void>();
  return Object.freeze({
    get aborted() { return aborted; },
    addEventListener(type: 'abort', listener: () => void) {
      void type;
      if (!aborted) listeners.add(listener);
    },
    removeEventListener(type: 'abort', listener: () => void) {
      void type;
      listeners.delete(listener);
    },
    abort() {
      if (aborted) return;
      aborted = true;
      const current = [...listeners];
      listeners.clear();
      for (const listener of current) {
        try { listener(); } catch { /* Cancellation must reach every registered owner. */ }
      }
    }
  });
}
