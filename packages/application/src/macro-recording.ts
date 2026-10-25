import { MAX_MACRO_SEND_CHARS, MAX_MACRO_STEPS, MAX_MACRO_TEXT_CHARS } from '../../domain/src/macro.ts';
import type { MacroStep } from '../../domain/src/macro.ts';

export type MacroRecordingWarning = 'secret-prompt' | 'input-skipped' | 'line-limit' | 'step-limit' | 'text-limit';

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
  start(sessionId: string, reservedTextChars?: number): boolean;
  pause(): void;
  resume(): void;
  recordInput(sessionId: string, data: string): MacroRecordingSnapshot;
  observeOutput(sessionId: string, data: string): MacroRecordingSnapshot;
  snapshot(): MacroRecordingSnapshot;
  stop(sessionId?: string): CompletedMacroRecording | undefined;
}

const MAX_PROMPT_LINE_CHARS = 512;
const MAX_INPUT_CHARS_PER_EVENT = MAX_MACRO_SEND_CHARS * 2;
const MAX_REDRAW_ROWS = 256;
const MAX_CSI_SEQUENCE_CHARS = 64;
const isScreenRedraw = (data: string): boolean => {
  const clearedLines = data.match(/(?:\u001b\[|\u009b)[0-9;?]*K/gu)?.length ?? 0;
  return data.length >= 64 && clearedLines >= 2 && /(?:\u001b\[|\u009b)(?:H|f|1;1H)/u.test(data);
};
const SECRET_PROMPT = /\b(?:password|passwd|passphrase|token|secret|verification(?:\s+code)?|one[- ]time\s+code)\b[^:\r\n]{0,80}[:?]\s*$/iu;

type AnsiMode = 'text' | 'escape' | 'csi' | 'osc' | 'osc-escape' | 'control-string' | 'control-string-escape';

/** Collects completed terminal lines in memory; it never persists terminal output. */
export function createMacroRecorder(): MacroRecorder {
  let sessionId: string | undefined;
  let paused = false;
  let steps: MacroStep[] = [];
  let totalTextChars = 0;
  let maxTextChars = MAX_MACRO_TEXT_CHARS;
  let line: string[] = [];
  let promptLine = '';
  let pausedPromptLine = '';
  let pausedSecretPromptOpen = false;
  let ansiMode: AnsiMode = 'text';
  let csiSequence = '';
  let discardUntilEnter = false;
  let suppressUntilEnter = false;
  let pausedAfterSecretPrompt = false;
  let submittedLineForEcho = '';
  let warning: MacroRecordingWarning | undefined;

  function snapshot(): MacroRecordingSnapshot {
    if (!sessionId) return { status: 'idle', stepCount: 0 };
    return { status: paused ? 'paused' : 'recording', sessionId, stepCount: steps.length, ...(warning ? { warning } : {}) };
  }

  function clearLine(): void { line = []; }

  function finishLine(): void {
    if (paused && pausedSecretPromptOpen) {
      pausedSecretPromptOpen = false;
      pausedAfterSecretPrompt = true;
      warning = 'secret-prompt';
    }
    if (suppressUntilEnter) {
      suppressUntilEnter = false;
      paused = true;
      pausedAfterSecretPrompt = true;
      clearLine();
      promptLine = '';
      pausedPromptLine = '';
      pausedSecretPromptOpen = false;
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
    if (totalTextChars + text.length > maxTextChars) {
      warning = 'text-limit';
      return;
    }
    steps.push({ kind: 'send', text });
    totalTextChars += text.length;
    submittedLineForEcho = text;
    warning = undefined;
  }

  function appendPromptCharacter(character: string): void {
    if (paused) {
      if (character === '\r' || character === '\n') {
        pausedPromptLine = '';
        return;
      }
      if (character === '\b' || character === '\u007f') {
        pausedPromptLine = Array.from(pausedPromptLine).slice(0, -1).join('');
        if (SECRET_PROMPT.test(pausedPromptLine)) {
          pausedSecretPromptOpen = true;
          warning = 'secret-prompt';
        }
        return;
      }
      if (character < ' ' || character === '\u007f') return;
      pausedPromptLine += character;
      if (pausedPromptLine.length > MAX_PROMPT_LINE_CHARS) pausedPromptLine = pausedPromptLine.slice(-MAX_PROMPT_LINE_CHARS);
      if (SECRET_PROMPT.test(pausedPromptLine)) {
        pausedSecretPromptOpen = true;
        warning = 'secret-prompt';
      }
      return;
    }
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
    const secretPrompt = SECRET_PROMPT.exec(promptLine);
    if (currentInputIsEchoed || outputIsSubmittedEcho || !secretPrompt) return;
    clearLine();
    discardUntilEnter = false;
    suppressUntilEnter = true;
    submittedLineForEcho = '';
    warning = 'secret-prompt';
  }

  function observeOutput(targetSessionId: string, data: string): MacroRecordingSnapshot {
    if (sessionId !== targetSessionId) return snapshot();
    const screenRedraw = isScreenRedraw(data);
    const redrawnLines = new Map<number, string[]>();
    let redrawnCursorRow = 0;
    let redrawnCursorColumn = 0;
    const currentRedrawnLine = (): string[] => {
      const current = redrawnLines.get(redrawnCursorRow);
      if (current) return current;
      const created: string[] = [];
      redrawnLines.set(redrawnCursorRow, created);
      return created;
    };
    const applyRedrawCsi = (finalCharacter: string): void => {
      const parameters = csiSequence.replace(/^[?>!]/u, '').split(';');
      const positiveParameter = (index: number, fallback: number): number => {
        const value = Number.parseInt(parameters[index] ?? '', 10);
        return Number.isSafeInteger(value) && value > 0 ? value : fallback;
      };
      if (finalCharacter === 'H' || finalCharacter === 'f') {
        redrawnCursorRow = Math.min(MAX_REDRAW_ROWS - 1, positiveParameter(0, 1) - 1);
        redrawnCursorColumn = Math.min(MAX_PROMPT_LINE_CHARS, positiveParameter(1, 1) - 1);
      } else if (finalCharacter === 'A') redrawnCursorRow = Math.max(0, redrawnCursorRow - positiveParameter(0, 1));
      else if (finalCharacter === 'B') redrawnCursorRow = Math.min(MAX_REDRAW_ROWS - 1, redrawnCursorRow + positiveParameter(0, 1));
      else if (finalCharacter === 'C') redrawnCursorColumn = Math.min(MAX_PROMPT_LINE_CHARS, redrawnCursorColumn + positiveParameter(0, 1));
      else if (finalCharacter === 'D') redrawnCursorColumn = Math.max(0, redrawnCursorColumn - positiveParameter(0, 1));
      else if (finalCharacter === 'E') {
        redrawnCursorRow = Math.min(MAX_REDRAW_ROWS - 1, redrawnCursorRow + positiveParameter(0, 1));
        redrawnCursorColumn = 0;
      } else if (finalCharacter === 'F') {
        redrawnCursorRow = Math.max(0, redrawnCursorRow - positiveParameter(0, 1));
        redrawnCursorColumn = 0;
      } else if (finalCharacter === 'G') redrawnCursorColumn = Math.min(MAX_PROMPT_LINE_CHARS, positiveParameter(0, 1) - 1);
      else if (finalCharacter === 'd') redrawnCursorRow = Math.min(MAX_REDRAW_ROWS - 1, positiveParameter(0, 1) - 1);
      else if (finalCharacter === 'K') {
        const mode = Number.parseInt(parameters[0] ?? '0', 10) || 0;
        const row = currentRedrawnLine();
        if (mode === 0) row.length = Math.min(row.length, redrawnCursorColumn);
        else if (mode === 1) {
          for (let index = 0; index < Math.min(redrawnCursorColumn, MAX_PROMPT_LINE_CHARS); index++) row[index] = ' ';
        } else if (mode === 2) redrawnLines.set(redrawnCursorRow, []);
      }
    };
    if (screenRedraw) {
      promptLine = '';
      submittedLineForEcho = '';
      pausedPromptLine = '';
      ansiMode = 'text';
      csiSequence = '';
    }
    for (const character of data) {
      if (ansiMode === 'escape') {
        if (character === '[') { ansiMode = 'csi'; csiSequence = ''; }
        else if (character === ']') ansiMode = 'osc';
        else if (character === 'P' || character === 'X' || character === '^' || character === '_') ansiMode = 'control-string';
        else ansiMode = 'text';
        continue;
      }
      if (ansiMode === 'csi') {
        if (character === '\u009c' || (character >= '@' && character <= '~')) {
          if (screenRedraw && character !== '\u009c') applyRedrawCsi(character);
          ansiMode = 'text';
          csiSequence = '';
        } else if (csiSequence.length < MAX_CSI_SEQUENCE_CHARS) csiSequence += character;
        continue;
      }
      if (ansiMode === 'osc') {
        if (character === '\u0007' || character === '\u009c') ansiMode = 'text';
        else if (character === '\u001b') ansiMode = 'osc-escape';
        continue;
      }
      if (ansiMode === 'osc-escape') {
        ansiMode = character === '\\' || character === '\u009c' ? 'text' : character === '\u001b' ? 'osc-escape' : 'osc';
        continue;
      }
      if (ansiMode === 'control-string') {
        if (character === '\u009c') ansiMode = 'text';
        else if (character === '\u001b') ansiMode = 'control-string-escape';
        continue;
      }
      if (ansiMode === 'control-string-escape') {
        ansiMode = character === '\\' || character === '\u009c' ? 'text' : character === '\u001b' ? 'control-string-escape' : 'control-string';
        continue;
      }
      if (character === '\u001b') { ansiMode = 'escape'; continue; }
      if (character === '\u009b') { ansiMode = 'csi'; csiSequence = ''; continue; }
      if (character === '\u009d') { ansiMode = 'osc'; continue; }
      if (character === '\u0090' || character === '\u0098' || character === '\u009e' || character === '\u009f') {
        ansiMode = 'control-string';
        continue;
      }
      if (character >= '\u0080' && character <= '\u009f') continue;
      if (!screenRedraw) {
        appendPromptCharacter(character);
        continue;
      }
      if (character === '\r') redrawnCursorColumn = 0;
      else if (character === '\n') {
        redrawnCursorRow = Math.min(MAX_REDRAW_ROWS - 1, redrawnCursorRow + 1);
        redrawnCursorColumn = 0;
      } else if (character === '\b' || character === '\u007f') redrawnCursorColumn = Math.max(0, redrawnCursorColumn - 1);
      else if (character >= ' ') {
        if (redrawnCursorColumn < MAX_PROMPT_LINE_CHARS) {
          currentRedrawnLine()[redrawnCursorColumn] = character;
          redrawnCursorColumn++;
        }
      }
    }
    if (screenRedraw) for (const character of currentRedrawnLine().join('')) appendPromptCharacter(character);
    return snapshot();
  }

  return {
    start(targetSessionId: string, reservedTextChars = 0): boolean {
      if (sessionId || typeof targetSessionId !== 'string' || targetSessionId.length === 0 ||
          !Number.isSafeInteger(reservedTextChars) || reservedTextChars < 0 || reservedTextChars > MAX_MACRO_TEXT_CHARS) return false;
      sessionId = targetSessionId;
      paused = false;
      steps = [];
      totalTextChars = 0;
      maxTextChars = MAX_MACRO_TEXT_CHARS - reservedTextChars;
      line = [];
      promptLine = '';
      pausedPromptLine = '';
      pausedSecretPromptOpen = false;
      ansiMode = 'text';
      csiSequence = '';
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
      const hadPartialLine = line.length > 0;
      clearLine();
      promptLine = '';
      pausedPromptLine = '';
      pausedSecretPromptOpen = false;
      submittedLineForEcho = '';
      // Text already visible in the remote prompt cannot be safely resumed.
      if (!suppressUntilEnter && hadPartialLine) discardUntilEnter = true;
    },
    resume(): void {
      if (!sessionId || !paused) return;
      const secretPromptStillOpen = pausedSecretPromptOpen;
      pausedPromptLine = '';
      pausedSecretPromptOpen = false;
      if (secretPromptStillOpen) {
        pausedAfterSecretPrompt = true;
        suppressUntilEnter = true;
        discardUntilEnter = false;
        clearLine();
        promptLine = '';
        warning = 'secret-prompt';
        return;
      }
      paused = false;
      if (pausedAfterSecretPrompt) {
        pausedAfterSecretPrompt = false;
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
          if (paused) {
            pausedSecretPromptOpen = false;
            pausedPromptLine = '';
          }
          if (suppressUntilEnter) {
            suppressUntilEnter = false;
            paused = true;
            pausedAfterSecretPrompt = true;
            pausedPromptLine = '';
            pausedSecretPromptOpen = false;
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
      totalTextChars = 0;
      maxTextChars = MAX_MACRO_TEXT_CHARS;
      line = [];
      promptLine = '';
      pausedPromptLine = '';
      pausedSecretPromptOpen = false;
      ansiMode = 'text';
      csiSequence = '';
      discardUntilEnter = false;
      suppressUntilEnter = false;
      pausedAfterSecretPrompt = false;
      submittedLineForEcho = '';
      warning = undefined;
      return completed;
    }
  };
}
