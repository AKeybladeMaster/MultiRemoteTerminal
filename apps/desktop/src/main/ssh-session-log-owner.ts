import type { SshSessionActivity, SshSessionLogFinishReason } from '../../../../packages/application/src/ssh-session-activity.ts';
import type { SshSessionLogFailurePhase } from '../../../../packages/application/src/ssh-session-activity.ts';

export interface PendingSshSessionLog {
  readonly senderId: number;
  readonly timer: ReturnType<typeof setTimeout>;
}

export interface SshSessionLogOwner {
  readonly senderId: number;
  phase: SshSessionLogFailurePhase;
  opened: boolean;
}

export interface SshSessionLogFinalizer {
  append(activity: SshSessionActivity): void;
  finish(sessionId: string, reason: SshSessionLogFinishReason): Promise<void>;
}

export function finishSshSessionLogsOwnedBy(senderId: number, pendingBySessionId: Map<string, PendingSshSessionLog>,
  ownerBySessionId: Map<string, SshSessionLogOwner>, writer: SshSessionLogFinalizer): void {
  for (const [sessionId, owner] of ownerBySessionId) {
    if (owner.senderId !== senderId) continue;
    const pending = pendingBySessionId.get(sessionId);
    if (pending) {
      clearTimeout(pending.timer);
      pendingBySessionId.delete(sessionId);
      writer.append({ type: 'connection-failed', sessionId, phase: 'preflight', code: 'CANCELLED' });
      void writer.finish(sessionId, 'connection-failed');
    } else if (owner.opened) void writer.finish(sessionId, 'session-closed');
    else {
      writer.append({ type: 'connection-failed', sessionId, phase: owner.phase, code: 'CANCELLED' });
      void writer.finish(sessionId, 'connection-failed');
    }
  }
}

export function observeSshSessionLogActivity(activity: SshSessionActivity, ownerBySessionId: Map<string, SshSessionLogOwner>): void {
  const owner = ownerBySessionId.get(activity.sessionId);
  if (!owner) return;
  if (activity.type === 'credential-prompt-started') owner.phase = 'credential-prompt';
  else if (activity.type === 'host-trust') owner.phase = 'host-trust';
  else if (activity.type === 'transport') {
    owner.phase = 'transport';
    if (activity.outcome === 'ready') owner.opened = true;
  } else if (activity.type === 'connection-failed') owner.phase = activity.phase;
}
