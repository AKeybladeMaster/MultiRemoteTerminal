import type { AppError } from '../../../../packages/domain/src/errors.ts';
import type { MacroRunProgress } from '../../../../packages/application/src/macro-runner.ts';

export interface MacroPlaybackView {
  readonly macroId: string;
  readonly sessionId: string;
  readonly targetTitle: string;
  readonly status: 'running' | 'completed' | 'cancelled' | 'failed';
  readonly progress?: MacroRunProgress;
  readonly error?: AppError;
  readonly cancelRequested?: boolean;
}

export function playbackStatusText(playback: MacroPlaybackView, macroName: string): string {
  if (playback.status === 'completed') return `Macro completed on ${playback.targetTitle}.`;
  if (playback.status === 'cancelled') return `Playback stopped on ${playback.targetTitle}. Later steps were not sent.`;
  if (playback.status === 'failed') {
    const error = playback.error;
    const code = error?.code ?? 'UNAVAILABLE';
    if (code === 'TIMEOUT') {
      const timedOutWrite = playback.progress?.step.kind === 'send' || (!playback.progress && error?.target === 'application');
      return timedOutWrite
        ? `Playback stopped on ${playback.targetTitle} (${code}). The terminal write was not confirmed before the five-second reply deadline and may still be accepted. Inspect the terminal before running ${macroName} again; later steps were not sent.`
        : `Playback stopped on ${playback.targetTitle} (${code}). The expected terminal text did not arrive before the wait expired. Later steps were not sent. Inspect the output before running ${macroName} again.`;
    }
    return `Playback stopped on ${playback.targetTitle} (${code}). Check the terminal before reviewing and retrying ${macroName}.`;
  }
  if (playback.cancelRequested) return 'Stopping after any terminal write already in flight settles. Later steps will not run.';
  const progress = playback.progress;
  if (!progress) return `Starting ${macroName} on ${playback.targetTitle}.`;
  if (progress.phase === 'waiting') return `Step ${progress.stepNumber} of ${progress.stepCount}: waiting for terminal text.`;
  if (progress.phase === 'delaying') return `Step ${progress.stepNumber} of ${progress.stepCount}: waiting before the next command.`;
  if (progress.phase === 'confirming') return `Step ${progress.stepNumber} of ${progress.stepCount}: confirmation required.`;
  if (progress.phase === 'step-complete') return `Step ${progress.stepNumber} of ${progress.stepCount} completed.`;
  return `Step ${progress.stepNumber} of ${progress.stepCount}: sending the reviewed command.`;
}
