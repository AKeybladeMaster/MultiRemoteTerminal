import type { ErrorCode } from '../../domain/src/errors.ts';

export type StorageOperationKind = 'busy' | 'cancelled' | 'conflict' | 'corrupt' | 'invalid' | 'not-found' | 'unavailable';

export class StorageOperationError extends Error {
  readonly kind: StorageOperationKind;

  constructor(kind: StorageOperationKind) {
    super(`Storage operation ${kind}`);
    this.name = 'StorageOperationError';
    this.kind = kind;
  }
}

export function storageOperationErrorCode(error: unknown): ErrorCode | undefined {
  if (!(error instanceof StorageOperationError)) return undefined;
  switch (error.kind) {
    case 'busy': return 'BUSY';
    case 'cancelled': return 'CANCELLED';
    case 'conflict': return 'CONFLICT';
    case 'corrupt': return 'CORRUPT';
    case 'invalid': return 'INVALID_REQUEST';
    case 'not-found': return 'NOT_FOUND';
    case 'unavailable': return 'UNAVAILABLE';
  }
}
