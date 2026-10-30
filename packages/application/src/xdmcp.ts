import type { CancellationSignal } from './cancellation.ts';
import { failure } from '../../domain/src/errors.ts';
import type { Outcome } from '../../domain/src/errors.ts';
import { canonicalizeXdmcpHost } from '../../domain/src/xdmcp.ts';

export class XdmcpProviderError extends Error {
  readonly code: 'UNAVAILABLE' | 'NOT_SUPPORTED' | 'CANCELLED';

  constructor(code: XdmcpProviderError['code']) {
    super('XDMCP launch failed');
    this.name = 'XdmcpProviderError';
    this.code = code;
  }
}

export interface XdmcpProvider {
  launch(sessionId: string, host: string, cancellation?: CancellationSignal): Promise<void>;
}

export interface XdmcpController {
  launch(requestId: string, host: string, cancellation?: CancellationSignal): Promise<Outcome<Record<string, never>>>;
}

const EMPTY_RESULT: Record<string, never> = Object.freeze({});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function createXdmcpController(provider: XdmcpProvider): XdmcpController {
  return Object.freeze({
    async launch(requestId: string, host: string, cancellation?: CancellationSignal): Promise<Outcome<Record<string, never>>> {
      const canonicalHost = canonicalizeXdmcpHost(host);
      if (!UUID.test(requestId) || !canonicalHost) return failure('INVALID_REQUEST');
      if (cancellation?.aborted) return failure('CANCELLED');
      try {
        await provider.launch(requestId, canonicalHost, cancellation);
        return cancellation?.aborted ? failure('CANCELLED') : { ok: true, result: EMPTY_RESULT };
      } catch (error) {
        return failure(error instanceof XdmcpProviderError ? error.code : 'UNAVAILABLE');
      }
    }
  });
}
