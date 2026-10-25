import { failure } from '../../domain/src/errors.ts';
import type { AppError, Outcome } from '../../domain/src/errors.ts';
import { normalizeMultiExecRequest } from '../../domain/src/multi-exec.ts';
import type { MultiExecRequest } from '../../domain/src/multi-exec.ts';
import { createCancellationSource } from './cancellation.ts';
import type { CancellationSignal } from './cancellation.ts';

const MAX_CONCURRENT_WRITES = 4;

export type MultiExecTargetStatus = 'queued' | 'sending' | 'sent' | 'uncertain' | 'failed' | 'not-sent';

export interface MultiExecTargetResult {
  readonly targetSessionId: string;
  readonly status: MultiExecTargetStatus;
  readonly error?: AppError;
}

export type MultiExecRunResult =
  | { readonly status: 'completed'; readonly targets: readonly MultiExecTargetResult[] }
  | { readonly status: 'cancelled'; readonly targets: readonly MultiExecTargetResult[] }
  | { readonly status: 'failed'; readonly error: AppError; readonly targets: readonly MultiExecTargetResult[] };

/** The adapter is limited to already-running terminal sessions; it cannot open or retarget a connection. */
export interface MultiExecRuntime {
  isTargetReady(sessionId: string): boolean;
  /** Resolves after the terminal input operation replies; it does not mean the shell command completed. */
  sendLine(sessionId: string, line: string): Promise<Outcome<void>>;
}

export interface MultiExecCallbacks {
  /** Must show the exact line and all selected destinations, then resolve only after explicit approval. */
  confirm: (review: MultiExecRequest, cancellation: CancellationSignal) => Promise<boolean>;
  readonly onTargetsChanged?: (targets: readonly MultiExecTargetResult[]) => void;
}

export interface MultiExecRunner {
  /** The caller supplies the reviewed request and explicit confirmation callback for each run. */
  run(input: unknown, callbacks: MultiExecCallbacks): Promise<MultiExecRunResult>;
  /** Stops scheduling targets that have not started; already-sent terminal writes cannot be retracted. */
  cancel(): void;
}

interface ActiveRun {
  readonly cancellation: ReturnType<typeof createCancellationSource>;
  readonly targets: MultiExecTargetResult[];
}

function snapshot(targets: readonly MultiExecTargetResult[]): readonly MultiExecTargetResult[] {
  return targets.map(target => ({ ...target }));
}

function notify(callbacks: MultiExecCallbacks, targets: readonly MultiExecTargetResult[]): void {
  try { callbacks.onTargetsChanged?.(snapshot(targets)); } catch { /* Progress presentation cannot change delivery. */ }
}

function isReady(runtime: MultiExecRuntime, sessionId: string): boolean {
  try { return runtime.isTargetReady(sessionId); }
  catch { return false; }
}

function waitForApproval(run: ActiveRun, callbacks: MultiExecCallbacks, request: MultiExecRequest): Promise<boolean> {
  if (run.cancellation.aborted) return Promise.resolve(false);
  return new Promise(resolve => {
    let settled = false;
    const finish = (approved: boolean) => {
      if (settled) return;
      settled = true;
      run.cancellation.removeEventListener('abort', onAbort);
      resolve(approved);
    };
    const onAbort = () => finish(false);
    run.cancellation.addEventListener('abort', onAbort, { once: true });
    Promise.resolve().then(() => callbacks.confirm(request, run.cancellation)).then(finish, () => finish(false));
    if (run.cancellation.aborted) onAbort();
  });
}

export function createMultiExecRunner(runtime: MultiExecRuntime): MultiExecRunner {
  let activeRun: ActiveRun | undefined;

  return Object.freeze({
    async run(input: unknown, callbacks: MultiExecCallbacks): Promise<MultiExecRunResult> {
      if (activeRun) return { status: 'failed', error: failure('BUSY').error, targets: [] };
      const request = normalizeMultiExecRequest(input);
      if (!request || !callbacks || typeof callbacks.confirm !== 'function') {
        return { status: 'failed', error: failure('INVALID_REQUEST').error, targets: [] };
      }

      const run: ActiveRun = {
        cancellation: createCancellationSource(),
        targets: request.targetSessionIds.map(targetSessionId => ({ targetSessionId, status: 'queued' }))
      };
      activeRun = run;

      try {
        if (!await waitForApproval(run, callbacks, request) || run.cancellation.aborted) {
          for (let index = 0; index < run.targets.length; index++) {
            run.targets[index] = { targetSessionId: request.targetSessionIds[index]!, status: 'not-sent' };
          }
          notify(callbacks, run.targets);
          return { status: 'cancelled', targets: snapshot(run.targets) };
        }

        let nextTarget = 0;
        const sendNext = async (): Promise<void> => {
          while (!run.cancellation.aborted) {
            const index = nextTarget++;
            if (index >= request.targetSessionIds.length) return;
            const targetSessionId = request.targetSessionIds[index]!;
            if (run.cancellation.aborted) {
              run.targets[index] = { targetSessionId, status: 'not-sent' };
              notify(callbacks, run.targets);
              return;
            }

            run.targets[index] = { targetSessionId, status: 'sending' };
            notify(callbacks, run.targets);
            if (!isReady(runtime, targetSessionId)) {
              run.targets[index] = { targetSessionId, status: 'failed', error: failure('UNAVAILABLE', 'terminal').error };
              notify(callbacks, run.targets);
              continue;
            }

            try {
              const result = await runtime.sendLine(targetSessionId, `${request.line}\r`);
              if (result.ok) run.targets[index] = { targetSessionId, status: 'sent' };
              else run.targets[index] = {
                targetSessionId,
                status: result.error.code === 'TIMEOUT' || result.error.code === 'UNAVAILABLE' ? 'uncertain' : 'failed',
                error: result.error
              };
            } catch {
              run.targets[index] = { targetSessionId, status: 'uncertain', error: failure('UNAVAILABLE', 'terminal').error };
            }
            notify(callbacks, run.targets);
          }
        };

        await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_WRITES, request.targetSessionIds.length) }, () => sendNext()));
        for (let index = 0; index < run.targets.length; index++) {
          if (run.targets[index]?.status === 'queued') {
            run.targets[index] = { targetSessionId: request.targetSessionIds[index]!, status: 'not-sent' };
          }
        }
        if (run.targets.some(target => target.status === 'not-sent')) {
          notify(callbacks, run.targets);
          return { status: 'cancelled', targets: snapshot(run.targets) };
        }
        return { status: 'completed', targets: snapshot(run.targets) };
      } catch {
        return { status: 'failed', error: failure('UNAVAILABLE').error, targets: snapshot(run.targets) };
      } finally {
        run.cancellation.abort();
        if (activeRun === run) activeRun = undefined;
      }
    },
    cancel(): void {
      activeRun?.cancellation.abort();
    }
  });
}
