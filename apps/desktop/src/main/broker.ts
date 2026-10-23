import { isAppDocument, parseRequest, requestIdOf } from '../../../../packages/contracts/src/commands.ts';
import type { DescribeReply } from '../../../../packages/contracts/src/commands.ts';
import type { WorkbenchSnapshot } from '../../../../packages/application/src/workbench.ts';
import { failure } from '../../../../packages/domain/src/errors.ts';

export interface CommandSender {
  readonly owned: boolean;
  readonly mainFrame: boolean;
  readonly url: string;
}

export interface AuditEvent {
  readonly kind: 'ipc.rejected' | 'application.unavailable';
  readonly code: string;
}

// One synchronous read-only operation: no queue, secret, external I/O, or background task.
export function dispatchCommand(sender: CommandSender, input: unknown,
  describe: () => WorkbenchSnapshot, audit: (event: AuditEvent) => void): DescribeReply {
  if (!sender.owned || !sender.mainFrame || !isAppDocument(sender.url)) {
    audit({ kind: 'ipc.rejected', code: 'FORBIDDEN' });
    return { requestId: '', ...failure('FORBIDDEN') };
  }
  const parsed = parseRequest(input);
  if (!parsed.ok) {
    audit({ kind: 'ipc.rejected', code: parsed.error.code });
    return { requestId: requestIdOf(input), ...parsed };
  }
  const { requestId } = parsed.result;
  try {
    return { requestId, ok: true, result: describe() };
  } catch {
    audit({ kind: 'application.unavailable', code: 'UNAVAILABLE' });
    return { requestId, ...failure('UNAVAILABLE') };
  }
}
