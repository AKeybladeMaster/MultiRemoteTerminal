import { failure } from '../../../../packages/domain/src/errors.ts';
import type { Outcome } from '../../../../packages/domain/src/errors.ts';
import { normalizeWorkbenchPreferences } from '../../../../packages/domain/src/workbench-preferences.ts';
import type { CancellationSignal } from '../../../../packages/application/src/cancellation.ts';
import type { WorkbenchPreferencesManager } from '../../../../packages/application/src/workbench-preferences.ts';
import type { CustomLogoSelection } from '../../../../packages/domain/src/custom-logo.ts';
import type { CustomLogoPicker } from './custom-logo-picker.ts';

export interface CustomLogoPreferenceAccess {
  readonly preferences: WorkbenchPreferencesManager;
  select(): Promise<Outcome<CustomLogoSelection>>;
}

/** Only persist a changed logo if this main-process instance produced it through the bounded picker. */
export function createCustomLogoPreferenceAccess(preferences: WorkbenchPreferencesManager,
  picker: CustomLogoPicker): CustomLogoPreferenceAccess {
  let selectedDataUrl: string | undefined;
  const guardedPreferences: WorkbenchPreferencesManager = Object.freeze({
    read(cancellation?: CancellationSignal) { return preferences.read(cancellation); },
    readStartup(cancellation?: CancellationSignal) { return preferences.readStartup(cancellation); },
    async save(value: unknown, cancellation?: CancellationSignal) {
      const normalized = normalizeWorkbenchPreferences(value);
      if (!normalized) return preferences.save(value, cancellation);
      const current = await preferences.read(cancellation);
      if (!current.ok) return current;
      const dataUrl = normalized.customLogoDataUrl;
      if (dataUrl !== null && dataUrl !== current.result.customLogoDataUrl && dataUrl !== selectedDataUrl) {
        return failure('INVALID_REQUEST');
      }
      const saved = await preferences.save(normalized, cancellation);
      if (saved.ok) selectedDataUrl = undefined;
      return saved;
    }
  });

  return Object.freeze({
    preferences: guardedPreferences,
    async select() {
      const selected = await picker.select();
      if (selected.ok) selectedDataUrl = selected.result.dataUrl;
      return selected;
    }
  });
}
