import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, FormEvent } from 'react';
import { MAX_STARTUP_GREETING_CODE_POINTS, normalizeWorkbenchPreferences } from '../../../../packages/domain/src/workbench-preferences.ts';

export function SettingsDialog({ onClose, onGreetingSaved }: {
  readonly onClose: () => void;
  readonly onGreetingSaved: (greeting: string) => void;
}) {
  const [greeting, setGreeting] = useState('');
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
  const validated = normalizeWorkbenchPreferences({ startupGreeting: greeting });
  const characterCount = Array.from(greeting).length;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    setError(undefined);
    closeButton.current?.focus();
    void window.multiRemoteTerminal.getWorkbenchPreferences().then(reply => {
      if (!active) return;
      if (reply.ok) setGreeting(reply.result.startupGreeting);
      else {
        setLoadFailed(true);
        setError(`Workbench settings could not be loaded (${reply.error.code}).`);
      }
    }).catch(() => {
      if (active) {
        setLoadFailed(true);
        setError('Workbench settings could not be loaded.');
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
      'textarea:not(:disabled), button:not(:disabled), [tabindex]:not([tabindex="-1"])'
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
    if (loading || loadFailed || saving || !validated) return;
    setSaving(true);
    setError(undefined);
    setStatus('Saving…');
    try {
      const reply = await window.multiRemoteTerminal.saveWorkbenchPreferences(validated);
      if (!reply.ok) {
        setError(reply.error.code === 'INVALID_REQUEST'
          ? `Use up to ${MAX_STARTUP_GREETING_CODE_POINTS} Unicode characters and omit control characters.`
          : `The greeting could not be saved (${reply.error.code}).`);
        setStatus('');
      } else {
        setGreeting(reply.result.startupGreeting);
        onGreetingSaved(reply.result.startupGreeting);
        setStatus('Greeting saved.');
      }
    } catch {
      setError('The greeting could not be saved.');
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
          <p id="settings-description">Set a greeting to show when the app starts. This is plain text and never runs in a terminal.</p>
        </div>
        <button ref={closeButton} type="button" className="quiet-button" disabled={saving} onClick={onClose}>Close</button>
      </header>
      <form className="settings-form" onSubmit={event => { void save(event); }}>
        <label htmlFor="startup-greeting">Startup greeting</label>
        <textarea ref={greetingInput} id="startup-greeting" name="startupGreeting" rows={5} maxLength={MAX_STARTUP_GREETING_CODE_POINTS * 2}
          disabled={loading || loadFailed || saving} value={greeting} onChange={event => { setGreeting(event.target.value); setError(undefined); setStatus(''); }} />
        <div className="settings-form-meta">
          <span>{characterCount} / {MAX_STARTUP_GREETING_CODE_POINTS} Unicode characters</span>
          {!validated && <span className="dialog-error" role="alert">Omit control characters other than new lines and tabs.</span>}
        </div>
        {error && <p className="dialog-error" role="alert">{error}</p>}
        {loadFailed && <button ref={retryButton} type="button" disabled={saving} onClick={() => setLoadGeneration(value => value + 1)}>Try loading settings again</button>}
        {status && <p className="settings-save-status" role="status">{status}</p>}
        <div className="ssh-connect-actions">
          <button type="button" disabled={saving} onClick={onClose}>Cancel</button>
          <button type="submit" className="ssh-primary" disabled={loading || loadFailed || saving || !validated}>
            {loading ? 'Loading…' : saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </section>
  </div>;
}
