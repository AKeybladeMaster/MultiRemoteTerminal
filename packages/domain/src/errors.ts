export type ErrorCode = 'INVALID_REQUEST' | 'UNKNOWN_COMMAND' | 'FORBIDDEN' | 'UNAVAILABLE' | 'NOT_SUPPORTED' | 'TIMEOUT' | 'BUSY' | 'NOT_FOUND' | 'CONFLICT' | 'CORRUPT' | 'CANCELLED' | 'OUTPUT_LIMIT' |
  'AUTHENTICATION_FAILED' | 'HOST_KEY_REJECTED' | 'HOST_KEY_CHANGED';
export type ErrorTarget = 'application' | 'terminal';

export interface AppError {
  readonly code: ErrorCode;
  readonly target: ErrorTarget;
  readonly retryable: boolean;
}

export type Outcome<T> = { readonly ok: true; readonly result: T } | { readonly ok: false; readonly error: AppError };

export function failure(code: ErrorCode, target: ErrorTarget = 'application'): { readonly ok: false; readonly error: AppError } {
  return { ok: false, error: { code, target, retryable: code === 'UNAVAILABLE' || code === 'TIMEOUT' || code === 'BUSY' ||
    code === 'AUTHENTICATION_FAILED' || code === 'HOST_KEY_REJECTED' } };
}
