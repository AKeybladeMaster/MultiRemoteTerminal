import { CONTRACT_VERSION, isDescribeReply } from '../../../../packages/contracts/src/commands.ts';
import type { DescribeRequest, DescribeReply, DesktopBridge } from '../../../../packages/contracts/src/commands.ts';
import { failure } from '../../../../packages/domain/src/errors.ts';

// Internal transport seam: one outstanding IPC, a bounded wait, and validated/redacted replies.
export function createBridge(invoke: (request: DescribeRequest) => Promise<unknown>, makeId: () => string): DesktopBridge {
  let inFlight = false;
  return Object.freeze({
    async describe(): Promise<DescribeReply> {
      const requestId = makeId();
      if (inFlight) return { requestId, ...failure('BUSY') };
      inFlight = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const received = Promise.resolve().then(() => invoke({ command: 'app.describe', requestId, contractVersion: CONTRACT_VERSION, payload: {} }))
        .then(reply => isDescribeReply(reply, requestId) ? reply : { requestId, ...failure('UNAVAILABLE') },
          () => ({ requestId, ...failure('UNAVAILABLE') }))
        .finally(() => { inFlight = false; });
      try {
        return await Promise.race([received,
          new Promise<DescribeReply>(resolve => { timer = setTimeout(() => resolve({ requestId, ...failure('TIMEOUT') }), 3000); })]);
      } finally {
        // A timed-out invocation still owns the slot until it settles; repeated calls cannot grow an IPC queue.
        clearTimeout(timer);
      }
    }
  });
}
