export type ErrorCode = 'INVALID_REQUEST' | 'UNKNOWN_COMMAND' | 'FORBIDDEN' | 'UNAVAILABLE' | 'TIMEOUT' | 'BUSY';

export interface AppError {
  readonly code: ErrorCode;
  readonly target: 'application';
  readonly retryable: boolean;
}

export type Outcome<T> = { readonly ok: true; readonly result: T } | { readonly ok: false; readonly error: AppError };

export function failure(code: ErrorCode): { readonly ok: false; readonly error: AppError } {
  return { ok: false, error: { code, target: 'application', retryable: code === 'UNAVAILABLE' || code === 'TIMEOUT' || code === 'BUSY' } };
}
