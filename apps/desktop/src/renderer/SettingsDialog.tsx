import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, FormEvent } from 'react';
import { MAX_STARTUP_GREETING_CODE_POINTS, normalizeWorkbenchPreferences } from '../../../../packages/domain/src/workbench-preferences.ts';
import type { WorkbenchPreferences } from '../../../../packages/domain/src/workbench-preferences.ts';
import { MAX_TERMINAL_HIGHLIGHT_PATTERN_CODE_POINTS, MAX_TERMINAL_HIGHLIGHT_RULES,
  normalizeTerminalHighlightRules, TERMINAL_HIGHLIGHT_COLORS } from '../../../../packages/domain/src/terminal-highlights.ts';
import type { TerminalHighlightColor, TerminalHighlightRule } from '../../../../packages/domain/src/terminal-highlights.ts';
import { workbenchPreferenceFailureMessage } from './workbench-preference-errors.ts';

export function SettingsDialog({ onClose, onPreferencesSaved }: {
  readonly onClose: () => void;
  readonly onPreferencesSaved: (preferences: WorkbenchPreferences) => void;
}) {
  const [greeting, setGreeting] = useState('');
  const [terminalHighlightEnabled, setTerminalHighlightEnabled] = useState(false);
  const [terminalHighlightRules, setTerminalHighlightRules] = useState<readonly TerminalHighlightRule[]>([]);
  const [autoSaveSessions, setAutoSaveSessions] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadGeneration, setLoadGeneration] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState('');
  const [credentialVaultState, setCredentialVaultState] = useState<'uninitialized' | 'available' | 'locked' | 'unavailable'>('uninitialized');
  const [credentialVaultMode, setCredentialVaultMode] = useState<'windows-account' | 'master-password'>('windows-account');
  const [credentialVaultBusy, setCredentialVaultBusy] = useState(false);
  const [credentialVaultError, setCredentialVaultError] = useState<string>();
  const dialog = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const greetingInput = useRef<HTMLTextAreaElement>(null);
  const normalizedRules = normalizeTerminalHighlightRules(terminalHighlightRules);
  const greetingIsValid = Boolean(normalizeWorkbenchPreferences({ startupGreeting: greeting }));
  const validatedPreferences = normalizeWorkbenchPreferences({
    startupGreeting: greeting, terminalHighlightEnabled, terminalHighlightRules, autoSaveSessions
  });
  const characterCount = Array.from(greeting).length;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    setError(undefined);
    closeButton.current?.focus();
    void window.multiRemoteTerminal.getWorkbenchPreferences().then(reply => {
      if (!active) return;
      if (reply.ok) {
        setGreeting(reply.result.startupGreeting);
        setTerminalHighlightEnabled(reply.result.terminalHighlightEnabled);
        setTerminalHighlightRules(reply.result.terminalHighlightRules);
        setAutoSaveSessions(reply.result.autoSaveSessions);
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
    if (loadFailed) retryButton.current?.focus();
    else if (!loading) greetingInput.current?.focus();
  }, [loadFailed, loading]);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      if (!saving) { event.preventDefault(); onClose(); }
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
    if (loading || loadFailed || saving || !validatedPreferences) return;
    setSaving(true);
    setError(undefined);
    setStatus('Saving…');
    try {
      const reply = await window.multiRemoteTerminal.saveWorkbenchPreferences(validatedPreferences);
      if (!reply.ok) {
        setError(reply.error.code === 'INVALID_REQUEST'
          ? 'Check the greeting and terminal highlight rules, then save again.'
          : workbenchPreferenceFailureMessage('save', reply.error.code));
        setStatus('');
      } else {
        setGreeting(reply.result.startupGreeting);
        setTerminalHighlightEnabled(reply.result.terminalHighlightEnabled);
        setTerminalHighlightRules(reply.result.terminalHighlightRules);
        setAutoSaveSessions(reply.result.autoSaveSessions);
        onPreferencesSaved(reply.result);
        setStatus('Settings saved.');
      }
    } catch {
      setError(workbenchPreferenceFailureMessage('save', undefined));
      setStatus('');
    } finally { setSaving(false); }
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

  return <div className="settings-backdrop" onMouseDown={event => {
    if (event.target === event.currentTarget && !saving) onClose();
  }}>
    <section ref={dialog} className="settings-dialog" role="dialog" aria-modal="true"
      aria-labelledby="settings-heading" aria-describedby="settings-description" onKeyDown={handleKeyDown}>
      <header className="settings-header">
        <div>
          <h2 id="settings-heading">Workbench settings</h2>
          <p id="settings-description">Choose which connections to remember, set a startup greeting, and color matching terminal text.</p>
        </div>
        <button ref={closeButton} type="button" className="quiet-button" disabled={saving} onClick={onClose}>Close</button>
      </header>
      <form className="settings-form" onSubmit={event => { void save(event); }}>
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
          <button type="button" className="settings-highlight-add" disabled={credentialVaultBusy}
            onClick={() => void changeCredentialVaultLock()}>
            {credentialVaultBusy ? 'Updating…' : credentialVaultState === 'available' ? 'Lock credentials' : 'Unlock credentials'}
          </button>
          <button type="button" className="settings-highlight-add" disabled={credentialVaultBusy || credentialVaultState === 'unavailable' || credentialVaultState === 'uninitialized'}
            onClick={() => void changeCredentialVaultMode()}>
            {credentialVaultBusy ? 'Updating…' : credentialVaultMode === 'windows-account' ? 'Use a master password' : 'Use Windows account protection'}
          </button>
          <button type="button" className="settings-highlight-add" disabled={credentialVaultBusy}
            onClick={() => void resetCredentialVault()}>
            Delete saved passwords
          </button>
        </div>
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
        <div className="settings-highlights">
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
        <div className="ssh-connect-actions">
          <button type="button" disabled={saving} onClick={onClose}>Cancel</button>
          <button type="submit" className="ssh-primary" disabled={loading || loadFailed || saving || !validatedPreferences}>
            {loading ? 'Loading…' : saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </section>
  </div>;
}
