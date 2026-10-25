import { failure } from '../../domain/src/errors.ts';
import type { Outcome } from '../../domain/src/errors.ts';
import { canonicalizeVncEndpoint } from '../../domain/src/vnc.ts';
import type { VncEndpoint } from '../../domain/src/vnc.ts';
import type { CancellationSignal } from './cancellation.ts';

export type VncViewerErrorCode = 'UNAVAILABLE' | 'NOT_SUPPORTED' | 'CANCELLED';

export class VncViewerError extends Error {
  readonly code: VncViewerErrorCode;

  constructor(code: VncViewerErrorCode) {
    super('TigerVNC could not be started');
    this.name = 'VncViewerError';
    this.code = code;
  }
}

export interface VncViewerProvider {
  launch(endpoint: VncEndpoint, cancellation?: CancellationSignal): Promise<void>;
}

export interface VncLaunchResult {
  readonly provider: 'external';
  readonly endpoint: VncEndpoint;
  readonly state: 'launch-requested';
}

export interface VncViewerController {
  launch(host: string, port: number, cancellation?: CancellationSignal): Promise<Outcome<VncLaunchResult>>;
}

export function createVncViewerController(provider: VncViewerProvider): VncViewerController {
  return {
    async launch(host, port, cancellation) {
      if (cancellation?.aborted) return failure('CANCELLED');
      const endpoint = canonicalizeVncEndpoint({ host, port });
      if (!endpoint) return failure('INVALID_REQUEST');
      try {
        await provider.launch(endpoint, cancellation);
        return { ok: true, result: { provider: 'external', endpoint, state: 'launch-requested' } };
      } catch (error) {
        return failure(error instanceof VncViewerError ? error.code : 'UNAVAILABLE');
      }
    }
  };
}
