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
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadGeneration, setLoadGeneration] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState('');
  const dialog = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const greetingInput = useRef<HTMLTextAreaElement>(null);
  const normalizedRules = normalizeTerminalHighlightRules(terminalHighlightRules);
  const greetingIsValid = Boolean(normalizeWorkbenchPreferences({ startupGreeting: greeting }));
  const validatedPreferences = normalizeWorkbenchPreferences({
    startupGreeting: greeting, terminalHighlightEnabled, terminalHighlightRules
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
        onPreferencesSaved(reply.result);
        setStatus('Settings saved.');
      }
    } catch {
      setError(workbenchPreferenceFailureMessage('save', undefined));
      setStatus('');
    } finally { setSaving(false); }
  }

  return <div className="settings-backdrop" onMouseDown={event => {
    if (event.target === event.currentTarget && !saving) onClose();
  }}>
    <section ref={dialog} className="settings-dialog" role="dialog" aria-modal="true"
      aria-labelledby="settings-heading" aria-describedby="settings-description" onKeyDown={handleKeyDown}>
      <header className="settings-header">
        <div>
          <h2 id="settings-heading">Workbench settings</h2>
          <p id="settings-description">Set an optional startup greeting and colors for terminal text that matches your rules.</p>
        </div>
        <button ref={closeButton} type="button" className="quiet-button" disabled={saving} onClick={onClose}>Close</button>
      </header>
      <form className="settings-form" onSubmit={event => { void save(event); }}>
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
