import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent, ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { LocalTerminalEvent, LocalTerminalSession } from '../../../../packages/application/src/local-terminals.ts';
import type { SshTerminalSession, SshTrustEvent } from '../../../../packages/application/src/ssh-terminals.ts';
import type { TelnetTerminalSession } from '../../../../packages/application/src/telnet-terminals.ts';
import type { SerialTerminalSession } from '../../../../packages/application/src/serial-terminals.ts';
import type { FtpFilesSession } from '../../../../packages/application/src/ftp-files.ts';
import type { SshTunnelSnapshot } from '../../../../packages/application/src/ssh-tunnels.ts';
import { normalizeMacroDraft } from '../../../../packages/domain/src/macro.ts';
import type { MacroDefinition, MacroDraft } from '../../../../packages/domain/src/macro.ts';
import type { MacroStep } from '../../../../packages/domain/src/macro.ts';
import { formatMacroShortcut, isMacroShortcutCode } from '../../../../packages/domain/src/macro-shortcut.ts';
import type { MacroShortcutBinding, MacroShortcutCode } from '../../../../packages/domain/src/macro-shortcut.ts';
import { failure } from '../../../../packages/domain/src/errors.ts';
import { createMacroRunner } from '../../../../packages/application/src/macro-runner.ts';
import type { MacroPlaybackView } from './MacroManagerDialog.tsx';
import { createMacroRecorder } from '../../../../packages/application/src/macro-recording.ts';
import type { MacroRecordingSnapshot, MacroRecordingWarning } from '../../../../packages/application/src/macro-recording.ts';
import { createMultiExecRunner } from '../../../../packages/application/src/multi-exec.ts';
import type { MultiExecRequest } from '../../../../packages/domain/src/multi-exec.ts';
import type { MultiExecDisplayTarget, MultiExecView } from './MultiExecDialog.tsx';
import type { OpenSftpFilesReply, OpenSshTerminalReply, OpenTelnetTerminalReply, OpenSerialTerminalReply, OpenTerminalReply } from '../../../../packages/contracts/src/commands.ts';
import type { AppError } from '../../../../packages/domain/src/errors.ts';
import { canonicalizeSshHostEndpoint } from '../../../../packages/domain/src/host-trust.ts';
import { canonicalizeRemoteEndpoint } from '../../../../packages/domain/src/remote-endpoint.ts';
import { canonicalizeRdpEndpoint } from '../../../../packages/domain/src/rdp.ts';
import { canonicalizeVncEndpoint } from '../../../../packages/domain/src/vnc.ts';
import { canonicalizeFtpEndpoint } from '../../../../packages/domain/src/ftp.ts';
import type { LocalShell } from '../../../../packages/domain/src/local-terminal.ts';
import { normalizeSerialConfiguration, serialConfigurationsEqual } from '../../../../packages/domain/src/serial.ts';
import type { SerialConfiguration, SerialPortInfo } from '../../../../packages/domain/src/serial.ts';
import type { TerminalHighlightRule } from '../../../../packages/domain/src/terminal-highlights.ts';
import type { WorkbenchPreferences } from '../../../../packages/domain/src/workbench-preferences.ts';
import { normalizeSavedSessionDraft } from '../../../../packages/domain/src/session-definition.ts';
import type { SavedSessionDefinition, SavedSessionDraft } from '../../../../packages/domain/src/session-definition.ts';
import type { SavedSessionFolder } from '../../../../packages/domain/src/session-folder.ts';
import type { LocalTextFile } from '../../../../packages/domain/src/local-text-file.ts';
import type { SshTunnelDraft } from '../../../../packages/domain/src/ssh-tunnel.ts';
import { TerminalPane } from './TerminalPane.tsx';
import { SAVED_SESSION_CATALOG_VIRTUALIZATION_THRESHOLD, VirtualizedList } from './VirtualizedList.tsx';
import type { TerminalTheme, TerminalUiHandle } from './TerminalPane.tsx';
import { RemoteFilesPane } from './RemoteFilesPane.tsx';
import { TunnelManagerDialog } from './TunnelManagerDialog.tsx';
import { MacroManagerDialog } from './MacroManagerDialog.tsx';
import { MultiExecDialog } from './MultiExecDialog.tsx';
import { HelpDialog } from './HelpDialog.tsx';
import { SettingsDialog } from './SettingsDialog.tsx';
import { RdpConnectDialog } from './RdpConnectDialog.tsx';
import { VncConnectDialog } from './VncConnectDialog.tsx';
import { LocalTextEditorDialog } from './LocalTextEditorDialog.tsx';
import { textEditorErrorMessage } from './text-editor-errors.ts';
import { workbenchPreferenceFailureMessage } from './workbench-preference-errors.ts';
import '@xterm/xterm/css/xterm.css';
import './tokens.css';

type InteractiveTerminal =
  | (LocalTerminalSession & { readonly transport: 'local'; readonly title: string })
  | (SshTerminalSession & { readonly transport: 'ssh'; readonly title: string })
  | (TelnetTerminalSession & { readonly transport: 'telnet'; readonly title: string });
type WorkbenchTerminal = InteractiveTerminal | (SerialTerminalSession & { readonly transport: 'serial'; readonly title: string });

type WorkbenchFtpSession = FtpFilesSession & { readonly transport: 'ftp'; readonly title: string };
type WorkbenchSftpSession = SshTerminalSession & { readonly transport: 'sftp'; readonly title: string };
type WorkbenchSession = WorkbenchTerminal | WorkbenchFtpSession | WorkbenchSftpSession;

function isMacroTerminal(session: WorkbenchSession | undefined): session is InteractiveTerminal {
  return session !== undefined && (session.transport === 'local' || session.transport === 'ssh' || session.transport === 'telnet');
}

type OpeningTerminal =
  | { readonly transport: 'local'; readonly sessionId: string; readonly shell: LocalShell; readonly cancelling: boolean }
  | { readonly transport: 'ssh' | 'sftp' | 'telnet'; readonly sessionId: string; readonly host: string; readonly port: number; readonly cancelling: boolean }
  | { readonly transport: 'serial'; readonly sessionId: string; readonly configuration: SerialConfiguration; readonly cancelling: boolean };

type PendingOpenRequest =
  | { cancelled: boolean; readonly transport: 'local'; readonly reply: Promise<OpenTerminalReply> }
  | { cancelled: boolean; readonly transport: 'ssh'; readonly reply: Promise<OpenSshTerminalReply> }
  | { cancelled: boolean; readonly transport: 'sftp'; readonly reply: Promise<OpenSftpFilesReply> }
  | { cancelled: boolean; readonly transport: 'telnet'; readonly reply: Promise<OpenTelnetTerminalReply> }
  | { cancelled: boolean; readonly transport: 'serial'; readonly reply: Promise<OpenSerialTerminalReply> };

type SavedFolderDialogState =
  | { readonly mode: 'create'; readonly parentId: string | null }
  | { readonly mode: 'rename'; readonly folder: SavedSessionFolder }
  | { readonly mode: 'move-folder'; readonly folder: SavedSessionFolder }
  | { readonly mode: 'move-session'; readonly session: SavedSessionDefinition };

type SavedCatalogItem =
  | { readonly kind: 'unfiled-header' }
  | { readonly kind: 'folder'; readonly folder: SavedSessionFolder; readonly depth: number }
  | { readonly kind: 'session'; readonly session: SavedSessionDefinition; readonly depth: number };

interface MacroRecordingView {
  readonly sessionId: string;
  readonly name: string;
  readonly targetTitle: string;
  readonly status: 'recording' | 'paused' | 'saving' | 'stopped';
  readonly steps: readonly MacroStep[];
  readonly stepCount: number;
  readonly warning?: MacroRecordingWarning | undefined;
  readonly stopReason?: 'stopped' | 'disconnected';
  readonly saveError?: string | undefined;
}

interface TerminalTabContextMenu {
  readonly sessionId: string;
  readonly x: number;
  readonly y: number;
}

type CommandName = 'new-powershell' | 'new-cmd' | 'new-bash' | 'connect-ssh' | 'connect-sftp' | 'connect-telnet' | 'connect-serial' | 'connect-ftp' | 'connect-rdp' | 'connect-vnc' | 'multi-exec' | 'close-active' | 'toggle-theme' | 'open-help' | 'open-settings';
interface PaletteCommand {
  readonly id: CommandName;
  readonly label: string;
  readonly run: () => void;
}

const SHELL_PRESENTATION: Record<LocalShell, { readonly name: string; readonly badge: string; readonly mark: string }> = {
  powershell: { name: 'PowerShell', badge: 'PS', mark: '›_' },
  cmd: { name: 'cmd', badge: 'CMD', mark: 'C:\\' },
  bash: { name: 'Bash', badge: 'BASH', mark: '$' }
};
const SAVED_SESSION_SEARCH_DEBOUNCE_MS = 50;

function shellName(shell: LocalShell): string { return SHELL_PRESENTATION[shell].name; }
function autoSavedProfileName(protocol: string, host: string, port: number): string {
  const suffix = `:${port} - ${protocol}`;
  return `${Array.from(host).slice(0, 256 - suffix.length).join('')}${suffix}`;
}
function shellBadge(shell: LocalShell): string { return SHELL_PRESENTATION[shell].badge; }
function shellMark(shell: LocalShell): string { return SHELL_PRESENTATION[shell].mark; }

function macroTargetTitle(session: InteractiveTerminal): string {
  if (session.transport === 'local') return `${session.title} · ${shellName(session.shell)} · local`;
  const protocol = session.transport === 'telnet' ? 'Telnet (plaintext)' : 'SSH';
  return `${session.title} · ${protocol} · ${sshEndpointLabel(session.endpoint.host, session.endpoint.port)}`;
}

function openingName(opening: OpeningTerminal): string {
  if (opening.transport === 'local') return `${shellName(opening.shell)} terminal`;
  if (opening.transport === 'serial') return `Serial connection to ${opening.configuration.path}`;
  const protocol = opening.transport === 'telnet' ? 'Telnet (plaintext)' : opening.transport === 'sftp' ? 'SFTP' : 'SSH';
  return `${protocol} connection to ${sshEndpointLabel(opening.host, opening.port)}`;
}

function sshEndpointLabel(host: string, port: number): string { return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`; }

function folderDescendants(folders: readonly SavedSessionFolder[], folderId: string): Set<string> {
  const descendants = new Set<string>([folderId]);
  const children = new Map<string, string[]>();
  for (const folder of folders) {
    if (folder.parentId === null) continue;
    const siblings = children.get(folder.parentId) ?? [];
    siblings.push(folder.id);
    children.set(folder.parentId, siblings);
  }
  const pending = [folderId];
  while (pending.length > 0) {
    const parentId = pending.pop();
    if (!parentId) continue;
    for (const childId of children.get(parentId) ?? []) {
      if (descendants.has(childId)) continue;
      descendants.add(childId);
      pending.push(childId);
    }
  }
  return descendants;
}

function folderPathLabel(folder: SavedSessionFolder, folders: readonly SavedSessionFolder[]): string {
  const names = [folder.name];
  const seen = new Set([folder.id]);
  let parentId = folder.parentId;
  while (parentId) {
    if (seen.has(parentId)) break;
    seen.add(parentId);
    const parent = folders.find(candidate => candidate.id === parentId);
    if (!parent) break;
    names.push(parent.name);
    parentId = parent.parentId;
  }
  return names.reverse().join(' / ');
}

function savedFolderError(code: string): string {
  if (code === 'CONFLICT') return 'This would create a folder cycle or a duplicate folder name at the same level. Rename a matching folder and try again.';
  if (code === 'NOT_FOUND') return 'The folder or session changed before the operation completed. Refresh the saved-session list and try again.';
  return `The folder operation failed (${code}).`;
}

function savedBundleError(code: string): string {
  if (code === 'CANCELLED') return '';
  if (code === 'CONFLICT') return 'Import stopped because a folder or saved connection conflicts with existing data. No changes were applied.';
  if (code === 'INVALID_REQUEST') return 'The selected file is not a supported saved-folder bundle. It may be damaged or contain unsupported fields.';
  if (code === 'BUSY' || code === 'TIMEOUT') return 'The saved-folder operation took too long. Try again with a smaller folder.';
  return `The saved-folder operation failed (${code}).`;
}

function terminalStatus(session: WorkbenchSession | undefined): string {
  if (!session) return 'No active terminal';
  if (session.transport === 'ftp') return `${session.endpoint.secure ? 'FTPS' : 'FTP (plaintext)'} files · ${sshEndpointLabel(session.endpoint.host, session.endpoint.port)} · ${session.state}`;
  if (session.transport === 'sftp') return `SFTP files · ${sshEndpointLabel(session.endpoint.host, session.endpoint.port)} · ${session.state}`;
  if (session.transport === 'local') return `${shellName(session.shell)} · Local · ${session.state}`;
  if (session.transport === 'serial') return `Serial · ${session.configuration.path} · ${session.configuration.baudRate} baud · ${session.state}`;
  return `${session.transport === 'telnet' ? 'Telnet (plaintext)' : 'SSH'} · ${sshEndpointLabel(session.endpoint.host, session.endpoint.port)} · ${session.state}`;
}

function sshOpenError(code: string): string {
  if (code === 'LOCKED') return 'The credential vault is locked. Open Settings and unlock it, then reopen this saved SSH profile.';
  if (code === 'AUTHENTICATION_FAILED') return 'The SSH server rejected these credentials.';
  if (code === 'HOST_KEY_REJECTED') return 'The SSH host was not trusted, so the connection was stopped.';
  if (code === 'HOST_KEY_CHANGED') return 'The SSH host key changed. The connection was blocked.';
  if (code === 'CANCELLED') return 'The SSH connection was cancelled.';
  if (code === 'TIMEOUT') return 'The SSH connection timed out.';
  return `Could not connect to the SSH server (${code}).`;
}

function sshCredentialError(code: string): string {
  if (code === 'CANCELLED') return '';
  if (code === 'LOCKED') return 'The credential vault is locked. Open Settings and unlock it before saving or forgetting a password.';
  if (code === 'NOT_FOUND') return 'This saved SSH profile no longer exists. Refresh Saved sessions and try again.';
  if (code === 'INVALID_REQUEST') return 'The selected profile or Windows credential was invalid. No password was saved.';
  if (code === 'CORRUPT') return 'The saved credential could not be read. Save the password again to replace it.';
  if (code === 'BUSY' || code === 'TIMEOUT') return 'The credential operation took too long. Try again.';
  return `The credential operation failed (${code}).`;
}

function telnetOpenError(code: string): string {
  if (code === 'CANCELLED') return 'The Telnet connection was cancelled.';
  if (code === 'TIMEOUT') return 'The Telnet connection timed out.';
  return `Could not connect to the Telnet server (${code}).`;
}

function ftpOpenError(code: string, secure: boolean): string {
  if (code === 'AUTHENTICATION_FAILED') return 'The FTP server rejected these credentials.';
  if (code === 'FORBIDDEN') return 'Plain FTP needs a fresh confirmation from the visible warning form.';
  if (code === 'CANCELLED') return 'The FTP connection was cancelled.';
  if (code === 'TIMEOUT') return 'The FTP connection timed out.';
  return `Could not connect to the ${secure ? 'FTPS' : 'FTP'} server (${code}).`;
}

function rdpOpenError(code: string): string {
  if (code === 'NOT_SUPPORTED') return 'Windows Remote Desktop is available only on Windows.';
  if (code === 'CANCELLED') return 'Opening Windows Remote Desktop was cancelled.';
  if (code === 'INVALID_REQUEST') return 'Enter a valid host name or IP address and port.';
  return 'Windows Remote Desktop could not be started. Check that the Windows viewer is available.';
}

function vncOpenError(code: string): string {
  if (code === 'NOT_SUPPORTED') return 'TigerVNC is available only on Windows.';
  if (code === 'CANCELLED') return 'Opening TigerVNC was cancelled.';
  if (code === 'INVALID_REQUEST') return 'Enter a valid host name or IP address and port.';
  if (code === 'UNAVAILABLE') return 'TigerVNC was not found in its standard Program Files location. Install TigerVNC and try again.';
  return `TigerVNC could not be started (${code}).`;
}

function tunnelOpenError(code: string): string {
  if (code === 'CONFLICT') return 'That local port is already in use. Choose another port or use 0 to let Windows assign one.';
  if (code === 'AUTHENTICATION_FAILED') return 'The SSH server rejected these credentials.';
  if (code === 'HOST_KEY_REJECTED') return 'The SSH host was not trusted, so the tunnel was stopped.';
  if (code === 'HOST_KEY_CHANGED') return 'The SSH host key changed. The tunnel was blocked.';
  if (code === 'CANCELLED') return 'Tunnel startup was cancelled.';
  if (code === 'TIMEOUT') return 'Tunnel startup timed out.';
  if (code === 'BUSY') return 'Too many tunnels are active or this tunnel is already changing state.';
  return `The tunnel operation failed (${code}).`;
}

function closeTerminalConnection(sessionId: string, transport: 'local' | 'ssh' | 'telnet' | 'serial' | 'ftp' | 'sftp') {
  if (transport === 'ssh') return window.multiRemoteTerminal.closeSshTerminal(sessionId);
  if (transport === 'sftp') return window.multiRemoteTerminal.closeSftpFiles(sessionId);
  if (transport === 'telnet') return window.multiRemoteTerminal.closeTelnetTerminal(sessionId);
  if (transport === 'serial') return window.multiRemoteTerminal.closeSerialTerminal(sessionId);
  if (transport === 'ftp') return window.multiRemoteTerminal.closeFtpFiles(sessionId);
  return window.multiRemoteTerminal.closeTerminal(sessionId);
}

function messageForError(error: AppError): string {
  if (error.code === 'OUTPUT_LIMIT') return 'This terminal produced more output than the display can buffer. The process was stopped.';
  if (error.code === 'NOT_FOUND') return 'This terminal is no longer available.';
  return `The terminal operation failed (${error.code}). ${error.retryable ? 'Try again or open a new terminal.' : 'Open a new terminal to continue.'}`;
}

function macroRecordingWarningText(warning: MacroRecordingWarning): string {
  if (warning === 'secret-prompt') return 'A recognized secret prompt was detected. Recording is paused; resume after it closes.';
  if (warning === 'input-skipped') return 'Input with control keys was skipped through the next submitted line.';
  if (warning === 'line-limit') return 'An overlong input line was skipped.';
  if (warning === 'text-limit') return 'The macro text limit was reached; this line was not recorded.';
  return 'The 64-step recording limit was reached.';
}

function macroShortcutCodeFromEvent(event: KeyboardEvent): MacroShortcutCode | undefined {
  if (!event.ctrlKey || !event.altKey || !event.shiftKey || event.metaKey || event.repeat || event.isComposing || event.getModifierState('AltGraph')) return undefined;
  return isMacroShortcutCode(event.code) ? event.code : undefined;
}

function Workbench() {
  const [theme, setTheme] = useState<TerminalTheme>('dark');
  const [fontSize, setFontSize] = useState(14);
  const [sessions, setSessions] = useState<WorkbenchSession[]>([]);
  const [openingSessions, setOpeningSessions] = useState<OpeningTerminal[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [status, setStatus] = useState('Starting');
  const [alert, setAlert] = useState<string>();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [localTextEditorOpen, setLocalTextEditorOpen] = useState(false);
  const [localTextEditorOpening, setLocalTextEditorOpening] = useState(false);
  const [localTextFile, setLocalTextFile] = useState<LocalTextFile>();
  const [startupGreeting, setStartupGreeting] = useState('');
  const [startupGreetingVisible, setStartupGreetingVisible] = useState(false);
  const [terminalHighlightEnabled, setTerminalHighlightEnabled] = useState(false);
  const [terminalHighlightRules, setTerminalHighlightRules] = useState<readonly TerminalHighlightRule[]>([]);
  const [terminalShellSyntaxEnabled, setTerminalShellSyntaxEnabled] = useState(false);
  const [pendingCloseId, setPendingCloseId] = useState<string>();
  const [tabContextMenu, setTabContextMenu] = useState<TerminalTabContextMenu>();
  const [query, setQuery] = useState('');
  const [selectedCommand, setSelectedCommand] = useState(0);
  const [sshConnectOpen, setSshConnectOpen] = useState(false);
  const [sshConnectMode, setSshConnectMode] = useState<'terminal' | 'sftp'>('terminal');
  const [sshGatewayTarget, setSshGatewayTarget] = useState<Extract<SavedSessionDefinition, { kind: 'ssh' }>>();
  const [sshGatewayProfiles, setSshGatewayProfiles] = useState<readonly Extract<SavedSessionDefinition, { kind: 'ssh' }>[]>([]);
  const [sshGatewayOne, setSshGatewayOne] = useState('');
  const [sshGatewayTwo, setSshGatewayTwo] = useState('');
  const [sshHost, setSshHost] = useState('');
  const [sshPort, setSshPort] = useState('22');
  const [sshConnectError, setSshConnectError] = useState<string>();
  const [sshSavedTitle, setSshSavedTitle] = useState<string>();
  const [telnetConnectOpen, setTelnetConnectOpen] = useState(false);
  const [telnetHost, setTelnetHost] = useState('');
  const [telnetPort, setTelnetPort] = useState('23');
  const [telnetConnectError, setTelnetConnectError] = useState<string>();
  const [telnetSavedTitle, setTelnetSavedTitle] = useState<string>();
  const [serialConnectOpen, setSerialConnectOpen] = useState(false);
  const [serialPorts, setSerialPorts] = useState<readonly SerialPortInfo[]>([]);
  const [serialPortsLoading, setSerialPortsLoading] = useState(false);
  const [serialPortsError, setSerialPortsError] = useState<string>();
  const [serialSavedTitle, setSerialSavedTitle] = useState<string>();
  const [serialSavedProfilePath, setSerialSavedProfilePath] = useState<string>();
  const [serialConfigurationDraft, setSerialConfigurationDraft] = useState<SerialConfiguration>({
    path: 'COM1', baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1, flowControl: 'none'
  });
  const [ftpConnectOpen, setFtpConnectOpen] = useState(false);
  const [ftpHost, setFtpHost] = useState('');
  const [ftpPort, setFtpPort] = useState('21');
  const [ftpSecurity, setFtpSecurity] = useState<'ftps' | 'ftp'>('ftps');
  const [ftpConnectError, setFtpConnectError] = useState<string>();
  const [ftpSavedTitle, setFtpSavedTitle] = useState<string>();
  const [ftpConnecting, setFtpConnecting] = useState(false);
  const [rdpConnectOpen, setRdpConnectOpen] = useState(false);
  const [rdpHost, setRdpHost] = useState('');
  const [rdpPort, setRdpPort] = useState(3389);
  const [rdpSavedProfileName, setRdpSavedProfileName] = useState<string>();
  const [vncConnectOpen, setVncConnectOpen] = useState(false);
  const [vncHost, setVncHost] = useState('');
  const [vncPort, setVncPort] = useState(5900);
  const [vncSavedProfileName, setVncSavedProfileName] = useState<string>();
  const [sshTrustEvents, setSshTrustEvents] = useState<SshTrustEvent[]>([]);
  const [sshTrustBusy, setSshTrustBusy] = useState(false);
  const [savedSessions, setSavedSessions] = useState<readonly SavedSessionDefinition[]>([]);
  const [savedSessionCount, setSavedSessionCount] = useState(0);
  const [savedFolders, setSavedFolders] = useState<readonly SavedSessionFolder[]>([]);
  const [tunnelManagerOpen, setTunnelManagerOpen] = useState(false);
  const [tunnelProfiles, setTunnelProfiles] = useState<readonly SavedSessionDefinition[]>([]);
  const [tunnels, setTunnels] = useState<readonly SshTunnelSnapshot[]>([]);
  const [tunnelsLoading, setTunnelsLoading] = useState(false);
  const [tunnelBusyId, setTunnelBusyId] = useState<string>();
  const [tunnelError, setTunnelError] = useState<string>();
  const [multiExecOpen, setMultiExecOpen] = useState(false);
  const [multiExecView, setMultiExecView] = useState<MultiExecView>();
  const [macroManagerOpen, setMacroManagerOpen] = useState(false);
  const [macros, setMacros] = useState<readonly MacroDefinition[]>([]);
  const [macroShortcuts, setMacroShortcuts] = useState<readonly MacroShortcutBinding[]>([]);
  const [macroShortcutCaptureMacroId, setMacroShortcutCaptureMacroId] = useState<string>();
  const [macroShortcutNotice, setMacroShortcutNotice] = useState<string>();
  const [macrosLoading, setMacrosLoading] = useState(false);
  const [macroBusy, setMacroBusy] = useState(false);
  const [macroError, setMacroError] = useState<string>();
  const [macroRecording, setMacroRecording] = useState<MacroRecordingView>();
  const [macroPlaybackMacroId, setMacroPlaybackMacroId] = useState<string>();
  const [macroPlayback, setMacroPlayback] = useState<MacroPlaybackView>();
  const [savedSearch, setSavedSearch] = useState('');
  const savedSearchRef = useRef(savedSearch);
  savedSearchRef.current = savedSearch;
  const [savedSessionsLoading, setSavedSessionsLoading] = useState(true);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [credentialBusyId, setCredentialBusyId] = useState<string>();
  const [savedSshCredentialStatus, setSavedSshCredentialStatus] = useState<Record<string, 'loading' | 'saved' | 'none' | 'unavailable'>>({});
  const [openSavedActionsMenuId, setOpenSavedActionsMenuId] = useState<string>();
  const [saveSessionOpen, setSaveSessionOpen] = useState(false);
  const [saveSessionName, setSaveSessionName] = useState('');
  const [saveSessionError, setSaveSessionError] = useState<string>();
  const [uncertainSaveDraft, setUncertainSaveDraft] = useState<SavedSessionDraft>();
  const [folderDialog, setFolderDialog] = useState<SavedFolderDialogState>();
  const [folderNameDraft, setFolderNameDraft] = useState('');
  const [folderParentDraft, setFolderParentDraft] = useState('');
  const [folderDialogError, setFolderDialogError] = useState<string>();
  const [expandedFolderIds, setExpandedFolderIds] = useState<ReadonlySet<string>>(new Set());
  const sessionsRef = useRef<WorkbenchSession[]>(sessions);
  sessionsRef.current = sessions;
  const handles = useRef(new Map<string, TerminalUiHandle>());
  const pendingEvents = useRef(new Map<string, LocalTerminalEvent[]>());
  const fileOnlySshSessionIds = useRef(new Set<string>());
  const visibleFileOnlySshSessionIds = useRef(new Set<string>());
  const pendingOpenRequests = useRef(new Map<string, PendingOpenRequest>());
  const nextOrdinal = useRef<Record<LocalShell, number>>({ powershell: 0, cmd: 0, bash: 0 });
  const nextSshOrdinal = useRef(0);
  const nextTelnetOrdinal = useRef(0);
  const nextSerialOrdinal = useRef(0);
  const nextFtpOrdinal = useRef(0);
  const savedSessionsRequest = useRef(0);
  const savedFoldersRequest = useRef(0);
  const tunnelManagerRequest = useRef(0);
  const tunnelOperationRequest = useRef(0);
  const macroManagerRequest = useRef(0);
  const macroShortcutRequest = useRef(0);
  const macroRecorder = useState(createMacroRecorder)[0];
  const macroPlaybackRun = useRef(false);
  const multiExecRun = useRef(false);
  const pendingMultiExecConfirmation = useRef<((approved: boolean) => void) | undefined>(undefined);
  const multiExecBackToSelection = useRef(false);
  const multiExecCloseAfterRun = useRef(false);
  const pendingMacroConfirmation = useRef<((accepted: boolean) => void) | undefined>(undefined);
  const macroRunner = useState(() => createMacroRunner({
    isTargetReady: sessionId => {
      const session = sessionsRef.current.find(candidate => candidate.sessionId === sessionId);
      return isMacroTerminal(session) && session.state === 'running' && handles.current.has(sessionId);
    },
    scheduleTimeout: (callback, delayMs) => {
      const timer = window.setTimeout(callback, delayMs);
      return () => window.clearTimeout(timer);
    },
    sendLine: async (sessionId, line) => {
      const session = sessionsRef.current.find(candidate => candidate.sessionId === sessionId);
      if (!isMacroTerminal(session) || session.state !== 'running' || !handles.current.has(sessionId)) {
        return failure('UNAVAILABLE', 'terminal');
      }
      try {
        const reply = session.transport === 'local'
          ? await window.multiRemoteTerminal.writeTerminal(sessionId, line)
          : session.transport === 'ssh'
            ? await window.multiRemoteTerminal.writeSshTerminal(sessionId, line)
            : await window.multiRemoteTerminal.writeTelnetTerminal(sessionId, line);
        return reply.ok ? { ok: true, result: undefined } : { ok: false, error: reply.error };
      } catch {
        return failure('UNAVAILABLE', 'terminal');
      }
    }
  }))[0];
  const macroSaveErrorCode = useRef('UNAVAILABLE');
  const macroRecordingView = useRef<MacroRecordingView | undefined>(undefined);
  const multiExecRunner = useState(() => createMultiExecRunner({
    isTargetReady: sessionId => {
      const session = sessionsRef.current.find(candidate => candidate.sessionId === sessionId);
      return isMacroTerminal(session) && session.state === 'running' && handles.current.has(sessionId);
    },
    sendLine: async (sessionId, line) => {
      const session = sessionsRef.current.find(candidate => candidate.sessionId === sessionId);
      if (!isMacroTerminal(session) || session.state !== 'running' || !handles.current.has(sessionId)) return failure('UNAVAILABLE', 'terminal');
      try {
        const reply = session.transport === 'local'
          ? await window.multiRemoteTerminal.writeTerminal(sessionId, line)
          : session.transport === 'ssh'
            ? await window.multiRemoteTerminal.writeSshTerminal(sessionId, line)
            : await window.multiRemoteTerminal.writeTelnetTerminal(sessionId, line);
        return reply.ok ? { ok: true, result: undefined } : { ok: false, error: reply.error };
      } catch {
        return failure('UNAVAILABLE', 'terminal');
      }
    }
  }))[0];
  const pendingMacroTerminalFocus = useRef<string | undefined>(undefined);
  const paletteInput = useRef<HTMLInputElement>(null);
  const palette = useRef<HTMLElement>(null);
  const paletteReturnFocus = useRef<HTMLElement | null>(null);
  const helpReturnFocus = useRef<HTMLElement | null>(null);
  const settingsReturnFocus = useRef<HTMLElement | null>(null);
  const localTextEditorTrigger = useRef<HTMLButtonElement>(null);
  const localTextEditorReturnFocus = useRef<HTMLElement | null>(null);
  const localTextFileRef = useRef<LocalTextFile | undefined>(undefined);
  const sshConnectDialog = useRef<HTMLElement>(null);
  const sshHostInput = useRef<HTMLInputElement>(null);
  const sshPortInput = useRef<HTMLInputElement>(null);
  const sshConnectReturnFocus = useRef<HTMLElement | null>(null);
  const telnetConnectDialog = useRef<HTMLElement>(null);
  const telnetHostInput = useRef<HTMLInputElement>(null);
  const telnetPortInput = useRef<HTMLInputElement>(null);
  const telnetConnectReturnFocus = useRef<HTMLElement | null>(null);
  const serialConnectDialog = useRef<HTMLElement>(null);
  const serialConnectReturnFocus = useRef<HTMLElement | null>(null);
  const ftpConnectDialog = useRef<HTMLElement>(null);
  const ftpHostInput = useRef<HTMLInputElement>(null);
  const ftpPortInput = useRef<HTMLInputElement>(null);
  const ftpConnectReturnFocus = useRef<HTMLElement | null>(null);
  const rdpConnectDialog = useRef<HTMLElement>(null);
  const rdpConnectReturnFocus = useRef<HTMLElement | null>(null);
  const vncConnectDialog = useRef<HTMLElement>(null);
  const vncConnectReturnFocus = useRef<HTMLElement | null>(null);
  const saveSessionDialog = useRef<HTMLElement>(null);
  const saveSessionNameInput = useRef<HTMLInputElement>(null);
  const checkSavedSessionsButton = useRef<HTMLButtonElement>(null);
  const saveSessionReturnFocus = useRef<HTMLElement | null>(null);
  const folderDialogRef = useRef<HTMLElement>(null);
  const folderNameInput = useRef<HTMLInputElement>(null);
  const folderParentInput = useRef<HTMLSelectElement>(null);
  const folderDialogReturnFocus = useRef<HTMLElement | null>(null);
  const tunnelManagerDialog = useRef<HTMLElement>(null);
  const tunnelManagerReturnFocus = useRef<HTMLElement | null>(null);
  const macroManagerDialog = useRef<HTMLElement>(null);
  const macroManagerReturnFocus = useRef<HTMLElement | null>(null);
  const multiExecDialog = useRef<HTMLElement>(null);
  const multiExecReturnFocus = useRef<HTMLElement | null>(null);
  const sshTrustDialog = useRef<HTMLElement>(null);
  const rejectSshHostButton = useRef<HTMLButtonElement>(null);
  const changedSshHostButton = useRef<HTMLButtonElement>(null);
  const sshTrustReturnFocus = useRef<HTMLElement | null>(null);
  const closeDialog = useRef<HTMLElement>(null);
  const closeReturnFocus = useRef<HTMLElement | null>(null);
  const keepTerminalButton = useRef<HTMLButtonElement>(null);
  const tabContextMenuElement = useRef<HTMLDivElement>(null);
  const firstTabContextAction = useRef<HTMLButtonElement>(null);
  const tabContextReturnFocus = useRef<HTMLElement | null>(null);
  const focusTerminalOnActiveChange = useRef(true);

  useLayoutEffect(() => {
    if (!openSavedActionsMenuId) return;
    const closeOutsideMenu = (event: PointerEvent) => {
      if (event.target instanceof Node && document.querySelector('details.saved-actions-menu[open]')?.contains(event.target)) return;
      setOpenSavedActionsMenuId(undefined);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const menu = document.querySelector<HTMLDetailsElement>('details.saved-actions-menu[open]');
      if (!menu) return;
      event.preventDefault();
      const summary = menu.querySelector<HTMLElement>('summary');
      setOpenSavedActionsMenuId(undefined);
      requestAnimationFrame(() => summary?.focus());
    };
    document.addEventListener('pointerdown', closeOutsideMenu, true);
    document.addEventListener('keydown', closeOnEscape, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutsideMenu, true);
      document.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [openSavedActionsMenuId]);

  const showTerminalError = useCallback((message: string) => setAlert(message), []);
  const loadSavedSessions = useCallback(async (search: string, refreshCount = true): Promise<readonly SavedSessionDefinition[] | undefined> => {
    const request = ++savedSessionsRequest.current;
    setSavedSessionsLoading(true);
    try {
      const [reply, countReply] = await Promise.all([
        window.multiRemoteTerminal.listSavedSessions(search),
        refreshCount ? window.multiRemoteTerminal.countSavedSessions() : Promise.resolve(undefined)
      ]);
      if (request !== savedSessionsRequest.current) return undefined;
      if (!reply.ok) {
        setAlert(`Saved sessions could not be loaded (${reply.error.code}).`);
        return undefined;
      }
      if (countReply && !countReply.ok) {
        setAlert(`Saved-session count could not be loaded (${countReply.error.code}).`);
        return undefined;
      }
      setSavedSessions(reply.result);
      if (countReply?.ok) setSavedSessionCount(countReply.result);
      return reply.result;
    } catch {
      if (request === savedSessionsRequest.current) setAlert('Saved sessions could not be loaded.');
      return undefined;
    } finally {
      if (request === savedSessionsRequest.current) setSavedSessionsLoading(false);
    }
  }, []);

  const loadSavedFolders = useCallback(async (): Promise<readonly SavedSessionFolder[] | undefined> => {
    const request = ++savedFoldersRequest.current;
    try {
      const reply = await window.multiRemoteTerminal.listSavedSessionFolders();
      if (request !== savedFoldersRequest.current) return undefined;
      if (!reply.ok) {
        setAlert(`Saved folders could not be loaded (${reply.error.code}).`);
        return undefined;
      }
      setSavedFolders(reply.result);
      setExpandedFolderIds(current => current.size > 0 ? current : new Set(reply.result.filter(folder => folder.parentId === null).map(folder => folder.id)));
      return reply.result;
    } catch {
      if (request === savedFoldersRequest.current) setAlert('Saved folders could not be loaded.');
      return undefined;
    }
  }, []);

  const rememberOpenedSession = useCallback(async (draft: SavedSessionDraft): Promise<void> => {
    try {
      const reply = await window.multiRemoteTerminal.rememberSavedSession(draft);
      if (!reply.ok) {
        if (reply.error.code !== 'FORBIDDEN') {
          setAlert(`The connection opened, but its profile could not be saved (${reply.error.code}).`);
        }
        return;
      }
      await loadSavedSessions(savedSearchRef.current);
    } catch {
      setAlert('The connection opened, but its profile could not be saved. Check Saved sessions before retrying.');
    }
  }, [loadSavedSessions]);

  const loadTunnelManager = useCallback(async (): Promise<void> => {
    const request = ++tunnelManagerRequest.current;
    setTunnelsLoading(true);
    try {
      const [tunnelReply, profileReply] = await Promise.all([
        window.multiRemoteTerminal.listSshTunnels(),
        window.multiRemoteTerminal.listSavedSessions('')
      ]);
      if (request !== tunnelManagerRequest.current) return;
      if (!tunnelReply.ok) {
        setTunnelError(`Saved tunnels could not be loaded (${tunnelReply.error.code}).`);
        return;
      }
      if (!profileReply.ok) {
        setTunnelError(`Saved SSH profiles could not be loaded (${profileReply.error.code}).`);
        return;
      }
      setTunnels(tunnelReply.result);
      setTunnelProfiles(profileReply.result.filter(profile => profile.kind === 'ssh' || profile.kind === 'sftp'));
    } catch {
      if (request === tunnelManagerRequest.current) setTunnelError('Saved tunnels could not be loaded.');
    } finally {
      if (request === tunnelManagerRequest.current) setTunnelsLoading(false);
    }
  }, []);

  const openTunnelManager = useCallback(() => {
    tunnelManagerReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setTunnelError(undefined);
    setTunnelManagerOpen(true);
    void loadTunnelManager();
  }, [loadTunnelManager]);

  const closeTunnelManager = useCallback(() => setTunnelManagerOpen(false), []);

  const publishMacroRecording = useCallback((next: MacroRecordingView | undefined) => {
    macroRecordingView.current = next;
    setMacroRecording(next);
  }, []);

  const syncMacroRecordingSnapshot = useCallback((snapshot: MacroRecordingSnapshot) => {
    const current = macroRecordingView.current;
    if (!current || current.status === 'saving' || current.status === 'stopped' || snapshot.status === 'idle') return;
    const next: MacroRecordingView = {
      ...current,
      status: snapshot.status,
      stepCount: snapshot.stepCount,
      warning: snapshot.warning
    };
    if (current.status !== next.status || current.stepCount !== next.stepCount || current.warning !== next.warning) publishMacroRecording(next);
  }, [publishMacroRecording]);

  const loadMacroShortcuts = useCallback(async (): Promise<void> => {
    const request = ++macroShortcutRequest.current;
    try {
      const reply = await window.multiRemoteTerminal.listMacroShortcuts();
      if (request === macroShortcutRequest.current && reply.ok) setMacroShortcuts(reply.result);
    } catch { /* Shortcuts remain unavailable until the manager can report the storage error. */ }
  }, []);

  const loadMacroManager = useCallback(async (): Promise<void> => {
    const request = ++macroManagerRequest.current;
    const shortcutsRequest = ++macroShortcutRequest.current;
    setMacrosLoading(true);
    try {
      const [macrosReply, shortcutsReply] = await Promise.all([
        window.multiRemoteTerminal.listMacros(), window.multiRemoteTerminal.listMacroShortcuts()
      ]);
      if (request !== macroManagerRequest.current) return;
      if (!macrosReply.ok) setMacroError(`Saved macros could not be loaded (${macrosReply.error.code}).`);
      else setMacros(macrosReply.result);
      if (shortcutsRequest === macroShortcutRequest.current) {
        if (!shortcutsReply.ok) setMacroShortcutNotice(`Keyboard shortcuts could not be loaded (${shortcutsReply.error.code}).`);
        else setMacroShortcuts(shortcutsReply.result);
      }
    } catch {
      if (request === macroManagerRequest.current) {
        setMacroError('Saved macros could not be loaded.');
        if (shortcutsRequest === macroShortcutRequest.current) setMacroShortcutNotice('Keyboard shortcuts could not be loaded.');
      }
    } finally {
      if (request === macroManagerRequest.current) setMacrosLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMacroShortcuts();
    return () => { macroShortcutRequest.current++; };
  }, [loadMacroShortcuts]);

  const openMacroManager = useCallback(() => {
    macroManagerReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setMacroError(undefined);
    setMacroShortcutNotice(undefined);
    setMacroShortcutCaptureMacroId(undefined);
    setMacroManagerOpen(true);
    void loadMacroManager();
  }, [loadMacroManager]);

  const openMultiExec = useCallback(() => {
    if (multiExecRun.current) return;
    multiExecReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setMultiExecView(undefined);
    setMultiExecOpen(true);
  }, []);

  const closeMultiExec = useCallback(() => {
    if (multiExecRun.current) {
      multiExecCloseAfterRun.current = true;
      if (pendingMultiExecConfirmation.current) pendingMultiExecConfirmation.current(false);
      else multiExecRunner.cancel();
      return;
    }
    setMultiExecView(undefined);
    setMultiExecOpen(false);
  }, [multiExecRunner]);

  const confirmMultiExec = useCallback((approved: boolean) => {
    const finish = pendingMultiExecConfirmation.current;
    if (!finish) return;
    if (!approved) multiExecBackToSelection.current = true;
    else setMultiExecView(current => current?.phase === 'review'
      ? { ...current, phase: 'sending', targetResults: current.targets.map(target => ({ targetSessionId: target.sessionId, status: 'queued' })) }
      : current);
    finish(approved);
  }, []);

  const cancelMultiExec = useCallback(() => {
    if (!multiExecRun.current) return;
    setMultiExecView(current => current?.phase === 'sending' ? { ...current, cancelRequested: true } : current);
    multiExecRunner.cancel();
  }, [multiExecRunner]);

  const reviewMultiExec = useCallback((request: MultiExecRequest) => {
    if (multiExecRun.current || macroPlaybackRun.current || macroRecordingView.current) return;
    multiExecRun.current = true;
    multiExecBackToSelection.current = false;
    multiExecCloseAfterRun.current = false;
    const targets: MultiExecDisplayTarget[] = request.targetSessionIds.map(sessionId => {
      const session = sessionsRef.current.find(candidate => candidate.sessionId === sessionId);
      return { sessionId, title: isMacroTerminal(session) ? macroTargetTitle(session) : 'Terminal no longer available' };
    });
    void multiExecRunner.run(request, {
      confirm: (review, cancellation) => new Promise<boolean>(resolve => {
        let settled = false;
        const finish = (approved: boolean) => {
          if (settled) return;
          settled = true;
          cancellation.removeEventListener('abort', onAbort);
          if (pendingMultiExecConfirmation.current === finish) pendingMultiExecConfirmation.current = undefined;
          resolve(approved);
        };
        const onAbort = () => finish(false);
        pendingMultiExecConfirmation.current = finish;
        cancellation.addEventListener('abort', onAbort, { once: true });
        setMultiExecView({ phase: 'review', line: review.line, targets, targetResults: [] });
        if (cancellation.aborted) onAbort();
      }),
      onTargetsChanged: targetResults => setMultiExecView(current => current && current.phase !== 'finished'
        ? { ...current, phase: 'sending', targetResults }
        : current)
    }).then(result => {
      if (multiExecBackToSelection.current) {
        setMultiExecView(undefined);
        return;
      }
      if (multiExecCloseAfterRun.current) {
        setMultiExecView(undefined);
        setMultiExecOpen(false);
        return;
      }
      setMultiExecView(current => ({
        phase: 'finished',
        line: current?.line ?? request.line,
        targets: current?.targets ?? targets,
        targetResults: result.targets,
        ...(result.status === 'cancelled' ? { cancelled: true } : {}),
        ...(result.status === 'failed' ? { error: result.error } : {})
      }));
    }).catch(() => setMultiExecView({
      phase: 'finished', line: request.line, targets, targetResults: [], error: failure('UNAVAILABLE').error
    })).finally(() => {
      multiExecRun.current = false;
      pendingMultiExecConfirmation.current = undefined;
      multiExecBackToSelection.current = false;
      multiExecCloseAfterRun.current = false;
    });
  }, [multiExecRunner]);

  const closeMacroPlayback = useCallback(() => {
    if (macroPlaybackRun.current) return;
    setMacroPlayback(undefined);
    setMacroPlaybackMacroId(undefined);
  }, []);

  const closeMacroManager = useCallback(() => {
    if (macroPlaybackRun.current) return;
    macroManagerRequest.current++;
    macroShortcutRequest.current++;
    setMacrosLoading(false);
    setMacroShortcutCaptureMacroId(undefined);
    setMacroShortcutNotice(undefined);
    setMacroManagerOpen(false);
    setMacroPlayback(undefined);
    setMacroPlaybackMacroId(undefined);
  }, []);

  const reviewMacroPlayback = useCallback((macroId: string) => {
    setMacroShortcutCaptureMacroId(undefined);
    setMacroShortcutNotice(undefined);
    setMacroPlayback(undefined);
    setMacroPlaybackMacroId(macroId);
  }, []);

  const openMacroShortcutReview = useCallback((macroId: string) => {
    macroManagerReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setMacroError(undefined);
    setMacroShortcutNotice(undefined);
    setMacroShortcutCaptureMacroId(undefined);
    setMacroManagerOpen(true);
    setMacroPlayback(undefined);
    setMacroPlaybackMacroId(macroId);
    void loadMacroManager();
  }, [loadMacroManager]);

  const beginMacroShortcutCapture = useCallback((macroId: string) => {
    if (macroBusy || macroPlaybackRun.current || macroRecordingView.current || multiExecRun.current) return;
    setMacroShortcutCaptureMacroId(macroId);
    setMacroShortcutNotice('Press Ctrl+Alt+Shift, then a letter, number, numpad key, or F1–F12. Press Escape to cancel.');
  }, [macroBusy]);

  const cancelMacroShortcutCapture = useCallback(() => {
    setMacroShortcutCaptureMacroId(undefined);
    setMacroShortcutNotice(undefined);
  }, []);

  const saveMacroShortcut = useCallback(async (macroId: string, code: MacroShortcutCode): Promise<void> => {
    setMacroShortcutCaptureMacroId(undefined);
    setMacroShortcutNotice('Saving shortcut…');
    setMacroBusy(true);
    try {
      const reply = await window.multiRemoteTerminal.setMacroShortcut(macroId, code);
      if (!reply.ok) {
        if (reply.error.code === 'CONFLICT') {
          setMacroShortcutCaptureMacroId(macroId);
          setMacroShortcutNotice('That shortcut is already assigned. Press a different combination or Escape to cancel.');
        } else setMacroShortcutNotice(`The shortcut could not be saved (${reply.error.code}).`);
        return;
      }
      setMacroShortcuts(current => [...current.filter(binding => binding.macroId !== macroId), reply.result]);
      setMacroShortcutNotice(`Shortcut saved: ${formatMacroShortcut(code)}.`);
    } catch {
      setMacroShortcutNotice('The shortcut could not be saved.');
    } finally { setMacroBusy(false); }
  }, []);

  const clearMacroShortcut = useCallback(async (macroId: string): Promise<void> => {
    setMacroShortcutCaptureMacroId(undefined);
    setMacroBusy(true);
    try {
      const reply = await window.multiRemoteTerminal.deleteMacroShortcut(macroId);
      if (!reply.ok) setMacroShortcutNotice(`The shortcut could not be cleared (${reply.error.code}).`);
      else {
        setMacroShortcuts(current => current.filter(binding => binding.macroId !== macroId));
        setMacroShortcutNotice('Shortcut cleared.');
      }
    } catch { setMacroShortcutNotice('The shortcut could not be cleared.'); }
    finally { setMacroBusy(false); }
  }, []);

  const startMacroPlayback = useCallback((macroId: string, sessionId: string) => {
    if (macroPlaybackRun.current) return;
    const macro = macros.find(candidate => candidate.id === macroId);
    const target = sessionsRef.current.find(candidate => candidate.sessionId === sessionId);
    const targetTitle = isMacroTerminal(target) ? macroTargetTitle(target) : 'selected terminal';
    if (!macro || macro.steps.length === 0 || !isMacroTerminal(target) || target.state !== 'running' || !handles.current.has(sessionId) ||
        macroRecordingView.current || multiExecRun.current) {
      setMacroPlayback({ macroId, sessionId, targetTitle, status: 'failed', error: failure('UNAVAILABLE', 'terminal').error });
      return;
    }

    macroPlaybackRun.current = true;
    setMacroPlayback({ macroId, sessionId, targetTitle, status: 'running' });
    setActiveId(sessionId);
    void macroRunner.run(macro, sessionId, {
      onProgress: progress => setMacroPlayback(current => current?.macroId === macroId ? { ...current, progress } : current),
      confirm: (_message, cancellation) => new Promise<boolean>(resolve => {
        let settled = false;
        const finish = (accepted: boolean) => {
          if (settled) return;
          settled = true;
          cancellation.removeEventListener('abort', onAbort);
          if (pendingMacroConfirmation.current === finish) pendingMacroConfirmation.current = undefined;
          resolve(accepted);
        };
        const onAbort = () => finish(false);
        pendingMacroConfirmation.current = finish;
        cancellation.addEventListener('abort', onAbort, { once: true });
        if (cancellation.aborted) onAbort();
      })
    }).then(result => {
      setMacroPlayback(current => {
        if (!current || current.macroId !== macroId) return current;
        return result.status === 'failed'
          ? { ...current, status: 'failed', error: result.error, cancelRequested: false }
          : { ...current, status: result.status, cancelRequested: false };
      });
    }).catch(() => {
      setMacroPlayback(current => current?.macroId === macroId
        ? { ...current, status: 'failed', error: failure('UNAVAILABLE', 'terminal').error, cancelRequested: false }
        : current);
    }).finally(() => {
      macroPlaybackRun.current = false;
      pendingMacroConfirmation.current = undefined;
    });
  }, [macroRunner, macros]);

  const cancelMacroPlayback = useCallback(() => {
    if (!macroPlaybackRun.current) return;
    setMacroPlayback(current => current?.status === 'running' ? { ...current, cancelRequested: true } : current);
    macroRunner.cancel();
  }, [macroRunner]);

  const confirmMacroPlayback = useCallback((accepted: boolean) => {
    pendingMacroConfirmation.current?.(accepted);
  }, []);

  const saveMacro = useCallback(async (id: string | undefined, draft: MacroDraft): Promise<string | undefined> => {
    macroSaveErrorCode.current = 'UNAVAILABLE';
    setMacroBusy(true);
    setMacroError(undefined);
    try {
      const reply = id
        ? await window.multiRemoteTerminal.updateMacro(id, draft)
        : await window.multiRemoteTerminal.createMacro(draft);
      if (!reply.ok) {
        macroSaveErrorCode.current = reply.error.code;
        setMacroError(`The macro could not be saved (${reply.error.code}).`);
        return undefined;
      }
      await loadMacroManager();
      return reply.result.id;
    } catch {
      setMacroError('The macro could not be saved.');
      return undefined;
    } finally {
      setMacroBusy(false);
    }
  }, [loadMacroManager]);

  const persistMacroRecording = useCallback(async (recording: MacroRecordingView): Promise<void> => {
    publishMacroRecording({ ...recording, status: 'saving', saveError: undefined });
    const id = await saveMacro(undefined, { name: recording.name, steps: recording.steps });
    if (id) {
      publishMacroRecording(undefined);
      setAlert(recording.stopReason === 'disconnected'
        ? `Recording saved after ${recording.targetTitle} disconnected.`
        : `Recording saved as "${recording.name}".`);
      return;
    }
    publishMacroRecording({ ...recording, status: 'stopped',
      saveError: `The recording for ${recording.targetTitle} could not be saved (${macroSaveErrorCode.current}). Retry or discard it.` });
  }, [publishMacroRecording, saveMacro]);

  const stopMacroRecording = useCallback((targetSessionId: string, reason: 'stopped' | 'disconnected') => {
    const completed = macroRecorder.stop(targetSessionId);
    const current = macroRecordingView.current;
    if (!completed || !current || current.sessionId !== targetSessionId) return;
    const recording: MacroRecordingView = {
      ...current,
      status: 'stopped',
      steps: completed.steps,
      stepCount: completed.steps.length,
      stopReason: reason,
      warning: undefined
    };
    if (recording.steps.length === 0) {
      publishMacroRecording(undefined);
      setAlert('No complete command lines were recorded.');
      return;
    }
    void persistMacroRecording(recording);
  }, [macroRecorder, persistMacroRecording, publishMacroRecording]);

  const startMacroRecording = useCallback((name: string, targetSessionId: string): boolean => {
    const draft = normalizeMacroDraft({ name, steps: [] });
    const target = sessions.find(session => session.sessionId === targetSessionId);
    const targetLabel = target?.title ?? (targetSessionId || 'selected terminal');
    if (!draft || !target || target.transport === 'ftp' || target.transport === 'sftp' || target.state !== 'running') {
      setMacroError(`Recording could not start for ${targetLabel} (INVALID_REQUEST). Choose a valid running terminal and retry.`);
      return false;
    }
    const terminal = handles.current.get(targetSessionId);
    if (!terminal) {
      setMacroError(`Recording could not start for ${targetLabel} (UNAVAILABLE). Wait for the terminal to be ready, then retry.`);
      return false;
    }
    if (macroRecordingView.current || multiExecRun.current || !macroRecorder.start(targetSessionId, draft.name.length)) {
      setMacroError(`Recording could not start for ${targetLabel} (BUSY). Stop or discard the active recording, then retry.`);
      return false;
    }
    const initialSnapshot = macroRecorder.observeOutput(targetSessionId, terminal.currentLineText());
    setMacroError(undefined);
    pendingMacroTerminalFocus.current = targetSessionId;
    setActiveId(targetSessionId);
    publishMacroRecording({ sessionId: targetSessionId, name: draft.name, targetTitle: target.title,
      status: initialSnapshot.status === 'idle' ? 'recording' : initialSnapshot.status,
      steps: [], stepCount: initialSnapshot.stepCount, warning: initialSnapshot.warning });
    macroManagerReturnFocus.current = null;
    closeMacroManager();
    return true;
  }, [closeMacroManager, macroRecorder, publishMacroRecording, sessions]);

  const recordMacroInput = useCallback((sessionId: string, data: string) => {
    syncMacroRecordingSnapshot(macroRecorder.recordInput(sessionId, data));
  }, [macroRecorder, syncMacroRecordingSnapshot]);

  const observeMacroOutput = useCallback((sessionId: string, data: string) => {
    macroRunner.observeOutput(sessionId, data);
    syncMacroRecordingSnapshot(macroRecorder.observeOutput(sessionId, data));
  }, [macroRecorder, macroRunner, syncMacroRecordingSnapshot]);

  const pauseMacroRecording = useCallback(() => {
    const current = macroRecordingView.current;
    if (!current || current.status !== 'recording') return;
    macroRecorder.pause();
    publishMacroRecording({ ...current, status: 'paused', warning: undefined });
  }, [macroRecorder, publishMacroRecording]);

  const resumeMacroRecording = useCallback(() => {
    const current = macroRecordingView.current;
    if (!current || current.status !== 'paused') return;
    pendingMacroTerminalFocus.current = current.sessionId;
    setActiveId(current.sessionId);
    macroRecorder.resume();
    const snapshot = macroRecorder.snapshot();
    publishMacroRecording({ ...current, status: snapshot.status === 'idle' ? 'paused' : snapshot.status,
      stepCount: snapshot.stepCount, warning: snapshot.warning });
  }, [macroRecorder, publishMacroRecording]);

  const discardMacroRecording = useCallback(() => {
    const current = macroRecordingView.current;
    if (!current) return;
    macroRecorder.stop(current.sessionId);
    publishMacroRecording(undefined);
  }, [macroRecorder, publishMacroRecording]);

  const retrySaveMacroRecording = useCallback(() => {
    const current = macroRecordingView.current;
    if (current?.status === 'stopped') void persistMacroRecording(current);
  }, [persistMacroRecording]);

  const deleteMacro = useCallback(async (id: string): Promise<boolean> => {
    setMacroBusy(true);
    setMacroError(undefined);
    try {
      const reply = await window.multiRemoteTerminal.deleteMacro(id);
      if (!reply.ok) {
        setMacroError(`The macro could not be deleted (${reply.error.code}).`);
        return false;
      }
      await loadMacroManager();
      return true;
    } catch {
      setMacroError('The macro could not be deleted.');
      return false;
    } finally {
      setMacroBusy(false);
    }
  }, [loadMacroManager]);

  const saveSshTunnel = useCallback(async (draft: SshTunnelDraft): Promise<string | undefined> => {
    const operation = ++tunnelOperationRequest.current;
    setTunnelBusyId('save');
    setTunnelError(undefined);
    try {
      const reply = await window.multiRemoteTerminal.saveSshTunnel(draft);
      if (!reply.ok) { setTunnelError(tunnelOpenError(reply.error.code)); return undefined; }
      await loadTunnelManager();
      return reply.result.id;
    } catch {
      setTunnelError('The tunnel could not be saved.');
      return undefined;
    } finally {
      if (operation === tunnelOperationRequest.current) setTunnelBusyId(undefined);
    }
  }, [loadTunnelManager]);

  const startTunnel = useCallback(async (id: string): Promise<void> => {
    const operation = ++tunnelOperationRequest.current;
    setTunnelBusyId(id);
    setTunnelError(undefined);
    try {
      const reply = await window.multiRemoteTerminal.startTunnel(id);
      if (!reply.ok) setTunnelError(tunnelOpenError(reply.error.code));
      else setTunnels(current => current.map(item => item.definition.id === id ? { ...item, status: reply.result } : item));
      await loadTunnelManager();
    } catch {
      setTunnelError('Tunnel startup could not be confirmed. Refresh its status before retrying.');
      await loadTunnelManager();
    } finally {
      if (operation === tunnelOperationRequest.current) setTunnelBusyId(undefined);
    }
  }, [loadTunnelManager]);

  const stopTunnel = useCallback(async (id: string): Promise<void> => {
    const operation = ++tunnelOperationRequest.current;
    setTunnelBusyId(id);
    setTunnelError(undefined);
    try {
      const reply = await window.multiRemoteTerminal.stopTunnel(id);
      if (!reply.ok) setTunnelError(tunnelOpenError(reply.error.code));
      else setTunnels(current => current.map(item => item.definition.id === id ? { ...item, status: reply.result } : item));
      await loadTunnelManager();
    } catch {
      setTunnelError('Tunnel shutdown could not be confirmed. Refresh its status before retrying.');
      await loadTunnelManager();
    } finally {
      if (operation === tunnelOperationRequest.current) setTunnelBusyId(undefined);
    }
  }, [loadTunnelManager]);

  const deleteTunnel = useCallback(async (id: string): Promise<void> => {
    const operation = ++tunnelOperationRequest.current;
    setTunnelBusyId(id);
    setTunnelError(undefined);
    try {
      const reply = await window.multiRemoteTerminal.deleteTunnel(id);
      if (!reply.ok) setTunnelError(tunnelOpenError(reply.error.code));
      else {
        setTunnels(current => current.filter(item => item.definition.id !== id));
        setTunnelError(undefined);
      }
    } catch { setTunnelError('The saved tunnel could not be deleted.'); }
    finally {
      if (operation === tunnelOperationRequest.current) setTunnelBusyId(undefined);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadSavedSessions(savedSearch, savedSearch.length === 0); }, SAVED_SESSION_SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      savedSessionsRequest.current++;
    };
  }, [loadSavedSessions, savedSearch]);

  useEffect(() => {
    void loadSavedFolders();
    return () => { savedFoldersRequest.current++; };
  }, [loadSavedFolders]);

  const openPalette = useCallback(() => {
    paletteReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery('');
    setPaletteOpen(true);
  }, []);

  const openHelp = useCallback(() => {
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    helpReturnFocus.current = paletteOpen ? paletteReturnFocus.current ?? activeElement : activeElement;
    if (paletteOpen) paletteReturnFocus.current = null;
    setHelpOpen(true);
  }, [paletteOpen]);

  const closeHelp = useCallback(() => setHelpOpen(false), []);

  const openSettings = useCallback(() => {
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    settingsReturnFocus.current = paletteOpen ? paletteReturnFocus.current ?? activeElement : activeElement;
    if (paletteOpen) paletteReturnFocus.current = null;
    setSettingsOpen(true);
  }, [paletteOpen]);

  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  const openLocalTextEditor = useCallback(async () => {
    if (localTextEditorOpening || localTextEditorOpen) return;
    localTextEditorReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setLocalTextEditorOpening(true);
    setAlert(undefined);
    try {
      const reply = await window.multiRemoteTerminal.openLocalTextFile();
      if (!reply.ok) {
        if (reply.error.code !== 'CANCELLED') setAlert(textEditorErrorMessage(reply.error.code, 'local'));
        return;
      }
      localTextFileRef.current = reply.result;
      setLocalTextFile(reply.result);
      setLocalTextEditorOpen(true);
    } catch {
      setAlert('The selected local file could not be opened.');
    } finally { setLocalTextEditorOpening(false); }
  }, [localTextEditorOpen, localTextEditorOpening]);

  const closeLocalTextEditor = useCallback(() => {
    setLocalTextEditorOpen(false);
    const file = localTextFileRef.current;
    localTextFileRef.current = undefined;
    setLocalTextFile(undefined);
    if (file) void window.multiRemoteTerminal.closeLocalTextFile(file.selectionId);
    const target = localTextEditorReturnFocus.current ?? localTextEditorTrigger.current;
    localTextEditorReturnFocus.current = null;
    requestAnimationFrame(() => target?.focus());
  }, []);

  useEffect(() => () => {
    const file = localTextFileRef.current;
    localTextFileRef.current = undefined;
    if (file) void window.multiRemoteTerminal.closeLocalTextFile(file.selectionId);
  }, []);

  const applyWorkbenchPreferences = useCallback((preferences: WorkbenchPreferences) => {
    setStartupGreeting(preferences.startupGreeting);
    setStartupGreetingVisible(preferences.startupGreeting.length > 0);
    setTerminalHighlightEnabled(preferences.terminalHighlightEnabled);
    setTerminalHighlightRules(preferences.terminalHighlightRules);
    setTerminalShellSyntaxEnabled(preferences.terminalShellSyntaxEnabled);
  }, []);

  const openSshConnect = useCallback((mode: 'terminal' | 'sftp' = 'terminal', host = '', port = 22, savedTitle?: string) => {
    sshConnectReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSshConnectMode(mode);
    setSshGatewayTarget(undefined);
    setSshGatewayProfiles([]);
    setSshGatewayOne('');
    setSshGatewayTwo('');
    setSshHost(host);
    setSshPort(String(port));
    setSshSavedTitle(savedTitle);
    setSshConnectError(undefined);
    setSshConnectOpen(true);
  }, []);

  const openTelnetConnect = useCallback((host = '', port = 23, savedTitle?: string) => {
    telnetConnectReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setTelnetHost(host);
    setTelnetPort(String(port));
    setTelnetSavedTitle(savedTitle);
    setTelnetConnectError(undefined);
    setTelnetConnectOpen(true);
  }, []);

  const refreshSerialPorts = useCallback(async (preserveCurrentSelection = false) => {
    setSerialPortsLoading(true);
    setSerialPortsError(undefined);
    try {
      const reply = await window.multiRemoteTerminal.listSerialPorts();
      if (!reply.ok) {
        setSerialPortsError(`Serial ports could not be listed (${reply.error.code}).`);
        return;
      }
      setSerialPorts(reply.result);
      setSerialConfigurationDraft(current => preserveCurrentSelection || reply.result.some(port => port.path === current.path)
        ? current : { ...current, path: reply.result[0]?.path ?? current.path });
    } catch {
      setSerialPortsError('Serial ports could not be listed. Check that the device driver is installed and try again.');
    } finally {
      setSerialPortsLoading(false);
    }
  }, []);

  const openSerialConnect = useCallback((configuration?: SerialConfiguration, savedTitle?: string) => {
    serialConnectReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (configuration) setSerialConfigurationDraft(configuration);
    setSerialSavedTitle(savedTitle);
    setSerialSavedProfilePath(configuration?.path);
    setSerialPortsError(undefined);
    setSerialConnectOpen(true);
    void refreshSerialPorts(Boolean(savedTitle));
  }, [refreshSerialPorts]);

  const openFtpConnect = useCallback((host = '', port = 21, secure = true, savedTitle?: string) => {
    ftpConnectReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setFtpHost(host);
    setFtpPort(String(port));
    setFtpSecurity(secure ? 'ftps' : 'ftp');
    setFtpSavedTitle(savedTitle);
    setFtpConnectError(undefined);
    setFtpConnectOpen(true);
  }, []);

  const openRdpConnect = useCallback((host = '', port = 3389, savedTitle?: string) => {
    rdpConnectReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setRdpHost(host);
    setRdpPort(port);
    setRdpSavedProfileName(savedTitle);
    setRdpConnectOpen(true);
  }, []);

  const openVncConnect = useCallback((host = '', port = 5900, savedTitle?: string) => {
    vncConnectReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setVncHost(host);
    setVncPort(port);
    setVncSavedProfileName(savedTitle);
    setVncConnectOpen(true);
  }, []);

  const launchRdpViewer = useCallback(async (host: string, port: number): Promise<string | undefined> => {
    const endpoint = canonicalizeRdpEndpoint({ host, port });
    if (!endpoint) return 'Enter a valid host name or IP address and port.';
    try {
      const reply = await window.multiRemoteTerminal.launchRdpViewer(endpoint.host, endpoint.port);
      if (!reply.ok) return rdpOpenError(reply.error.code);
      setAlert('Windows Remote Desktop was opened outside this app. Connection status is not tracked here.');
      return undefined;
    } catch { return 'Windows Remote Desktop could not be started. Check that the Windows viewer is available.'; }
  }, []);

  const saveRdpProfile = useCallback(async (name: string, host: string, port: number): Promise<string | undefined> => {
    const draft = normalizeSavedSessionDraft({ kind: 'rdp', name, host, port });
    if (!draft || draft.kind !== 'rdp') return 'Enter a valid profile name, host, and port.';
    setCatalogBusy(true);
    try {
      const reply = await window.multiRemoteTerminal.createSavedSession(draft);
      if (!reply.ok) return `The RDP profile could not be saved (${reply.error.code}).`;
      await loadSavedSessions(savedSearch);
      setAlert(`Saved RDP profile “${reply.result.name}”.`);
      return undefined;
    } catch { return 'The RDP profile could not be saved.'; }
    finally { setCatalogBusy(false); }
  }, [loadSavedSessions, savedSearch]);

  const launchVncViewer = useCallback(async (host: string, port: number): Promise<string | undefined> => {
    const endpoint = canonicalizeVncEndpoint({ host, port });
    if (!endpoint) return 'Enter a valid host name or IP address and port.';
    try {
      const reply = await window.multiRemoteTerminal.launchVncViewer(endpoint.host, endpoint.port);
      if (!reply.ok) return vncOpenError(reply.error.code);
      setAlert('TigerVNC was opened outside this app. Connection status is not tracked here.');
      return undefined;
    } catch { return 'TigerVNC could not be started. Check that it is installed in Program Files.'; }
  }, []);

  const saveVncProfile = useCallback(async (name: string, host: string, port: number): Promise<string | undefined> => {
    const draft = normalizeSavedSessionDraft({ kind: 'vnc', name, host, port });
    if (!draft || draft.kind !== 'vnc') return 'Enter a valid profile name, host, and port.';
    setCatalogBusy(true);
    try {
      const reply = await window.multiRemoteTerminal.createSavedSession(draft);
      if (!reply.ok) return `The VNC profile could not be saved (${reply.error.code}).`;
      await loadSavedSessions(savedSearch);
      setAlert(`Saved VNC profile “${reply.result.name}”.`);
      return undefined;
    } catch { return 'The VNC profile could not be saved.'; }
    finally { setCatalogBusy(false); }
  }, [loadSavedSessions, savedSearch]);

  const requestCloseTerminal = useCallback((sessionId: string) => {
    closeReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPendingCloseId(sessionId);
  }, []);

  function openTerminalTabContextMenu(event: MouseEvent<HTMLButtonElement>, sessionId: string) {
    event.preventDefault();
    tabContextReturnFocus.current = event.currentTarget;
    setTabContextMenu({ sessionId, x: event.clientX, y: event.clientY });
  }

  function closeTerminalTabContextMenu(restoreFocus: boolean) {
    setTabContextMenu(undefined);
    const target = tabContextReturnFocus.current;
    tabContextReturnFocus.current = null;
    if (!restoreFocus) return;
    requestAnimationFrame(() => { if (target?.isConnected) target.focus(); });
  }

  async function copyTerminalSelection(sessionId: string) {
    const handle = handles.current.get(sessionId);
    try {
      if (!handle || !(await handle.copySelection())) {
        setAlert('Select terminal text before choosing Copy selection.');
      }
    } catch {
      setAlert('Clipboard access is unavailable. Select the text and press Ctrl+C instead.');
    } finally {
      closeTerminalTabContextMenu(false);
      requestAnimationFrame(() => handles.current.get(sessionId)?.focus());
    }
  }

  function clearTerminalDisplay(sessionId: string) {
    const handle = handles.current.get(sessionId);
    if (handle) handle.clear();
    closeTerminalTabContextMenu(false);
    requestAnimationFrame(() => handles.current.get(sessionId)?.focus());
  }

  function focusNextContextAction(direction: -1 | 1) {
    const menu = tabContextMenuElement.current;
    if (!menu) return;
    const actions = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
    if (actions.length === 0) return;
    const current = actions.indexOf(document.activeElement as HTMLButtonElement);
    actions[(current + direction + actions.length) % actions.length]?.focus();
  }

  useLayoutEffect(() => {
    const menu = tabContextMenuElement.current;
    if (!menu || !tabContextMenu) return;
    const bounds = menu.getBoundingClientRect();
    const margin = 8;
    menu.style.left = `${Math.max(margin, Math.min(tabContextMenu.x, window.innerWidth - bounds.width - margin))}px`;
    menu.style.top = `${Math.max(margin, Math.min(tabContextMenu.y, window.innerHeight - bounds.height - margin))}px`;
  }, [tabContextMenu]);

  useEffect(() => {
    if (!tabContextMenu) return;
    requestAnimationFrame(() => firstTabContextAction.current?.focus());
    const dismissOutsideMenu = (event: PointerEvent) => {
      if (event.target instanceof Node && tabContextMenuElement.current?.contains(event.target)) return;
      setTabContextMenu(undefined);
    };
    const dismissOnResize = () => closeTerminalTabContextMenu(true);
    document.addEventListener('pointerdown', dismissOutsideMenu, true);
    window.addEventListener('resize', dismissOnResize);
    return () => {
      document.removeEventListener('pointerdown', dismissOutsideMenu, true);
      window.removeEventListener('resize', dismissOnResize);
    };
  }, [tabContextMenu]);

  const deliver = useCallback((event: LocalTerminalEvent, handle: TerminalUiHandle) => {
    if (event.kind === 'data') {
      handle.write(event.data, () => {
        void handle.acknowledgeOutput(event.sequence).then(() => undefined).catch(() => {
          setAlert('Terminal output could not be acknowledged.');
        });
      });
    } else if (event.kind === 'exit') {
      macroRunner.disconnect(event.sessionId);
      stopMacroRecording(event.sessionId, 'disconnected');
      setSessions(current => current.map(session => session.sessionId === event.sessionId && session.transport !== 'ftp' ? { ...session, state: 'exited' } : session));
    } else {
      macroRunner.disconnect(event.sessionId);
      stopMacroRecording(event.sessionId, 'disconnected');
      setSessions(current => current.map(session => session.sessionId === event.sessionId && session.transport !== 'ftp' ? { ...session, state: 'failed' } : session));
      setAlert(messageForError(event.error));
    }
  }, [macroRunner, stopMacroRecording]);

  const terminalReady = useCallback((sessionId: string, handle: TerminalUiHandle | undefined) => {
    if (!handle) { handles.current.delete(sessionId); return; }
    handles.current.set(sessionId, handle);
    const queued = pendingEvents.current.get(sessionId) ?? [];
    pendingEvents.current.delete(sessionId);
    for (const event of queued) deliver(event, handle);
  }, [deliver]);

  useEffect(() => window.multiRemoteTerminal.onTerminalEvent(event => {
    const handle = handles.current.get(event.sessionId);
    if (handle) { deliver(event, handle); return; }
    if (visibleFileOnlySshSessionIds.current.has(event.sessionId) && event.kind === 'exit') {
      setSessions(current => current.map(session => session.sessionId === event.sessionId && session.transport === 'sftp' ? { ...session, state: 'exited' } : session));
      return;
    }
    if (visibleFileOnlySshSessionIds.current.has(event.sessionId) && event.kind === 'failure') {
      setSessions(current => current.map(session => session.sessionId === event.sessionId && session.transport === 'sftp' ? { ...session, state: 'failed' } : session));
      setAlert(messageForError(event.error));
      return;
    }
    const queued = pendingEvents.current.get(event.sessionId) ?? [];
    queued.push(event);
    pendingEvents.current.set(event.sessionId, queued);
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

  useEffect(() => window.multiRemoteTerminal.onTunnelStatus(status => {
    setTunnels(current => current.map(item => item.definition.id === status.tunnelId ? { ...item, status } : item));
    if (status.state === 'failed') setTunnelError(tunnelOpenError(status.errorCode));
  }), []);

  const openTerminal = useCallback(async (shell: LocalShell, savedTitle?: string, rememberWhenOpened = true) => {
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
      if (reply.error.code !== 'CANCELLED') setAlert(shell === 'bash'
        ? 'Could not start Bash. Check that Git for Windows is installed.'
        : `Could not start ${shellName(shell)} (${reply.error.code}).`);
      return;
    }
    const ordinal = ++nextOrdinal.current[shell];
    const title = shellName(shell);
    if (rememberWhenOpened && reply.result.state === 'running') {
      void rememberOpenedSession({ kind: 'local', name: savedTitle ?? title, shell });
    }
    setSessions(current => [...current, { ...reply.result, transport: 'local', title: savedTitle ?? `${title} session ${ordinal}` }]);
    setActiveId(reply.result.sessionId);
  }, [rememberOpenedSession]);

  const openSshTerminal = useCallback(async (hostInput: string, portInput: string, savedTitle?: string, gatewayProfileIds: readonly string[] = [], savedProfileId?: string) => {
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
    setSshGatewayTarget(undefined);
    setSshGatewayProfiles([]);
    setSshGatewayOne('');
    setSshGatewayTwo('');
    setPaletteOpen(false);
    setAlert(undefined);
    const sessionId = crypto.randomUUID();
    const replyPromise = window.multiRemoteTerminal.openSshTerminal(sessionId, validatedEndpoint.host, validatedEndpoint.port, 80, 24, gatewayProfileIds, savedProfileId);
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
    if (reply.result.state === 'running' && gatewayProfileIds.length === 0) {
      void rememberOpenedSession({ kind: 'ssh', name: savedTitle ?? autoSavedProfileName('SSH', endpoint.host, endpoint.port), host: endpoint.host, port: endpoint.port });
    }
    setSessions(current => [...current, { ...reply.result, transport: 'ssh', title: savedTitle ?? `${endpoint.host}:${endpoint.port} - SSH ${ordinal}` }]);
    setActiveId(reply.result.sessionId);
  }, [rememberOpenedSession]);

  const openSftpFiles = useCallback(async (hostInput: string, portInput: string, savedTitle?: string) => {
    const host = hostInput.trim();
    const port = Number(portInput);
    if (!host) { setSshConnectError('Enter a host name or IP address.'); sshHostInput.current?.focus(); return; }
    if (!/^\d{1,5}$/.test(portInput) || !Number.isInteger(port) || port < 1 || port > 65_535) {
      setSshConnectError('Port must be a whole number from 1 to 65535.');
      sshPortInput.current?.focus();
      return;
    }
    const endpoint = canonicalizeSshHostEndpoint({ host, port });
    if (!endpoint) { setSshConnectError('Enter a valid DNS name or IP address.'); sshHostInput.current?.focus(); return; }
    setSshConnectError(undefined);
    sshTrustReturnFocus.current = sshConnectReturnFocus.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setSshConnectOpen(false);
    setPaletteOpen(false);
    setAlert(undefined);
    const sessionId = crypto.randomUUID();
    fileOnlySshSessionIds.current.add(sessionId);
    const replyPromise = window.multiRemoteTerminal.openSftpFiles(sessionId, endpoint.host, endpoint.port);
    pendingOpenRequests.current.set(sessionId, { transport: 'sftp', cancelled: false, reply: replyPromise });
    setOpeningSessions(current => [...current, { transport: 'sftp', sessionId, host: endpoint.host, port: endpoint.port, cancelling: false }]);
    const reply = await replyPromise;
    if (pendingOpenRequests.current.get(sessionId)?.cancelled) {
      fileOnlySshSessionIds.current.delete(sessionId);
      pendingEvents.current.delete(sessionId);
      return;
    }
    pendingOpenRequests.current.delete(sessionId);
    setOpeningSessions(current => current.filter(opening => opening.sessionId !== sessionId));
    if (!reply.ok) {
      fileOnlySshSessionIds.current.delete(sessionId);
      pendingEvents.current.delete(sessionId);
      setSshTrustEvents(current => current.filter(event => event.sessionId !== sessionId || event.kind === 'changed'));
      if (reply.error.code !== 'CANCELLED') setAlert(reply.error.code === 'AUTHENTICATION_FAILED'
        ? 'The SSH server rejected these credentials.'
        : reply.error.code === 'HOST_KEY_REJECTED' ? 'The SSH host was not trusted, so the SFTP connection was stopped.'
          : reply.error.code === 'HOST_KEY_CHANGED' ? 'The SSH host key changed. The SFTP connection was blocked.'
            : reply.error.code === 'TIMEOUT' ? 'The SFTP connection timed out.' : `Could not connect to SFTP (${reply.error.code}).`);
      return;
    }
    const ordinal = ++nextSshOrdinal.current;
    const queuedEvents = pendingEvents.current.get(sessionId) ?? [];
    pendingEvents.current.delete(sessionId);
    const state = queuedEvents.reduce<typeof reply.result.state>((current, event) => event.kind === 'exit' ? 'exited'
      : event.kind === 'failure' ? 'failed' : current, reply.result.state);
    if (queuedEvents.some(event => event.kind === 'failure')) setAlert('The SFTP connection failed while opening. Reconnect to continue.');
    if (state === 'running') {
      void rememberOpenedSession({ kind: 'sftp', name: savedTitle ?? autoSavedProfileName('SFTP', endpoint.host, endpoint.port), host: endpoint.host, port: endpoint.port });
    }
    visibleFileOnlySshSessionIds.current.add(sessionId);
    setSessions(current => [...current, { ...reply.result, state, transport: 'sftp', title: savedTitle ?? `${endpoint.host}:${endpoint.port} - SFTP ${ordinal}` }]);
    setActiveId(reply.result.sessionId);
  }, [rememberOpenedSession]);

  const openTelnetTerminal = useCallback(async (hostInput: string, portInput: string, savedTitle?: string) => {
    const host = hostInput.trim();
    const port = Number(portInput);
    if (!host) { setTelnetConnectError('Enter a host name or IP address.'); telnetHostInput.current?.focus(); return; }
    if (!/^\d{1,5}$/.test(portInput) || !Number.isInteger(port) || port < 1 || port > 65_535) {
      setTelnetConnectError('Port must be a whole number from 1 to 65535.');
      telnetPortInput.current?.focus();
      return;
    }
    const validatedEndpoint = canonicalizeRemoteEndpoint({ host, port });
    if (!validatedEndpoint) { setTelnetConnectError('Enter a valid DNS name or IP address.'); telnetHostInput.current?.focus(); return; }
    setTelnetConnectError(undefined);
    setTelnetConnectOpen(false);
    setPaletteOpen(false);
    setAlert(undefined);
    const sessionId = crypto.randomUUID();
    const replyPromise = window.multiRemoteTerminal.openTelnetTerminal(sessionId, validatedEndpoint.host, validatedEndpoint.port, 80, 24);
    pendingOpenRequests.current.set(sessionId, { transport: 'telnet', cancelled: false, reply: replyPromise });
    setOpeningSessions(current => [...current, {
      transport: 'telnet', sessionId, host: validatedEndpoint.host, port: validatedEndpoint.port, cancelling: false
    }]);
    const reply = await replyPromise;
    if (pendingOpenRequests.current.get(sessionId)?.cancelled) return;
    pendingOpenRequests.current.delete(sessionId);
    setOpeningSessions(current => current.filter(opening => opening.sessionId !== sessionId));
    if (!reply.ok) {
      if (reply.error.code !== 'CANCELLED') setAlert(telnetOpenError(reply.error.code));
      return;
    }
    const endpoint = reply.result.endpoint;
    const ordinal = ++nextTelnetOrdinal.current;
    if (reply.result.state === 'running') {
      void rememberOpenedSession({ kind: 'telnet', name: savedTitle ?? autoSavedProfileName('Telnet', endpoint.host, endpoint.port), host: endpoint.host, port: endpoint.port });
    }
    setSessions(current => [...current, {
      ...reply.result, transport: 'telnet', title: savedTitle ?? `${endpoint.host}:${endpoint.port} - Telnet (plaintext) ${ordinal}`
    }]);
    setActiveId(reply.result.sessionId);
  }, [rememberOpenedSession]);

  const openSerialTerminal = useCallback(async (input: SerialConfiguration, savedTitle?: string) => {
    const configuration = normalizeSerialConfiguration(input);
    if (!configuration || !serialPorts.some(port => port.path === configuration.path)) {
      setSerialPortsError('Choose a serial port that is currently listed. Refresh the list if the device changed.');
      return;
    }
    setSerialConnectOpen(false);
    setSerialSavedTitle(undefined);
    setSerialSavedProfilePath(undefined);
    setSerialPortsError(undefined);
    setAlert(undefined);
    const sessionId = crypto.randomUUID();
    const replyPromise = window.multiRemoteTerminal.openSerialTerminal(sessionId, configuration, 80, 24);
    pendingOpenRequests.current.set(sessionId, { transport: 'serial', cancelled: false, reply: replyPromise });
    setOpeningSessions(current => [...current, { transport: 'serial', sessionId, configuration, cancelling: false }]);
    const reply = await replyPromise;
    if (pendingOpenRequests.current.get(sessionId)?.cancelled) return;
    pendingOpenRequests.current.delete(sessionId);
    setOpeningSessions(current => current.filter(opening => opening.sessionId !== sessionId));
    if (!reply.ok) {
      if (reply.error.code !== 'CANCELLED') setAlert(`Could not open ${configuration.path} (${reply.error.code}). Check the port settings and device connection.`);
      return;
    }
    const ordinal = ++nextSerialOrdinal.current;
    if (reply.result.state === 'running') {
      void rememberOpenedSession({ kind: 'serial', name: savedTitle ?? `${configuration.path} - ${configuration.baudRate} baud`, configuration });
    }
    setSessions(current => [...current, {
      ...reply.result, transport: 'serial', title: savedTitle ?? `${configuration.path} · ${configuration.baudRate} baud · Serial ${ordinal}`
    }]);
    setActiveId(reply.result.sessionId);
  }, [rememberOpenedSession, serialPorts]);

  async function openFtpFiles(hostInput: string, portInput: string, secure: boolean, savedTitle?: string) {
    if (ftpConnecting) return;
    const host = hostInput.trim();
    const port = Number(portInput);
    if (!host) { setFtpConnectError('Enter a host name or IP address.'); ftpHostInput.current?.focus(); return; }
    if (!/^\d{1,5}$/.test(portInput) || !Number.isInteger(port) || port < 1 || port > 65_535) {
      setFtpConnectError('Port must be a whole number from 1 to 65535.');
      ftpPortInput.current?.focus();
      return;
    }
    const endpoint = canonicalizeFtpEndpoint({ host, port, secure });
    if (!endpoint) { setFtpConnectError('Enter a valid DNS name or IP address.'); ftpHostInput.current?.focus(); return; }
    setFtpConnectError(undefined);
    setFtpConnecting(true);
    setAlert(undefined);
    const sessionId = crypto.randomUUID();
    try {
      const reply = await window.multiRemoteTerminal.openFtpFiles(sessionId, endpoint.host, endpoint.port, endpoint.secure);
      if (!reply.ok) { setFtpConnectError(ftpOpenError(reply.error.code, endpoint.secure)); return; }
      const ordinal = ++nextFtpOrdinal.current;
      const protocol = endpoint.secure ? 'FTPS' : 'FTP (plaintext)';
      const title = savedTitle ?? `${endpoint.host}:${endpoint.port} - ${protocol} ${ordinal}`;
      if (reply.result.state === 'running') {
        void rememberOpenedSession({ kind: 'ftp', name: savedTitle ?? autoSavedProfileName(endpoint.secure ? 'FTPS' : 'FTP', endpoint.host, endpoint.port),
          host: endpoint.host, port: endpoint.port, secure: endpoint.secure });
      }
      setSessions(current => [...current, { ...reply.result, transport: 'ftp', title }]);
      setActiveId(reply.result.sessionId);
      setFtpConnectOpen(false);
    } catch {
      setFtpConnectError('The FTP connection could not be confirmed. Check the saved session before retrying.');
    } finally { setFtpConnecting(false); }
  }

  const cancelOpening = useCallback((sessionId: string) => {
    const pending = pendingOpenRequests.current.get(sessionId);
    if (!pending || pending.cancelled) return;
    pending.cancelled = true;
    setOpeningSessions(current => current.map(opening => opening.sessionId === sessionId ? { ...opening, cancelling: true } : opening));
    void (async () => {
      const closeReply = await closeTerminalConnection(sessionId, pending.transport);
      const reply = await pending.reply;
      if (reply.ok) {
        const cleanup = await closeTerminalConnection(sessionId, pending.transport);
        if (!cleanup.ok && cleanup.error.code !== 'NOT_FOUND') setAlert(messageForError(cleanup.error));
      } else if (!closeReply.ok && closeReply.error.code !== 'NOT_FOUND') {
        setAlert(messageForError(closeReply.error));
      } else if (reply.error.code !== 'CANCELLED' && reply.error.code !== 'NOT_FOUND') {
        setAlert(`Could not confirm terminal cancellation (${reply.error.code}).`);
      }
      pendingEvents.current.delete(sessionId);
      pendingOpenRequests.current.delete(sessionId);
      if (pending.transport === 'sftp') {
        fileOnlySshSessionIds.current.delete(sessionId);
        visibleFileOnlySshSessionIds.current.delete(sessionId);
      }
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

  const closeTerminal = useCallback(async (sessionId: string, transport: WorkbenchSession['transport']) => {
    macroRunner.disconnect(sessionId);
    const reply = await closeTerminalConnection(sessionId, transport);
    if (!reply.ok && reply.error.code !== 'NOT_FOUND') setAlert(messageForError(reply.error));
    stopMacroRecording(sessionId, 'stopped');
    handles.current.delete(sessionId);
    pendingEvents.current.delete(sessionId);
    if (transport === 'sftp') {
      fileOnlySshSessionIds.current.delete(sessionId);
      visibleFileOnlySshSessionIds.current.delete(sessionId);
    }
    focusTerminalOnActiveChange.current = true;
    setSessions(current => current.filter(session => session.sessionId !== sessionId));
  }, [macroRunner, stopMacroRecording]);

  const reconnectFtp = useCallback((session: WorkbenchFtpSession) => {
    void (async () => {
      await closeTerminal(session.sessionId, 'ftp');
      openFtpConnect(session.endpoint.host, session.endpoint.port, session.endpoint.secure, session.title);
    })();
  }, [closeTerminal, openFtpConnect]);

  const reconnectSftp = useCallback((session: WorkbenchSftpSession) => {
    void (async () => {
      await closeTerminal(session.sessionId, 'sftp');
      openSshConnect('sftp', session.endpoint.host, session.endpoint.port, session.title);
    })();
  }, [closeTerminal, openSshConnect]);

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
    void openTerminal('powershell', undefined, false);
    return () => { active = false; };
  }, [openTerminal]);

  useEffect(() => {
    let active = true;
    void window.multiRemoteTerminal.getWorkbenchPreferences().then(reply => {
      if (!active) return;
      if (reply.ok) {
        applyWorkbenchPreferences(reply.result);
      } else setAlert(workbenchPreferenceFailureMessage('load', reply.error.code));
    }).catch(() => {
      if (active) setAlert(workbenchPreferenceFailureMessage('load', undefined));
    });
    return () => { active = false; };
  }, [applyWorkbenchPreferences]);

  useEffect(() => {
    if (!activeId) return;
    if (focusTerminalOnActiveChange.current) {
      const targetSessionId = activeId;
      const focusFrame = requestAnimationFrame(() => {
        if (!document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) {
          handles.current.get(targetSessionId)?.focus();
        }
      });
      return () => cancelAnimationFrame(focusFrame);
    }
    focusTerminalOnActiveChange.current = true;
  }, [activeId, sessions]);

  useEffect(() => {
    if (activeId && !sessions.some(session => session.sessionId === activeId)) setActiveId(sessions.at(-1)?.sessionId);
  }, [activeId, sessions]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (helpOpen || settingsOpen) return;
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
      if (multiExecOpen) {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          if (multiExecView?.phase === 'sending') cancelMultiExec();
          else if (multiExecView?.phase === 'review') confirmMultiExec(false);
          else closeMultiExec();
        } else if (event.key === 'Tab') {
          const focusable = [...(multiExecDialog.current?.querySelectorAll<HTMLElement>(
            'input:not(:disabled), button:not(:disabled), [tabindex="-1"]'
          ) ?? [])];
          if (focusable.length) {
            event.preventDefault();
            event.stopPropagation();
            const current = focusable.indexOf(document.activeElement as HTMLElement);
            focusable[(current + (event.shiftKey ? focusable.length - 1 : 1)) % focusable.length]?.focus();
          }
        }
        return;
      }
      if (macroManagerOpen) {
        if (macroShortcutCaptureMacroId) {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setMacroShortcutCaptureMacroId(undefined);
            setMacroShortcutNotice('Shortcut assignment cancelled.');
            return;
          }
          if (event.key === 'Tab') {
            setMacroShortcutCaptureMacroId(undefined);
            setMacroShortcutNotice('Shortcut assignment cancelled.');
          } else if (event.key === 'Control' || event.key === 'Alt' || event.key === 'Shift' || event.key === 'Meta') {
            return;
          } else if (isMacroShortcutCode(event.code)) {
            event.preventDefault();
            event.stopPropagation();
            const code = macroShortcutCodeFromEvent(event);
            if (code) void saveMacroShortcut(macroShortcutCaptureMacroId, code);
            else setMacroShortcutNotice('Use Ctrl+Alt+Shift with a letter, number, numpad key, or F1–F12.');
            return;
          } else if (event.ctrlKey || event.altKey || event.metaKey) {
            event.preventDefault();
            event.stopPropagation();
            setMacroShortcutNotice('Use Ctrl+Alt+Shift with a letter, number, numpad key, or F1–F12.');
            return;
          }
        }
        if (event.key === 'Escape' && !macroBusy) {
          event.preventDefault();
          if (macroPlaybackRun.current) cancelMacroPlayback();
          else if (macroPlaybackMacroId) closeMacroPlayback();
          else closeMacroManager();
        }
        else if (event.key === 'Tab') {
          const focusable = [...(macroManagerDialog.current?.querySelectorAll<HTMLElement>('input:not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled)') ?? [])];
          if (focusable.length) {
            event.preventDefault();
            const current = focusable.indexOf(document.activeElement as HTMLElement);
            focusable[(current + (event.shiftKey ? focusable.length - 1 : 1)) % focusable.length]?.focus();
          }
        }
        return;
      }
      if (tunnelManagerOpen) {
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
      if (folderDialog) {
        if (event.key === 'Escape' && !catalogBusy) { event.preventDefault(); setFolderDialog(undefined); }
        else if (event.key === 'Tab') {
          const focusable = [...(folderDialogRef.current?.querySelectorAll<HTMLElement>('input:not(:disabled), select:not(:disabled), button:not(:disabled)') ?? [])];
          if (focusable.length) {
            event.preventDefault();
            const current = focusable.indexOf(document.activeElement as HTMLElement);
            focusable[(current + (event.shiftKey ? focusable.length - 1 : 1)) % focusable.length]?.focus();
          }
        }
        return;
      }
      if (rdpConnectOpen) {
        if (event.key === 'Escape' && rdpConnectDialog.current?.getAttribute('aria-busy') !== 'true') {
          event.preventDefault(); setRdpConnectOpen(false);
        }
        else if (event.key === 'Tab') {
          const focusable = [...(rdpConnectDialog.current?.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)') ?? [])];
          if (focusable.length) {
            event.preventDefault();
            const current = focusable.indexOf(document.activeElement as HTMLElement);
            focusable[(current + (event.shiftKey ? focusable.length - 1 : 1)) % focusable.length]?.focus();
          }
        }
        return;
      }
      if (vncConnectOpen) {
        if (event.key === 'Escape' && vncConnectDialog.current?.getAttribute('aria-busy') !== 'true') {
          event.preventDefault(); setVncConnectOpen(false);
        }
        else if (event.key === 'Tab') {
          const focusable = [...(vncConnectDialog.current?.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)') ?? [])];
          if (focusable.length) {
            event.preventDefault();
            const current = focusable.indexOf(document.activeElement as HTMLElement);
            focusable[(current + (event.shiftKey ? focusable.length - 1 : 1)) % focusable.length]?.focus();
          }
        }
        return;
      }
      if (sshConnectOpen) {
        if (event.key === 'Escape') { event.preventDefault(); cancelSshConnect(); }
        else if (event.key === 'Tab') {
          const focusable = [...(sshConnectDialog.current?.querySelectorAll<HTMLElement>('input:not(:disabled), select:not(:disabled), button:not(:disabled)') ?? [])];
          if (focusable.length) {
            event.preventDefault();
            const current = focusable.indexOf(document.activeElement as HTMLElement);
            focusable[(current + (event.shiftKey ? focusable.length - 1 : 1)) % focusable.length]?.focus();
          }
        }
        return;
      }
      if (telnetConnectOpen) {
        if (event.key === 'Escape') { event.preventDefault(); setTelnetConnectOpen(false); }
        else if (event.key === 'Tab') {
          const focusable = [...(telnetConnectDialog.current?.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)') ?? [])];
          if (focusable.length) {
            event.preventDefault();
            const current = focusable.indexOf(document.activeElement as HTMLElement);
            focusable[(current + (event.shiftKey ? focusable.length - 1 : 1)) % focusable.length]?.focus();
          }
        }
        return;
      }
      if (serialConnectOpen) {
        if (event.key === 'Escape') { event.preventDefault(); setSerialConnectOpen(false); }
        else if (event.key === 'Tab') {
          const focusable = [...(serialConnectDialog.current?.querySelectorAll<HTMLElement>('input:not(:disabled), select:not(:disabled), button:not(:disabled)') ?? [])];
          if (focusable.length) {
            event.preventDefault();
            const current = focusable.indexOf(document.activeElement as HTMLElement);
            focusable[(current + (event.shiftKey ? focusable.length - 1 : 1)) % focusable.length]?.focus();
          }
        }
        return;
      }
      if (ftpConnectOpen) {
        if (event.key === 'Escape' && !ftpConnecting) { event.preventDefault(); setFtpConnectOpen(false); }
        else if (event.key === 'Tab') {
          const focusable = [...(ftpConnectDialog.current?.querySelectorAll<HTMLElement>('input:not(:disabled), select:not(:disabled), button:not(:disabled)') ?? [])];
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
      if (tabContextMenu) {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeTerminalTabContextMenu(true);
        } else if (event.key === 'Tab') {
          event.preventDefault();
          closeTerminalTabContextMenu(true);
        }
        return;
      }
      const target = event.target;
      const editingText = target instanceof HTMLElement && !target.closest('.xterm') &&
        (target.isContentEditable || target.matches('input, textarea, select'));
      if (!editingText && !paletteOpen) {
        const code = macroShortcutCodeFromEvent(event);
        const binding = code ? macroShortcuts.find(candidate => candidate.code === code) : undefined;
        if (binding) {
          event.preventDefault();
          event.stopPropagation();
          openMacroShortcutReview(binding.macroId);
          return;
        }
      }
      if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'w' && activeId && !editingText) {
        event.preventDefault();
        requestCloseTerminal(activeId);
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
  }, [activeId, cancelMacroPlayback, cancelMultiExec, catalogBusy, closeMacroManager, closeMacroPlayback, closeMultiExec, confirmMultiExec,
    decideSshTrust, folderDialog, ftpConnectOpen, ftpConnecting, macroBusy, macroManagerOpen, macroPlaybackMacroId, macroShortcutCaptureMacroId,
    macroShortcuts, multiExecOpen, multiExecView, openMacroShortcutReview, openPalette, paletteOpen, pendingCloseId, requestCloseTerminal,
    helpOpen, rdpConnectOpen, saveMacroShortcut, saveSessionOpen, sessions, settingsOpen, sshConnectOpen, sshTrustBusy, sshTrustEvents,
    serialConnectOpen, tabContextMenu, telnetConnectOpen, tunnelManagerOpen, vncConnectOpen]);

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
    if (helpOpen || !helpReturnFocus.current) return;
    const target = helpReturnFocus.current;
    helpReturnFocus.current = null;
    requestAnimationFrame(() => { if (target.isConnected) target.focus(); });
  }, [helpOpen]);

  useEffect(() => {
    if (settingsOpen || !settingsReturnFocus.current) return;
    const target = settingsReturnFocus.current;
    settingsReturnFocus.current = null;
    requestAnimationFrame(() => { if (target.isConnected) target.focus(); });
  }, [settingsOpen]);

  useLayoutEffect(() => {
    if (sshConnectOpen) {
      if (sshGatewayTarget) document.getElementById('ssh-gateway-one')?.focus();
      else sshHostInput.current?.focus();
    }
  }, [sshConnectOpen, sshGatewayTarget]);

  useLayoutEffect(() => {
    if (rdpConnectOpen) requestAnimationFrame(() => rdpConnectDialog.current?.querySelector<HTMLElement>('input')?.focus());
  }, [rdpConnectOpen]);

  useLayoutEffect(() => {
    if (vncConnectOpen) requestAnimationFrame(() => vncConnectDialog.current?.querySelector<HTMLElement>('input')?.focus());
  }, [vncConnectOpen]);

  useLayoutEffect(() => {
    if (tunnelManagerOpen) requestAnimationFrame(() => tunnelManagerDialog.current?.querySelector<HTMLElement>('select, input, button')?.focus());
  }, [tunnelManagerOpen]);

  useLayoutEffect(() => {
    if (macroManagerOpen) macroManagerDialog.current?.querySelector<HTMLElement>('#macro-recording-name')?.focus();
  }, [macroManagerOpen]);

  useLayoutEffect(() => {
    if (multiExecOpen || !multiExecReturnFocus.current) return;
    const target = multiExecReturnFocus.current;
    multiExecReturnFocus.current = null;
    requestAnimationFrame(() => { if (target.isConnected) target.focus(); });
  }, [multiExecOpen]);

  useLayoutEffect(() => {
    const targetSessionId = pendingMacroTerminalFocus.current;
    if (!targetSessionId || macroManagerOpen || activeId !== targetSessionId || !macroRecording) return;
    pendingMacroTerminalFocus.current = undefined;
    handles.current.get(targetSessionId)?.focus();
  }, [activeId, macroManagerOpen, macroRecording]);

  useEffect(() => {
    const cancelPlaybackOnShutdown = () => macroRunner.cancel();
    window.addEventListener('beforeunload', cancelPlaybackOnShutdown);
    return () => window.removeEventListener('beforeunload', cancelPlaybackOnShutdown);
  }, [macroRunner]);

  useEffect(() => {
    if (!macroManagerOpen && macroManagerReturnFocus.current) {
      const target = macroManagerReturnFocus.current;
      macroManagerReturnFocus.current = null;
      requestAnimationFrame(() => { if (target.isConnected) target.focus(); });
    }
  }, [macroManagerOpen]);

  useEffect(() => {
    if (!tunnelManagerOpen && tunnelManagerReturnFocus.current) {
      const target = tunnelManagerReturnFocus.current;
      tunnelManagerReturnFocus.current = null;
      requestAnimationFrame(() => { if (target.isConnected) target.focus(); });
    }
  }, [tunnelManagerOpen]);

  useEffect(() => {
    if (!sshConnectOpen && sshConnectReturnFocus.current) {
      const target = sshConnectReturnFocus.current;
      sshConnectReturnFocus.current = null;
      requestAnimationFrame(() => { if (target.isConnected) target.focus(); });
    }
  }, [sshConnectOpen]);

  useEffect(() => {
    if (telnetConnectOpen) requestAnimationFrame(() => telnetHostInput.current?.focus());
    else if (telnetConnectReturnFocus.current) {
      const target = telnetConnectReturnFocus.current;
      telnetConnectReturnFocus.current = null;
      requestAnimationFrame(() => { if (target.isConnected) target.focus(); });
    }
  }, [telnetConnectOpen]);

  useEffect(() => {
    if (serialConnectOpen) requestAnimationFrame(() => serialConnectDialog.current?.querySelector<HTMLElement>('select, button')?.focus());
    else if (serialConnectReturnFocus.current) {
      const target = serialConnectReturnFocus.current;
      serialConnectReturnFocus.current = null;
      requestAnimationFrame(() => { if (target.isConnected) target.focus(); });
    }
  }, [serialConnectOpen]);

  useEffect(() => {
    if (ftpConnectOpen) requestAnimationFrame(() => ftpHostInput.current?.focus());
    else if (ftpConnectReturnFocus.current) {
      const target = ftpConnectReturnFocus.current;
      ftpConnectReturnFocus.current = null;
      requestAnimationFrame(() => { if (target.isConnected) target.focus(); });
    }
  }, [ftpConnectOpen]);

  useEffect(() => {
    if (!rdpConnectOpen && rdpConnectReturnFocus.current) {
      const target = rdpConnectReturnFocus.current;
      rdpConnectReturnFocus.current = null;
      requestAnimationFrame(() => { if (target.isConnected) target.focus(); });
    }
  }, [rdpConnectOpen]);

  useEffect(() => {
    if (!vncConnectOpen && vncConnectReturnFocus.current) {
      const target = vncConnectReturnFocus.current;
      vncConnectReturnFocus.current = null;
      requestAnimationFrame(() => { if (target.isConnected) target.focus(); });
    }
  }, [vncConnectOpen]);

  useEffect(() => {
    if (saveSessionOpen) {
      if (!catalogBusy) requestAnimationFrame(() => {
        if (uncertainSaveDraft) checkSavedSessionsButton.current?.focus();
        else saveSessionNameInput.current?.focus();
      });
    } else if (!catalogBusy && saveSessionReturnFocus.current) {
      const target = saveSessionReturnFocus.current;
      saveSessionReturnFocus.current = null;
      requestAnimationFrame(() => { if (target.isConnected) target.focus(); });
    }
  }, [catalogBusy, saveSessionOpen, uncertainSaveDraft]);

  useEffect(() => {
    if (folderDialog) {
      if (!catalogBusy) requestAnimationFrame(() => {
        if (folderDialog.mode === 'create' || folderDialog.mode === 'rename') folderNameInput.current?.focus();
        else folderParentInput.current?.focus();
      });
    } else if (!catalogBusy && folderDialogReturnFocus.current) {
      const target = folderDialogReturnFocus.current;
      folderDialogReturnFocus.current = null;
      requestAnimationFrame(() => { if (target.isConnected) target.focus(); });
    }
  }, [catalogBusy, folderDialog]);

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
    { id: 'new-bash', label: 'New Bash terminal', run: () => { void openTerminal('bash'); } },
    { id: 'connect-ssh', label: 'Connect to SSH server', run: () => openSshConnect('terminal') },
    { id: 'connect-sftp', label: 'Connect to SFTP files', run: () => openSshConnect('sftp') },
    { id: 'connect-telnet', label: 'Connect to Telnet server (plaintext)', run: () => openTelnetConnect() },
    { id: 'connect-serial', label: 'Connect to serial port', run: openSerialConnect },
    { id: 'connect-ftp', label: 'Connect to FTP or FTPS server', run: () => openFtpConnect() },
    { id: 'connect-rdp', label: 'Connect to RDP desktop (external viewer)', run: () => openRdpConnect() },
    { id: 'connect-vnc', label: 'Connect to VNC desktop (external TigerVNC viewer)', run: () => openVncConnect() },
    { id: 'multi-exec', label: 'Send line to terminals (MultiExec)', run: openMultiExec },
    { id: 'close-active', label: 'Close active terminal', run: () => { if (activeId) requestCloseTerminal(activeId); } },
    { id: 'toggle-theme', label: `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`, run: toggleTheme },
    { id: 'open-help', label: 'Help and keyboard shortcuts', run: openHelp },
    { id: 'open-settings', label: 'Workbench settings', run: openSettings }
  ];
  const filteredCommands = commands.filter(command => command.label.toLowerCase().includes(query.toLowerCase()));
  const active = sessions.find(session => session.sessionId === activeId);
  const multiExecTargets: MultiExecDisplayTarget[] = sessions.filter(isMacroTerminal)
    .filter(session => session.state === 'running' && handles.current.has(session.sessionId))
    .map(session => ({ sessionId: session.sessionId, title: macroTargetTitle(session) }));
  const multiExecBlockedReason = macroRecording !== undefined
    ? 'Stop or discard the active macro recording before sending to multiple terminals.'
    : macroPlayback?.status === 'running'
      ? 'Wait for or cancel macro playback before sending to multiple terminals.'
      : undefined;
  const pendingClose = sessions.find(session => session.sessionId === pendingCloseId);
  const currentSshTrust = sshTrustEvents[0];
  const savedFolderById = new Map(savedFolders.map(folder => [folder.id, folder]));
  const sessionsByFolder = new Map<string, SavedSessionDefinition[]>();
  const unfiledSessions: SavedSessionDefinition[] = [];
  for (const session of savedSessions) {
    if (session.folderId === null) unfiledSessions.push(session);
    else {
      const items = sessionsByFolder.get(session.folderId) ?? [];
      items.push(session);
      sessionsByFolder.set(session.folderId, items);
    }
  }
  const folderChildren = new Map<string, SavedSessionFolder[]>();
  const rootFolders: SavedSessionFolder[] = [];
  for (const folder of savedFolders) {
    if (folder.parentId === null) rootFolders.push(folder);
    else {
      const items = folderChildren.get(folder.parentId) ?? [];
      items.push(folder);
      folderChildren.set(folder.parentId, items);
    }
  }
  const visibleFolderIds = savedSearch ? new Set<string>() : new Set(savedFolders.map(folder => folder.id));
  if (savedSearch) {
    for (const session of savedSessions) {
      let folderId = session.folderId;
      const seen = new Set<string>();
      while (folderId && !seen.has(folderId)) {
        seen.add(folderId);
        visibleFolderIds.add(folderId);
        folderId = savedFolderById.get(folderId)?.parentId ?? null;
      }
    }
  }
  const excludedMoveTargetIds = folderDialog?.mode === 'move-folder' ? folderDescendants(savedFolders, folderDialog.folder.id) : new Set<string>();

  function renderSavedSession(session: SavedSessionDefinition, depth: number): ReactElement {
    const menuId = `session:${session.id}`;
    const menuOpen = openSavedActionsMenuId === menuId;
    const credentialStatus = session.kind === 'ssh' ? savedSshCredentialStatus[session.id] ?? 'none' : undefined;
    return <li className="saved-session-row" key={session.id} style={{ paddingInlineStart: `${Math.min(depth, 8) * 10}px` }}>
      <button className="saved-session-open" type="button" aria-label={`Open ${session.name}`} onClick={() => openSavedSession(session)}>
        <span className={`shell-glyph ${session.kind === 'local' ? session.shell : session.kind}`} aria-hidden="true">
          {session.kind === 'local' ? shellBadge(session.shell) : session.kind === 'ssh' ? 'SSH' : session.kind === 'sftp' ? 'SFTP'
            : session.kind === 'telnet' ? 'TELNET' : session.kind === 'rdp' ? 'RDP' : session.kind === 'vnc' ? 'VNC'
              : session.kind === 'serial' ? 'COM' : session.secure ? 'FTPS' : 'FTP'}
        </span>
        <span className="saved-session-name" translate="no">{session.name}</span>
        <span className="saved-session-detail" translate="no">{session.kind === 'local' ? session.shell
          : session.kind === 'serial' ? `${session.configuration.path} · ${session.configuration.baudRate} baud`
            : `${sshEndpointLabel(session.host, session.port)} · ${session.kind === 'ftp' ? session.secure ? 'FTPS' : 'FTP (plaintext)' : session.kind === 'rdp' ? 'RDP · external viewer' : session.kind === 'vnc' ? 'VNC · external viewer' : session.kind.toUpperCase()}`}</span>
      </button>
      <div className="saved-session-actions">
        <button type="button" aria-label={`${session.favorite ? 'Remove favorite from' : 'Make favorite'} ${session.name}`}
          aria-pressed={session.favorite} disabled={catalogBusy} onClick={() => void toggleSavedFavorite(session)}>{session.favorite ? '★' : '☆'}</button>
        <details className="saved-actions-menu" open={menuOpen}>
          <summary role="button" aria-label={`Actions for saved session ${session.name}`} title={`Actions for ${session.name}`}
            aria-expanded={menuOpen} onClick={event => toggleSavedActionsMenu(event, menuId, session.kind === 'ssh' ? session.id : undefined)}>···</summary>
          <div className="saved-actions-panel" aria-label={`Saved-session actions for ${session.name}`}>
            {session.kind === 'ssh' && <>
              <p className="saved-session-credential-status" role="status">{credentialStatus === 'saved' ? 'A password is saved with Windows account protection.'
                : credentialStatus === 'loading' ? 'Checking saved password…' : credentialStatus === 'unavailable' ? 'Password status is unavailable.' : 'No password is saved.'}</p>
              <button type="button" disabled={catalogBusy || credentialBusyId === session.id}
                onClick={() => void saveSshCredential(session)}>{credentialStatus === 'saved' ? 'Replace saved password…' : 'Save password…'}</button>
              <button type="button" disabled={catalogBusy || credentialBusyId === session.id || credentialStatus !== 'saved'}
                onClick={() => void forgetSshCredential(session)}>Forget saved password</button>
            </>}
            {session.kind === 'ssh' && <button type="button" disabled={catalogBusy} aria-label={`Connect ${session.name} through gateways`}
              onClick={() => { setOpenSavedActionsMenuId(undefined); void openSavedSshThroughGateways(session); }}>Connect through gateways…</button>}
            <button type="button" disabled={catalogBusy} aria-label={`Move saved session ${session.name}`}
              onClick={() => { setOpenSavedActionsMenuId(undefined); openSavedFolderDialog({ mode: 'move-session', session }); }}>Move to folder</button>
            <button type="button" disabled={catalogBusy} aria-label={`Delete saved session ${session.name}`}
              onClick={() => { setOpenSavedActionsMenuId(undefined); void deleteSavedSession(session); }}>Delete</button>
          </div>
        </details>
      </div>
    </li>;
  }

  function renderSavedFolder(folder: SavedSessionFolder, depth: number, includeChildren = true): ReactElement {
    const menuId = `folder:${folder.id}`;
    const menuOpen = openSavedActionsMenuId === menuId;
    const sessionsHere = sessionsByFolder.get(folder.id) ?? [];
    const children = (folderChildren.get(folder.id) ?? []).filter(child => visibleFolderIds.has(child.id));
    const expanded = expandedFolderIds.has(folder.id) || (Boolean(savedSearch) && (sessionsHere.length > 0 || children.length > 0));
    return <li className="saved-folder-node" key={folder.id}>
      <div className="saved-folder-entry" style={{ paddingInlineStart: `${Math.min(depth, 8) * 10}px` }}>
        <button className="saved-folder-toggle" type="button" aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} folder ${folder.name}`} disabled={catalogBusy}
          onClick={() => setExpandedFolderIds(current => {
            const next = new Set(current);
            if (next.has(folder.id)) next.delete(folder.id);
            else next.add(folder.id);
            return next;
          })}>
          <span className="saved-folder-chevron" aria-hidden="true">{expanded ? '⌄' : '›'}</span>
          <span className="saved-folder-icon" aria-hidden="true" />
          <span className="saved-folder-name" translate="no">{folder.name}</span>
          <span className="saved-folder-count">{sessionsHere.length}</span>
        </button>
        <details className="saved-actions-menu" open={menuOpen}>
          <summary role="button" aria-label={`Actions for folder ${folder.name}`} title={`Actions for ${folder.name}`}
            aria-expanded={menuOpen} onClick={event => toggleSavedActionsMenu(event, menuId)}>···</summary>
          <div className="saved-actions-panel" aria-label={`Folder actions for ${folder.name}`}>
            <button type="button" disabled={catalogBusy} aria-label={`Create subfolder in ${folder.name}`}
              onClick={() => { setOpenSavedActionsMenuId(undefined); openSavedFolderDialog({ mode: 'create', parentId: folder.id }); }}>New subfolder</button>
            <button type="button" disabled={catalogBusy} aria-label={`Export folder ${folder.name}`}
              onClick={() => { setOpenSavedActionsMenuId(undefined); void exportSavedFolder(folder); }}>Export folder</button>
            <button type="button" disabled={catalogBusy} aria-label={`Rename folder ${folder.name}`}
              onClick={() => { setOpenSavedActionsMenuId(undefined); openSavedFolderDialog({ mode: 'rename', folder }); }}>Rename</button>
            <button type="button" disabled={catalogBusy} aria-label={`Move folder ${folder.name}`}
              onClick={() => { setOpenSavedActionsMenuId(undefined); openSavedFolderDialog({ mode: 'move-folder', folder }); }}>Move</button>
            <button type="button" disabled={catalogBusy} aria-label={`Delete folder ${folder.name}`}
              onClick={() => { setOpenSavedActionsMenuId(undefined); void deleteSavedFolder(folder); }}>Delete</button>
          </div>
        </details>
      </div>
      {includeChildren && expanded && <ul className="saved-folder-children">
        {children.map(child => renderSavedFolder(child, depth + 1))}
        {sessionsHere.map(session => renderSavedSession(session, depth + 1))}
      </ul>}
    </li>;
  }

  function renderUnfiledFolderHeader(): ReactElement {
    return <div className="saved-folder-entry unfiled-folder-entry">
      <span className="saved-folder-static"><span className="saved-folder-icon" aria-hidden="true" />
        <span className="saved-folder-name">Unfiled</span>
        <span className="saved-folder-count">{unfiledSessions.length}</span></span>
    </div>;
  }

  function renderNestedUnfiledFolder(): ReactElement {
    return <li className="saved-folder-node" key="unfiled">
      {renderUnfiledFolderHeader()}
      <ul className="saved-folder-children">{unfiledSessions.map(session => renderSavedSession(session, 1))}</ul>
    </li>;
  }

  const savedCatalogVirtualItems: SavedCatalogItem[] = [];
  if (savedSessions.length + savedFolders.length > SAVED_SESSION_CATALOG_VIRTUALIZATION_THRESHOLD) {
    if (unfiledSessions.length > 0) {
      savedCatalogVirtualItems.push({ kind: 'unfiled-header' });
      unfiledSessions.forEach(session => savedCatalogVirtualItems.push({ kind: 'session', session, depth: 1 }));
    }
    const appendFolderRows = (folder: SavedSessionFolder, depth: number): void => {
      const sessionsHere = sessionsByFolder.get(folder.id) ?? [];
      const children = (folderChildren.get(folder.id) ?? []).filter(child => visibleFolderIds.has(child.id));
      const expanded = expandedFolderIds.has(folder.id) || (Boolean(savedSearch) && (sessionsHere.length > 0 || children.length > 0));
      savedCatalogVirtualItems.push({ kind: 'folder', folder, depth });
      if (!expanded) return;
      children.forEach(child => appendFolderRows(child, depth + 1));
      sessionsHere.forEach(session => savedCatalogVirtualItems.push({ kind: 'session', session, depth: depth + 1 }));
    };
    rootFolders.filter(folder => visibleFolderIds.has(folder.id)).forEach(folder => appendFolderRows(folder, 0));
  }

  function openSavedSession(session: SavedSessionDefinition) {
    if (session.kind === 'local') void openTerminal(session.shell, session.name);
    else if (session.kind === 'ssh') void openSshTerminal(session.host, String(session.port), session.name, [], session.id);
    else if (session.kind === 'sftp') void openSftpFiles(session.host, String(session.port), session.name);
    else if (session.kind === 'telnet') openTelnetConnect(session.host, session.port, session.name);
    else if (session.kind === 'ftp') openFtpConnect(session.host, session.port, session.secure, session.name);
    else if (session.kind === 'serial') openSerialConnect(session.configuration, session.name);
    else if (session.kind === 'rdp') openRdpConnect(session.host, session.port, session.name);
    else if (session.kind === 'vnc') openVncConnect(session.host, session.port, session.name);
  }

  async function openSavedSshThroughGateways(session: Extract<SavedSessionDefinition, { kind: 'ssh' }>) {
    const reply = await window.multiRemoteTerminal.listSavedSessions('');
    if (!reply.ok) {
      setAlert(`Saved SSH gateways could not be loaded (${reply.error.code}).`);
      return;
    }
    const profiles = reply.result.filter((profile): profile is Extract<SavedSessionDefinition, { kind: 'ssh' }> =>
      profile.kind === 'ssh' && profile.id !== session.id && !(profile.host === session.host && profile.port === session.port));
    if (profiles.length === 0) {
      setAlert('Save another SSH session to use it as a gateway.');
      return;
    }
    openSshConnect('terminal', session.host, session.port, session.name);
    setSshGatewayTarget(session);
    setSshGatewayProfiles(profiles);
  }

  function cancelSshConnect() {
    setSshConnectOpen(false);
    setSshGatewayTarget(undefined);
    setSshGatewayProfiles([]);
    setSshGatewayOne('');
    setSshGatewayTwo('');
  }

  function connectThroughSelectedGateways() {
    if (!sshGatewayTarget || !sshGatewayOne) {
      setSshConnectError('Choose the first SSH gateway.');
      return;
    }
    const selected = [sshGatewayOne, sshGatewayTwo].filter(Boolean);
    const names = selected.map(id => sshGatewayProfiles.find(profile => profile.id === id)?.name ?? 'SSH gateway');
    void openSshTerminal(sshHost, sshPort, [...names, sshGatewayTarget.name].join(' → '), selected, sshGatewayTarget.id);
  }

  function toggleSavedActionsMenu(event: MouseEvent<HTMLElement>, menuId: string, credentialProfileId?: string): void {
    event.preventDefault();
    setOpenSavedActionsMenuId(current => current === menuId ? undefined : menuId);
    if (credentialProfileId) {
      setSavedSshCredentialStatus(current => ({ ...current, [credentialProfileId]: 'loading' }));
      void window.multiRemoteTerminal.hasSavedSshCredential(credentialProfileId).then(reply => {
        setSavedSshCredentialStatus(current => ({ ...current, [credentialProfileId]: reply.ok ? reply.result ? 'saved' : 'none' : 'unavailable' }));
      }, () => setSavedSshCredentialStatus(current => ({ ...current, [credentialProfileId]: 'unavailable' })));
    }
  }

  function beginSaveActiveSession() {
    if (!active) return;
    saveSessionReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSaveSessionName(uncertainSaveDraft?.name ?? active.title);
    setSaveSessionError(uncertainSaveDraft
      ? 'A previous save has an uncertain result. Check Saved sessions before trying again.'
      : undefined);
    setSaveSessionOpen(true);
  }

  async function saveActiveSession() {
    if (!active || catalogBusy || uncertainSaveDraft) return;
    const draft: SavedSessionDraft = active.transport === 'local'
      ? { kind: 'local', name: saveSessionName, shell: active.shell }
      : active.transport === 'serial'
        ? { kind: 'serial', name: saveSessionName, configuration: active.configuration }
      : active.transport === 'ssh'
        ? { kind: 'ssh', name: saveSessionName, host: active.endpoint.host, port: active.endpoint.port }
        : active.transport === 'sftp'
          ? { kind: 'sftp', name: saveSessionName, host: active.endpoint.host, port: active.endpoint.port }
        : active.transport === 'telnet'
          ? { kind: 'telnet', name: saveSessionName, host: active.endpoint.host, port: active.endpoint.port }
          : { kind: 'ftp', name: saveSessionName, host: active.endpoint.host, port: active.endpoint.port, secure: active.endpoint.secure };
    setCatalogBusy(true);
    setSaveSessionError(undefined);
    try {
      const reply = await window.multiRemoteTerminal.createSavedSession(draft);
      if (!reply.ok) {
        if (reply.error.code === 'BUSY') setSaveSessionError('Storage is busy. Try saving again.');
        else if (reply.error.code === 'TIMEOUT' || reply.error.code === 'CANCELLED' || reply.error.code === 'UNAVAILABLE') {
          setUncertainSaveDraft(normalizeSavedSessionDraft(draft));
          setSaveSessionError('Saving could not be confirmed. Check Saved sessions before trying again.');
        } else setSaveSessionError(`The session could not be saved (${reply.error.code}).`);
        return;
      }
      setSaveSessionOpen(false);
      await loadSavedSessions(savedSearch);
    } catch {
      setUncertainSaveDraft(normalizeSavedSessionDraft(draft));
      setSaveSessionError('Saving could not be confirmed. Check Saved sessions before trying again.');
    } finally {
      setCatalogBusy(false);
    }
  }

  async function checkUncertainSavedSession() {
    if (!uncertainSaveDraft || catalogBusy) return;
    const draft = normalizeSavedSessionDraft(uncertainSaveDraft);
    if (!draft) return;
    const search = draft.name;
    const definitions = await loadSavedSessions(search);
    if (!definitions) return;
    setSavedSearch(search);
    setUncertainSaveDraft(undefined);
    const alreadySaved = definitions.some(definition => {
      if (definition.kind !== draft.kind || definition.name !== draft.name) return false;
      if (draft.kind === 'local') return definition.kind === 'local' && definition.shell === draft.shell;
      if (draft.kind === 'serial') return definition.kind === 'serial' && serialConfigurationsEqual(definition.configuration, draft.configuration);
      if (definition.kind === 'local' || definition.kind === 'serial') return false;
      return definition.host === draft.host && definition.port === draft.port;
    });
    setAlert(alreadySaved
      ? 'This session is already saved. Open it from Saved sessions instead of saving it again.'
      : 'No matching saved session was found. You can try saving again.');
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
    const credentialDetail = session.kind === 'ssh' ? ' Its saved password will also be removed.' : '';
    if (catalogBusy || !window.confirm(`Delete saved session "${session.name}"?${credentialDetail}`)) return;
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

  async function saveSshCredential(session: Extract<SavedSessionDefinition, { kind: 'ssh' }>) {
    if (credentialBusyId) return;
    setOpenSavedActionsMenuId(undefined);
    setCredentialBusyId(session.id);
    try {
      const reply = await window.multiRemoteTerminal.saveSshCredential(session.id);
      if (reply.ok) {
        setSavedSshCredentialStatus(current => ({ ...current, [session.id]: 'saved' }));
        setAlert(`A password is saved with Windows account protection for ${session.name}. It will be used when this profile is opened.`);
      } else if (reply.error.code !== 'CANCELLED') setAlert(sshCredentialError(reply.error.code));
    } catch { setAlert('The SSH password could not be saved.'); }
    finally { setCredentialBusyId(undefined); }
  }

  async function forgetSshCredential(session: Extract<SavedSessionDefinition, { kind: 'ssh' }>) {
    if (credentialBusyId || !window.confirm(`Forget the saved password for "${session.name}"?`)) return;
    setOpenSavedActionsMenuId(undefined);
    setCredentialBusyId(session.id);
    try {
      const reply = await window.multiRemoteTerminal.forgetSshCredential(session.id);
      if (!reply.ok) setAlert(sshCredentialError(reply.error.code));
      else {
        setSavedSshCredentialStatus(current => ({ ...current, [session.id]: 'none' }));
        setAlert(`Saved password forgotten for ${session.name}.`);
      }
    } catch { setAlert('The saved SSH password could not be forgotten.'); }
    finally { setCredentialBusyId(undefined); }
  }

  function openSavedFolderDialog(state: SavedFolderDialogState) {
    folderDialogReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setFolderDialogError(undefined);
    setFolderNameDraft(state.mode === 'rename' ? state.folder.name : '');
    if (state.mode === 'create') setFolderParentDraft(state.parentId ?? '');
    else if (state.mode === 'move-folder') setFolderParentDraft(state.folder.parentId ?? '');
    else if (state.mode === 'move-session') setFolderParentDraft(state.session.folderId ?? '');
    else setFolderParentDraft('');
    setFolderDialog(state);
  }

  async function refreshSavedCatalog() {
    await Promise.all([loadSavedSessions(savedSearch), loadSavedFolders()]);
  }

  async function submitSavedFolderDialog() {
    if (!folderDialog || catalogBusy) return;
    setCatalogBusy(true);
    setFolderDialogError(undefined);
    let completed = false;
    try {
      if (folderDialog.mode === 'create') {
        const reply = await window.multiRemoteTerminal.createSavedSessionFolder({ name: folderNameDraft, parentId: folderDialog.parentId });
        if (!reply.ok) { setFolderDialogError(savedFolderError(reply.error.code)); focusFolderDialogError(); return; }
        setExpandedFolderIds(current => new Set([...current, ...(folderDialog.parentId ? [folderDialog.parentId] : []), reply.result.id]));
        completed = true;
      } else if (folderDialog.mode === 'rename') {
        const reply = await window.multiRemoteTerminal.renameSavedSessionFolder(folderDialog.folder.id, folderNameDraft);
        if (!reply.ok) { setFolderDialogError(savedFolderError(reply.error.code)); focusFolderDialogError(); return; }
        completed = true;
      } else if (folderDialog.mode === 'move-folder') {
        const reply = await window.multiRemoteTerminal.moveSavedSessionFolder(folderDialog.folder.id, folderParentDraft || null);
        if (!reply.ok) { setFolderDialogError(savedFolderError(reply.error.code)); focusFolderDialogError(); return; }
        completed = true;
      } else {
        const reply = await window.multiRemoteTerminal.moveSavedSession(folderDialog.session.id, folderParentDraft || null);
        if (!reply.ok) { setFolderDialogError(savedFolderError(reply.error.code)); focusFolderDialogError(); return; }
        completed = true;
      }
      if (completed) {
        setFolderDialog(undefined);
        await refreshSavedCatalog();
      }
    } catch {
      setFolderDialogError('The folder operation could not be confirmed. Refresh the list before retrying.');
      focusFolderDialogError();
    } finally {
      setCatalogBusy(false);
    }
  }

  function focusFolderDialogError() {
    requestAnimationFrame(() => {
      if (folderDialog?.mode === 'create' || folderDialog?.mode === 'rename') folderNameInput.current?.focus();
      else folderParentInput.current?.focus();
    });
  }

  async function deleteSavedFolder(folder: SavedSessionFolder) {
    if (catalogBusy) return;
    const destination = folder.parentId ? savedFolders.find(item => item.id === folder.parentId)?.name ?? 'its parent folder' : 'the top level';
    const sessionDestination = folder.parentId ? `inside ${destination}` : 'Unfiled';
    if (!window.confirm(`Delete folder “${folder.name}”? Its sessions will move to ${sessionDestination}, and its subfolders will move to ${destination}.`)) return;
    setCatalogBusy(true);
    try {
      const reply = await window.multiRemoteTerminal.deleteSavedSessionFolder(folder.id);
      if (!reply.ok) setAlert(savedFolderError(reply.error.code));
      else {
        setExpandedFolderIds(current => {
          const next = new Set(current);
          next.delete(folder.id);
          return next;
        });
        await refreshSavedCatalog();
      }
    } catch {
      setAlert('The folder could not be deleted. Refresh the saved-session list and check its contents.');
    } finally {
      setCatalogBusy(false);
    }
  }

  async function exportSavedFolder(folder: SavedSessionFolder) {
    if (catalogBusy) return;
    setCatalogBusy(true);
    try {
      const reply = await window.multiRemoteTerminal.exportSavedSessionFolder(folder.id);
      if (!reply.ok) {
        const message = savedBundleError(reply.error.code);
        if (message) setAlert(message);
      } else {
        setAlert(`Exported ${reply.result.folderCount} ${reply.result.folderCount === 1 ? 'folder' : 'folders'} and ${reply.result.sessionCount} ${reply.result.sessionCount === 1 ? 'saved session' : 'saved sessions'}. The JSON file contains no credentials.`);
      }
    } catch {
      setAlert('The folder export could not be confirmed. Check the selected destination before retrying.');
    } finally {
      setCatalogBusy(false);
    }
  }

  async function importSavedFolder() {
    if (catalogBusy) return;
    setCatalogBusy(true);
    try {
      const reply = await window.multiRemoteTerminal.importSavedSessionFolder();
      if (!reply.ok) {
        const message = savedBundleError(reply.error.code);
        if (message) setAlert(message);
        return;
      }
      const folders = await loadSavedFolders();
      await loadSavedSessions(savedSearch);
      if (folders) setExpandedFolderIds(current => new Set([...current, ...folders.filter(folder => folder.parentId === null).map(folder => folder.id)]));
      setAlert(`Imported ${reply.result.folderCount} ${reply.result.folderCount === 1 ? 'folder' : 'folders'} and ${reply.result.sessionCount} ${reply.result.sessionCount === 1 ? 'saved session' : 'saved sessions'} (${reply.result.createdFolderCount} folders and ${reply.result.createdSessionCount} sessions added).`);
    } catch {
      setAlert('The folder import could not be confirmed. Refresh the saved-session list before retrying.');
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
        <span className="build-label">Local and remote sessions</span>
        <button ref={localTextEditorTrigger} className="quiet-button" type="button" aria-haspopup="dialog"
          disabled={localTextEditorOpening || localTextEditorOpen} onClick={() => void openLocalTextEditor()}>
          {localTextEditorOpening ? 'Opening file…' : 'Edit local file'}</button>
        <button className="quiet-button" type="button" aria-haspopup="dialog" onClick={openSettings}>Settings</button>
        <button className="quiet-button" type="button" aria-haspopup="dialog" onClick={openHelp}>Help</button>
        <button className="quiet-button" type="button" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={toggleTheme}>
          {theme === 'dark' ? 'Light theme' : 'Dark theme'}
        </button>
      </div>
    </header>
    <div className="workspace">
      <aside className="session-rail" aria-label="Sessions">
        <div className="rail-heading"><h2>Sessions</h2><span>{sessions.length}</span></div>
        <button className="new-terminal" type="button" onClick={openPalette}><span aria-hidden="true">＋</span> New local terminal</button>
        <button className="connect-ssh-button" type="button" onClick={() => openSshConnect()}><span aria-hidden="true">↗</span> Connect to SSH</button>
        <button className="connect-ssh-button" type="button" onClick={() => openSerialConnect()}>Connect to serial port</button>
        <button className="connect-ssh-button" type="button" onClick={() => openTelnetConnect()}><span aria-hidden="true">↗</span> Connect to Telnet (plaintext)</button>
        <button className="connect-ssh-button" type="button" onClick={() => openFtpConnect()}><span aria-hidden="true">↗</span> Connect to FTP / FTPS files</button>
        <button className="connect-ssh-button" type="button" aria-haspopup="dialog" onClick={() => openRdpConnect()}><span aria-hidden="true">↗</span> Connect to RDP desktop</button>
        <button className="connect-ssh-button" type="button" aria-haspopup="dialog" onClick={() => openVncConnect()}>Connect to VNC desktop</button>
        <button className="connect-ssh-button" type="button" onClick={() => openSshConnect('sftp')}>Connect to SFTP files</button>
        <button className="connect-ssh-button" type="button" aria-haspopup="dialog" data-testid="tunnel-manager-open" onClick={openTunnelManager}>Port forwarding</button>
        <button className="connect-ssh-button" type="button" aria-haspopup="dialog" data-testid="macro-manager-open" onClick={openMacroManager}>Macros</button>
        <button className="connect-ssh-button" type="button" aria-haspopup="dialog" data-testid="multi-exec-open" onClick={openMultiExec}>MultiExec</button>
        <button className="save-session-button" type="button" disabled={!active || catalogBusy} onClick={beginSaveActiveSession}>Save active session</button>
        {sessions.length > 0 && <div className="session-group">
          <h3>Open sessions</h3>
          <ul>
            {sessions.map(session => <li key={session.sessionId}>
              <button className={`session-item ${session.sessionId === activeId ? 'selected' : ''}`} type="button"
                aria-current={session.sessionId === activeId ? 'page' : undefined} onClick={() => setActiveId(session.sessionId)}>
                <span className={`shell-glyph ${session.transport === 'local' ? session.shell : session.transport}`} aria-hidden="true">
                  {session.transport === 'local' ? shellMark(session.shell) : session.transport === 'ssh' ? 'SSH'
                    : session.transport === 'sftp' ? 'SFTP' : session.transport === 'telnet' ? 'TELNET' : session.transport === 'serial' ? 'COM'
                      : session.endpoint.secure ? 'FTPS' : 'FTP'}
                </span>
                <span className="session-name" translate="no">{session.title}</span>
                <span className={`state-dot ${session.state}`} aria-label={session.state} />
              </button>
            </li>)}
          </ul>
        </div>}
        <section className="saved-session-group" aria-labelledby="saved-sessions-heading">
          <div className="saved-session-heading"><div className="rail-heading"><h2 id="saved-sessions-heading">Saved sessions</h2><span className="saved-session-count" aria-label={`${savedSessionCount} saved ${savedSessionCount === 1 ? 'session' : 'sessions'}`}>{savedSessionCount}</span></div>
            <button className="saved-folder-create" type="button" disabled={catalogBusy} aria-label="Import a saved session folder" onClick={() => void importSavedFolder()}>Import</button>
            <button className="saved-folder-create" type="button" disabled={catalogBusy} onClick={() => openSavedFolderDialog({ mode: 'create', parentId: null })}>+ Folder</button>
          </div>
          <label className="visually-hidden" htmlFor="saved-session-search">Search saved sessions</label>
          <input className="saved-session-search" id="saved-session-search" type="search" autoComplete="off" maxLength={256}
            placeholder="Search saved sessions…" value={savedSearch} onChange={event => {
              setSavedSessionsLoading(true);
              setSavedSearch(event.target.value);
            }} />
          {savedSessionsLoading && <p className="saved-session-empty" role="status">Loading saved sessions…</p>}
          {!savedSessionsLoading && savedSearch && savedSessions.length === 0 && <p className="saved-session-empty">No saved sessions match this search.</p>}
          {!savedSessionsLoading && !savedSearch && savedSessions.length === 0 && savedFolders.length === 0 && <p className="saved-session-empty">No saved sessions yet.</p>}
          {(!savedSessionsLoading && (savedSessions.length > 0 || savedFolders.length > 0)) && <VirtualizedList
            items={savedCatalogVirtualItems}
            label="Saved sessions and folders"
            className="saved-session-list"
            rowHeight={52}
            threshold={SAVED_SESSION_CATALOG_VIRTUALIZATION_THRESHOLD}
            renderItem={item => item.kind === 'unfiled-header'
              ? <li className="saved-folder-node" key="unfiled">{renderUnfiledFolderHeader()}</li>
              : item.kind === 'folder' ? renderSavedFolder(item.folder, item.depth, false)
                : renderSavedSession(item.session, item.depth)}
            isItemFocusable={item => item.kind !== 'unfiled-header'}
            renderNonVirtualizedRows={() => [
              ...(unfiledSessions.length > 0 ? [renderNestedUnfiledFolder()] : []),
              ...rootFolders.filter(folder => visibleFolderIds.has(folder.id)).map(folder => renderSavedFolder(folder, 0))
            ]} />}
        </section>
        <button className="palette-hint" type="button" onClick={openPalette}>
          <span>Command palette</span><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>P</kbd>
        </button>
      </aside>
      <main className="terminal-workspace" id="workspace" tabIndex={-1} data-opening={openingSessions.length > 0} data-recording={macroRecording !== undefined}
        style={{ gridTemplateRows: ['48px', ...Array.from({ length: Number(openingSessions.length > 0) + Number(startupGreetingVisible && startupGreeting.length > 0) + Number(macroRecording !== undefined) }, () => 'auto'), 'minmax(0, 1fr)'].join(' ') }}>
        <div className="tab-strip">
          <div className="tab-list" role="tablist" aria-label="Sessions">
            {sessions.map((session, index) => <button className={`tab-item ${session.sessionId === activeId ? 'selected' : ''}`} key={session.sessionId}
              type="button" role="tab" id={`tab-${session.sessionId}`} aria-controls={`panel-${session.sessionId}`}
              aria-selected={session.sessionId === activeId} tabIndex={session.sessionId === activeId ? 0 : -1}
              aria-haspopup={session.transport === 'ftp' || session.transport === 'sftp' ? undefined : 'menu'}
              aria-expanded={session.transport !== 'ftp' && session.transport !== 'sftp' && tabContextMenu?.sessionId === session.sessionId}
              onAuxClick={event => { if (event.button === 1) { event.preventDefault(); requestCloseTerminal(session.sessionId); } }}
              onContextMenu={event => { if (session.transport !== 'ftp' && session.transport !== 'sftp') openTerminalTabContextMenu(event, session.sessionId); }}
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
              <span className={`shell-glyph ${session.transport === 'local' ? session.shell : session.transport}`} aria-hidden="true">
                {session.transport === 'local' ? shellMark(session.shell) : session.transport === 'ssh' ? 'SSH'
                  : session.transport === 'sftp' ? 'SFTP' : session.transport === 'telnet' ? 'TELNET' : session.transport === 'serial' ? 'COM'
                    : session.endpoint.secure ? 'FTPS' : 'FTP'}
              </span>
              <span translate="no">{session.title}</span>
              <span className={`state-dot ${session.state}`} aria-hidden="true" />
            </button>
            )}
          </div>
          <div className="tab-actions">
            {active && <button className="tab-close" type="button" aria-label={active.transport === 'ftp' || active.transport === 'sftp' ? 'Close active file session' : 'Close active terminal'}
              onClick={() => requestCloseTerminal(active.sessionId)}>×</button>}
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
        {startupGreetingVisible && startupGreeting.length > 0 && <section className="startup-greeting-banner" aria-label="Startup greeting">
          <div><h2>Welcome</h2><p>{startupGreeting}</p></div>
          <button className="quiet-button" type="button" onClick={() => setStartupGreetingVisible(false)}>Dismiss greeting</button>
        </section>}
        {macroRecording && <section className="macro-recording-banner" aria-label="Macro recording controls">
          <div className="macro-recording-copy">
            <strong>{macroRecording.status === 'saving' ? 'Saving recording' : macroRecording.status === 'stopped' ? `Recording stopped: ${macroRecording.name}` : `${macroRecording.status === 'paused' ? 'Recording paused' : 'Recording'}: ${macroRecording.name}`}</strong>
            <span>{macroRecording.targetTitle} · {macroRecording.stepCount} complete {macroRecording.stepCount === 1 ? 'line' : 'lines'}</span>
            <span>Clipboard paste is omitted. Pausing discards the current line. Only recognized secret prompts are suppressed; review commands for sensitive text.</span>
            {macroRecording.warning && <span className="macro-recording-warning" role="status" aria-live="polite">{macroRecordingWarningText(macroRecording.warning)}</span>}
            {macroRecording.saveError && <span className="macro-recording-warning" role="alert">{macroRecording.saveError}</span>}
          </div>
          <div className="macro-recording-actions">
            {macroRecording.status === 'recording' && <button type="button" onClick={pauseMacroRecording}>Pause recording</button>}
            {macroRecording.status === 'paused' && <button type="button" onClick={resumeMacroRecording}>Resume recording</button>}
            {(macroRecording.status === 'recording' || macroRecording.status === 'paused') && <button className="macro-recording-stop" type="button" onClick={() => stopMacroRecording(macroRecording.sessionId, 'stopped')}>Stop and save</button>}
            {macroRecording.status === 'stopped' && <button className="macro-recording-stop" type="button" onClick={retrySaveMacroRecording}>Retry save</button>}
            {macroRecording.status !== 'saving' && <button type="button" onClick={discardMacroRecording}>Discard</button>}
          </div>
        </section>}
        <div className="terminal-stack">
          {sessions.map(session => <section className="terminal-panel" key={session.sessionId} id={`panel-${session.sessionId}`} role="tabpanel"
            aria-labelledby={`tab-${session.sessionId}`} hidden={session.sessionId !== activeId}>
            {session.transport === 'ftp' || session.transport === 'sftp'
              ? <RemoteFilesPane sessionId={session.sessionId} active={session.sessionId === activeId} transport={session.transport}
                onReconnect={() => session.transport === 'ftp' ? reconnectFtp(session) : reconnectSftp(session)} />
              : <div className={`terminal-panel-layout ${session.transport === 'ssh' && session.state === 'running' ? 'with-remote-files' : ''}`}>
                <div className="terminal-pane-stage">
                  <TerminalPane sessionId={session.sessionId} title={session.title} active={session.sessionId === activeId}
                    transport={session.transport}
                    canWrite={session.state === 'running' && !(macroPlayback?.status === 'running' && macroPlayback.sessionId === session.sessionId) &&
                      !(multiExecView && multiExecView.phase !== 'finished' && multiExecView.targets.some(target => target.sessionId === session.sessionId))}
                    theme={theme} fontSize={fontSize} terminalHighlightEnabled={terminalHighlightEnabled}
                    terminalHighlightRules={terminalHighlightRules} terminalShellSyntaxEnabled={terminalShellSyntaxEnabled} onReady={terminalReady}
                    onInput={recordMacroInput} onOutput={observeMacroOutput} onError={showTerminalError} />
                </div>
                {session.transport === 'ssh' && session.state === 'running' &&
                  <RemoteFilesPane sessionId={session.sessionId} active={session.sessionId === activeId} transport="sftp" />}
              </div>}
          </section>)}
          {sessions.length === 0 && <div className="empty-terminal">
            <span className="empty-mark" aria-hidden="true">›_</span>
            <h2>No terminal is open</h2>
            <p>Open a local terminal, connect to a terminal server, or browse files over FTP or FTPS.</p>
            <button type="button" className="new-terminal" onClick={openPalette}>New local terminal</button>
            <button type="button" className="connect-ssh-button" onClick={() => openSshConnect()}>Connect to SSH</button>
            <button type="button" className="connect-ssh-button" onClick={() => openSerialConnect()}>Connect to serial port</button>
            <button type="button" className="connect-ssh-button" onClick={() => openSshConnect('sftp')}>Connect to SFTP files</button>
            <button type="button" className="connect-ssh-button" onClick={() => openTelnetConnect()}>Connect to Telnet (plaintext)</button>
            <button type="button" className="connect-ssh-button" onClick={() => openFtpConnect()}>Connect to FTP / FTPS files</button>
            <button type="button" className="connect-ssh-button" onClick={() => openRdpConnect()}>Connect to RDP desktop</button>
            <button className="connect-ssh-button" type="button" aria-haspopup="dialog" onClick={() => openVncConnect()}>Connect to VNC desktop</button>
          </div>}
        </div>
      </main>
    </div>
    {alert && <div className="alert-strip" role="alert"><span>{alert}</span><button type="button" aria-label="Dismiss message" onClick={() => setAlert(undefined)}>Dismiss</button></div>}
    {helpOpen && <HelpDialog onClose={closeHelp} />}
    {settingsOpen && <SettingsDialog onClose={closeSettings} onPreferencesSaved={applyWorkbenchPreferences} />}
    <LocalTextEditorDialog open={localTextEditorOpen} file={localTextFile} onClose={closeLocalTextEditor} />
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
    {tabContextMenu && sessions.some(session => session.sessionId === tabContextMenu.sessionId) && <div ref={tabContextMenuElement}
      className="terminal-tab-menu" role="menu" aria-label={`Terminal actions for ${sessions.find(session => session.sessionId === tabContextMenu.sessionId)?.title ?? 'session'}`}
      style={{ left: `${tabContextMenu.x}px`, top: `${tabContextMenu.y}px` }}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          focusNextContextAction(event.key === 'ArrowDown' ? 1 : -1);
        } else if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          const actions = tabContextMenuElement.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
          (event.key === 'Home' ? actions?.[0] : actions?.[actions.length - 1])?.focus();
        }
      }}>
      <button ref={firstTabContextAction} type="button" role="menuitem" onClick={() => void copyTerminalSelection(tabContextMenu.sessionId)}>Copy selection</button>
      <button type="button" role="menuitem" onClick={() => clearTerminalDisplay(tabContextMenu.sessionId)}>Clear terminal</button>
      <button type="button" role="menuitem" onClick={() => {
        const session = sessions.find(candidate => candidate.sessionId === tabContextMenu.sessionId);
        const trigger = tabContextReturnFocus.current;
        closeTerminalTabContextMenu(false);
        requestAnimationFrame(() => {
          if (trigger?.isConnected) trigger.focus();
          if (session) requestCloseTerminal(session.sessionId);
        });
      }}>Close terminal</button>
    </div>}
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
        <h2 id="save-session-heading">{uncertainSaveDraft ? 'Check save status' : 'Save active session'}</h2>
        <p id="save-session-description">{uncertainSaveDraft
          ? 'The previous save may have completed. Check the saved-session list before retrying.'
          : 'Save the session so you can open it again later. Credentials and terminal history are never saved.'}</p>
        <form onSubmit={event => { event.preventDefault(); void saveActiveSession(); }}>
          <label htmlFor="saved-session-name">Session name</label>
          <input ref={saveSessionNameInput} id="saved-session-name" name="name" type="text" autoComplete="off" maxLength={256}
            disabled={Boolean(uncertainSaveDraft)}
            required value={saveSessionName} onChange={event => setSaveSessionName(event.target.value)} />
          {saveSessionError && <p className="dialog-error" role="alert">{saveSessionError}</p>}
          <div className="ssh-connect-actions">
            <button type="button" disabled={catalogBusy} onClick={() => setSaveSessionOpen(false)}>{uncertainSaveDraft ? 'Close' : 'Cancel'}</button>
            {uncertainSaveDraft
              ? <button ref={checkSavedSessionsButton} type="button" className="ssh-primary" disabled={catalogBusy} onClick={() => {
                void checkUncertainSavedSession();
                setSaveSessionOpen(false);
              }}>Check saved sessions</button>
              : <button type="submit" className="ssh-primary" disabled={catalogBusy}>{catalogBusy ? 'Saving...' : 'Save session'}</button>}
          </div>
        </form>
      </section>
    </div>}
    {folderDialog && <div className="ssh-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !catalogBusy) setFolderDialog(undefined); }}>
      <section ref={folderDialogRef} className="ssh-connect-dialog" role="dialog" aria-modal="true"
        aria-labelledby="saved-folder-dialog-heading" aria-describedby="saved-folder-dialog-description">
        <h2 id="saved-folder-dialog-heading">{folderDialog.mode === 'create' ? 'Create folder'
          : folderDialog.mode === 'rename' ? `Rename ${folderDialog.folder.name}`
            : folderDialog.mode === 'move-folder' ? `Move ${folderDialog.folder.name}` : `Move ${folderDialog.session.name}`}</h2>
        <p id="saved-folder-dialog-description">{folderDialog.mode === 'create'
          ? `Create a folder ${folderDialog.parentId ? `inside ${savedFolderById.get(folderDialog.parentId)?.name ?? 'the selected folder'}` : 'at the top level'}. Folder names must be unique within the same parent.`
          : folderDialog.mode === 'rename' ? 'Rename the folder. A folder with the same name cannot already exist at this level.'
            : folderDialog.mode === 'move-folder' ? 'Choose the new parent. A folder cannot be moved into itself or one of its descendants.'
              : 'Choose where this saved session should appear in the sidebar. Credentials and terminal history stay separate.'}</p>
        <form onSubmit={event => { event.preventDefault(); void submitSavedFolderDialog(); }}>
          {(folderDialog.mode === 'create' || folderDialog.mode === 'rename') && <>
            <label htmlFor="saved-folder-name">Folder name</label>
            <input ref={folderNameInput} id="saved-folder-name" name="name" type="text" autoComplete="off" maxLength={256}
              required value={folderNameDraft} onChange={event => setFolderNameDraft(event.target.value)} />
          </>}
          {(folderDialog.mode === 'move-folder' || folderDialog.mode === 'move-session') && <>
            <label htmlFor="saved-folder-parent">{folderDialog.mode === 'move-folder' ? 'Move under' : 'Move to'}</label>
            <select ref={folderParentInput} id="saved-folder-parent" value={folderParentDraft} onChange={event => setFolderParentDraft(event.target.value)}>
              <option value="">{folderDialog.mode === 'move-folder' ? 'Top level' : 'Unfiled'}</option>
              {savedFolders.filter(folder => !excludedMoveTargetIds.has(folder.id))
                .toSorted((left, right) => folderPathLabel(left, savedFolders).localeCompare(folderPathLabel(right, savedFolders)))
                .map(folder => <option key={folder.id} value={folder.id}>{folderPathLabel(folder, savedFolders)}</option>)}
            </select>
          </>}
          {folderDialogError && <p className="dialog-error" role="alert">{folderDialogError}</p>}
          <div className="ssh-connect-actions">
            <button type="button" disabled={catalogBusy} onClick={() => setFolderDialog(undefined)}>Cancel</button>
            <button type="submit" className="ssh-primary" disabled={catalogBusy}>{catalogBusy ? 'Saving…'
              : folderDialog.mode === 'create' ? 'Create folder' : folderDialog.mode === 'rename' ? 'Save name' : 'Move'}</button>
          </div>
        </form>
      </section>
    </div>}
    {sshConnectOpen && <div className="ssh-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) cancelSshConnect(); }}>
      <section ref={sshConnectDialog} className="ssh-connect-dialog" role="dialog" aria-modal="true"
        aria-labelledby="ssh-connect-heading" aria-describedby="ssh-connect-description">
        <h2 id="ssh-connect-heading">{sshGatewayTarget ? `Connect ${sshGatewayTarget.name} through gateways` : sshConnectMode === 'sftp' ? 'Connect to SFTP files' : 'Connect to an SSH server'}</h2>
        <p id="ssh-connect-description">{sshConnectMode === 'sftp'
          ? 'Connect with SSH credentials and verified host identity. This opens the SFTP file browser without starting a remote shell.'
          : sshGatewayTarget
            ? 'Choose one or two saved SSH sessions as gateways. This route applies to this connection only; each gateway and the destination will have its own credential and host verification prompts.'
            : 'Enter the server address. The Windows credential prompt will collect your username and password after you connect.'}</p>
        <form onSubmit={event => { event.preventDefault();
          if (sshConnectMode === 'sftp') void openSftpFiles(sshHost, sshPort, sshSavedTitle);
          else if (sshGatewayTarget) connectThroughSelectedGateways();
          else void openSshTerminal(sshHost, sshPort, sshSavedTitle);
        }}>
          <label htmlFor="ssh-host">Host name or IP address</label>
          <input ref={sshHostInput} id="ssh-host" name="host" type="text" autoComplete="off" spellCheck={false}
            placeholder="server.example.com…" disabled={Boolean(sshGatewayTarget)} value={sshHost} onChange={event => setSshHost(event.target.value)} />
          <label htmlFor="ssh-port">Port</label>
          <input ref={sshPortInput} id="ssh-port" name="port" type="number" inputMode="numeric" min="1" max="65535" step="1"
            disabled={Boolean(sshGatewayTarget)} value={sshPort} onChange={event => setSshPort(event.target.value)} />
          {sshGatewayTarget && <>
            <label htmlFor="ssh-gateway-one">SSH gateway 1</label>
            <select id="ssh-gateway-one" value={sshGatewayOne} onChange={event => { setSshGatewayOne(event.target.value); setSshGatewayTwo(''); }}>
              <option value="">Choose a saved SSH profile</option>
              {sshGatewayProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name} — {sshEndpointLabel(profile.host, profile.port)}</option>)}
            </select>
            <label htmlFor="ssh-gateway-two">SSH gateway 2 (optional)</label>
            <select id="ssh-gateway-two" value={sshGatewayTwo} onChange={event => setSshGatewayTwo(event.target.value)} disabled={!sshGatewayOne}>
              <option value="">No second gateway</option>
              {sshGatewayProfiles.filter(profile => profile.id !== sshGatewayOne && (() => {
                const first = sshGatewayProfiles.find(item => item.id === sshGatewayOne);
                return !first || profile.host !== first.host || profile.port !== first.port;
              })()).map(profile => <option key={profile.id} value={profile.id}>{profile.name} — {sshEndpointLabel(profile.host, profile.port)}</option>)}
            </select>
          </>}
          {sshConnectError && <p className="dialog-error" role="alert">{sshConnectError}</p>}
          <div className="ssh-connect-actions">
            <button type="button" onClick={cancelSshConnect}>Cancel</button>
            <button type="submit" className="ssh-primary" disabled={Boolean(sshGatewayTarget && !sshGatewayOne)}>Connect</button>
          </div>
        </form>
      </section>
    </div>}
    {telnetConnectOpen && <div className="ssh-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setTelnetConnectOpen(false); }}>
      <section ref={telnetConnectDialog} className="ssh-connect-dialog telnet-connect-dialog" role="dialog" aria-modal="true"
        aria-labelledby="telnet-connect-heading" aria-describedby="telnet-connect-description telnet-plaintext-warning">
        <h2 id="telnet-connect-heading">Connect to a Telnet server</h2>
        <p id="telnet-connect-description">Enter the server address. Telnet uses an unencrypted connection and may expose everything you type.</p>
        <div className="telnet-plaintext-warning" id="telnet-plaintext-warning" role="note">
          <strong>Telnet traffic is sent in plaintext.</strong> Do not enter passwords, private keys, or other secrets. Use only on a trusted network.
        </div>
        <form onSubmit={event => { event.preventDefault(); void openTelnetTerminal(telnetHost, telnetPort, telnetSavedTitle); }}>
          <label htmlFor="telnet-host">Host name or IP address</label>
          <input ref={telnetHostInput} id="telnet-host" name="host" type="text" autoComplete="off" spellCheck={false}
            placeholder="server.example.com" value={telnetHost} onChange={event => setTelnetHost(event.target.value)} />
          <label htmlFor="telnet-port">Port</label>
          <input ref={telnetPortInput} id="telnet-port" name="port" type="number" inputMode="numeric" min="1" max="65535" step="1"
            value={telnetPort} onChange={event => setTelnetPort(event.target.value)} />
          {telnetConnectError && <p className="dialog-error" role="alert">{telnetConnectError}</p>}
          <div className="ssh-connect-actions">
            <button type="button" onClick={() => setTelnetConnectOpen(false)}>Cancel</button>
            <button type="submit" className="ssh-primary" data-mrt-telnet-consent-trigger>Connect</button>
          </div>
        </form>
      </section>
    </div>}
    {serialConnectOpen && <div className="ssh-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setSerialConnectOpen(false); }}>
      <section ref={serialConnectDialog} className="ssh-connect-dialog serial-connect-dialog" role="dialog" aria-modal="true"
        aria-labelledby="serial-connect-heading" aria-describedby="serial-connect-description" aria-busy={serialPortsLoading}>
        <h2 id="serial-connect-heading">Connect to a serial port</h2>
        <p id="serial-connect-description">Choose a listed Windows COM port and match its settings to the attached device. Data is displayed as UTF-8 text.</p>
        <form onSubmit={event => { event.preventDefault(); void openSerialTerminal(serialConfigurationDraft, serialSavedTitle); }}>
          <div className="serial-port-toolbar">
            <label htmlFor="serial-port">Port</label>
            <button type="button" onClick={() => void refreshSerialPorts(Boolean(serialSavedTitle))} disabled={serialPortsLoading}>
              {serialPortsLoading ? 'Refreshing…' : 'Refresh ports'}
            </button>
          </div>
          <select id="serial-port" value={serialPorts.some(port => port.path === serialConfigurationDraft.path) ? serialConfigurationDraft.path : ''}
            onChange={event => {
              const path = event.target.value;
              if (path !== serialSavedProfilePath) {
                setSerialSavedTitle(undefined);
                setSerialSavedProfilePath(undefined);
              }
              setSerialConfigurationDraft(current => ({ ...current, path }));
            }}>
            <option value="">{serialPorts.length === 0 ? 'No serial ports found' : 'Choose a serial port'}</option>
            {serialPorts.map(port => <option key={port.path} value={port.path}>
              {port.path}{port.manufacturer ? ` · ${port.manufacturer}` : ''}
            </option>)}
          </select>
          {serialPortsLoading && <p className="serial-port-status" role="status">Looking for serial ports…</p>}
          {!serialPortsLoading && serialPorts.length === 0 && <p className="serial-port-status" role="status">Connect a device, then refresh the port list.</p>}
          {serialSavedTitle && !serialPortsLoading && !serialPorts.some(port => port.path === serialConfigurationDraft.path) &&
            <p className="serial-port-status" role="status">The saved profile uses {serialConfigurationDraft.path}, which is not currently listed. Choose a listed port to connect with these settings.</p>}
          {serialPortsError && <p className="dialog-error" role="alert">{serialPortsError}</p>}
          <div className="serial-options">
            <label htmlFor="serial-baud">Baud rate</label>
            <input id="serial-baud" type="number" inputMode="numeric" min="300" max="2000000" step="1" required
              value={serialConfigurationDraft.baudRate} onChange={event => setSerialConfigurationDraft(current => ({ ...current, baudRate: Number(event.target.value) }))} />
            <label htmlFor="serial-data-bits">Data bits</label>
            <select id="serial-data-bits" value={serialConfigurationDraft.dataBits}
              onChange={event => setSerialConfigurationDraft(current => ({ ...current, dataBits: Number(event.target.value) as SerialConfiguration['dataBits'] }))}>
              {[5, 6, 7, 8].map(bits => <option key={bits} value={bits}>{bits}</option>)}
            </select>
            <label htmlFor="serial-parity">Parity</label>
            <select id="serial-parity" value={serialConfigurationDraft.parity}
              onChange={event => setSerialConfigurationDraft(current => ({ ...current, parity: event.target.value as SerialConfiguration['parity'] }))}>
              {(['none', 'even', 'odd', 'mark', 'space'] as const).map(parity => <option key={parity} value={parity}>{parity[0]?.toUpperCase()}{parity.slice(1)}</option>)}
            </select>
            <label htmlFor="serial-stop-bits">Stop bits</label>
            <select id="serial-stop-bits" value={serialConfigurationDraft.stopBits}
              onChange={event => setSerialConfigurationDraft(current => ({ ...current, stopBits: Number(event.target.value) as SerialConfiguration['stopBits'] }))}>
              {[1, 1.5, 2].map(bits => <option key={bits} value={bits}>{bits}</option>)}
            </select>
            <label htmlFor="serial-flow-control">Flow control</label>
            <select id="serial-flow-control" value={serialConfigurationDraft.flowControl}
              onChange={event => setSerialConfigurationDraft(current => ({ ...current, flowControl: event.target.value as SerialConfiguration['flowControl'] }))}>
              <option value="none">None</option>
              <option value="rtscts">RTS/CTS</option>
              <option value="xonxoff">XON/XOFF</option>
            </select>
          </div>
          <div className="ssh-connect-actions">
            <button type="button" onClick={() => setSerialConnectOpen(false)}>Cancel</button>
            <button type="submit" className="ssh-primary" disabled={serialPortsLoading || !serialPorts.some(port => port.path === serialConfigurationDraft.path) || !normalizeSerialConfiguration(serialConfigurationDraft)}>
              Connect
            </button>
          </div>
        </form>
      </section>
    </div>}
    {ftpConnectOpen && <div className="ssh-backdrop" onMouseDown={event => {
      if (event.target === event.currentTarget && !ftpConnecting) setFtpConnectOpen(false);
    }}>
      <section ref={ftpConnectDialog} className="ssh-connect-dialog" role="dialog" aria-modal="true"
        aria-labelledby="ftp-connect-heading" aria-describedby="ftp-connect-description ftp-security-warning">
        <h2 id="ftp-connect-heading">Connect to FTP or FTPS files</h2>
        <p id="ftp-connect-description">Your username and password are collected in a separate Windows credential prompt. The app never saves them with the session profile.</p>
        <form onSubmit={event => { event.preventDefault(); void openFtpFiles(ftpHost, ftpPort, ftpSecurity === 'ftps', ftpSavedTitle); }}>
          <label htmlFor="ftp-host">Host name or IP address</label>
          <input ref={ftpHostInput} id="ftp-host" name="host" type="text" autoComplete="off" spellCheck={false}
            placeholder="files.example.com" disabled={ftpConnecting} value={ftpHost} onChange={event => setFtpHost(event.target.value)} />
          <label htmlFor="ftp-port">Port</label>
          <input ref={ftpPortInput} id="ftp-port" name="port" type="number" inputMode="numeric" min="1" max="65535" step="1"
            disabled={ftpConnecting} value={ftpPort} onChange={event => setFtpPort(event.target.value)} />
          <label htmlFor="ftp-security">Connection security</label>
          <select id="ftp-security" name="security" disabled={ftpConnecting} value={ftpSecurity}
            onChange={event => setFtpSecurity(event.target.value === 'ftp' ? 'ftp' : 'ftps')}>
            <option value="ftps">FTPS (TLS encrypted)</option>
            <option value="ftp">FTP (no encryption)</option>
          </select>
          {ftpSecurity === 'ftp' ? <div className="telnet-plaintext-warning" id="ftp-security-warning" role="note">
            <strong>FTP sends the username, password, and file contents without encryption.</strong> Connect only on a trusted network. This warning appears before every plain FTP connection.
          </div> : <p id="ftp-security-warning" role="note">FTPS uses TLS with normal certificate validation. The server must support explicit FTPS.</p>}
          {ftpConnectError && <p className="dialog-error" role="alert">{ftpConnectError}</p>}
          {ftpConnecting && <p className="remote-file-status" role="status">Connecting. The Windows credential prompt will open shortly.</p>}
          <div className="ssh-connect-actions">
            <button type="button" disabled={ftpConnecting} onClick={() => setFtpConnectOpen(false)}>Cancel</button>
            <button type="submit" className="ssh-primary" data-mrt-ftp-consent-trigger disabled={ftpConnecting}>
              {ftpConnecting ? 'Connecting...' : 'Connect'}
            </button>
          </div>
        </form>
      </section>
    </div>}
    {rdpConnectOpen && <RdpConnectDialog dialogRef={rdpConnectDialog} initialHost={rdpHost} initialPort={rdpPort}
      {...(rdpSavedProfileName ? { savedProfileName: rdpSavedProfileName } : {})}
      onClose={() => setRdpConnectOpen(false)} onLaunch={launchRdpViewer} onSaveProfile={saveRdpProfile} />}
    {vncConnectOpen && <VncConnectDialog dialogRef={vncConnectDialog} initialHost={vncHost} initialPort={vncPort}
      {...(vncSavedProfileName ? { savedProfileName: vncSavedProfileName } : {})}
      onClose={() => setVncConnectOpen(false)} onLaunch={launchVncViewer} onSaveProfile={saveVncProfile} />}
    {tunnelManagerOpen && <TunnelManagerDialog dialogRef={tunnelManagerDialog} profiles={tunnelProfiles} tunnels={tunnels}
      loading={tunnelsLoading} busyId={tunnelBusyId} error={tunnelError} onClose={closeTunnelManager} onSave={saveSshTunnel}
      onDelete={id => { void deleteTunnel(id); }} onStart={id => { void startTunnel(id); }} onStop={id => { void stopTunnel(id); }} />}
    {macroManagerOpen && <MacroManagerDialog dialogRef={macroManagerDialog} macros={macros} shortcuts={macroShortcuts} loading={macrosLoading} busy={macroBusy} error={macroError}
      activeSessionId={activeId}
      recordingTargets={sessions.filter(isMacroTerminal).filter(session => session.state === 'running').map(session => ({ sessionId: session.sessionId, title: macroTargetTitle(session) }))}
      recordingActive={macroRecording !== undefined} playbackMacroId={macroPlaybackMacroId} playback={macroPlayback}
      shortcutCaptureMacroId={macroShortcutCaptureMacroId} shortcutNotice={macroShortcutNotice}
      onClose={closeMacroManager} onSave={saveMacro} onDelete={deleteMacro} onStartRecording={startMacroRecording}
      onReviewPlayback={reviewMacroPlayback} onClosePlayback={closeMacroPlayback} onStartPlayback={startMacroPlayback}
      onCancelPlayback={cancelMacroPlayback} onConfirmPlayback={confirmMacroPlayback} onCaptureShortcut={beginMacroShortcutCapture}
      onCancelShortcutCapture={cancelMacroShortcutCapture} onClearShortcut={id => { void clearMacroShortcut(id); }} />}
    {multiExecOpen && <MultiExecDialog dialogRef={multiExecDialog} targets={multiExecTargets} view={multiExecView}
      blockedReason={multiExecBlockedReason} onClose={closeMultiExec} onReview={reviewMultiExec}
      onConfirm={confirmMultiExec} onCancel={cancelMultiExec} />}
    {currentSshTrust && <div className="ssh-backdrop ssh-trust-backdrop" onMouseDown={event => {
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
        <p id="close-description">{pendingClose.transport === 'ftp' ? 'Closing this file session disconnects from the FTP server.'
          : pendingClose.transport === 'sftp' ? 'Closing this file session disconnects from the SSH server.'
            : 'Closing this terminal stops its shell process and any command running in it.'}</p>
        <div className="close-actions">
          <button ref={keepTerminalButton} type="button" onClick={() => setPendingCloseId(undefined)}>{pendingClose.transport === 'ftp' || pendingClose.transport === 'sftp' ? 'Keep session' : 'Keep terminal'}</button>
          <button type="button" className="confirm-close" onClick={confirmCloseTerminal}>{pendingClose.transport === 'ftp' || pendingClose.transport === 'sftp' ? 'Close session' : 'Close terminal'}</button>
        </div>
      </section>
    </div>}
  </div>;
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(<Workbench />);
