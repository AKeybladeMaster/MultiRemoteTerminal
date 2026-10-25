import { failure } from '../../domain/src/errors.ts';
import type { Outcome } from '../../domain/src/errors.ts';
import { canonicalizeRdpEndpoint } from '../../domain/src/rdp.ts';
import type { RdpEndpoint } from '../../domain/src/rdp.ts';
import type { CancellationSignal } from './cancellation.ts';

export type RdpViewerErrorCode = 'UNAVAILABLE' | 'NOT_SUPPORTED' | 'CANCELLED';

export class RdpViewerError extends Error {
  readonly code: RdpViewerErrorCode;

  constructor(code: RdpViewerErrorCode) {
    super('Windows Remote Desktop could not be started');
    this.name = 'RdpViewerError';
    this.code = code;
  }
}

export interface RdpViewerProvider {
  launch(endpoint: RdpEndpoint, cancellation?: CancellationSignal): Promise<void>;
}

export interface RdpLaunchResult {
  readonly provider: 'external';
  readonly endpoint: RdpEndpoint;
  readonly state: 'launch-requested';
}

export interface RdpViewerController {
  launch(host: string, port: number, cancellation?: CancellationSignal): Promise<Outcome<RdpLaunchResult>>;
}

export function createRdpViewerController(provider: RdpViewerProvider): RdpViewerController {
  return {
    async launch(host, port, cancellation) {
      if (cancellation?.aborted) return failure('CANCELLED');
      const endpoint = canonicalizeRdpEndpoint({ host, port });
      if (!endpoint) return failure('INVALID_REQUEST');
      try {
        await provider.launch(endpoint, cancellation);
        return { ok: true, result: { provider: 'external', endpoint, state: 'launch-requested' } };
      } catch (error) {
        return failure(error instanceof RdpViewerError ? error.code : 'UNAVAILABLE');
      }
    }
  };
}
