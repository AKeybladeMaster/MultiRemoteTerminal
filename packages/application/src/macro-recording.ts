import { MAX_MACRO_SEND_CHARS, MAX_MACRO_STEPS } from '../../domain/src/macro.ts';
import type { MacroStep } from '../../domain/src/macro.ts';

export type MacroRecordingWarning = 'secret-prompt' | 'input-skipped' | 'line-limit' | 'step-limit';

export interface MacroRecordingSnapshot {
  readonly status: 'idle' | 'recording' | 'paused';
  readonly sessionId?: string;
  readonly stepCount: number;
  readonly warning?: MacroRecordingWarning;
}

export interface CompletedMacroRecording {
  readonly sessionId: string;
  readonly steps: readonly MacroStep[];
}

export interface MacroRecorder {
  start(sessionId: string): boolean;
  pause(): void;
  resume(): void;
  recordInput(sessionId: string, data: string): MacroRecordingSnapshot;
  observeOutput(sessionId: string, data: string): MacroRecordingSnapshot;
  snapshot(): MacroRecordingSnapshot;
  stop(sessionId?: string): CompletedMacroRecording | undefined;
}

const MAX_PROMPT_LINE_CHARS = 512;
const MAX_INPUT_CHARS_PER_EVENT = MAX_MACRO_SEND_CHARS * 2;
const SECRET_PROMPT = /\b(?:password|passwd|passphrase|token|secret|verification(?:\s+code)?|one[- ]time\s+code)\b[^:\r\n]{0,80}[:?]\s*$/iu;

type AnsiMode = 'text' | 'escape' | 'csi' | 'osc' | 'osc-escape';

/** Collects completed terminal lines in memory; it never persists terminal output. */
export function createMacroRecorder(): MacroRecorder {
  let sessionId: string | undefined;
  let paused = false;
  let steps: MacroStep[] = [];
  let line: string[] = [];
  let promptLine = '';
  let ansiMode: AnsiMode = 'text';
  let discardUntilEnter = false;
  let suppressUntilEnter = false;
  let pausedAfterSecretPrompt = false;
  let ignorePromptDetectionUntilCommand = false;
  let submittedLineForEcho = '';
  let warning: MacroRecordingWarning | undefined;

  function snapshot(): MacroRecordingSnapshot {
    if (!sessionId) return { status: 'idle', stepCount: 0 };
    return { status: paused ? 'paused' : 'recording', sessionId, stepCount: steps.length, ...(warning ? { warning } : {}) };
  }

  function clearLine(): void { line = []; }

  function finishLine(): void {
    if (suppressUntilEnter) {
      suppressUntilEnter = false;
      paused = true;
      pausedAfterSecretPrompt = true;
      clearLine();
      promptLine = '';
      return;
    }
    if (discardUntilEnter) {
      discardUntilEnter = false;
      clearLine();
      return;
    }
    if (paused) { clearLine(); return; }
    const text = line.join('');
    clearLine();
    if (!text.trim()) return;
    if (text.length > MAX_MACRO_SEND_CHARS) {
      warning = 'line-limit';
      return;
    }
    if (steps.length >= MAX_MACRO_STEPS) {
      warning = 'step-limit';
      return;
    }
    steps.push({ kind: 'send', text });
    submittedLineForEcho = text;
    ignorePromptDetectionUntilCommand = false;
    warning = undefined;
  }

  function appendPromptCharacter(character: string): void {
    if (character === '\r' || character === '\n') {
      promptLine = '';
      submittedLineForEcho = '';
      return;
    }
    if (character === '\b' || character === '\u007f') {
      promptLine = Array.from(promptLine).slice(0, -1).join('');
      return;
    }
    if (character < ' ' || character === '\u007f') return;
    promptLine += character;
    if (promptLine.length > MAX_PROMPT_LINE_CHARS) promptLine = promptLine.slice(-MAX_PROMPT_LINE_CHARS);
    const typedLine = line.join('');
    const currentInputIsEchoed = typedLine.length > 0 && (promptLine.endsWith(typedLine) || typedLine.startsWith(promptLine.slice(-Math.min(promptLine.length, typedLine.length))));
    const echoMarker = submittedLineForEcho.slice(0, Math.min(8, submittedLineForEcho.length));
    const echoIndex = echoMarker ? promptLine.lastIndexOf(echoMarker) : -1;
    const outputAfterSubmittedEcho = echoIndex >= 0 ? promptLine.slice(echoIndex) : '';
    const outputIsSubmittedEcho = echoIndex >= 0 && submittedLineForEcho.startsWith(outputAfterSubmittedEcho);
    if (!ignorePromptDetectionUntilCommand && !currentInputIsEchoed && !outputIsSubmittedEcho && SECRET_PROMPT.test(promptLine)) {
      clearLine();
      discardUntilEnter = false;
      suppressUntilEnter = true;
      pausedAfterSecretPrompt = false;
      ignorePromptDetectionUntilCommand = false;
      submittedLineForEcho = '';
      warning = 'secret-prompt';
    }
  }

  function observeOutput(targetSessionId: string, data: string): MacroRecordingSnapshot {
    if (sessionId !== targetSessionId) return snapshot();
    for (const character of data) {
      if (ansiMode === 'escape') {
        if (character === '[') ansiMode = 'csi';
        else if (character === ']') ansiMode = 'osc';
        else ansiMode = 'text';
        continue;
      }
      if (ansiMode === 'csi') {
        if (character >= '@' && character <= '~') ansiMode = 'text';
        continue;
      }
      if (ansiMode === 'osc') {
        if (character === '\u0007') ansiMode = 'text';
        else if (character === '\u001b') ansiMode = 'osc-escape';
        continue;
      }
      if (ansiMode === 'osc-escape') {
        ansiMode = character === '\\' ? 'text' : character === '\u001b' ? 'osc-escape' : 'osc';
        continue;
      }
      if (character === '\u001b') { ansiMode = 'escape'; continue; }
      appendPromptCharacter(character);
    }
    return snapshot();
  }

  return {
    start(targetSessionId: string): boolean {
      if (sessionId || typeof targetSessionId !== 'string' || targetSessionId.length === 0) return false;
      sessionId = targetSessionId;
      paused = false;
      steps = [];
      line = [];
      promptLine = '';
      ansiMode = 'text';
      discardUntilEnter = false;
      suppressUntilEnter = false;
      pausedAfterSecretPrompt = false;
      submittedLineForEcho = '';
      warning = undefined;
      return true;
    },
    pause(): void {
      if (!sessionId || paused) return;
      paused = true;
      clearLine();
      // Text already visible in the remote prompt cannot be safely resumed.
      discardUntilEnter = !suppressUntilEnter;
    },
    resume(): void {
      if (!sessionId || !paused) return;
      paused = false;
      if (pausedAfterSecretPrompt) {
        pausedAfterSecretPrompt = false;
        ignorePromptDetectionUntilCommand = true;
        suppressUntilEnter = false;
        discardUntilEnter = false;
        promptLine = '';
        warning = undefined;
      }
    },
    recordInput(targetSessionId: string, data: string): MacroRecordingSnapshot {
      if (sessionId !== targetSessionId || typeof data !== 'string') return snapshot();
      if (data === '\u001b[I' || data === '\u001b[O') return snapshot();
      if (data.length > MAX_INPUT_CHARS_PER_EVENT) {
        clearLine();
        discardUntilEnter = true;
        warning = 'line-limit';
        return snapshot();
      }
      for (const character of data) {
        if (character === '\r' || character === '\n') { finishLine(); continue; }
        if (character === '\u0003') {
          clearLine();
          discardUntilEnter = false;
          if (suppressUntilEnter) {
            suppressUntilEnter = false;
            paused = true;
            pausedAfterSecretPrompt = true;
            warning = 'secret-prompt';
          } else warning = undefined;
          continue;
        }
        if (character === '\b' || character === '\u007f') {
          if (suppressUntilEnter || discardUntilEnter || paused) continue;
          line.pop();
          continue;
        }
        if (suppressUntilEnter || discardUntilEnter || paused) continue;
        if (character < ' ' || character === '\u007f') {
          clearLine();
          discardUntilEnter = true;
          warning = 'input-skipped';
          continue;
        }
        line.push(character);
        if (line.length > MAX_MACRO_SEND_CHARS) {
          clearLine();
          discardUntilEnter = true;
          warning = 'line-limit';
        }
      }
      return snapshot();
    },
    observeOutput,
    snapshot,
    stop(targetSessionId?: string): CompletedMacroRecording | undefined {
      if (!sessionId || (targetSessionId !== undefined && targetSessionId !== sessionId)) return undefined;
      const completed = { sessionId, steps: [...steps] };
      sessionId = undefined;
      paused = false;
      steps = [];
      line = [];
      promptLine = '';
      ansiMode = 'text';
      discardUntilEnter = false;
      suppressUntilEnter = false;
      pausedAfterSecretPrompt = false;
      ignorePromptDetectionUntilCommand = false;
      submittedLineForEcho = '';
      warning = undefined;
      return completed;
    }
  };
}
