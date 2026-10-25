import { failure } from '../../domain/src/errors.ts';
import type { AppError, Outcome } from '../../domain/src/errors.ts';
import { isMacroDefinition } from '../../domain/src/macro.ts';
import type { MacroStep } from '../../domain/src/macro.ts';
import { createCancellationSource } from './cancellation.ts';
import type { CancellationSignal } from './cancellation.ts';

const MAX_WAIT_OUTPUT_CHARS = 65_536;
const TERMINAL_TEXT_CHUNK_CHARS = 4_096;

export type MacroRunPhase = 'sending' | 'waiting' | 'delaying' | 'confirming' | 'step-complete';

export interface MacroRunProgress {
  readonly targetSessionId: string;
  readonly stepNumber: number;
  readonly stepCount: number;
  readonly step: MacroStep;
  readonly phase: MacroRunPhase;
}

export type MacroRunResult =
  | { readonly status: 'completed' }
  | { readonly status: 'cancelled' }
  | { readonly status: 'failed'; readonly error: AppError };

export interface MacroRunnerRuntime {
  isTargetReady(sessionId: string): boolean;
  /** Sends one authored line, including its Enter key, through the existing terminal command. */
  sendLine(sessionId: string, line: string): Promise<Outcome<void>>;
  /** Schedules a bounded timeout and returns an idempotent cancellation function. */
  scheduleTimeout(callback: () => void, delayMs: number): () => void;
}

export interface MacroRunnerCallbacks {
  readonly onProgress?: (progress: MacroRunProgress) => void;
  readonly confirm: (message: string, cancellation: CancellationSignal) => Promise<boolean>;
}

export interface MacroRunner {
  run(macro: unknown, targetSessionId: string, callbacks: MacroRunnerCallbacks): Promise<MacroRunResult>;
  cancel(): void;
  observeOutput(sessionId: string, data: string): void;
  disconnect(sessionId: string): void;
}

interface OutputWaiter {
  readonly text: string;
  readonly complete: () => void;
}

interface ActiveRun {
  readonly sessionId: string;
  readonly cancellation: ReturnType<typeof createCancellationSource>;
  readonly textReader: TerminalTextReader;
  outputText: string;
  waiter: OutputWaiter | undefined;
  cancelError?: AppError;
}

type WaitResult = 'matched' | 'timeout' | 'cancelled';

type ControlMode = 'text' | 'escape' | 'csi' | 'osc' | 'osc-escape' | 'control-string' | 'control-string-escape';

/** Removes terminal controls as output arrives and retains no control-string payload. */
function createTerminalTextReader(onText: (text: string) => void): TerminalTextReader {
  let mode: ControlMode = 'text';
  let chunk = '';
  let previousWasCarriageReturn = false;

  function flush(): void {
    if (!chunk) return;
    onText(chunk);
    chunk = '';
  }

  function append(character: string): void {
    if (character === '\r') {
      chunk += '\n';
      previousWasCarriageReturn = true;
    } else if (character === '\n') {
      if (!previousWasCarriageReturn) chunk += '\n';
      previousWasCarriageReturn = false;
    } else {
      chunk += character;
      previousWasCarriageReturn = false;
    }
    if (chunk.length >= TERMINAL_TEXT_CHUNK_CHARS) flush();
  }

  return {
    push(data: string): void {
      for (const character of data) {
        if (mode === 'escape') {
          if (character === '[') mode = 'csi';
          else if (character === ']') mode = 'osc';
          else if (character === 'P' || character === 'X' || character === '^' || character === '_') mode = 'control-string';
          else mode = 'text';
          continue;
        }
        if (mode === 'csi') {
          if (character === '\u009c' || (character >= '@' && character <= '~')) mode = 'text';
          continue;
        }
        if (mode === 'osc') {
          if (character === '\u0007' || character === '\u009c') mode = 'text';
          else if (character === '\u001b') mode = 'osc-escape';
          continue;
        }
        if (mode === 'osc-escape') {
          mode = character === '\\' || character === '\u009c' ? 'text' : character === '\u001b' ? 'osc-escape' : 'osc';
          continue;
        }
        if (mode === 'control-string') {
          if (character === '\u009c') mode = 'text';
          else if (character === '\u001b') mode = 'control-string-escape';
          continue;
        }
        if (mode === 'control-string-escape') {
          mode = character === '\\' || character === '\u009c' ? 'text' : character === '\u001b' ? 'control-string-escape' : 'control-string';
          continue;
        }
        if (character === '\u001b') { mode = 'escape'; continue; }
        if (character === '\u009b') { mode = 'csi'; continue; }
        if (character === '\u009d') { mode = 'osc'; continue; }
        if (character === '\u0090' || character === '\u0098' || character === '\u009e' || character === '\u009f') {
          mode = 'control-string';
          continue;
        }
        if (character >= '\u0080' && character <= '\u009f') continue;
        if (character < ' ' && character !== '\r' && character !== '\n') continue;
        append(character);
      }
      flush();
    }
  };
}

interface TerminalTextReader {
  push(data: string): void;
}

export function createMacroRunner(runtime: MacroRunnerRuntime): MacroRunner {
  let activeRun: ActiveRun | undefined;

  function notify(callbacks: MacroRunnerCallbacks, progress: MacroRunProgress): void {
    try { callbacks.onProgress?.(progress); } catch { /* Progress presentation does not control execution. */ }
  }

  function targetReady(sessionId: string): boolean {
    try { return runtime.isTargetReady(sessionId); }
    catch { return false; }
  }

  function cancellationResult(run: ActiveRun): MacroRunResult {
    return run.cancelError?.code === 'CANCELLED'
      ? { status: 'cancelled' }
      : { status: 'failed', error: run.cancelError ?? failure('CANCELLED', 'terminal').error };
  }

  function appendOutput(run: ActiveRun, text: string): void {
    const waiter = run.waiter;
    const combined = run.outputText + text;
    const matchAt = waiter ? combined.indexOf(waiter.text) : -1;
    if (waiter && matchAt >= 0) {
      run.outputText = combined.slice(matchAt + waiter.text.length).slice(-MAX_WAIT_OUTPUT_CHARS);
      run.waiter = undefined;
      waiter.complete();
      return;
    }
    run.outputText = combined.slice(-MAX_WAIT_OUTPUT_CHARS);
  }

  function waitForText(run: ActiveRun, text: string, timeoutMs: number): Promise<WaitResult> {
    const matchAt = run.outputText.indexOf(text);
    if (matchAt >= 0) {
      run.outputText = run.outputText.slice(matchAt + text.length);
      return Promise.resolve('matched');
    }
    if (run.cancellation.aborted) return Promise.resolve('cancelled');

    return new Promise(resolve => {
      let settled = false;
      let cancelTimer = () => {};
      const finish = (result: WaitResult) => {
        if (settled) return;
        settled = true;
        cancelTimer();
        run.cancellation.removeEventListener('abort', onAbort);
        if (run.waiter?.complete === onOutput) run.waiter = undefined;
        resolve(result);
      };
      const onOutput = () => finish('matched');
      const onAbort = () => finish('cancelled');
      cancelTimer = runtime.scheduleTimeout(() => finish('timeout'), timeoutMs);
      run.waiter = { text, complete: onOutput };
      run.cancellation.addEventListener('abort', onAbort, { once: true });
      if (run.cancellation.aborted) onAbort();
    });
  }

  function delay(run: ActiveRun, durationMs: number): Promise<boolean> {
    if (run.cancellation.aborted) return Promise.resolve(false);
    return new Promise(resolve => {
      let settled = false;
      let cancelTimer = () => {};
      const finish = (completed: boolean) => {
        if (settled) return;
        settled = true;
        cancelTimer();
        run.cancellation.removeEventListener('abort', onAbort);
        resolve(completed);
      };
      const onAbort = () => finish(false);
      cancelTimer = runtime.scheduleTimeout(() => finish(true), durationMs);
      run.cancellation.addEventListener('abort', onAbort, { once: true });
      if (run.cancellation.aborted) onAbort();
    });
  }

  async function confirm(run: ActiveRun, callbacks: MacroRunnerCallbacks, message: string): Promise<boolean> {
    if (run.cancellation.aborted) return false;
    let onAbort: () => void = () => {};
    try {
      const decision = Promise.resolve(callbacks.confirm(message, run.cancellation));
      const cancelled = new Promise<undefined>(resolve => {
        onAbort = () => {
          run.cancellation.removeEventListener('abort', onAbort);
          resolve(undefined);
        };
        run.cancellation.addEventListener('abort', onAbort, { once: true });
        if (run.cancellation.aborted) onAbort();
      });
      const accepted = await Promise.race([decision, cancelled]);
      return accepted === true;
    } catch {
      throw new Error('Macro confirmation is unavailable.');
    } finally {
      run.cancellation.removeEventListener('abort', onAbort);
    }
  }

  async function sendLine(run: ActiveRun, sessionId: string, text: string): Promise<AppError | undefined> {
    if (!targetReady(sessionId)) return failure('UNAVAILABLE', 'terminal').error;
    try {
      const result = await runtime.sendLine(sessionId, `${text}\r`);
      if (!result.ok) return result.error;
    } catch {
      return failure('UNAVAILABLE', 'terminal').error;
    }
    if (run.cancellation.aborted) return run.cancelError ?? failure('CANCELLED', 'terminal').error;
    return targetReady(sessionId) ? undefined : failure('UNAVAILABLE', 'terminal').error;
  }

  return {
    async run(input: unknown, targetSessionId: string, callbacks: MacroRunnerCallbacks): Promise<MacroRunResult> {
      if (activeRun) return { status: 'failed', error: failure('BUSY').error };
      if (!isMacroDefinition(input) || input.steps.length === 0 || typeof targetSessionId !== 'string' || targetSessionId.length === 0 ||
          !callbacks || typeof callbacks.confirm !== 'function') {
        return { status: 'failed', error: failure('INVALID_REQUEST', 'terminal').error };
      }
      if (!targetReady(targetSessionId)) return { status: 'failed', error: failure('UNAVAILABLE', 'terminal').error };

      const run: ActiveRun = {
        sessionId: targetSessionId,
        cancellation: createCancellationSource(),
        textReader: createTerminalTextReader(text => appendOutput(run, text)),
        outputText: '',
        waiter: undefined
      };
      activeRun = run;

      try {
        for (let index = 0; index < input.steps.length; index++) {
          if (run.cancellation.aborted) return cancellationResult(run);
          if (!targetReady(targetSessionId)) return { status: 'failed', error: failure('UNAVAILABLE', 'terminal').error };
          const step = input.steps[index]!;
          let phase: MacroRunPhase;
          if (step.kind === 'send') phase = 'sending';
          else if (step.kind === 'waitForText') phase = 'waiting';
          else if (step.kind === 'delay') phase = 'delaying';
          else phase = 'confirming';
          notify(callbacks, { targetSessionId, stepNumber: index + 1, stepCount: input.steps.length, step, phase });

          if (step.kind === 'send') {
            const error = await sendLine(run, targetSessionId, step.text);
            if (error) return error.code === 'CANCELLED' ? { status: 'cancelled' } : { status: 'failed', error };
          } else if (step.kind === 'waitForText') {
            const result = await waitForText(run, step.text, step.timeoutMs);
            if (result === 'timeout') return { status: 'failed', error: failure('TIMEOUT', 'terminal').error };
            if (result === 'cancelled' || run.cancellation.aborted) return cancellationResult(run);
          } else if (step.kind === 'delay') {
            if (!await delay(run, step.durationMs) || run.cancellation.aborted) return cancellationResult(run);
          } else {
            let accepted: boolean;
            try { accepted = await confirm(run, callbacks, step.message); }
            catch { return { status: 'failed', error: failure('UNAVAILABLE').error }; }
            if (run.cancellation.aborted) return cancellationResult(run);
            if (!accepted) return { status: 'cancelled' };
          }

          if (!targetReady(targetSessionId)) return { status: 'failed', error: failure('UNAVAILABLE', 'terminal').error };
          notify(callbacks, { targetSessionId, stepNumber: index + 1, stepCount: input.steps.length, step, phase: 'step-complete' });
        }
        return { status: 'completed' };
      } catch {
        return { status: 'failed', error: failure('UNAVAILABLE', 'terminal').error };
      } finally {
        run.cancellation.abort();
        if (activeRun === run) activeRun = undefined;
        run.waiter = undefined;
        run.outputText = '';
      }
    },
    cancel(): void {
      const run = activeRun;
      if (!run) return;
      run.cancelError = failure('CANCELLED', 'terminal').error;
      run.cancellation.abort();
    },
    observeOutput(sessionId: string, data: string): void {
      const run = activeRun;
      if (!run || run.sessionId !== sessionId || typeof data !== 'string') return;
      run.textReader.push(data);
    },
    disconnect(sessionId: string): void {
      const run = activeRun;
      if (!run || run.sessionId !== sessionId) return;
      run.cancelError = failure('UNAVAILABLE', 'terminal').error;
      run.cancellation.abort();
    }
  };
}
