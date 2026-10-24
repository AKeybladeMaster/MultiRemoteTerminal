export type StorageOperationKind = 'busy' | 'cancelled' | 'conflict' | 'corrupt' | 'not-found' | 'unavailable';

export class StorageOperationError extends Error {
  readonly kind: StorageOperationKind;

  constructor(kind: StorageOperationKind) {
    super(`Storage operation ${kind}`);
    this.name = 'StorageOperationError';
    this.kind = kind;
  }
}
