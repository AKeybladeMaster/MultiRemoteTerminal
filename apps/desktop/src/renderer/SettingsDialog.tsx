import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, FormEvent } from 'react';
import { DEFAULT_ENABLED_LOCAL_SHELLS, DEFAULT_VISIBLE_LOCAL_SHELLS, LOCAL_SHELL_TOOL_REGISTRY } from '../../../../packages/domain/src/local-shell-tools.ts';
import type { LocalShell } from '../../../../packages/domain/src/local-terminal.ts';
import { DEFAULT_ENABLED_OPTIONAL_CONNECTIONS, OPTIONAL_CONNECTION_TOOL_REGISTRY } from '../../../../packages/domain/src/optional-connection-tools.ts';
import type { OptionalConnectionId } from '../../../../packages/domain/src/optional-connection-tools.ts';
import { MAX_STARTUP_GREETING_CODE_POINTS, normalizeWorkbenchPreferences } from '../../../../packages/domain/src/workbench-preferences.ts';
import type { WorkbenchPreferences } from '../../../../packages/domain/src/workbench-preferences.ts';
import { MAX_POWERSHELL_PROFILE_SCRIPT_CODE_UNITS, normalizePowerShellProfileScript } from '../../../../packages/domain/src/powershell-profile.ts';
import { MAX_CUSTOM_LOGO_DIMENSION, MAX_CUSTOM_LOGO_SOURCE_BYTES } from '../../../../packages/domain/src/custom-logo.ts';
import { MAX_TERMINAL_HIGHLIGHT_PATTERN_CODE_POINTS, MAX_TERMINAL_HIGHLIGHT_RULES,
  normalizeTerminalHighlightRules, TERMINAL_HIGHLIGHT_COLORS } from '../../../../packages/domain/src/terminal-highlights.ts';
import type { TerminalHighlightColor, TerminalHighlightRule } from '../../../../packages/domain/src/terminal-highlights.ts';
import { workbenchPreferenceFailureMessage } from './workbench-preference-errors.ts';

function sshCredentialBundleError(code: string): string {
  if (code === 'LOCKED') return 'Unlock the credential vault before importing or exporting passwords.';
  if (code === 'CORRUPT') return 'The bundle could not be authenticated. Check its passphrase and file integrity.';
  if (code === 'INVALID_REQUEST') return 'The selected file is not a supported encrypted SSH credential bundle.';
  if (code === 'CONFLICT') return 'Import found a missing, changed, or already-protected SSH profile. No credentials were imported.';
  if (code === 'OUTPUT_LIMIT') return 'The credential bundle exceeds the supported size limit.';
  if (code === 'BUSY' || code === 'TIMEOUT') return 'The credential bundle operation took too long. Try again.';
  return `The encrypted SSH credential bundle operation failed (${code}).`;
}

export function SettingsDialog({ onClose, onPreferencesSaved, activePowerShellSessionId }: {
  readonly onClose: () => void;
  readonly onPreferencesSaved: (preferences: WorkbenchPreferences) => void;
  readonly activePowerShellSessionId?: string | undefined;
}) {
  const [greeting, setGreeting] = useState('');
  const [powerShellProfileScript, setPowerShellProfileScript] = useState('');
  const [savedPowerShellProfileScript, setSavedPowerShellProfileScript] = useState('');
  const [profilePreview, setProfilePreview] = useState<{ readonly sessionId: string; readonly previewId: string; readonly script: string }>();
  const [profilePreviewBusy, setProfilePreviewBusy] = useState(false);
  const [profileApplyBusy, setProfileApplyBusy] = useState(false);
  const [profileStatus, setProfileStatus] = useState('');
  const [terminalHighlightEnabled, setTerminalHighlightEnabled] = useState(false);
  const [terminalHighlightRules, setTerminalHighlightRules] = useState<readonly TerminalHighlightRule[]>([]);
  const [terminalShellSyntaxEnabled, setTerminalShellSyntaxEnabled] = useState(false);
  const [autoSaveSessions, setAutoSaveSessions] = useState(false);
  const [showSftpBrowserBesideSsh, setShowSftpBrowserBesideSsh] = useState(true);
  const [visibleLocalShells, setVisibleLocalShells] = useState<readonly LocalShell[]>(DEFAULT_VISIBLE_LOCAL_SHELLS);
  const [enabledLocalShells, setEnabledLocalShells] = useState<readonly LocalShell[]>(DEFAULT_ENABLED_LOCAL_SHELLS);
  const [enabledOptionalConnections, setEnabledOptionalConnections] = useState<readonly OptionalConnectionId[]>(DEFAULT_ENABLED_OPTIONAL_CONNECTIONS);
  const [customLogoDataUrl, setCustomLogoDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadGeneration, setLoadGeneration] = useState(0);
  const [saving, setSaving] = useState(false);
  const [settingsTemplateBusy, setSettingsTemplateBusy] = useState(false);
  const [logoPicking, setLogoPicking] = useState(false);
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState('');
  const [credentialVaultState, setCredentialVaultState] = useState<'uninitialized' | 'available' | 'locked' | 'unavailable'>('uninitialized');
  const [credentialVaultMode, setCredentialVaultMode] = useState<'windows-account' | 'master-password'>('windows-account');
  const [credentialVaultBusy, setCredentialVaultBusy] = useState(false);
  const [credentialVaultError, setCredentialVaultError] = useState<string>();
  const [credentialBundleStatus, setCredentialBundleStatus] = useState('');
  const dialog = useRef<HTMLElement>(null);
  const loadedPreferences = useRef<WorkbenchPreferences | undefined>(undefined);
  const closeButton = useRef<HTMLButtonElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const greetingInput = useRef<HTMLTextAreaElement>(null);
  const normalizedRules = normalizeTerminalHighlightRules(terminalHighlightRules);
  const greetingIsValid = Boolean(normalizeWorkbenchPreferences({ startupGreeting: greeting }));
  const profileScriptIsValid = normalizePowerShellProfileScript(powerShellProfileScript) !== undefined;
  const profileScriptDirty = powerShellProfileScript !== savedPowerShellProfileScript;
  const profileActionBusy = profilePreviewBusy || profileApplyBusy;
  const validatedPreferences = normalizeWorkbenchPreferences({
    startupGreeting: greeting, powerShellProfileScript, terminalHighlightEnabled, terminalHighlightRules, autoSaveSessions, terminalShellSyntaxEnabled,
    showSftpBrowserBesideSsh, visibleLocalShells, enabledLocalShells, enabledOptionalConnections, customLogoDataUrl
  });
  const characterCount = Array.from(greeting).length;

  function loadPreferencesIntoDraft(preferences: WorkbenchPreferences): void {
    setGreeting(preferences.startupGreeting);
    setPowerShellProfileScript(preferences.powerShellProfileScript);
    setTerminalHighlightEnabled(preferences.terminalHighlightEnabled);
    setTerminalHighlightRules(preferences.terminalHighlightRules);
    setAutoSaveSessions(preferences.autoSaveSessions);
    setTerminalShellSyntaxEnabled(preferences.terminalShellSyntaxEnabled);
    setShowSftpBrowserBesideSsh(preferences.showSftpBrowserBesideSsh);
    setVisibleLocalShells(preferences.visibleLocalShells);
    setEnabledLocalShells(preferences.enabledLocalShells);
    setEnabledOptionalConnections(preferences.enabledOptionalConnections);
    setCustomLogoDataUrl(preferences.customLogoDataUrl);
    setProfilePreview(undefined);
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    setError(undefined);
    closeButton.current?.focus();
    void window.multiRemoteTerminal.getWorkbenchSettingsPreferences().then(reply => {
      if (!active) return;
      if (reply.ok) {
        loadedPreferences.current = reply.result;
        loadPreferencesIntoDraft(reply.result);
        setSavedPowerShellProfileScript(reply.result.powerShellProfileScript);
      }
      else {
        setLoadFailed(true);
        setError(workbenchPreferenceFailureMessage('load', reply.error.code));
      }
    }).catch(() => {
      if (active) {
        setLoadFailed(true);
        setError(workbenchPreferenceFailureMessage('load', undefined));
      }
    }).finally(() => {
      if (active) setLoading(false);
    });
    void window.multiRemoteTerminal.getCredentialVaultState().then(reply => {
      if (!active) return;
      if (reply.ok) {
        setCredentialVaultState(reply.result.state);
        setCredentialVaultMode(reply.result.mode);
        setCredentialVaultError(undefined);
      } else {
        setCredentialVaultState('unavailable');
        setCredentialVaultError(`Credential vault status could not be loaded (${reply.error.code}).`);
      }
    }, () => {
      if (active) {
        setCredentialVaultState('unavailable');
        setCredentialVaultError('Credential vault status could not be loaded.');
      }
    });
    return () => { active = false; };
  }, [loadGeneration]);

  useEffect(() => {
    setProfilePreview(undefined);
    setProfileStatus('');
  }, [activePowerShellSessionId]);

  useEffect(() => {
    if (loadFailed) retryButton.current?.focus();
    else if (!loading) greetingInput.current?.focus();
  }, [loadFailed, loading]);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      if (!saving && !logoPicking && !profileActionBusy && !settingsTemplateBusy && !credentialVaultBusy) { event.preventDefault(); onClose(); }
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...(dialog.current?.querySelectorAll<HTMLElement>(
      'input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), [tabindex]:not([tabindex="-1"])'
    ) ?? [])];
    if (focusable.length === 0) { event.preventDefault(); return; }
    const current = focusable.indexOf(document.activeElement as HTMLElement);
    if (event.shiftKey && current <= 0) {
      event.preventDefault();
      focusable.at(-1)?.focus();
    } else if (!event.shiftKey && current === focusable.length - 1) {
      event.preventDefault();
      focusable[0]?.focus();
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || loadFailed || saving || logoPicking || profileActionBusy || settingsTemplateBusy || !validatedPreferences) return;
    setSaving(true);
    setError(undefined);
    setStatus('Saving…');
    try {
      const reply = await window.multiRemoteTerminal.saveWorkbenchPreferences(validatedPreferences);
      if (!reply.ok) {
        setError(reply.error.code === 'INVALID_REQUEST'
          ? 'Check your settings and try again.'
          : workbenchPreferenceFailureMessage('save', reply.error.code));
        setStatus('');
      } else {
        loadedPreferences.current = reply.result;
        loadPreferencesIntoDraft(reply.result);
        setSavedPowerShellProfileScript(reply.result.powerShellProfileScript);
        onPreferencesSaved(reply.result);
        setStatus('Settings saved.');
      }
    } catch {
      setError(workbenchPreferenceFailureMessage('save', undefined));
      setStatus('');
    } finally { setSaving(false); }
  }

  async function chooseCustomLogo(): Promise<void> {
    if (loading || loadFailed || saving || logoPicking) return;
    setLogoPicking(true);
    setError(undefined);
    setStatus('');
    try {
      const reply = await window.multiRemoteTerminal.selectCustomLogo();
      if (reply.ok) {
        setCustomLogoDataUrl(reply.result.dataUrl);
        setStatus('Logo selected. Save changes to apply it.');
      } else if (reply.error.code !== 'CANCELLED') {
        setError(reply.error.code === 'INVALID_REQUEST'
          ? `Choose a valid PNG image no larger than 1 MiB or ${MAX_CUSTOM_LOGO_DIMENSION} × ${MAX_CUSTOM_LOGO_DIMENSION} pixels.`
          : 'The logo could not be read. Choose another PNG image and try again.');
      }
    } catch {
      setError('The logo could not be selected. Try again.');
    } finally { setLogoPicking(false); }
  }

  async function exportSettingsTemplate(): Promise<void> {
    if (loading || loadFailed || saving || settingsTemplateBusy || !validatedPreferences) return;
    setSettingsTemplateBusy(true);
    setError(undefined);
    setStatus('');
    try {
      const reply = await window.multiRemoteTerminal.exportWorkbenchSettingsTemplate(validatedPreferences);
      if (reply.ok) setStatus('Settings template exported. Review the included PowerShell script before sharing the file.');
      else if (reply.error.code !== 'CANCELLED') setError(`Settings template could not be exported (${reply.error.code}).`);
    } catch { setError('Settings template could not be exported. Try again.'); }
    finally { setSettingsTemplateBusy(false); }
  }

  async function importSettingsTemplate(): Promise<void> {
    if (loading || loadFailed || saving || settingsTemplateBusy) return;
    if ((!validatedPreferences || JSON.stringify(validatedPreferences) !== JSON.stringify(loadedPreferences.current)) &&
        !window.confirm('Loading a settings template replaces your unsaved settings draft. Continue?')) return;
    setSettingsTemplateBusy(true);
    setError(undefined);
    setStatus('');
    try {
      const reply = await window.multiRemoteTerminal.importWorkbenchSettingsTemplate();
      if (reply.ok) {
        loadPreferencesIntoDraft(reply.result);
        setProfileStatus('');
        setStatus('Template loaded into this draft. Review it and save changes to apply.');
      } else if (reply.error.code !== 'CANCELLED') {
        setError(reply.error.code === 'INVALID_REQUEST' ? 'The selected file is not a valid settings template or exceeds the size limit.'
          : `Settings template could not be imported (${reply.error.code}).`);
      }
    } catch { setError('Settings template could not be imported. Try again.'); }
    finally { setSettingsTemplateBusy(false); }
  }

  async function previewPowerShellProfileScript(): Promise<void> {
    if (!activePowerShellSessionId || loading || loadFailed || saving || profilePreviewBusy || profileApplyBusy ||
        profileScriptDirty || !profileScriptIsValid || savedPowerShellProfileScript.length === 0) return;
    setProfilePreviewBusy(true);
    setProfilePreview(undefined);
    setProfileStatus('Loading the saved script preview…');
    setError(undefined);
    try {
      const reply = await window.multiRemoteTerminal.previewPowerShellProfileScript(activePowerShellSessionId);
      if (!reply.ok) {
        setProfileStatus(reply.error.code === 'INVALID_REQUEST' ? 'Save a non-empty script before previewing it.'
          : `The saved script could not be previewed (${reply.error.code}).`);
      } else {
        setProfilePreview({ sessionId: activePowerShellSessionId, ...reply.result });
        setProfileStatus('Preview loaded. Review it before running it in this PowerShell session.');
      }
    } catch {
      setProfileStatus('The saved script could not be previewed. Try again.');
    } finally { setProfilePreviewBusy(false); }
  }

  async function applyPowerShellProfileScript(): Promise<void> {
    const preview = profilePreview;
    if (!preview || profileScriptDirty || !activePowerShellSessionId || preview.sessionId !== activePowerShellSessionId ||
        loading || loadFailed || saving || profilePreviewBusy || profileApplyBusy) return;
    setProfileApplyBusy(true);
    setProfileStatus('Sending the reviewed script to the active PowerShell session…');
    setError(undefined);
    try {
      const reply = await window.multiRemoteTerminal.applyPowerShellProfileScript(preview.sessionId, preview.previewId);
      setProfilePreview(undefined);
      setProfileStatus(reply.ok ? 'Script sent to the active PowerShell session.'
        : reply.error.code === 'CONFLICT' ? 'The saved script changed after preview. Load a new preview before running it.'
          : reply.error.code === 'FORBIDDEN' ? 'Run authorization expired. Load a new preview, review it, then click Run again.'
            : `The script could not be sent to this PowerShell session (${reply.error.code}).`);
    } catch {
      setProfilePreview(undefined);
      setProfileStatus('The script could not be sent to this PowerShell session. Try again.');
    } finally { setProfileApplyBusy(false); }
  }

  async function updateVaultFromReply(reply: Awaited<ReturnType<typeof window.multiRemoteTerminal.unlockCredentialVault>>, action: string) {
    if (reply.ok) {
      setCredentialVaultState(reply.result.state);
      setCredentialVaultMode(reply.result.mode);
      setCredentialVaultError(undefined);
      return;
    }
    try {
      const current = await window.multiRemoteTerminal.getCredentialVaultState();
      if (current.ok) {
        setCredentialVaultState(current.result.state);
        setCredentialVaultMode(current.result.mode);
      }
    } catch { /* Preserve the original operation error if status refresh fails. */ }
    if (reply.error.code === 'AUTHENTICATION_FAILED') setCredentialVaultError('That master password was not accepted.');
    else if (reply.error.code === 'CONFLICT' && action === 'enable') setCredentialVaultError('The two master passwords did not match. Try again.');
    else if (reply.error.code === 'CONFLICT' && action === 'reset') setCredentialVaultError('Saved passwords were deleted, but session references could not be cleared. Saved sessions remain; opening one will ask for its password again.');
    else if (reply.error.code === 'LOCKED') setCredentialVaultError('The vault is locked. Wait before trying again, then unlock it.');
    else setCredentialVaultError(`Credential vault could not be ${action} (${reply.error.code}).`);
  }

  async function changeCredentialVaultLock() {
    if (credentialVaultBusy) return;
    setCredentialVaultBusy(true);
    setCredentialVaultError(undefined);
    try {
      if (credentialVaultState === 'available') {
        const reply = await window.multiRemoteTerminal.lockCredentialVault();
        if (reply.ok) setCredentialVaultState('locked');
        else setCredentialVaultError(`Credential vault could not be locked (${reply.error.code}).`);
      } else {
        const reply = await window.multiRemoteTerminal.unlockCredentialVault();
        await updateVaultFromReply(reply, 'unlocked');
      }
    } catch { setCredentialVaultError('Credential vault could not be updated.'); }
    finally { setCredentialVaultBusy(false); }
  }

  async function changeCredentialVaultMode() {
    if (credentialVaultBusy) return;
    setCredentialVaultBusy(true);
    setCredentialVaultError(undefined);
    try {
      const reply = credentialVaultMode === 'windows-account'
        ? await window.multiRemoteTerminal.enableMasterPasswordVault()
        : await window.multiRemoteTerminal.disableMasterPasswordVault();
      await updateVaultFromReply(reply, credentialVaultMode === 'windows-account' ? 'enable' : 'change protection');
    } catch { setCredentialVaultError('Credential protection could not be changed.'); }
    finally { setCredentialVaultBusy(false); }
  }

  async function resetCredentialVault() {
    if (credentialVaultBusy || !window.confirm('Delete every saved password? Your saved sessions will remain, but their passwords must be entered again.')) return;
    setCredentialVaultBusy(true);
    setCredentialVaultError(undefined);
    try {
      const reply = await window.multiRemoteTerminal.resetCredentialVault();
      await updateVaultFromReply(reply, 'reset');
    } catch { setCredentialVaultError('Saved passwords could not be reset.'); }
    finally { setCredentialVaultBusy(false); }
  }

  async function exportSshCredentialBundle() {
    if (credentialVaultBusy || credentialVaultState !== 'available') return;
    setCredentialVaultBusy(true);
    setCredentialVaultError(undefined);
    setCredentialBundleStatus('');
    try {
      const reply = await window.multiRemoteTerminal.exportSshCredentialBundle();
      if (reply.ok) setCredentialBundleStatus(reply.result.credentialCount === 0
        ? 'No saved SSH passwords were available to export.'
        : `Encrypted bundle exported with ${reply.result.credentialCount} saved SSH password${reply.result.credentialCount === 1 ? '' : 's'}.`);
      else if (reply.error.code !== 'CANCELLED') setCredentialVaultError(sshCredentialBundleError(reply.error.code));
    } catch { setCredentialVaultError('Encrypted SSH credentials could not be exported.'); }
    finally { setCredentialVaultBusy(false); }
  }

  async function importSshCredentialBundle() {
    if (credentialVaultBusy || credentialVaultState !== 'available') return;
    setCredentialVaultBusy(true);
    setCredentialVaultError(undefined);
    setCredentialBundleStatus('');
    try {
      const reply = await window.multiRemoteTerminal.importSshCredentialBundle();
      if (reply.ok) setCredentialBundleStatus(`Imported ${reply.result.credentialCount} saved SSH password${reply.result.credentialCount === 1 ? '' : 's'}.`);
      else if (reply.error.code !== 'CANCELLED') setCredentialVaultError(sshCredentialBundleError(reply.error.code));
    } catch { setCredentialVaultError('Encrypted SSH credentials could not be imported.'); }
    finally { setCredentialVaultBusy(false); }
  }

  return <div className="settings-backdrop" onMouseDown={event => {
    if (event.target === event.currentTarget && !saving && !logoPicking && !profileActionBusy && !settingsTemplateBusy && !credentialVaultBusy) onClose();
  }}>
    <section ref={dialog} className="settings-dialog" role="dialog" aria-modal="true"
      aria-labelledby="settings-heading" aria-describedby="settings-description" onKeyDown={handleKeyDown}>
      <header className="settings-header">
        <div>
          <h2 id="settings-heading">Workbench settings</h2>
          <p id="settings-description">Review connection security, manage saved-password protection, and control terminal tools and workbench preferences.</p>
        </div>
        <button ref={closeButton} type="button" className="quiet-button" disabled={saving || logoPicking || profileActionBusy || settingsTemplateBusy || credentialVaultBusy} onClick={onClose}>Close</button>
      </header>
      <form className="settings-form" onSubmit={event => { void save(event); }}>
        <section className="settings-highlights" aria-labelledby="custom-logo-heading">
          <h3 id="custom-logo-heading">Workbench logo</h3>
          <p className="settings-highlight-help">
            Choose a PNG up to {MAX_CUSTOM_LOGO_SOURCE_BYTES / 1_048_576} MiB and {MAX_CUSTOM_LOGO_DIMENSION} × {MAX_CUSTOM_LOGO_DIMENSION} pixels. The app saves a normalized copy with your settings.
          </p>
          {customLogoDataUrl && <img className="settings-custom-logo-preview" src={customLogoDataUrl} alt="Selected workbench logo" width={96} height={96} />}
          <div className="ssh-connect-actions">
            <button type="button" disabled={loading || loadFailed || saving || logoPicking} onClick={() => void chooseCustomLogo()}>
              {logoPicking ? 'Reading image…' : 'Choose PNG logo'}
            </button>
            <button type="button" disabled={loading || loadFailed || saving || logoPicking || !customLogoDataUrl}
              onClick={() => { setCustomLogoDataUrl(null); setError(undefined); setStatus('The built-in wordmark will be used after you save.'); }}>
              Use built-in wordmark
            </button>
          </div>
        </section>
        <section className="settings-highlights" role="group" aria-labelledby="optional-connections-heading"
          aria-describedby="optional-connections-description">
          <h3 id="optional-connections-heading">Optional connection types</h3>
          <p className="settings-highlight-help" id="optional-connections-description">
            Choose which built-in connection types can start new work. Disabling one hides its launch action and blocks new opens, including saved-profile reopen. Existing sessions remain available to finish and close.
          </p>
          {OPTIONAL_CONNECTION_TOOL_REGISTRY.map(tool => {
            const inputId = `optional-connection-${tool.id}`;
            const descriptionId = `${inputId}-description`;
            return <div key={tool.id}>
              <label className="settings-highlight-toggle" htmlFor={inputId}>
                <input id={inputId} name={`enabledOptionalConnections.${tool.id}`} type="checkbox"
                  checked={enabledOptionalConnections.includes(tool.id)} disabled={loading || loadFailed || saving}
                  aria-describedby={descriptionId}
                  onChange={event => {
                    const selected = new Set(enabledOptionalConnections);
                    if (event.target.checked) selected.add(tool.id);
                    else selected.delete(tool.id);
                    setEnabledOptionalConnections(OPTIONAL_CONNECTION_TOOL_REGISTRY
                      .filter(candidate => selected.has(candidate.id)).map(candidate => candidate.id));
                    setError(undefined);
                    setStatus('');
                  }} />
                <span>{tool.settingLabel}</span>
              </label>
              <p className="settings-highlight-help" id={descriptionId}>{tool.description}</p>
            </div>;
          })}
        </section>
        <section className="settings-highlights" aria-labelledby="security-policy-heading">
          <h3 id="security-policy-heading">Security policy</h3>
          <p className="settings-highlight-help"><strong>SSH host keys.</strong> New SSH hosts require explicit fingerprint approval. A changed key blocks the connection. Verify the new fingerprint independently before resetting saved host trust and reconnecting.</p>
          <p className="settings-highlight-help"><strong>Local and SOCKS tunnels.</strong> Local and SOCKS tunnels bind to 127.0.0.1, so other devices cannot connect to them directly.</p>
          <p className="settings-highlight-help"><strong>Remote forwarding.</strong> Remote forwarding requests 127.0.0.1, but the server's GatewayPorts policy may expose the listener more widely. Review the server's forwarding policy before starting.</p>
        </section>
        <div className="settings-highlights">
          <h3>Credential vault</h3>
          <p className="settings-highlight-help">
            {credentialVaultMode === 'windows-account'
              ? 'Saved SSH passwords use Windows account protection. It does not protect them from malware running as your Windows user. You can switch to a master password for portable, encrypted vault data.'
              : 'Saved SSH passwords use a master password and stay locked after each app restart. The password cannot be recovered. Malware running as your Windows user may still access data while the app is unlocked.'}
          </p>
          <p>Protection: {credentialVaultMode === 'windows-account' ? 'Windows account' : 'Master password'}</p>
          <p role="status" aria-live="polite">Status: {credentialVaultState === 'available' ? 'Unlocked'
            : credentialVaultState === 'locked' ? 'Locked' : credentialVaultState === 'uninitialized' ? 'Starting' : 'Unavailable'}</p>
          {credentialVaultError && <p className="dialog-error" role="alert">{credentialVaultError}</p>}
          {credentialBundleStatus && <p role="status" aria-live="polite">{credentialBundleStatus}</p>}
          <button type="button" className="settings-highlight-add" disabled={credentialVaultBusy || saving || logoPicking}
            onClick={() => void changeCredentialVaultLock()}>
            {credentialVaultBusy ? 'Updating…' : credentialVaultState === 'available' ? 'Lock credentials' : 'Unlock credentials'}
          </button>
          <button type="button" className="settings-highlight-add" disabled={credentialVaultBusy || saving || logoPicking || credentialVaultState === 'unavailable' || credentialVaultState === 'uninitialized'}
            onClick={() => void changeCredentialVaultMode()}>
            {credentialVaultBusy ? 'Updating…' : credentialVaultMode === 'windows-account' ? 'Use a master password' : 'Use Windows account protection'}
          </button>
          <button type="button" className="settings-highlight-add" disabled={credentialVaultBusy || saving || logoPicking}
            onClick={() => void resetCredentialVault()}>
            Delete saved passwords
          </button>
          <p className="settings-highlight-help">
            Encrypted bundles contain saved SSH passwords only. Import requires the matching saved SSH profiles and never replaces an existing password.
          </p>
          <button type="button" className="settings-highlight-add" disabled={credentialVaultBusy || saving || logoPicking || credentialVaultState !== 'available'}
            onClick={() => void exportSshCredentialBundle()}>
            Export encrypted SSH passwords…
          </button>
          <button type="button" className="settings-highlight-add" disabled={credentialVaultBusy || saving || logoPicking || credentialVaultState !== 'available'}
            onClick={() => void importSshCredentialBundle()}>
            Import encrypted SSH passwords…
          </button>
        </div>
        <div className="settings-highlights">
          <label className="settings-highlight-toggle" htmlFor="show-sftp-browser-beside-ssh">
            <input id="show-sftp-browser-beside-ssh" name="showSftpBrowserBesideSsh" type="checkbox" checked={showSftpBrowserBesideSsh}
              disabled={loading || loadFailed || saving} aria-describedby="show-sftp-browser-beside-ssh-description"
              onChange={event => { setShowSftpBrowserBesideSsh(event.target.checked); setError(undefined); setStatus(''); }} />
            <span>Show the remote file pane beside SSH terminals</span>
          </label>
          <p id="show-sftp-browser-beside-ssh-description" className="settings-highlight-help">
            Turn this off to keep SSH terminals full width. You can still connect to SFTP in a files-only tab.
          </p>
        </div>
        <section className="settings-highlights" role="group" aria-labelledby="local-shell-tools-heading"
          aria-describedby="local-shell-tools-description">
          <h3 id="local-shell-tools-heading">Local terminal tools</h3>
          <p className="settings-highlight-help" id="local-shell-tools-description">
            Choose which shell actions appear in the command palette. This does not install shells or change saved sessions.
          </p>
          {LOCAL_SHELL_TOOL_REGISTRY.map(tool => {
            const inputId = `visible-local-shell-${tool.shell}`;
            const descriptionId = `${inputId}-description`;
            return <div key={tool.shell}>
              <label className="settings-highlight-toggle" htmlFor={inputId}>
                <input id={inputId} name={`visibleLocalShells.${tool.shell}`} type="checkbox" checked={visibleLocalShells.includes(tool.shell)}
                  disabled={loading || loadFailed || saving} aria-describedby={descriptionId}
                  onChange={event => {
                    const shouldShow = event.target.checked;
                    setVisibleLocalShells(current => shouldShow
                      ? LOCAL_SHELL_TOOL_REGISTRY.filter(candidate => candidate.shell === tool.shell || current.includes(candidate.shell))
                        .map(candidate => candidate.shell)
                      : current.filter(shell => shell !== tool.shell));
                    setError(undefined);
                    setStatus('');
                  }} />
                <span>Show {tool.label} in command palette</span>
              </label>
              <p className="settings-highlight-help" id={descriptionId}>{tool.description}</p>
            </div>;
          })}
        </section>
        <section className="settings-highlights" role="group" aria-labelledby="local-shell-availability-heading"
          aria-describedby="local-shell-availability-description">
          <h3 id="local-shell-availability-heading">Local shell availability</h3>
          <p className="settings-highlight-help" id="local-shell-availability-description">
            Disabled shells cannot start new sessions or reopen saved profiles. Existing sessions stay open and can be closed, and saved profiles are kept. If PowerShell is disabled, the app skips its startup terminal without choosing another shell.
          </p>
          {LOCAL_SHELL_TOOL_REGISTRY.map(tool => {
            const inputId = `enabled-local-shell-${tool.shell}`;
            const descriptionId = `${inputId}-description`;
            return <div key={tool.shell}>
              <label className="settings-highlight-toggle" htmlFor={inputId}>
                <input id={inputId} name={`enabledLocalShells.${tool.shell}`} type="checkbox" checked={enabledLocalShells.includes(tool.shell)}
                  disabled={loading || loadFailed || saving} aria-describedby={descriptionId}
                  onChange={event => {
                    const shouldEnable = event.target.checked;
                    setEnabledLocalShells(current => shouldEnable
                      ? LOCAL_SHELL_TOOL_REGISTRY.filter(candidate => candidate.shell === tool.shell || current.includes(candidate.shell))
                        .map(candidate => candidate.shell)
                      : current.filter(shell => shell !== tool.shell));
                    setError(undefined);
                    setStatus('');
                  }} />
                <span>Allow {tool.label} sessions</span>
              </label>
              <p className="settings-highlight-help" id={descriptionId}>{tool.description}</p>
            </div>;
          })}
        </section>
        <div className="settings-highlights">
          <label className="settings-highlight-toggle" htmlFor="auto-save-sessions">
            <input id="auto-save-sessions" type="checkbox" checked={autoSaveSessions}
              disabled={loading || loadFailed || saving}
              onChange={event => { setAutoSaveSessions(event.target.checked); setError(undefined); setStatus(''); }} />
            <span>Automatically save connections I open</span>
          </label>
          <p className="settings-highlight-help">
            Successful terminal and file connections appear in Saved sessions and move to the top when reopened. Passwords, keys, and terminal contents are never saved.
          </p>
        </div>
        <label htmlFor="startup-greeting">Startup greeting</label>
        <textarea ref={greetingInput} id="startup-greeting" name="startupGreeting" rows={5} maxLength={MAX_STARTUP_GREETING_CODE_POINTS * 2}
          disabled={loading || loadFailed || saving} value={greeting} onChange={event => { setGreeting(event.target.value); setError(undefined); setStatus(''); }} />
        <div className="settings-form-meta">
          <span>{characterCount} / {MAX_STARTUP_GREETING_CODE_POINTS} Unicode characters</span>
          {characterCount > MAX_STARTUP_GREETING_CODE_POINTS
            ? <span className="dialog-error" role="alert">Use no more than {MAX_STARTUP_GREETING_CODE_POINTS} Unicode characters.</span>
            : !greetingIsValid && <span className="dialog-error" role="alert">Omit control characters other than new lines and tabs.</span>}
        </div>
        <section className="settings-highlights" aria-labelledby="powershell-profile-heading"
          aria-describedby="powershell-profile-description powershell-profile-warning">
          <h3 id="powershell-profile-heading">PowerShell profile script</h3>
          <p id="powershell-profile-description" className="settings-highlight-help">
            Save a local script here, then preview the saved text and explicitly run it in an already open local PowerShell tab.
          </p>
          <label htmlFor="powershell-profile-script">Saved PowerShell script</label>
          <textarea id="powershell-profile-script" name="powerShellProfileScript" rows={7}
            maxLength={MAX_POWERSHELL_PROFILE_SCRIPT_CODE_UNITS} spellCheck={false}
            disabled={loading || loadFailed || saving || profileActionBusy}
            value={powerShellProfileScript} onChange={event => {
              setPowerShellProfileScript(event.target.value);
              setProfilePreview(undefined);
              setProfileStatus('');
              setError(undefined);
              setStatus('');
            }} />
          <div className="settings-form-meta">
            <span>{powerShellProfileScript.length} / {MAX_POWERSHELL_PROFILE_SCRIPT_CODE_UNITS} UTF-16 code units</span>
            {!profileScriptIsValid && <span className="dialog-error" role="alert">Remove control, bidirectional formatting, and Unicode line separator characters, and keep the script within the size limit.</span>}
          </div>
          <p id="powershell-profile-warning" className="settings-profile-warning">
            Scripts are stored locally as plain text. PowerShell can change files and contact network services. Review the exact saved script before each run. It never runs at app startup or when a terminal opens.
          </p>
          {profileScriptDirty && <p className="settings-highlight-help" role="status">Save changes before previewing this script.</p>}
          <div className="ssh-connect-actions settings-profile-actions">
            <button type="button" disabled={loading || loadFailed || saving || profileActionBusy || !activePowerShellSessionId ||
              profileScriptDirty || !profileScriptIsValid || savedPowerShellProfileScript.length === 0}
              onClick={() => void previewPowerShellProfileScript()}>
              {profilePreviewBusy ? 'Loading preview…' : 'Preview saved script'}
            </button>
            <button type="button" className="ssh-primary" data-mrt-powershell-profile-trigger={activePowerShellSessionId}
              disabled={loading || loadFailed || saving || profileActionBusy || !activePowerShellSessionId || profileScriptDirty ||
                !profilePreview || profilePreview.sessionId !== activePowerShellSessionId}
              onClick={() => void applyPowerShellProfileScript()}>
              {profileApplyBusy ? 'Sending…' : 'Run in this PowerShell session'}
            </button>
          </div>
          {!activePowerShellSessionId && <p className="settings-highlight-help">Open and select a running local PowerShell tab to preview or run the script.</p>}
          {profilePreview && profilePreview.sessionId === activePowerShellSessionId && <div className="settings-profile-preview" aria-labelledby="powershell-profile-preview-heading">
            <h4 id="powershell-profile-preview-heading">Exact saved script preview</h4>
            <pre tabIndex={0} aria-label="Exact saved PowerShell script preview">{profilePreview.script}</pre>
            <p className="settings-highlight-help">Run only when PowerShell is at an idle prompt. This sends the script as terminal input; if another program is running or waiting for input, it may receive the text instead.</p>
          </div>}
          {profileStatus && <p className="settings-save-status" role="status" aria-live="polite">{profileStatus}</p>}
        </section>
        <div className="settings-highlights">
          <label className="settings-highlight-toggle" htmlFor="terminal-shell-syntax-enabled">
            <input id="terminal-shell-syntax-enabled" type="checkbox" checked={terminalShellSyntaxEnabled}
              disabled={loading || loadFailed || saving} aria-describedby="terminal-shell-syntax-description"
              onChange={event => { setTerminalShellSyntaxEnabled(event.target.checked); setError(undefined); setStatus(''); }} />
            <span>Color Shell and PowerShell input at prompts</span>
          </label>
          <p id="terminal-shell-syntax-description" className="settings-highlight-help">
            Colors common Shell and PowerShell commands, keywords, options, variables, strings, and other tokens while you type at recognized prompts. PowerShell continuation colors also cover an unquoted trailing backtick, selected natural operators, and balanced open delimiters up to 32 levels. This bounded lexical aid does not change terminal input or output.
          </p>
          <label className="settings-highlight-toggle" htmlFor="terminal-highlight-enabled">
            <input id="terminal-highlight-enabled" type="checkbox" checked={terminalHighlightEnabled}
              disabled={loading || loadFailed || saving}
              onChange={event => { setTerminalHighlightEnabled(event.target.checked); setError(undefined); setStatus(''); }} />
            <span>Highlight matching terminal text</span>
          </label>
          <p id="terminal-highlight-description" className="settings-highlight-help">
            Rules use RE2 regular expressions and apply to parsed terminal text. They do not change commands or received ANSI data.
          </p>
          <div className="settings-highlight-rules" aria-describedby="terminal-highlight-description">
            {terminalHighlightRules.map((rule, index) => <div className="settings-highlight-rule" key={index}>
              <label className="visually-hidden" htmlFor={`terminal-highlight-pattern-${index}`}>Rule {index + 1} pattern</label>
              <input id={`terminal-highlight-pattern-${index}`} type="text" autoComplete="off"
                maxLength={MAX_TERMINAL_HIGHLIGHT_PATTERN_CODE_POINTS * 2}
                disabled={loading || loadFailed || saving} value={rule.pattern}
                onChange={event => {
                  setTerminalHighlightRules(current => current.map((item, itemIndex) => itemIndex === index
                    ? { ...item, pattern: event.target.value } : item));
                  setError(undefined); setStatus('');
                }} />
              <label className="visually-hidden" htmlFor={`terminal-highlight-color-${index}`}>Rule {index + 1} color</label>
              <select id={`terminal-highlight-color-${index}`} value={rule.color} disabled={loading || loadFailed || saving}
                onChange={event => {
                  setTerminalHighlightRules(current => current.map((item, itemIndex) => itemIndex === index
                    ? { ...item, color: event.target.value as TerminalHighlightColor } : item));
                  setError(undefined); setStatus('');
                }}>
                {TERMINAL_HIGHLIGHT_COLORS.map(color => <option key={color} value={color}>{color[0]!.toUpperCase() + color.slice(1)}</option>)}
              </select>
              <button type="button" className="settings-highlight-remove" disabled={loading || loadFailed || saving}
                aria-label={`Remove highlight rule ${index + 1}`} onClick={() => {
                  setTerminalHighlightRules(current => current.filter((_, itemIndex) => itemIndex !== index));
                  setError(undefined); setStatus('');
                }}>Remove</button>
            </div>)}
          </div>
          {!normalizedRules && <p className="dialog-error" role="alert">
            Use valid RE2 patterns with up to {MAX_TERMINAL_HIGHLIGHT_PATTERN_CODE_POINTS} Unicode characters and one of the listed colors. Add no more than {MAX_TERMINAL_HIGHLIGHT_RULES} rules.
          </p>}
          <button type="button" className="settings-highlight-add" disabled={loading || loadFailed || saving || terminalHighlightRules.length >= MAX_TERMINAL_HIGHLIGHT_RULES}
            onClick={() => {
              setTerminalHighlightRules(current => [...current, { pattern: '', color: 'cyan' }]);
              setError(undefined); setStatus('');
            }}>Add rule</button>
        </div>
        {error && <p className="dialog-error" role="alert">{error}</p>}
        {loadFailed && <button ref={retryButton} type="button" disabled={saving} onClick={() => setLoadGeneration(value => value + 1)}>Try loading settings again</button>}
        {status && <p className="settings-save-status" role="status">{status}</p>}
        <section className="settings-highlights" aria-labelledby="settings-template-heading">
          <h3 id="settings-template-heading">Settings profile</h3>
          <p className="settings-highlight-help">
            Export the current draft or load a versioned JSON template. Templates contain workbench settings and saved PowerShell script text, but no saved connection credentials. Review script text before sharing; importing it never runs it. Loading replaces unsaved changes and only changes this draft until you save.
          </p>
          <div className="ssh-connect-actions">
            <button type="button" disabled={loading || loadFailed || saving || settingsTemplateBusy || !validatedPreferences}
              onClick={() => void exportSettingsTemplate()}>{settingsTemplateBusy ? 'Working…' : 'Export settings template…'}</button>
            <button type="button" disabled={loading || loadFailed || saving || settingsTemplateBusy}
              onClick={() => void importSettingsTemplate()}>{settingsTemplateBusy ? 'Working…' : 'Load settings template…'}</button>
          </div>
        </section>
        <div className="ssh-connect-actions">
          <button type="button" disabled={saving || logoPicking || profileActionBusy || settingsTemplateBusy || credentialVaultBusy} onClick={onClose}>Cancel</button>
          <button type="submit" className="ssh-primary" disabled={loading || loadFailed || saving || logoPicking || profileActionBusy || settingsTemplateBusy || !validatedPreferences}>
            {loading ? 'Loading…' : saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </section>
  </div>;
}
