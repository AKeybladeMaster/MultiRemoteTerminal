import { createWriteStream } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { isAbsolute, basename, extname } from 'node:path';
import { finished } from 'node:stream/promises';
import { performance } from 'node:perf_hooks';
import { failure } from '../../../../packages/domain/src/errors.ts';
import type { Outcome } from '../../../../packages/domain/src/errors.ts';
import { canonicalizeSshHostEndpoint } from '../../../../packages/domain/src/host-trust.ts';
import type { SshHostEndpoint } from '../../../../packages/domain/src/host-trust.ts';
import type { SshSessionActivity, SshSessionLogFinishReason, SshSessionLogStatus, SshSessionLogStopReason } from '../../../../packages/application/src/ssh-session-activity.ts';

export const SSH_SESSION_LOG_MAX_FILE_BYTES = 64 * 1024 * 1024;
export const SSH_SESSION_LOG_MAX_PENDING_BYTES = 1024 * 1024;
export const SSH_SESSION_LOG_IO_TIMEOUT_MS = 10_000;
const MAX_RECORD_CHARS = 16_384;
const FINAL_RECORD_RESERVE = 512;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function waitForSshSessionLogStream<T>(operation: Promise<T>, stream: WriteStream,
  timeoutMs = SSH_SESSION_LOG_IO_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => { stream.destroy(); reject(new Error('SSH session log I/O timed out')); }, timeoutMs);
    timer.unref?.();
  });
  return Promise.race([operation, timeout]).finally(() => clearTimeout(timer));
}

interface ActiveLog {
  readonly sessionId: string;
  readonly fileName: string;
  readonly stream: WriteStream;
  readonly startedAt: number;
  readonly endpoints: readonly SshHostEndpoint[];
  bytesQueued: number;
  finishing?: Promise<void>;
}

export interface SshSessionLogWriter {
  start(sessionId: string, path: string, endpoints: readonly SshHostEndpoint[]): Promise<Outcome<{ readonly fileName: string }>>;
  append(activity: SshSessionActivity): void;
  finish(sessionId: string, reason: SshSessionLogFinishReason): Promise<void>;
  closeAll(): Promise<void>;
}

export function createSshSessionLogWriter(
  onStatus: (status: SshSessionLogStatus) => void = () => {},
  maxFileBytes = SSH_SESSION_LOG_MAX_FILE_BYTES,
): SshSessionLogWriter {
  const active = new Map<string, ActiveLog>();

  function line(log: ActiveLog, record: Record<string, unknown>): string {
    return `${JSON.stringify({ version: 1, timestamp: new Date().toISOString(), elapsedMs: Math.max(0, Math.round(performance.now() - log.startedAt)),
      sessionId: log.sessionId, ...record })}\n`;
  }

  function enqueue(log: ActiveLog, text: string, reserveFinal: boolean): boolean {
    const byteLength = Buffer.byteLength(text, 'utf8');
    if (log.bytesQueued + byteLength + (reserveFinal ? FINAL_RECORD_RESERVE : 0) > maxFileBytes) return false;
    if (log.stream.writableLength + byteLength > SSH_SESSION_LOG_MAX_PENDING_BYTES) return false;
    log.bytesQueued += byteLength;
    log.stream.write(text, 'utf8');
    return true;
  }

  async function finalize(log: ActiveLog, reason: SshSessionLogFinishReason, status?: SshSessionLogStopReason): Promise<void> {
    if (log.finishing) return log.finishing;
    log.finishing = (async () => {
      const finalLine = line(log, { type: 'log-finished', reason });
      if (log.stream.writableLength + Buffer.byteLength(finalLine, 'utf8') <= SSH_SESSION_LOG_MAX_PENDING_BYTES &&
          log.bytesQueued + Buffer.byteLength(finalLine, 'utf8') <= maxFileBytes) {
        log.bytesQueued += Buffer.byteLength(finalLine, 'utf8');
        log.stream.end(finalLine, 'utf8');
      } else log.stream.end();
      try { await waitForSshSessionLogStream(finished(log.stream), log.stream); } catch { status = 'write-error'; }
      if (active.get(log.sessionId) === log) active.delete(log.sessionId);
      try {
        if (status) onStatus({ sessionId: log.sessionId, status: 'stopped', reason: status, fileName: log.fileName });
        else if (reason === 'connection-failed' || reason === 'session-closed' || reason === 'session-exited' || reason === 'application-shutdown') {
          onStatus({ sessionId: log.sessionId, status: 'finished', reason, fileName: log.fileName });
        } else onStatus({ sessionId: log.sessionId, status: 'stopped', reason: 'write-error', fileName: log.fileName });
      } catch { /* UI status cannot interrupt file cleanup. */ }
    })();
    return log.finishing;
  }

  return Object.freeze({
    async start(sessionId: string, path: string, endpoints: readonly SshHostEndpoint[]): Promise<Outcome<{ readonly fileName: string }>> {
      const normalized = Array.isArray(endpoints) ? endpoints.map(canonicalizeSshHostEndpoint) : undefined;
      if (!SESSION_ID.test(sessionId) || active.has(sessionId) || !isAbsolute(path) || extname(path).toLowerCase() !== '.log' ||
          !normalized || normalized.length < 1 || normalized.length > 4 || normalized.some(endpoint => endpoint === undefined)) {
        return failure(active.has(sessionId) ? 'BUSY' : 'INVALID_REQUEST');
      }
      const stream = createWriteStream(path, { flags: 'w', mode: 0o600, highWaterMark: 64 * 1024 });
      const log: ActiveLog = { sessionId, fileName: basename(path), stream, startedAt: performance.now(), endpoints: normalized as SshHostEndpoint[], bytesQueued: 0 };
      active.set(sessionId, log);
      stream.on('error', () => { void finalize(log, 'write-error', 'write-error'); });
      try {
        await waitForSshSessionLogStream(new Promise<void>((resolve, reject) => {
          stream.once('open', () => resolve());
          stream.once('error', reject);
        }), stream);
        const header = line(log, { type: 'attempt-started', target: log.endpoints.at(-1), gateways: log.endpoints.slice(0, -1) });
        if (!enqueue(log, header, true)) throw new Error('log start record exceeds limits');
        return { ok: true, result: { fileName: log.fileName } };
      } catch {
        active.delete(sessionId);
        stream.destroy();
        return failure('UNAVAILABLE');
      }
    },
    append(activity: SshSessionActivity): void {
      const log = active.get(activity.sessionId);
      if (!log || log.finishing) return;
      if ('data' in activity && (typeof activity.data !== 'string' || activity.data.length > MAX_RECORD_CHARS)) {
        void finalize(log, 'record-limit', 'record-limit');
        return;
      }
      const record = { ...activity } as unknown as Record<string, unknown>;
      delete record.sessionId;
      const text = line(log, record);
      const byteLength = Buffer.byteLength(text, 'utf8');
      if (log.stream.writableLength + byteLength > SSH_SESSION_LOG_MAX_PENDING_BYTES) {
        void finalize(log, 'queue-limit', 'queue-limit');
        return;
      }
      if (!enqueue(log, text, true)) {
        void finalize(log, 'file-size-limit', 'file-size-limit');
        return;
      }
      if (activity.type === 'connection-failed') void finalize(log, 'connection-failed');
      else if (activity.type === 'session-closed') void finalize(log, 'session-closed');
      else if (activity.type === 'session-exited') void finalize(log, 'session-exited');
    },
    async finish(sessionId: string, reason: SshSessionLogFinishReason): Promise<void> {
      const log = active.get(sessionId);
      if (log) await finalize(log, reason);
    },
    async closeAll(): Promise<void> {
      await Promise.all([...active.values()].map(log => finalize(log, 'application-shutdown')));
    }
  });
}
