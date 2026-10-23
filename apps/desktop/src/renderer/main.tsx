import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { LocalTerminalEvent, LocalTerminalSession } from '../../../../packages/application/src/local-terminals.ts';
import type { SshTerminalSession, SshTrustEvent } from '../../../../packages/application/src/ssh-terminals.ts';
import type { OpenSshTerminalReply, OpenTerminalReply } from '../../../../packages/contracts/src/commands.ts';
import type { AppError } from '../../../../packages/domain/src/errors.ts';
import { canonicalizeSshHostEndpoint } from '../../../../packages/domain/src/host-trust.ts';
import type { LocalShell } from '../../../../packages/domain/src/local-terminal.ts';
import type { SavedSessionDefinition, SavedSessionDraft } from '../../../../packages/domain/src/session-definition.ts';
import { TerminalPane } from './TerminalPane.tsx';
import type { TerminalTheme, TerminalUiHandle } from './TerminalPane.tsx';
import '@xterm/xterm/css/xterm.css';
import './tokens.css';

type WorkbenchTerminal =
  | (LocalTerminalSession & { readonly transport: 'local'; readonly title: string })
  | (SshTerminalSession & { readonly transport: 'ssh'; readonly title: string });

type OpeningTerminal =
  | { readonly transport: 'local'; readonly sessionId: string; readonly shell: LocalShell; readonly cancelling: boolean }
  | { readonly transport: 'ssh'; readonly sessionId: string; readonly host: string; readonly port: number; readonly cancelling: boolean };

type PendingOpenRequest =
  | { cancelled: boolean; readonly transport: 'local'; readonly reply: Promise<OpenTerminalReply> }
  | { cancelled: boolean; readonly transport: 'ssh'; readonly reply: Promise<OpenSshTerminalReply> };

type CommandName = 'new-powershell' | 'new-cmd' | 'connect-ssh' | 'close-active' | 'toggle-theme';
interface PaletteCommand {
  readonly id: CommandName;
  readonly label: string;
  readonly run: () => void;
}

function shellName(shell: LocalShell): string { return shell === 'powershell' ? 'PowerShell' : 'cmd'; }

function openingName(opening: OpeningTerminal): string {
  return opening.transport === 'local' ? `${shellName(opening.shell)} terminal` : `SSH connection to ${sshEndpointLabel(opening.host, opening.port)}`;
}

function sshEndpointLabel(host: string, port: number): string { return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`; }

function terminalStatus(session: WorkbenchTerminal | undefined): string {
  if (!session) return 'No active terminal';
  if (session.transport === 'local') return `${shellName(session.shell)} · Local · ${session.state}`;
  return `SSH · ${sshEndpointLabel(session.endpoint.host, session.endpoint.port)} · ${session.state}`;
}

function sshOpenError(code: string): string {
  if (code === 'AUTHENTICATION_FAILED') return 'The SSH server rejected these credentials.';
  if (code === 'HOST_KEY_REJECTED') return 'The SSH host was not trusted, so the connection was stopped.';
  if (code === 'HOST_KEY_CHANGED') return 'The SSH host key changed. The connection was blocked.';
  if (code === 'CANCELLED') return 'The SSH connection was cancelled.';
  if (code === 'TIMEOUT') return 'The SSH connection timed out.';
  return `Could not connect to the SSH server (${code}).`;
}

function messageForError(error: AppError): string {
  if (error.code === 'OUTPUT_LIMIT') return 'This terminal produced more output than the display can buffer. The process was stopped.';
  if (error.code === 'NOT_FOUND') return 'This terminal is no longer available.';
  return `The terminal operation failed (${error.code}). ${error.retryable ? 'Try again or open a new terminal.' : 'Open a new terminal to continue.'}`;
}

function Workbench() {
  const [theme, setTheme] = useState<TerminalTheme>('dark');
  const [fontSize, setFontSize] = useState(14);
  const [sessions, setSessions] = useState<WorkbenchTerminal[]>([]);
  const [openingSessions, setOpeningSessions] = useState<OpeningTerminal[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [status, setStatus] = useState('Starting');
  const [alert, setAlert] = useState<string>();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [pendingCloseId, setPendingCloseId] = useState<string>();
  const [query, setQuery] = useState('');
  const [selectedCommand, setSelectedCommand] = useState(0);
  const [sshConnectOpen, setSshConnectOpen] = useState(false);
  const [sshHost, setSshHost] = useState('');
  const [sshPort, setSshPort] = useState('22');
  const [sshConnectError, setSshConnectError] = useState<string>();
  const [sshTrustEvents, setSshTrustEvents] = useState<SshTrustEvent[]>([]);
  const [sshTrustBusy, setSshTrustBusy] = useState(false);
  const [savedSessions, setSavedSessions] = useState<readonly SavedSessionDefinition[]>([]);
  const [savedSearch, setSavedSearch] = useState('');
  const [savedSessionsLoading, setSavedSessionsLoading] = useState(true);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [saveSessionOpen, setSaveSessionOpen] = useState(false);
  const [saveSessionName, setSaveSessionName] = useState('');
  const [saveSessionError, setSaveSessionError] = useState<string>();
  const handles = useRef(new Map<string, TerminalUiHandle>());
  const pendingEvents = useRef(new Map<string, LocalTerminalEvent[]>());
  const pendingOpenRequests = useRef(new Map<string, PendingOpenRequest>());
  const nextOrdinal = useRef<Record<LocalShell, number>>({ powershell: 0, cmd: 0 });
  const nextSshOrdinal = useRef(0);
  const savedSessionsRequest = useRef(0);
  const paletteInput = useRef<HTMLInputElement>(null);
  const palette = useRef<HTMLElement>(null);
  const paletteReturnFocus = useRef<HTMLElement | null>(null);
  const sshConnectDialog = useRef<HTMLElement>(null);
  const sshHostInput = useRef<HTMLInputElement>(null);
  const sshPortInput = useRef<HTMLInputElement>(null);
  const sshConnectReturnFocus = useRef<HTMLElement | null>(null);
  const saveSessionDialog = useRef<HTMLElement>(null);
  const saveSessionNameInput = useRef<HTMLInputElement>(null);
  const saveSessionReturnFocus = useRef<HTMLElement | null>(null);
  const sshTrustDialog = useRef<HTMLElement>(null);
  const rejectSshHostButton = useRef<HTMLButtonElement>(null);
  const changedSshHostButton = useRef<HTMLButtonElement>(null);
  const sshTrustReturnFocus = useRef<HTMLElement | null>(null);
  const closeDialog = useRef<HTMLElement>(null);
  const closeReturnFocus = useRef<HTMLElement | null>(null);
  const keepTerminalButton = useRef<HTMLButtonElement>(null);
  const focusTerminalOnActiveChange = useRef(true);

  const showTerminalError = useCallback((message: string) => setAlert(message), []);
  const loadSavedSessions = useCallback(async (search: string) => {
    const request = ++savedSessionsRequest.current;
    setSavedSessionsLoading(true);
    try {
      const reply = await window.multiRemoteTerminal.listSavedSessions(search);
      if (request !== savedSessionsRequest.current) return;
      if (!reply.ok) {
        setAlert(`Saved sessions could not be loaded (${reply.error.code}).`);
        return;
      }
      setSavedSessions(reply.result);
    } catch {
      if (request === savedSessionsRequest.current) setAlert('Saved sessions could not be loaded.');
    } finally {
      if (request === savedSessionsRequest.current) setSavedSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadSavedSessions(savedSearch); }, 160);
    return () => {
      window.clearTimeout(timer);
      savedSessionsRequest.current++;
    };
  }, [loadSavedSessions, savedSearch]);

  const openPalette = useCallback(() => {
    paletteReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery('');
    setPaletteOpen(true);
  }, []);

  const openSshConnect = useCallback(() => {
    sshConnectReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSshConnectError(undefined);
    setSshConnectOpen(true);
  }, []);

  const requestCloseTerminal = useCallback((sessionId: string) => {
    closeReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPendingCloseId(sessionId);
  }, []);

  const deliver = useCallback((event: LocalTerminalEvent, handle: TerminalUiHandle) => {
    if (event.kind === 'data') {
      handle.write(event.data, () => {
        void handle.acknowledgeOutput(event.sequence).then(() => undefined).catch(() => {
          setAlert('Terminal output could not be acknowledged.');
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

  useEffect(() => window.multiRemoteTerminal.onSshTrustEvent(event => {
    if (sshTrustReturnFocus.current === null) sshTrustReturnFocus.current = sshConnectReturnFocus.current;
    setSshTrustEvents(current => {
      const index = current.findIndex(existing => existing.sessionId === event.sessionId);
      if (index < 0) return [...current, event];
      if (event.kind === 'changed' && current[index]?.kind !== 'changed') {
        return current.map((existing, currentIndex) => currentIndex === index ? event : existing);
      }
      return current;
    });
  }), []);

  const openTerminal = useCallback(async (shell: LocalShell, savedTitle?: string) => {
    setPaletteOpen(false);
    setQuery('');
    setAlert(undefined);
    const sessionId = crypto.randomUUID();
    const replyPromise = window.multiRemoteTerminal.openTerminal(sessionId, shell, 80, 24);
    pendingOpenRequests.current.set(sessionId, { transport: 'local', cancelled: false, reply: replyPromise });
    setOpeningSessions(current => [...current, { transport: 'local', sessionId, shell, cancelling: false }]);
    const reply = await replyPromise;
    if (pendingOpenRequests.current.get(sessionId)?.cancelled) return;
    pendingOpenRequests.current.delete(sessionId);
    setOpeningSessions(current => current.filter(opening => opening.sessionId !== sessionId));
    if (!reply.ok) {
      if (reply.error.code !== 'CANCELLED') setAlert(`Could not start ${shellName(shell)} (${reply.error.code}).`);
      return;
    }
    const ordinal = ++nextOrdinal.current[shell];
    const title = shellName(shell);
    setSessions(current => [...current, { ...reply.result, transport: 'local', title: savedTitle ?? `${title} session ${ordinal}` }]);
    setActiveId(reply.result.sessionId);
  }, []);

  const openSshTerminal = useCallback(async (hostInput: string, portInput: string, savedTitle?: string) => {
    const host = hostInput.trim();
    const port = Number(portInput);
    if (!host) { setSshConnectError('Enter a host name or IP address.'); sshHostInput.current?.focus(); return; }
    if (!/^\d{1,5}$/.test(portInput) || !Number.isInteger(port) || port < 1 || port > 65_535) {
      setSshConnectError('Port must be a whole number from 1 to 65535.');
      sshPortInput.current?.focus();
      return;
    }
    const validatedEndpoint = canonicalizeSshHostEndpoint({ host, port });
    if (!validatedEndpoint) { setSshConnectError('Enter a valid DNS name or IP address.'); sshHostInput.current?.focus(); return; }
    setSshConnectError(undefined);
    sshTrustReturnFocus.current = sshConnectReturnFocus.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setSshConnectOpen(false);
    setPaletteOpen(false);
    setAlert(undefined);
    const sessionId = crypto.randomUUID();
    const replyPromise = window.multiRemoteTerminal.openSshTerminal(sessionId, validatedEndpoint.host, validatedEndpoint.port, 80, 24);
    pendingOpenRequests.current.set(sessionId, { transport: 'ssh', cancelled: false, reply: replyPromise });
    setOpeningSessions(current => [...current, { transport: 'ssh', sessionId, host: validatedEndpoint.host, port: validatedEndpoint.port, cancelling: false }]);
    const reply = await replyPromise;
    if (pendingOpenRequests.current.get(sessionId)?.cancelled) return;
    pendingOpenRequests.current.delete(sessionId);
    setOpeningSessions(current => current.filter(opening => opening.sessionId !== sessionId));
    if (!reply.ok) {
      setSshTrustEvents(current => current.filter(event => event.sessionId !== sessionId || event.kind === 'changed'));
      if (reply.error.code !== 'CANCELLED') setAlert(sshOpenError(reply.error.code));
      return;
    }
    const ordinal = ++nextSshOrdinal.current;
    const endpoint = reply.result.endpoint;
    setSessions(current => [...current, { ...reply.result, transport: 'ssh', title: savedTitle ?? `${endpoint.host}:${endpoint.port} - SSH ${ordinal}` }]);
    setActiveId(reply.result.sessionId);
  }, []);

  const cancelOpening = useCallback((sessionId: string) => {
    const pending = pendingOpenRequests.current.get(sessionId);
    if (!pending || pending.cancelled) return;
    pending.cancelled = true;
    setOpeningSessions(current => current.map(opening => opening.sessionId === sessionId ? { ...opening, cancelling: true } : opening));
    void (async () => {
      const closeReply = pending.transport === 'ssh'
        ? await window.multiRemoteTerminal.closeSshTerminal(sessionId)
        : await window.multiRemoteTerminal.closeTerminal(sessionId);
      const reply = await pending.reply;
      if (reply.ok) {
        const cleanup = pending.transport === 'ssh'
          ? await window.multiRemoteTerminal.closeSshTerminal(sessionId)
          : await window.multiRemoteTerminal.closeTerminal(sessionId);
        if (!cleanup.ok && cleanup.error.code !== 'NOT_FOUND') setAlert(messageForError(cleanup.error));
      } else if (!closeReply.ok && closeReply.error.code !== 'NOT_FOUND') {
        setAlert(messageForError(closeReply.error));
      } else if (reply.error.code !== 'CANCELLED' && reply.error.code !== 'NOT_FOUND') {
        setAlert(`Could not confirm terminal cancellation (${reply.error.code}).`);
      }
      pendingEvents.current.delete(sessionId);
      pendingOpenRequests.current.delete(sessionId);
      if (pending.transport === 'ssh') {
        setSshTrustEvents(current => current.filter(event => event.sessionId !== sessionId || event.kind === 'changed'));
      }
      setOpeningSessions(current => current.filter(opening => opening.sessionId !== sessionId));
    })();
  }, []);

  const removeSshTrustEvent = useCallback((sessionId: string) => {
    setSshTrustEvents(current => current.filter(event => event.sessionId !== sessionId));
  }, []);

  const decideSshTrust = useCallback(async (event: SshTrustEvent, approve: boolean) => {
    if (event.kind === 'changed') {
      removeSshTrustEvent(event.sessionId);
      setAlert('The SSH host key changed. The connection remains blocked. Verify the new key before resetting saved host trust.');
      return;
    }
    if (sshTrustBusy) return;
    setSshTrustBusy(true);
    try {
      const reply = approve
        ? await window.multiRemoteTerminal.approveSshHost(event.challenge.token)
        : await window.multiRemoteTerminal.rejectSshHost(event.challenge.token);
      if (!reply.ok) {
        setAlert(messageForError(reply.error));
        return;
      }
      removeSshTrustEvent(event.sessionId);
    } catch {
      setAlert('The SSH host decision could not be completed.');
    } finally {
      setSshTrustBusy(false);
    }
  }, [removeSshTrustEvent, sshTrustBusy]);

  const resetSshHostTrust = useCallback(async (event: Extract<SshTrustEvent, { kind: 'changed' }>) => {
    if (sshTrustBusy) return;
    setSshTrustBusy(true);
    try {
      const reply = await window.multiRemoteTerminal.revokeSshHost(event.host, event.port);
      if (!reply.ok) {
        setAlert(messageForError(reply.error));
        return;
      }
      removeSshTrustEvent(event.sessionId);
      setAlert('Saved host trust was reset. Reconnect only after you verify the new fingerprint with the server administrator.');
    } catch {
      setAlert('Saved SSH host trust could not be reset.');
    } finally {
      setSshTrustBusy(false);
    }
  }, [removeSshTrustEvent, sshTrustBusy]);

  const closeTerminal = useCallback(async (sessionId: string, transport: WorkbenchTerminal['transport']) => {
    const reply = transport === 'ssh'
      ? await window.multiRemoteTerminal.closeSshTerminal(sessionId)
      : await window.multiRemoteTerminal.closeTerminal(sessionId);
    if (!reply.ok && reply.error.code !== 'NOT_FOUND') setAlert(messageForError(reply.error));
    handles.current.delete(sessionId);
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
      const currentTrust = sshTrustEvents[0];
      if (currentTrust) {
        if (event.key === 'Escape') {
          event.preventDefault();
          if (!sshTrustBusy) void decideSshTrust(currentTrust, false);
        } else if (event.key === 'Tab') {
          const focusable = [...(sshTrustDialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])];
          if (focusable.length) {
            event.preventDefault();
            const current = focusable.indexOf(document.activeElement as HTMLElement);
            focusable[(current + (event.shiftKey ? focusable.length - 1 : 1)) % focusable.length]?.focus();
          }
        }
        return;
      }
      if (saveSessionOpen) {
        if (event.key === 'Escape' && !catalogBusy) { event.preventDefault(); setSaveSessionOpen(false); }
        else if (event.key === 'Tab') {
          const focusable = [...(saveSessionDialog.current?.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)') ?? [])];
          if (focusable.length) {
            event.preventDefault();
            const current = focusable.indexOf(document.activeElement as HTMLElement);
            focusable[(current + (event.shiftKey ? focusable.length - 1 : 1)) % focusable.length]?.focus();
          }
        }
        return;
      }
      if (sshConnectOpen) {
        if (event.key === 'Escape') { event.preventDefault(); setSshConnectOpen(false); }
        else if (event.key === 'Tab') {
          const focusable = [...(sshConnectDialog.current?.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)') ?? [])];
          if (focusable.length) {
            event.preventDefault();
            const current = focusable.indexOf(document.activeElement as HTMLElement);
            focusable[(current + (event.shiftKey ? focusable.length - 1 : 1)) % focusable.length]?.focus();
          }
        }
        return;
      }
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
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [activeId, catalogBusy, decideSshTrust, openPalette, paletteOpen, pendingCloseId, requestCloseTerminal, saveSessionOpen, sessions, sshConnectOpen, sshTrustBusy, sshTrustEvents]);

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
    if (sshConnectOpen) requestAnimationFrame(() => sshHostInput.current?.focus());
    else if (sshConnectReturnFocus.current) {
      const target = sshConnectReturnFocus.current;
      sshConnectReturnFocus.current = null;
      requestAnimationFrame(() => { if (target.isConnected) target.focus(); });
    }
  }, [sshConnectOpen]);

  useEffect(() => {
    if (saveSessionOpen) requestAnimationFrame(() => saveSessionNameInput.current?.focus());
    else if (saveSessionReturnFocus.current) {
      const target = saveSessionReturnFocus.current;
      saveSessionReturnFocus.current = null;
      requestAnimationFrame(() => { if (target.isConnected) target.focus(); });
    }
  }, [saveSessionOpen]);

  useEffect(() => {
    const current = sshTrustEvents[0];
    if (current) {
      requestAnimationFrame(() => {
        if (current.kind === 'challenge') rejectSshHostButton.current?.focus();
        else changedSshHostButton.current?.focus();
      });
    } else if (sshTrustReturnFocus.current) {
      const target = sshTrustReturnFocus.current;
      sshTrustReturnFocus.current = null;
      requestAnimationFrame(() => { if (target.isConnected) target.focus(); });
    }
  }, [sshTrustEvents]);

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
    { id: 'connect-ssh', label: 'Connect to SSH server', run: openSshConnect },
    { id: 'close-active', label: 'Close active terminal', run: () => { if (activeId) requestCloseTerminal(activeId); } },
    { id: 'toggle-theme', label: `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`, run: toggleTheme }
  ];
  const filteredCommands = commands.filter(command => command.label.toLowerCase().includes(query.toLowerCase()));
  const active = sessions.find(session => session.sessionId === activeId);
  const pendingClose = sessions.find(session => session.sessionId === pendingCloseId);
  const currentSshTrust = sshTrustEvents[0];

  function openSavedSession(session: SavedSessionDefinition) {
    if (session.kind === 'local') void openTerminal(session.shell, session.name);
    else void openSshTerminal(session.host, String(session.port), session.name);
  }

  function beginSaveActiveSession() {
    if (!active) return;
    saveSessionReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSaveSessionName(active.title);
    setSaveSessionError(undefined);
    setSaveSessionOpen(true);
  }

  async function saveActiveSession() {
    if (!active || catalogBusy) return;
    const draft: SavedSessionDraft = active.transport === 'local'
      ? { kind: 'local', name: saveSessionName, shell: active.shell }
      : { kind: 'ssh', name: saveSessionName, host: active.endpoint.host, port: active.endpoint.port };
    setCatalogBusy(true);
    setSaveSessionError(undefined);
    try {
      const reply = await window.multiRemoteTerminal.createSavedSession(draft);
      if (!reply.ok) {
        setSaveSessionError(reply.error.code === 'BUSY' ? 'Storage is busy. Try saving again.' : `The session could not be saved (${reply.error.code}).`);
        return;
      }
      setSaveSessionOpen(false);
      await loadSavedSessions(savedSearch);
    } catch {
      setSaveSessionError('The session could not be saved.');
    } finally {
      setCatalogBusy(false);
    }
  }

  async function toggleSavedFavorite(session: SavedSessionDefinition) {
    if (catalogBusy) return;
    setCatalogBusy(true);
    try {
      const reply = await window.multiRemoteTerminal.setSavedSessionFavorite(session.id, !session.favorite);
      if (!reply.ok) setAlert(`Favorite could not be updated (${reply.error.code}).`);
      else await loadSavedSessions(savedSearch);
    } catch {
      setAlert('Favorite could not be updated.');
    } finally {
      setCatalogBusy(false);
    }
  }

  async function deleteSavedSession(session: SavedSessionDefinition) {
    if (catalogBusy || !window.confirm(`Delete saved session "${session.name}"?`)) return;
    setCatalogBusy(true);
    try {
      const reply = await window.multiRemoteTerminal.deleteSavedSession(session.id);
      if (!reply.ok) setAlert(`Saved session could not be deleted (${reply.error.code}).`);
      else await loadSavedSessions(savedSearch);
    } catch {
      setAlert('Saved session could not be deleted.');
    } finally {
      setCatalogBusy(false);
    }
  }

  function runCommand(command: PaletteCommand | undefined) {
    if (!command) return;
    setPaletteOpen(false);
    command.run();
  }

  function confirmCloseTerminal() {
    if (pendingClose) void closeTerminal(pendingClose.sessionId, pendingClose.transport);
    setPendingCloseId(undefined);
  }

  return <div className="workbench" data-theme={theme}>
    <h1 className="visually-hidden" translate="no">MultiRemoteTerminal terminal workspace</h1>
    <a className="skip" href="#workspace">Skip to terminal workspace</a>
    <header className="app-header">
      <span className="wordmark" translate="no">MultiRemoteTerminal</span>
      <div className="header-actions">
        <span className="build-label">Local and SSH terminals</span>
        <button className="quiet-button" type="button" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={toggleTheme}>
          {theme === 'dark' ? 'Light theme' : 'Dark theme'}
        </button>
      </div>
    </header>
    <div className="workspace">
      <aside className="session-rail" aria-label="Sessions">
        <div className="rail-heading"><h2>Sessions</h2><span>{sessions.length}</span></div>
        <button className="new-terminal" type="button" onClick={openPalette}><span aria-hidden="true">＋</span> New local terminal</button>
        <button className="connect-ssh-button" type="button" onClick={openSshConnect}><span aria-hidden="true">↗</span> Connect to SSH</button>
        <button className="save-session-button" type="button" disabled={!active || catalogBusy} onClick={beginSaveActiveSession}>Save active session</button>
        {sessions.length > 0 && <div className="session-group">
          <h3>Local terminals</h3>
          <ul>
            {sessions.map(session => <li key={session.sessionId}>
              <button className={`session-item ${session.sessionId === activeId ? 'selected' : ''}`} type="button"
                aria-current={session.sessionId === activeId ? 'page' : undefined} onClick={() => setActiveId(session.sessionId)}>
                <span className={`shell-glyph ${session.transport === 'local' ? session.shell : 'ssh'}`} aria-hidden="true">
                  {session.transport === 'ssh' ? 'SSH' : session.shell === 'powershell' ? '›_' : 'C:\\'}
                </span>
                <span className="session-name" translate="no">{session.title}</span>
                <span className={`state-dot ${session.state}`} aria-label={session.state} />
              </button>
            </li>)}
          </ul>
        </div>}
        <section className="saved-session-group" aria-labelledby="saved-sessions-heading">
          <div className="rail-heading"><h2 id="saved-sessions-heading">Saved sessions</h2><span>{savedSessions.length}</span></div>
          <label className="visually-hidden" htmlFor="saved-session-search">Search saved sessions</label>
          <input className="saved-session-search" id="saved-session-search" type="search" autoComplete="off" maxLength={256}
            placeholder="Search saved sessions" value={savedSearch} onChange={event => setSavedSearch(event.target.value)} />
          {savedSessionsLoading && <p className="saved-session-empty" role="status">Loading saved sessions</p>}
          {!savedSessionsLoading && savedSessions.length === 0 && <p className="saved-session-empty">{savedSearch ? 'No saved sessions match this search.' : 'No saved sessions yet.'}</p>}
          {savedSessions.length > 0 && <ul className="saved-session-list">
            {savedSessions.map(session => <li className="saved-session-row" key={session.id}>
              <button className="saved-session-open" type="button" aria-label={`Open ${session.name}`} onClick={() => openSavedSession(session)}>
                <span className={`shell-glyph ${session.kind === 'local' ? session.shell : 'ssh'}`} aria-hidden="true">
                  {session.kind === 'ssh' ? 'SSH' : session.shell === 'powershell' ? 'PS' : 'CMD'}
                </span>
                <span className="saved-session-name" translate="no">{session.name}</span>
                <span className="saved-session-detail" translate="no">{session.kind === 'local' ? session.shell : `${session.host}:${session.port}`}</span>
              </button>
              <div className="saved-session-actions">
                <button type="button" aria-label={`${session.favorite ? 'Remove favorite from' : 'Make favorite'} ${session.name}`}
                  aria-pressed={session.favorite} disabled={catalogBusy} onClick={() => void toggleSavedFavorite(session)}>{session.favorite ? '★' : '☆'}</button>
                <button type="button" aria-label={`Delete saved session ${session.name}`} disabled={catalogBusy}
                  onClick={() => void deleteSavedSession(session)}>Del</button>
              </div>
            </li>)}
          </ul>}
        </section>
        <button className="palette-hint" type="button" onClick={openPalette}>
          <span>Command palette</span><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>P</kbd>
        </button>
      </aside>
      <main className="terminal-workspace" id="workspace" tabIndex={-1} data-opening={openingSessions.length > 0}>
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
              <span className={`shell-glyph ${session.transport === 'local' ? session.shell : 'ssh'}`} aria-hidden="true">
                {session.transport === 'ssh' ? 'SSH' : session.shell === 'powershell' ? '›_' : 'C:\\'}
              </span>
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
        {openingSessions.length > 0 && <div className="opening-notices" role="group" aria-label="Opening terminals">
          {openingSessions.map(opening => <div className="opening-notice" key={opening.sessionId}>
            <span role="status">{opening.cancelling ? 'Cancelling' : 'Opening'} {openingName(opening)}...</span>
            <button type="button" className="quiet-button" disabled={opening.cancelling}
              aria-label={`${opening.cancelling ? 'Cancelling' : 'Cancel opening'} ${openingName(opening)}`}
              onClick={() => cancelOpening(opening.sessionId)}>{opening.cancelling ? 'Cancelling...' : 'Cancel'}</button>
          </div>)}
        </div>}
        <div className="terminal-stack">
          {sessions.map(session => <section className="terminal-panel" key={session.sessionId} id={`panel-${session.sessionId}`} role="tabpanel"
            aria-labelledby={`tab-${session.sessionId}`} hidden={session.sessionId !== activeId}>
            <TerminalPane sessionId={session.sessionId} title={session.title} active={session.sessionId === activeId}
              transport={session.transport}
              canWrite={session.state === 'running'} theme={theme} fontSize={fontSize} onReady={terminalReady}
              onError={showTerminalError} />
          </section>)}
          {sessions.length === 0 && <div className="empty-terminal">
            <span className="empty-mark" aria-hidden="true">›_</span>
            <h2>No terminal is open</h2>
            <p>Open a local terminal or connect to an SSH server to get started.</p>
            <button type="button" className="new-terminal" onClick={openPalette}>New local terminal</button>
            <button type="button" className="connect-ssh-button" onClick={openSshConnect}>Connect to SSH</button>
          </div>}
        </div>
      </main>
    </div>
    {alert && <div className="alert-strip" role="alert"><span>{alert}</span><button type="button" aria-label="Dismiss message" onClick={() => setAlert(undefined)}>Dismiss</button></div>}
    <footer className="status-bar">
      <div className="terminal-status">
        <span className={`state-dot ${active?.state ?? 'idle'}`} />
        <span>{terminalStatus(active)}</span>
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
    {saveSessionOpen && <div className="ssh-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !catalogBusy) setSaveSessionOpen(false); }}>
      <section ref={saveSessionDialog} className="ssh-connect-dialog" role="dialog" aria-modal="true"
        aria-labelledby="save-session-heading" aria-describedby="save-session-description">
        <h2 id="save-session-heading">Save active session</h2>
        <p id="save-session-description">Save the shell or SSH endpoint so you can open it again later. Credentials and terminal history are never saved.</p>
        <form onSubmit={event => { event.preventDefault(); void saveActiveSession(); }}>
          <label htmlFor="saved-session-name">Session name</label>
          <input ref={saveSessionNameInput} id="saved-session-name" name="name" type="text" autoComplete="off" maxLength={256}
            required value={saveSessionName} onChange={event => setSaveSessionName(event.target.value)} />
          {saveSessionError && <p className="dialog-error" role="alert">{saveSessionError}</p>}
          <div className="ssh-connect-actions">
            <button type="button" disabled={catalogBusy} onClick={() => setSaveSessionOpen(false)}>Cancel</button>
            <button type="submit" className="ssh-primary" disabled={catalogBusy}>{catalogBusy ? 'Saving...' : 'Save session'}</button>
          </div>
        </form>
      </section>
    </div>}
    {sshConnectOpen && <div className="ssh-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setSshConnectOpen(false); }}>
      <section ref={sshConnectDialog} className="ssh-connect-dialog" role="dialog" aria-modal="true"
        aria-labelledby="ssh-connect-heading" aria-describedby="ssh-connect-description">
        <h2 id="ssh-connect-heading">Connect to an SSH server</h2>
        <p id="ssh-connect-description">Enter the server address. The Windows credential prompt will collect your username and password after you connect.</p>
        <form onSubmit={event => { event.preventDefault(); void openSshTerminal(sshHost, sshPort); }}>
          <label htmlFor="ssh-host">Host name or IP address</label>
          <input ref={sshHostInput} id="ssh-host" name="host" type="text" autoComplete="off" spellCheck={false}
            placeholder="server.example.com…" value={sshHost} onChange={event => setSshHost(event.target.value)} />
          <label htmlFor="ssh-port">Port</label>
          <input ref={sshPortInput} id="ssh-port" name="port" type="number" inputMode="numeric" min="1" max="65535" step="1"
            value={sshPort} onChange={event => setSshPort(event.target.value)} />
          {sshConnectError && <p className="dialog-error" role="alert">{sshConnectError}</p>}
          <div className="ssh-connect-actions">
            <button type="button" onClick={() => setSshConnectOpen(false)}>Cancel</button>
            <button type="submit" className="ssh-primary">Connect</button>
          </div>
        </form>
      </section>
    </div>}
    {currentSshTrust && <div className="ssh-backdrop" onMouseDown={event => {
      if (event.target === event.currentTarget && !sshTrustBusy) void decideSshTrust(currentSshTrust, false);
    }}>
      <section ref={sshTrustDialog} className={`ssh-trust-dialog ${currentSshTrust.kind === 'changed' ? 'changed' : ''}`}
        role={currentSshTrust.kind === 'changed' ? 'alertdialog' : 'dialog'} aria-modal="true"
        aria-labelledby="ssh-trust-heading" aria-describedby="ssh-trust-description">
        {currentSshTrust.kind === 'challenge' ? <>
          <p className="dialog-eyebrow">First connection</p>
          <h2 id="ssh-trust-heading">Verify this SSH host</h2>
          <p id="ssh-trust-description">Check this fingerprint with the server administrator using a trusted channel before you trust the host.</p>
          <dl className="ssh-host-facts">
          <div><dt>Host</dt><dd>{sshEndpointLabel(currentSshTrust.challenge.host, currentSshTrust.challenge.port)}</dd></div>
            <div><dt>Key algorithm</dt><dd>{currentSshTrust.challenge.algorithm}</dd></div>
            <div><dt>SHA-256 fingerprint</dt><dd><code className="ssh-fingerprint" translate="no">{currentSshTrust.challenge.fingerprint}</code></dd></div>
          </dl>
          <div className="ssh-connect-actions">
            <button ref={rejectSshHostButton} type="button" disabled={sshTrustBusy}
              onClick={() => void decideSshTrust(currentSshTrust, false)}>Reject</button>
            <button type="button" className="ssh-primary" disabled={sshTrustBusy}
              onClick={() => void decideSshTrust(currentSshTrust, true)}>{sshTrustBusy ? 'Saving trust…' : 'Trust key and connect'}</button>
          </div>
        </> : <>
          <p className="dialog-eyebrow">Connection blocked</p>
          <h2 id="ssh-trust-heading">SSH host key changed</h2>
          <p id="ssh-trust-description">The saved identity for this server does not match its current key. This connection was stopped. Verify the new fingerprint independently before resetting saved host trust.</p>
          <dl className="ssh-host-facts">
          <div><dt>Host</dt><dd>{sshEndpointLabel(currentSshTrust.host, currentSshTrust.port)}</dd></div>
            <div><dt>Key algorithm</dt><dd>{currentSshTrust.algorithm}</dd></div>
            <div><dt>New SHA-256 fingerprint</dt><dd><code className="ssh-fingerprint" translate="no">{currentSshTrust.fingerprint}</code></dd></div>
          </dl>
          <div className="ssh-connect-actions">
            <button ref={changedSshHostButton} type="button" disabled={sshTrustBusy}
              onClick={() => void decideSshTrust(currentSshTrust, false)}>Dismiss</button>
            <button type="button" className="ssh-primary" disabled={sshTrustBusy}
              onClick={() => void resetSshHostTrust(currentSshTrust)}>Reset saved host trust</button>
          </div>
        </>}
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
