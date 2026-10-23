import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { LocalTerminalEvent, LocalTerminalSession } from '../../../../packages/application/src/local-terminals.ts';
import type { AppError } from '../../../../packages/domain/src/errors.ts';
import type { LocalShell } from '../../../../packages/domain/src/local-terminal.ts';
import { TerminalPane } from './TerminalPane.tsx';
import type { TerminalTheme, TerminalUiHandle } from './TerminalPane.tsx';
import '@xterm/xterm/css/xterm.css';
import './tokens.css';

interface WorkbenchTerminal extends LocalTerminalSession {
  readonly title: string;
}

type CommandName = 'new-powershell' | 'new-cmd' | 'close-active' | 'toggle-theme';
interface PaletteCommand {
  readonly id: CommandName;
  readonly label: string;
  readonly run: () => void;
}

function shellName(shell: LocalShell): string { return shell === 'powershell' ? 'PowerShell' : 'cmd'; }

function messageForError(error: AppError): string {
  if (error.code === 'OUTPUT_LIMIT') return 'This terminal produced more output than the display can buffer. The process was stopped.';
  if (error.code === 'NOT_FOUND') return 'This terminal is no longer available.';
  return `The terminal operation failed (${error.code}). ${error.retryable ? 'Try again or open a new terminal.' : 'Open a new terminal to continue.'}`;
}

function Workbench() {
  const [theme, setTheme] = useState<TerminalTheme>('dark');
  const [fontSize, setFontSize] = useState(14);
  const [sessions, setSessions] = useState<WorkbenchTerminal[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [status, setStatus] = useState('Starting');
  const [alert, setAlert] = useState<string>();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [pendingCloseId, setPendingCloseId] = useState<string>();
  const [query, setQuery] = useState('');
  const [selectedCommand, setSelectedCommand] = useState(0);
  const handles = useRef(new Map<string, TerminalUiHandle>());
  const pendingEvents = useRef(new Map<string, LocalTerminalEvent[]>());
  const nextOrdinal = useRef<Record<LocalShell, number>>({ powershell: 0, cmd: 0 });
  const paletteInput = useRef<HTMLInputElement>(null);
  const palette = useRef<HTMLElement>(null);
  const paletteReturnFocus = useRef<HTMLElement | null>(null);
  const closeDialog = useRef<HTMLElement>(null);
  const closeReturnFocus = useRef<HTMLElement | null>(null);
  const keepTerminalButton = useRef<HTMLButtonElement>(null);
  const focusTerminalOnActiveChange = useRef(true);

  const showTerminalError = useCallback((message: string) => setAlert(message), []);
  const openPalette = useCallback(() => {
    paletteReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery('');
    setPaletteOpen(true);
  }, []);

  const requestCloseTerminal = useCallback((sessionId: string) => {
    closeReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPendingCloseId(sessionId);
  }, []);

  const deliver = useCallback((event: LocalTerminalEvent, handle: TerminalUiHandle) => {
    if (event.kind === 'data') {
      handle.write(event.data, () => {
        void window.multiRemoteTerminal.acknowledgeTerminalOutput(event.sessionId, event.sequence).then(reply => {
          if (!reply.ok) setAlert(messageForError(reply.error));
        });
      });
    } else if (event.kind === 'exit') {
      setSessions(current => current.map(session => session.sessionId === event.sessionId ? { ...session, state: 'exited' } : session));
    } else {
      setSessions(current => current.map(session => session.sessionId === event.sessionId ? { ...session, state: 'failed' } : session));
      setAlert(messageForError(event.error));
    }
  }, []);

  const terminalReady = useCallback((sessionId: string, handle: TerminalUiHandle | undefined) => {
    if (!handle) { handles.current.delete(sessionId); return; }
    handles.current.set(sessionId, handle);
    const queued = pendingEvents.current.get(sessionId) ?? [];
    pendingEvents.current.delete(sessionId);
    for (const event of queued) deliver(event, handle);
  }, [deliver]);

  useEffect(() => window.multiRemoteTerminal.onTerminalEvent(event => {
    const handle = handles.current.get(event.sessionId);
    if (handle) deliver(event, handle);
    else {
      const queued = pendingEvents.current.get(event.sessionId) ?? [];
      queued.push(event);
      pendingEvents.current.set(event.sessionId, queued);
    }
  }), [deliver]);

  const openTerminal = useCallback(async (shell: LocalShell) => {
    setPaletteOpen(false);
    setQuery('');
    setAlert(undefined);
    const reply = await window.multiRemoteTerminal.openTerminal(shell, 80, 24);
    if (!reply.ok) { setAlert(`Could not start ${shellName(shell)} (${reply.error.code}).`); return; }
    const ordinal = ++nextOrdinal.current[shell];
    const title = shellName(shell);
    setSessions(current => [...current, { ...reply.result, title: `${title} session ${ordinal}` }]);
    setActiveId(reply.result.sessionId);
  }, []);

  const closeTerminal = useCallback(async (sessionId: string) => {
    const reply = await window.multiRemoteTerminal.closeTerminal(sessionId);
    if (!reply.ok && reply.error.code !== 'NOT_FOUND') setAlert(messageForError(reply.error));
    pendingEvents.current.delete(sessionId);
    focusTerminalOnActiveChange.current = true;
    setSessions(current => current.filter(session => session.sessionId !== sessionId));
  }, []);

  const toggleTheme = useCallback(() => setTheme(current => current === 'dark' ? 'light' : 'dark'), []);

  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#142231' : '#f3f6fa');
  }, [theme]);

  useEffect(() => {
    let active = true;
    void window.multiRemoteTerminal.describe().then(reply => {
      if (!active) return;
      setStatus(reply.ok ? `Ready · ${reply.result.platform} · version ${reply.result.version}` : `Unavailable (${reply.error.code})`);
    });
    void openTerminal('powershell');
    return () => { active = false; };
  }, [openTerminal]);

  useEffect(() => {
    if (!activeId) return;
    if (focusTerminalOnActiveChange.current) requestAnimationFrame(() => handles.current.get(activeId)?.focus());
    focusTerminalOnActiveChange.current = true;
  }, [activeId, sessions]);

  useEffect(() => {
    if (activeId && !sessions.some(session => session.sessionId === activeId)) setActiveId(sessions.at(-1)?.sessionId);
  }, [activeId, sessions]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (pendingCloseId) {
        if (event.key === 'Escape') { event.preventDefault(); setPendingCloseId(undefined); }
        else if (event.key === 'Tab') {
          const focusable = [...(closeDialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])];
          if (focusable.length) {
            event.preventDefault();
            const current = focusable.indexOf(document.activeElement as HTMLElement);
            focusable[(current + (event.shiftKey ? focusable.length - 1 : 1)) % focusable.length]?.focus();
          }
        }
        return;
      }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        if (paletteOpen) setPaletteOpen(false);
        else openPalette();
      } else if (event.ctrlKey && event.key === 'Tab' && sessions.length > 1) {
        event.preventDefault();
        const index = sessions.findIndex(session => session.sessionId === activeId);
        const next = sessions[(index + (event.shiftKey ? sessions.length - 1 : 1)) % sessions.length];
        focusTerminalOnActiveChange.current = true;
        setActiveId(next?.sessionId);
      } else if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'w' && activeId) {
        event.preventDefault(); requestCloseTerminal(activeId);
      } else if (event.key === 'Escape' && paletteOpen) {
        event.preventDefault(); setPaletteOpen(false);
      } else if (event.key === 'Tab' && paletteOpen) {
        const focusable = [...(palette.current?.querySelectorAll<HTMLElement>('input, button:not(:disabled)') ?? [])];
        if (focusable.length) {
          event.preventDefault();
          const current = focusable.indexOf(document.activeElement as HTMLElement);
          focusable[(current + (event.shiftKey ? focusable.length - 1 : 1)) % focusable.length]?.focus();
        }
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [activeId, openPalette, paletteOpen, pendingCloseId, requestCloseTerminal, sessions]);

  useEffect(() => {
    if (paletteOpen) {
      requestAnimationFrame(() => paletteInput.current?.focus());
      setSelectedCommand(0);
    } else if (paletteReturnFocus.current) {
      const target = paletteReturnFocus.current;
      paletteReturnFocus.current = null;
      requestAnimationFrame(() => { if (target.isConnected) target.focus(); });
    }
  }, [paletteOpen]);

  useEffect(() => {
    if (pendingCloseId) requestAnimationFrame(() => keepTerminalButton.current?.focus());
    else if (closeReturnFocus.current) {
      const target = closeReturnFocus.current;
      closeReturnFocus.current = null;
      requestAnimationFrame(() => { if (target.isConnected) target.focus(); });
    }
  }, [pendingCloseId]);

  const commands: PaletteCommand[] = [
    { id: 'new-powershell', label: 'New PowerShell terminal', run: () => { void openTerminal('powershell'); } },
    { id: 'new-cmd', label: 'New cmd terminal', run: () => { void openTerminal('cmd'); } },
    { id: 'close-active', label: 'Close active terminal', run: () => { if (activeId) requestCloseTerminal(activeId); } },
    { id: 'toggle-theme', label: `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`, run: toggleTheme }
  ];
  const filteredCommands = commands.filter(command => command.label.toLowerCase().includes(query.toLowerCase()));
  const active = sessions.find(session => session.sessionId === activeId);
  const pendingClose = sessions.find(session => session.sessionId === pendingCloseId);

  function runCommand(command: PaletteCommand | undefined) {
    if (!command) return;
    setPaletteOpen(false);
    command.run();
  }

  function confirmCloseTerminal() {
    if (pendingCloseId) void closeTerminal(pendingCloseId);
    setPendingCloseId(undefined);
  }

  return <div className="workbench" data-theme={theme}>
    <h1 className="visually-hidden" translate="no">MultiRemoteTerminal terminal workspace</h1>
    <a className="skip" href="#workspace">Skip to terminal workspace</a>
    <header className="app-header">
      <span className="wordmark" translate="no">MultiRemoteTerminal</span>
      <div className="header-actions">
        <span className="build-label">Local terminals</span>
        <button className="quiet-button" type="button" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={toggleTheme}>
          {theme === 'dark' ? 'Light theme' : 'Dark theme'}
        </button>
      </div>
    </header>
    <div className="workspace">
      <aside className="session-rail" aria-label="Sessions">
        <div className="rail-heading"><h2>Sessions</h2><span>{sessions.length}</span></div>
        <button className="new-terminal" type="button" onClick={openPalette}><span aria-hidden="true">＋</span> New local terminal</button>
        {sessions.length > 0 && <div className="session-group">
          <h3>Local terminals</h3>
          <ul>
            {sessions.map(session => <li key={session.sessionId}>
              <button className={`session-item ${session.sessionId === activeId ? 'selected' : ''}`} type="button"
                aria-current={session.sessionId === activeId ? 'page' : undefined} onClick={() => setActiveId(session.sessionId)}>
                <span className={`shell-glyph ${session.shell}`} aria-hidden="true">{session.shell === 'powershell' ? '›_' : 'C:\\'}</span>
                <span className="session-name" translate="no">{session.title}</span>
                <span className={`state-dot ${session.state}`} aria-label={session.state} />
              </button>
            </li>)}
          </ul>
        </div>}
        <button className="palette-hint" type="button" onClick={openPalette}>
          <span>Command palette</span><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>P</kbd>
        </button>
      </aside>
      <main className="terminal-workspace" id="workspace" tabIndex={-1}>
        <div className="tab-strip">
          <div className="tab-list" role="tablist" aria-label="Terminal sessions">
            {sessions.map((session, index) => <button className={`tab-item ${session.sessionId === activeId ? 'selected' : ''}`} key={session.sessionId}
              type="button" role="tab" id={`tab-${session.sessionId}`} aria-controls={`panel-${session.sessionId}`}
              aria-selected={session.sessionId === activeId} tabIndex={session.sessionId === activeId ? 0 : -1}
              onClick={() => { focusTerminalOnActiveChange.current = true; setActiveId(session.sessionId); }}
              onKeyDown={event => {
                let nextIndex = index;
                if (event.key === 'ArrowRight') nextIndex = (index + 1) % sessions.length;
                else if (event.key === 'ArrowLeft') nextIndex = (index + sessions.length - 1) % sessions.length;
                else if (event.key === 'Home') nextIndex = 0;
                else if (event.key === 'End') nextIndex = sessions.length - 1;
                else return;
                event.preventDefault();
                const next = sessions[nextIndex];
                if (!next) return;
                focusTerminalOnActiveChange.current = false;
                setActiveId(next.sessionId);
                requestAnimationFrame(() => document.getElementById(`tab-${next.sessionId}`)?.focus());
              }}>
              <span className={`shell-glyph ${session.shell}`} aria-hidden="true">{session.shell === 'powershell' ? '›_' : 'C:\\'}</span>
              <span translate="no">{session.title}</span>
              <span className={`state-dot ${session.state}`} aria-hidden="true" />
            </button>
            )}
          </div>
          <div className="tab-actions">
            {active && <button className="tab-close" type="button" aria-label="Close active terminal" onClick={() => requestCloseTerminal(active.sessionId)}>×</button>}
            <button className="add-tab" type="button" aria-label="New local terminal" title="New local terminal" onClick={openPalette}>＋</button>
          </div>
        </div>
        <div className="terminal-stack">
          {sessions.map(session => <section className="terminal-panel" key={session.sessionId} id={`panel-${session.sessionId}`} role="tabpanel"
            aria-labelledby={`tab-${session.sessionId}`} hidden={session.sessionId !== activeId}>
            <TerminalPane sessionId={session.sessionId} title={session.title} active={session.sessionId === activeId}
              canWrite={session.state === 'running'} theme={theme} fontSize={fontSize} onReady={terminalReady}
              onError={showTerminalError} />
          </section>)}
          {sessions.length === 0 && <div className="empty-terminal">
            <span className="empty-mark" aria-hidden="true">›_</span>
            <h2>No terminal is open</h2>
            <p>Open PowerShell or cmd to start working on this computer.</p>
            <button type="button" className="new-terminal" onClick={openPalette}>New local terminal</button>
          </div>}
        </div>
      </main>
    </div>
    {alert && <div className="alert-strip" role="alert"><span>{alert}</span><button type="button" aria-label="Dismiss message" onClick={() => setAlert(undefined)}>Dismiss</button></div>}
    <footer className="status-bar">
      <div className="terminal-status">
        <span className={`state-dot ${active?.state ?? 'idle'}`} />
        <span>{active ? `${shellName(active.shell)} · Local · ${active.state}` : 'No active terminal'}</span>
      </div>
      <div className="font-controls" role="group" aria-label="Terminal font size">
        <span>Font size</span>
        <button type="button" aria-label="Decrease terminal font size" onClick={() => setFontSize(value => Math.max(10, value - 1))} disabled={fontSize <= 10}>−</button>
        <output aria-live="polite" aria-label="Current terminal font size">{fontSize}</output>
        <button type="button" aria-label="Increase terminal font size" onClick={() => setFontSize(value => Math.min(24, value + 1))} disabled={fontSize >= 24}>＋</button>
      </div>
    </footer>
    <span className="visually-hidden" role="status" aria-live="polite">{status}</span>
    {paletteOpen && <div className="palette-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setPaletteOpen(false); }}>
      <section className="command-palette" role="dialog" aria-modal="true" aria-labelledby="palette-heading">
        <h2 id="palette-heading" className="visually-hidden">Command palette</h2>
        <label className="visually-hidden" htmlFor="palette-search">Find a command</label>
        <input ref={paletteInput} id="palette-search" name="command" autoComplete="off" type="search" placeholder="Find a command…" value={query}
          onChange={event => { setQuery(event.target.value); setSelectedCommand(0); }}
          onKeyDown={event => {
            if (event.key === 'ArrowDown') { event.preventDefault(); setSelectedCommand(value => Math.min(value + 1, filteredCommands.length - 1)); }
            else if (event.key === 'ArrowUp') { event.preventDefault(); setSelectedCommand(value => Math.max(0, value - 1)); }
            else if (event.key === 'Enter') { event.preventDefault(); runCommand(filteredCommands[selectedCommand]); }
          }} />
        <ul>
          {filteredCommands.map((command, index) => <li key={command.id}>
            <button className={index === selectedCommand ? 'active' : ''} type="button" aria-current={index === selectedCommand ? 'true' : undefined}
              onMouseEnter={() => setSelectedCommand(index)} onClick={() => runCommand(command)}>
              <span>{command.label}</span><span aria-hidden="true">{command.id.startsWith('new-') ? '↵' : ''}</span>
            </button>
          </li>)}
          {filteredCommands.length === 0 && <li className="no-commands">No matching commands</li>}
        </ul>
        <p><kbd>↑</kbd><kbd>↓</kbd> select <kbd>Enter</kbd> run <kbd>Esc</kbd> close</p>
      </section>
    </div>}
    {pendingClose && <div className="close-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setPendingCloseId(undefined); }}>
      <section ref={closeDialog} className="close-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="close-heading" aria-describedby="close-description">
        <h2 id="close-heading">Close {pendingClose.title}?</h2>
        <p id="close-description">Closing this terminal stops its shell process and any command running in it.</p>
        <div className="close-actions">
          <button ref={keepTerminalButton} type="button" onClick={() => setPendingCloseId(undefined)}>Keep terminal</button>
          <button type="button" className="confirm-close" onClick={confirmCloseTerminal}>Close terminal</button>
        </div>
      </section>
    </div>}
  </div>;
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(<Workbench />);
