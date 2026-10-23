import { isAppDocument, parseRequest, requestIdOf } from '../../../../packages/contracts/src/commands.ts';
import type { CommandReply } from '../../../../packages/contracts/src/commands.ts';
import type { LocalTerminalController } from '../../../../packages/application/src/local-terminals.ts';
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

export interface CommandActions {
  readonly describe: () => WorkbenchSnapshot;
  readonly noteUserActivity: () => void;
  readonly terminals: Pick<LocalTerminalController, 'open' | 'write' | 'resize' | 'acknowledgeOutput' | 'close'>;
}

export async function dispatchCommand(
  sender: CommandSender,
  input: unknown,
  actions: CommandActions,
  audit: (event: AuditEvent) => void,
): Promise<CommandReply<unknown>> {
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
    if (parsed.result.command === 'terminal.open' || parsed.result.command === 'terminal.write' ||
        parsed.result.command === 'terminal.close') actions.noteUserActivity();
    switch (parsed.result.command) {
      case 'app.describe': return { requestId, ok: true, result: actions.describe() };
      case 'terminal.open': {
        const { sessionId, shell, columns, rows } = parsed.result.payload;
        return { requestId, ...await actions.terminals.open(sessionId, shell, { columns, rows }) };
      }
      case 'terminal.write': {
        const { sessionId, data } = parsed.result.payload;
        return { requestId, ...await actions.terminals.write(sessionId, data) };
      }
      case 'terminal.resize': {
        const { sessionId, columns, rows } = parsed.result.payload;
        return { requestId, ...await actions.terminals.resize(sessionId, { columns, rows }) };
      }
      case 'terminal.ack': {
        const { sessionId, sequence } = parsed.result.payload;
        return { requestId, ...await actions.terminals.acknowledgeOutput(sessionId, sequence) };
      }
      case 'terminal.close': {
        return { requestId, ...await actions.terminals.close(parsed.result.payload.sessionId) };
      }
    }
  } catch {
    audit({ kind: 'application.unavailable', code: 'UNAVAILABLE' });
    return { requestId, ...failure('UNAVAILABLE') };
  }
}
