import type { LocalTerminalController } from './local-terminals.ts';
import type { WorkbenchPreferencesManager } from './workbench-preferences.ts';
import type { Outcome } from '../../domain/src/errors.ts';
import { failure } from '../../domain/src/errors.ts';
import { normalizePowerShellProfileScript } from '../../domain/src/powershell-profile.ts';

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PREVIEW_ID = SESSION_ID;
const PREVIEW_TTL_MS = 5 * 60_000;
const MAX_PENDING_PREVIEWS = 32;

interface PendingPreview extends PowerShellProfileScriptPreview {
  readonly sessionId: string;
  readonly expiresAt: number;
}

export interface PowerShellProfileScriptPreview {
  readonly previewId: string;
  readonly script: string;
}

export interface PowerShellProfileScriptController {
  preview(sessionId: string): Promise<Outcome<PowerShellProfileScriptPreview>>;
  apply(sessionId: string, previewId: string): Promise<Outcome<Record<string, never>>>;
  clear(): void;
}

/** Reads saved script text for preview and permits one exact, session-bound application. */
export function createPowerShellProfileScriptController(
  preferences: Pick<WorkbenchPreferencesManager, 'read'>,
  terminals: Pick<LocalTerminalController, 'applyPowerShellProfileScript'>,
  makeId: () => string,
  now: () => number = () => Date.now(),
): PowerShellProfileScriptController {
  const previews = new Map<string, PendingPreview>();

  function prune(): void {
    const timestamp = now();
    for (const [previewId, preview] of previews) if (preview.expiresAt < timestamp) previews.delete(previewId);
  }

  return Object.freeze({
    async preview(sessionId: string): Promise<Outcome<PowerShellProfileScriptPreview>> {
      if (!SESSION_ID.test(sessionId)) return failure('INVALID_REQUEST');
      prune();
      if (previews.size >= MAX_PENDING_PREVIEWS) return failure('BUSY');
      const stored = await preferences.read();
      if (!stored.ok) return stored;
      const script = normalizePowerShellProfileScript(stored.result.powerShellProfileScript);
      if (script === undefined) return failure('CORRUPT');
      if (script.length === 0) return failure('INVALID_REQUEST');
      const previewId = makeId();
      if (!PREVIEW_ID.test(previewId) || previews.has(previewId)) return failure('UNAVAILABLE');
      const preview = { previewId, sessionId, script, expiresAt: now() + PREVIEW_TTL_MS };
      previews.set(previewId, preview);
      return { ok: true, result: { previewId, script } };
    },
    async apply(sessionId: string, previewId: string): Promise<Outcome<Record<string, never>>> {
      if (!SESSION_ID.test(sessionId) || !PREVIEW_ID.test(previewId)) return failure('INVALID_REQUEST');
      prune();
      const preview = previews.get(previewId);
      previews.delete(previewId);
      if (!preview || preview.expiresAt < now() || preview.sessionId !== sessionId) return failure('FORBIDDEN');
      const stored = await preferences.read();
      if (!stored.ok) return stored;
      if (stored.result.powerShellProfileScript !== preview.script) return failure('CONFLICT');
      return terminals.applyPowerShellProfileScript(sessionId, preview.script);
    },
    clear(): void { previews.clear(); }
  });
}
