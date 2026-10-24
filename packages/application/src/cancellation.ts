export interface CancellationSignal {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void, options?: { readonly once?: boolean }): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

export interface CancellationSource extends CancellationSignal {
  abort(): void;
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
