import type { AppError, ErrorCode, Outcome } from '../../domain/src/errors.ts';
import { failure } from '../../domain/src/errors.ts';
import { isLocalShell, MAX_TERMINAL_COLUMNS, MAX_TERMINAL_INPUT_CHARS, MAX_TERMINAL_ROWS } from '../../domain/src/local-terminal.ts';
import type { LocalShell } from '../../domain/src/local-terminal.ts';
import type { LocalTerminalEvent, LocalTerminalSession } from '../../application/src/local-terminals.ts';
import type { RdpLaunchResult } from '../../application/src/rdp-viewer.ts';
import type { VncLaunchResult } from '../../application/src/vnc-viewer.ts';
import type { SshTerminalSession, SshTrustEvent } from '../../application/src/ssh-terminals.ts';
import type { TelnetTerminalSession } from '../../application/src/telnet-terminals.ts';
import type { FtpFilesSession } from '../../application/src/ftp-files.ts';
import type { WorkbenchSnapshot } from '../../application/src/workbench.ts';
import { canonicalizeSshHostEndpoint } from '../../domain/src/host-trust.ts';
import { canonicalizeRemoteEndpoint } from '../../domain/src/remote-endpoint.ts';
import { canonicalizeRdpEndpoint } from '../../domain/src/rdp.ts';
import { canonicalizeVncEndpoint } from '../../domain/src/vnc.ts';
import { canonicalizeFtpEndpoint, isFtpTransferProgress, isFtpTransferResult } from '../../domain/src/ftp.ts';
import { isCanonicalFtpEndpoint } from '../../domain/src/ftp.ts';
import { isFtpDirectoryListing, isFtpRemotePath } from '../../domain/src/ftp.ts';
import type { FtpTransferProgress, FtpTransferResult } from '../../domain/src/ftp.ts';
import { isSavedSessionDefinition, isSessionDefinitionId, normalizeSavedSessionDraft, normalizeSessionSearch } from '../../domain/src/session-definition.ts';
import type { SavedSessionDefinition, SavedSessionDraft } from '../../domain/src/session-definition.ts';
import { isSessionFolderId } from '../../domain/src/session-definition.ts';
import { isSavedSessionFolder, normalizeSessionFolderDraft, normalizeSessionFolderName } from '../../domain/src/session-folder.ts';
import type { SavedSessionFolder, SavedSessionFolderDraft } from '../../domain/src/session-folder.ts';
import type { SessionFolderExportResult, SessionFolderImportResult } from '../../domain/src/session-folder-bundle.ts';
import { isRemoteDirectoryListing, isRemotePath } from '../../domain/src/remote-files.ts';
import type { RemoteDirectoryListing } from '../../domain/src/remote-files.ts';
import { isFileTransferProgress, isFileTransferResult } from '../../domain/src/file-transfer.ts';
import type { FileTransferProgress, FileTransferResult } from '../../domain/src/file-transfer.ts';
import { isRemoteTextFile, isRemoteTextFileSaveResult, isRemoteTextRevision, remoteTextByteLength } from '../../domain/src/remote-text-file.ts';
import type { RemoteTextFile, RemoteTextFileSaveResult } from '../../domain/src/remote-text-file.ts';
import { isSshTunnelDefinition, isTunnelId, isTunnelRunStatus, normalizeSshTunnelDraft } from '../../domain/src/ssh-tunnel.ts';
import type { SshTunnelDefinition, SshTunnelDraft, TunnelRunStatus } from '../../domain/src/ssh-tunnel.ts';
import { isSshGatewayProfileIds } from '../../domain/src/ssh-route.ts';
import type { SshTunnelSnapshot } from '../../application/src/ssh-tunnels.ts';
import { isMacroId, isMacroDefinition, normalizeMacroDraft } from '../../domain/src/macro.ts';
import type { MacroDefinition, MacroDraft } from '../../domain/src/macro.ts';
import { isMacroShortcutBinding, isMacroShortcutCode } from '../../domain/src/macro-shortcut.ts';
import type { MacroShortcutBinding, MacroShortcutCode } from '../../domain/src/macro-shortcut.ts';
import { isWorkbenchPreferences, normalizeWorkbenchPreferences } from '../../domain/src/workbench-preferences.ts';
import type { WorkbenchPreferences } from '../../domain/src/workbench-preferences.ts';

export const CONTRACT_VERSION = 1;
export const COMMAND_CHANNEL = 'mrt:command:v1';
export const CANCEL_CATALOG_COMMAND_CHANNEL = 'mrt:cancel-catalog:v1';
export const PASTE_GESTURE_CHANNEL = 'mrt:paste-gesture:v1';
export const TELNET_CONSENT_GESTURE_CHANNEL = 'mrt:telnet-consent-gesture:v1';
export const FTP_CONSENT_GESTURE_CHANNEL = 'mrt:ftp-consent-gesture:v1';
export const RDP_LAUNCH_GESTURE_CHANNEL = 'mrt:rdp-launch-gesture:v1';
export const VNC_LAUNCH_GESTURE_CHANNEL = 'mrt:vnc-launch-gesture:v1';
export const FTP_TRANSFER_EVENT_CHANNEL = 'mrt:ftp-transfer-event:v1';
export const SSH_TRANSFER_EVENT_CHANNEL = 'mrt:ssh-transfer-event:v1';
export const TERMINAL_EVENT_CHANNEL = 'mrt:terminal-event:v1';
export const SSH_TRUST_EVENT_CHANNEL = 'mrt:ssh-trust-event:v1';
export const TUNNEL_STATUS_EVENT_CHANNEL = 'mrt:tunnel-status-event:v1';
export const APP_URL = 'mrt://app/index.html';

export function isAppDocument(value: string): boolean {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.href === APP_URL;
  } catch { return false; }
}

export function parseCatalogCancellationRequest(value: unknown, context: {
  readonly ownerWindow: boolean;
  readonly mainFrame: boolean;
  readonly url: string;
}): string | undefined {
  if (!context.ownerWindow || !context.mainFrame || !isAppDocument(context.url) || !record(value) || !exactKeys(value, ['requestId'])) return undefined;
  const requestId = requestIdOf(value);
  return requestId || undefined;
}

interface Request<C extends string, P extends Record<string, unknown>> {
  readonly command: C;
  readonly requestId: string;
  readonly contractVersion: 1;
  readonly payload: P;
}

export type DescribeRequest = Request<'app.describe', Record<string, never>>;
export type OpenTerminalRequest = Request<'terminal.open', { readonly sessionId: string; readonly shell: LocalShell; readonly columns: number; readonly rows: number }>;
export type WriteTerminalRequest = Request<'terminal.write', { readonly sessionId: string; readonly data: string }>;
export type PasteTerminalRequest = Request<'terminal.paste', { readonly sessionId: string }>;
export type ResizeTerminalRequest = Request<'terminal.resize', { readonly sessionId: string; readonly columns: number; readonly rows: number }>;
export type AcknowledgeTerminalRequest = Request<'terminal.ack', { readonly sessionId: string; readonly sequence: number }>;
export type CloseTerminalRequest = Request<'terminal.close', { readonly sessionId: string }>;
export type OpenSshTerminalRequest = Request<'ssh.open', { readonly sessionId: string; readonly host: string; readonly port: number; readonly columns: number; readonly rows: number;
  readonly gatewayProfileIds?: readonly string[] }>;
export type OpenSftpFilesRequest = Request<'sftp.open', { readonly sessionId: string; readonly host: string; readonly port: number }>;
export type CloseSftpFilesRequest = Request<'sftp.close', { readonly sessionId: string }>;
export type WriteSshTerminalRequest = Request<'ssh.write', { readonly sessionId: string; readonly data: string }>;
export type PasteSshTerminalRequest = Request<'ssh.paste', { readonly sessionId: string }>;
export type ResizeSshTerminalRequest = Request<'ssh.resize', { readonly sessionId: string; readonly columns: number; readonly rows: number }>;
export type AcknowledgeSshTerminalRequest = Request<'ssh.ack', { readonly sessionId: string; readonly sequence: number }>;
export type CloseSshTerminalRequest = Request<'ssh.close', { readonly sessionId: string }>;
export type OpenTelnetTerminalRequest = Request<'telnet.open', { readonly sessionId: string; readonly host: string; readonly port: number; readonly columns: number; readonly rows: number }>;
export type WriteTelnetTerminalRequest = Request<'telnet.write', { readonly sessionId: string; readonly data: string }>;
export type PasteTelnetTerminalRequest = Request<'telnet.paste', { readonly sessionId: string }>;
export type ResizeTelnetTerminalRequest = Request<'telnet.resize', { readonly sessionId: string; readonly columns: number; readonly rows: number }>;
export type AcknowledgeTelnetTerminalRequest = Request<'telnet.ack', { readonly sessionId: string; readonly sequence: number }>;
export type CloseTelnetTerminalRequest = Request<'telnet.close', { readonly sessionId: string }>;
export type DecideSshHostRequest = Request<'ssh.host.approve' | 'ssh.host.reject', { readonly token: string }>;
export type RevokeSshHostRequest = Request<'ssh.host.revoke', { readonly host: string; readonly port: number }>;
export type ListSshDirectoryRequest = Request<'ssh.files.list', { readonly sessionId: string; readonly path: string }>;
export type UploadSshFileRequest = Request<'ssh.files.upload', { readonly sessionId: string; readonly operationId: string; readonly remoteDirectory: string }>;
export type DownloadSshFileRequest = Request<'ssh.files.download', { readonly sessionId: string; readonly operationId: string; readonly remotePath: string }>;
export type ReadSshTextFileRequest = Request<'ssh.files.read-text', { readonly sessionId: string; readonly operationId: string; readonly remotePath: string }>;
export type SaveSshTextFileRequest = Request<'ssh.files.write-text', { readonly sessionId: string; readonly operationId: string; readonly remotePath: string;
  readonly content: string; readonly expectedRevision: string }>;
export type CancelSshTransferRequest = Request<'ssh.files.cancel', { readonly sessionId: string; readonly operationId: string }>;
export type OpenFtpFilesRequest = Request<'ftp.open', { readonly sessionId: string; readonly host: string; readonly port: number; readonly secure: boolean }>;
export type ListFtpDirectoryRequest = Request<'ftp.files.list', { readonly sessionId: string; readonly path: string }>;
export type UploadFtpFileRequest = Request<'ftp.files.upload', { readonly sessionId: string; readonly operationId: string; readonly remoteDirectory: string }>;
export type DownloadFtpFileRequest = Request<'ftp.files.download', { readonly sessionId: string; readonly operationId: string; readonly remotePath: string }>;
export type CancelFtpTransferRequest = Request<'ftp.files.cancel', { readonly sessionId: string; readonly operationId: string }>;
export type CloseFtpFilesRequest = Request<'ftp.close', { readonly sessionId: string }>;
export type LaunchRdpViewerRequest = Request<'rdp.launch', { readonly host: string; readonly port: number }>;
export type LaunchVncViewerRequest = Request<'vnc.launch', { readonly host: string; readonly port: number }>;
export type ListSessionsRequest = Request<'session.list', { readonly query: string }>;
export type CreateSessionRequest = Request<'session.create', SavedSessionDraft>;
export type SetSessionFavoriteRequest = Request<'session.favorite', { readonly id: string; readonly favorite: boolean }>;
export type DeleteSessionRequest = Request<'session.delete', { readonly id: string }>;
export type ListSessionFoldersRequest = Request<'session.folder.list', Record<string, never>>;
export type CreateSessionFolderRequest = Request<'session.folder.create', { readonly parentId: string | null; readonly name: string }>;
export type RenameSessionFolderRequest = Request<'session.folder.rename', { readonly id: string; readonly name: string }>;
export type MoveSessionFolderRequest = Request<'session.folder.move', { readonly id: string; readonly parentId: string | null }>;
export type DeleteSessionFolderRequest = Request<'session.folder.delete', { readonly id: string }>;
export type ExportSessionFolderRequest = Request<'session.folder.export', { readonly id: string }>;
export type ImportSessionFolderRequest = Request<'session.folder.import', Record<string, never>>;
export type MoveSessionRequest = Request<'session.move', { readonly id: string; readonly folderId: string | null }>;
export type ListSshTunnelsRequest = Request<'tunnel.list', Record<string, never>>;
export type SaveSshTunnelRequest = Request<'tunnel.save', { readonly id?: string; readonly sessionId: string; readonly name: string;
  readonly mode: 'local' | 'remote'; readonly bindHost: '127.0.0.1'; readonly bindPort: number; readonly targetHost: string; readonly targetPort: number } |
  { readonly id?: string; readonly sessionId: string; readonly name: string; readonly mode: 'dynamic'; readonly bindHost: '127.0.0.1'; readonly bindPort: number }>;
export type DeleteSshTunnelRequest = Request<'tunnel.delete', { readonly id: string }>;
export type StartSshTunnelRequest = Request<'tunnel.start', { readonly id: string }>;
export type StopSshTunnelRequest = Request<'tunnel.stop', { readonly id: string }>;
export type ListMacrosRequest = Request<'macro.list', Record<string, never>>;
export type CreateMacroRequest = Request<'macro.create', { readonly name: string; readonly description?: string; readonly steps: MacroDraft['steps'] }>;
export type UpdateMacroRequest = Request<'macro.update', { readonly id: string; readonly name: string; readonly description?: string; readonly steps: MacroDraft['steps'] }>;
export type DeleteMacroRequest = Request<'macro.delete', { readonly id: string }>;
export type ListMacroShortcutsRequest = Request<'macro.shortcut.list', Record<string, never>>;
export type SetMacroShortcutRequest = Request<'macro.shortcut.set', { readonly macroId: string; readonly code: MacroShortcutCode }>;
export type DeleteMacroShortcutRequest = Request<'macro.shortcut.delete', { readonly macroId: string }>;
export type GetWorkbenchPreferencesRequest = Request<'preferences.get', Record<string, never>>;
export type SaveWorkbenchPreferencesRequest = Request<'preferences.save', { readonly preferences: WorkbenchPreferences }>;
export type CommandRequest = DescribeRequest | OpenTerminalRequest | WriteTerminalRequest | PasteTerminalRequest | ResizeTerminalRequest | AcknowledgeTerminalRequest | CloseTerminalRequest |
  OpenSshTerminalRequest | OpenSftpFilesRequest | CloseSftpFilesRequest | WriteSshTerminalRequest | PasteSshTerminalRequest | ResizeSshTerminalRequest | AcknowledgeSshTerminalRequest | CloseSshTerminalRequest | DecideSshHostRequest | RevokeSshHostRequest | ListSshDirectoryRequest |
  UploadSshFileRequest | DownloadSshFileRequest | ReadSshTextFileRequest | SaveSshTextFileRequest | CancelSshTransferRequest |
  OpenTelnetTerminalRequest | WriteTelnetTerminalRequest | PasteTelnetTerminalRequest | ResizeTelnetTerminalRequest | AcknowledgeTelnetTerminalRequest | CloseTelnetTerminalRequest |
  OpenFtpFilesRequest | ListFtpDirectoryRequest | UploadFtpFileRequest | DownloadFtpFileRequest | CancelFtpTransferRequest | CloseFtpFilesRequest |
  LaunchRdpViewerRequest | LaunchVncViewerRequest |
  ListSessionsRequest | CreateSessionRequest | SetSessionFavoriteRequest | DeleteSessionRequest | ListSessionFoldersRequest | CreateSessionFolderRequest |
  RenameSessionFolderRequest | MoveSessionFolderRequest | DeleteSessionFolderRequest | ExportSessionFolderRequest | ImportSessionFolderRequest | MoveSessionRequest |
  ListSshTunnelsRequest | SaveSshTunnelRequest | DeleteSshTunnelRequest | StartSshTunnelRequest | StopSshTunnelRequest |
  ListMacrosRequest | CreateMacroRequest | UpdateMacroRequest | DeleteMacroRequest | ListMacroShortcutsRequest | SetMacroShortcutRequest | DeleteMacroShortcutRequest |
  GetWorkbenchPreferencesRequest | SaveWorkbenchPreferencesRequest;

export type CommandReply<T> = Outcome<T> & { readonly requestId: string };
export type DescribeReply = CommandReply<WorkbenchSnapshot>;
export type OpenTerminalResult = Pick<LocalTerminalSession, 'sessionId' | 'shell' | 'state'>;
export type OpenSshTerminalResult = Pick<SshTerminalSession, 'sessionId' | 'endpoint' | 'state'>;
export type OpenTelnetTerminalResult = Pick<TelnetTerminalSession, 'sessionId' | 'endpoint' | 'state'>;
export type OpenTerminalReply = CommandReply<OpenTerminalResult>;
export type OpenSshTerminalReply = CommandReply<OpenSshTerminalResult>;
export type OpenSftpFilesReply = CommandReply<OpenSshTerminalResult>;
export type OpenTelnetTerminalReply = CommandReply<OpenTelnetTerminalResult>;
export type ListSshDirectoryReply = CommandReply<RemoteDirectoryListing>;
export type SshTransferReply = CommandReply<FileTransferResult>;
export type SshTextFileReply = CommandReply<RemoteTextFile>;
export type SshTextFileSaveReply = CommandReply<RemoteTextFileSaveResult>;
export type OpenFtpFilesReply = CommandReply<FtpFilesSession>;
export type ListFtpDirectoryReply = CommandReply<RemoteDirectoryListing>;
export type FtpTransferReply = CommandReply<FtpTransferResult>;
export type LaunchRdpViewerReply = CommandReply<RdpLaunchResult>;
export type LaunchVncViewerReply = CommandReply<VncLaunchResult>;
export type ListSessionsReply = CommandReply<readonly SavedSessionDefinition[]>;
export type CreateSessionReply = CommandReply<SavedSessionDefinition>;
export type ListSessionFoldersReply = CommandReply<readonly SavedSessionFolder[]>;
export type CreateSessionFolderReply = CommandReply<SavedSessionFolder>;
export type ExportSessionFolderReply = CommandReply<SessionFolderExportResult>;
export type ImportSessionFolderReply = CommandReply<SessionFolderImportResult>;
export type ListSshTunnelsReply = CommandReply<readonly SshTunnelSnapshot[]>;
export type SaveSshTunnelReply = CommandReply<SshTunnelDefinition>;
export type TunnelStatusReply = CommandReply<TunnelRunStatus>;
export type ListMacrosReply = CommandReply<readonly MacroDefinition[]>;
export type MacroDefinitionReply = CommandReply<MacroDefinition>;
export type ListMacroShortcutsReply = CommandReply<readonly MacroShortcutBinding[]>;
export type MacroShortcutReply = CommandReply<MacroShortcutBinding>;
export type WorkbenchPreferencesReply = CommandReply<WorkbenchPreferences>;
export type TerminalActionReply = CommandReply<Record<string, never>>;

export interface DesktopBridge {
  describe(): Promise<DescribeReply>;
  openTerminal(sessionId: string, shell: LocalShell, columns: number, rows: number): Promise<OpenTerminalReply>;
  writeTerminal(sessionId: string, data: string): Promise<TerminalActionReply>;
  pasteTerminal(sessionId: string): Promise<TerminalActionReply>;
  resizeTerminal(sessionId: string, columns: number, rows: number): Promise<TerminalActionReply>;
  acknowledgeTerminalOutput(sessionId: string, sequence: number): Promise<TerminalActionReply>;
  closeTerminal(sessionId: string): Promise<TerminalActionReply>;
  openSshTerminal(sessionId: string, host: string, port: number, columns: number, rows: number,
    gatewayProfileIds?: readonly string[]): Promise<OpenSshTerminalReply>;
  openSftpFiles(sessionId: string, host: string, port: number): Promise<OpenSftpFilesReply>;
  writeSshTerminal(sessionId: string, data: string): Promise<TerminalActionReply>;
  pasteSshTerminal(sessionId: string): Promise<TerminalActionReply>;
  resizeSshTerminal(sessionId: string, columns: number, rows: number): Promise<TerminalActionReply>;
  acknowledgeSshTerminalOutput(sessionId: string, sequence: number): Promise<TerminalActionReply>;
  closeSshTerminal(sessionId: string): Promise<TerminalActionReply>;
  closeSftpFiles(sessionId: string): Promise<TerminalActionReply>;
  openTelnetTerminal(sessionId: string, host: string, port: number, columns: number, rows: number): Promise<OpenTelnetTerminalReply>;
  writeTelnetTerminal(sessionId: string, data: string): Promise<TerminalActionReply>;
  pasteTelnetTerminal(sessionId: string): Promise<TerminalActionReply>;
  resizeTelnetTerminal(sessionId: string, columns: number, rows: number): Promise<TerminalActionReply>;
  acknowledgeTelnetTerminalOutput(sessionId: string, sequence: number): Promise<TerminalActionReply>;
  closeTelnetTerminal(sessionId: string): Promise<TerminalActionReply>;
  approveSshHost(token: string): Promise<TerminalActionReply>;
  rejectSshHost(token: string): Promise<TerminalActionReply>;
  revokeSshHost(host: string, port: number): Promise<TerminalActionReply>;
  listSshDirectory(sessionId: string, path: string): Promise<ListSshDirectoryReply>;
  uploadSshFile(sessionId: string, operationId: string, remoteDirectory: string): Promise<SshTransferReply>;
  downloadSshFile(sessionId: string, operationId: string, remotePath: string): Promise<SshTransferReply>;
  readSshTextFile(sessionId: string, operationId: string, remotePath: string): Promise<SshTextFileReply>;
  saveSshTextFile(sessionId: string, operationId: string, remotePath: string, content: string, expectedRevision: string): Promise<SshTextFileSaveReply>;
  cancelSshTransfer(sessionId: string, operationId: string): Promise<TerminalActionReply>;
  openFtpFiles(sessionId: string, host: string, port: number, secure: boolean): Promise<OpenFtpFilesReply>;
  listFtpDirectory(sessionId: string, path: string): Promise<ListFtpDirectoryReply>;
  uploadFtpFile(sessionId: string, operationId: string, remoteDirectory: string): Promise<FtpTransferReply>;
  downloadFtpFile(sessionId: string, operationId: string, remotePath: string): Promise<FtpTransferReply>;
  cancelFtpTransfer(sessionId: string, operationId: string): Promise<TerminalActionReply>;
  closeFtpFiles(sessionId: string): Promise<TerminalActionReply>;
  launchRdpViewer(host: string, port: number): Promise<LaunchRdpViewerReply>;
  launchVncViewer(host: string, port: number): Promise<LaunchVncViewerReply>;
  listSavedSessions(query: string): Promise<ListSessionsReply>;
  createSavedSession(draft: SavedSessionDraft): Promise<CreateSessionReply>;
  setSavedSessionFavorite(id: string, favorite: boolean): Promise<TerminalActionReply>;
  deleteSavedSession(id: string): Promise<TerminalActionReply>;
  listSavedSessionFolders(): Promise<ListSessionFoldersReply>;
  createSavedSessionFolder(draft: SavedSessionFolderDraft): Promise<CreateSessionFolderReply>;
  renameSavedSessionFolder(id: string, name: string): Promise<TerminalActionReply>;
  moveSavedSessionFolder(id: string, parentId: string | null): Promise<TerminalActionReply>;
  deleteSavedSessionFolder(id: string): Promise<TerminalActionReply>;
  exportSavedSessionFolder(id: string): Promise<ExportSessionFolderReply>;
  importSavedSessionFolder(): Promise<ImportSessionFolderReply>;
  moveSavedSession(id: string, folderId: string | null): Promise<TerminalActionReply>;
  listSshTunnels(): Promise<ListSshTunnelsReply>;
  saveSshTunnel(draft: SshTunnelDraft): Promise<SaveSshTunnelReply>;
  deleteTunnel(id: string): Promise<TerminalActionReply>;
  startTunnel(id: string): Promise<TunnelStatusReply>;
  stopTunnel(id: string): Promise<TunnelStatusReply>;
  listMacros(): Promise<ListMacrosReply>;
  createMacro(draft: MacroDraft): Promise<MacroDefinitionReply>;
  updateMacro(id: string, draft: MacroDraft): Promise<MacroDefinitionReply>;
  deleteMacro(id: string): Promise<TerminalActionReply>;
  listMacroShortcuts(): Promise<ListMacroShortcutsReply>;
  setMacroShortcut(macroId: string, code: MacroShortcutCode): Promise<MacroShortcutReply>;
  deleteMacroShortcut(macroId: string): Promise<TerminalActionReply>;
  getWorkbenchPreferences(): Promise<WorkbenchPreferencesReply>;
  saveWorkbenchPreferences(preferences: WorkbenchPreferences): Promise<WorkbenchPreferencesReply>;
  onTerminalEvent(listener: (event: LocalTerminalEvent) => void): () => void;
  onSshTrustEvent(listener: (event: SshTrustEvent) => void): () => void;
  onTunnelStatus(listener: (status: TunnelRunStatus) => void): () => void;
  onFtpTransferProgress(listener: (event: FtpTransferProgress) => void): () => void;
  onSshTransferProgress(listener: (event: FileTransferProgress) => void): () => void;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRUST_TOKEN = /^[A-Za-z0-9_-]{16,256}$/;
const ERROR_CODES: readonly ErrorCode[] = ['INVALID_REQUEST', 'UNKNOWN_COMMAND', 'FORBIDDEN', 'UNAVAILABLE', 'NOT_SUPPORTED', 'TIMEOUT', 'BUSY', 'NOT_FOUND', 'CONFLICT', 'CORRUPT', 'CANCELLED', 'OUTPUT_LIMIT',
  'AUTHENTICATION_FAILED', 'HOST_KEY_REJECTED', 'HOST_KEY_CHANGED'];

export function parsePasteGestureRequest(value: unknown): string | undefined {
  return record(value) && exactKeys(value, ['sessionId']) && typeof value.sessionId === 'string' && UUID.test(value.sessionId)
    ? value.sessionId : undefined;
}

export const parseTelnetConsentGestureRequest = parsePasteGestureRequest;
export const parseFtpConsentGestureRequest = parsePasteGestureRequest;

export function parseRdpLaunchGestureRequest(value: unknown): { readonly host: string; readonly port: number } | undefined {
  if (!record(value) || !exactKeys(value, ['host', 'port'])) return undefined;
  return canonicalizeRdpEndpoint(value);
}

export function parseVncLaunchGestureRequest(value: unknown): { readonly host: string; readonly port: number } | undefined {
  if (!record(value) || !exactKeys(value, ['host', 'port'])) return undefined;
  return canonicalizeVncEndpoint(value);
}

function validSize(columns: unknown, rows: unknown): boolean {
  return Number.isInteger(columns) && (columns as number) >= 2 && (columns as number) <= MAX_TERMINAL_COLUMNS &&
    Number.isInteger(rows) && (rows as number) >= 1 && (rows as number) <= MAX_TERMINAL_ROWS;
}

export function requestIdOf(value: unknown): string {
  return record(value) && typeof value.requestId === 'string' && UUID.test(value.requestId) ? value.requestId : '';
}

export function parseRequest(value: unknown): Outcome<CommandRequest> {
  if (!record(value) || !exactKeys(value, ['command', 'requestId', 'contractVersion', 'payload']) || requestIdOf(value) === '' ||
      value.contractVersion !== CONTRACT_VERSION || !record(value.payload)) return failure('INVALID_REQUEST');
  const payload = value.payload;
  if (value.command === 'app.describe' && exactKeys(payload, [])) return { ok: true, result: value as unknown as DescribeRequest };
  if (value.command === 'terminal.open' && exactKeys(payload, ['sessionId', 'shell', 'columns', 'rows']) &&
      typeof payload.sessionId === 'string' && UUID.test(payload.sessionId) && isLocalShell(payload.shell) && validSize(payload.columns, payload.rows)) {
    return { ok: true, result: value as unknown as OpenTerminalRequest };
  }
  if (value.command === 'terminal.write' && exactKeys(payload, ['sessionId', 'data']) && typeof payload.sessionId === 'string' && UUID.test(payload.sessionId) &&
      typeof payload.data === 'string' && payload.data.length <= MAX_TERMINAL_INPUT_CHARS) return { ok: true, result: value as unknown as WriteTerminalRequest };
  if (value.command === 'terminal.paste' && exactKeys(payload, ['sessionId']) && typeof payload.sessionId === 'string' && UUID.test(payload.sessionId)) {
    return { ok: true, result: value as unknown as PasteTerminalRequest };
  }
  if (value.command === 'terminal.resize' && exactKeys(payload, ['sessionId', 'columns', 'rows']) && typeof payload.sessionId === 'string' && UUID.test(payload.sessionId) &&
      validSize(payload.columns, payload.rows)) return { ok: true, result: value as unknown as ResizeTerminalRequest };
  if (value.command === 'terminal.ack' && exactKeys(payload, ['sessionId', 'sequence']) && typeof payload.sessionId === 'string' && UUID.test(payload.sessionId) &&
      Number.isSafeInteger(payload.sequence) && (payload.sequence as number) > 0) return { ok: true, result: value as unknown as AcknowledgeTerminalRequest };
  if (value.command === 'terminal.close' && exactKeys(payload, ['sessionId']) && typeof payload.sessionId === 'string' && UUID.test(payload.sessionId)) {
    return { ok: true, result: value as unknown as CloseTerminalRequest };
  }
  if (value.command === 'ssh.open' && (exactKeys(payload, ['sessionId', 'host', 'port', 'columns', 'rows']) ||
      (exactKeys(payload, ['sessionId', 'host', 'port', 'columns', 'rows', 'gatewayProfileIds']) && isSshGatewayProfileIds(payload.gatewayProfileIds))) &&
      typeof payload.sessionId === 'string' && UUID.test(payload.sessionId) && typeof payload.host === 'string' && Number.isInteger(payload.port) &&
      canonicalizeSshHostEndpoint({ host: payload.host, port: payload.port }) !== undefined && validSize(payload.columns, payload.rows)) {
    return { ok: true, result: value as unknown as OpenSshTerminalRequest };
  }
  if (value.command === 'sftp.open' && exactKeys(payload, ['sessionId', 'host', 'port']) &&
      typeof payload.sessionId === 'string' && UUID.test(payload.sessionId) && typeof payload.host === 'string' && Number.isInteger(payload.port) &&
      canonicalizeSshHostEndpoint({ host: payload.host, port: payload.port }) !== undefined) {
    return { ok: true, result: value as unknown as OpenSftpFilesRequest };
  }
  if (value.command === 'sftp.close' && exactKeys(payload, ['sessionId']) && typeof payload.sessionId === 'string' && UUID.test(payload.sessionId)) {
    return { ok: true, result: value as unknown as CloseSftpFilesRequest };
  }
  if (value.command === 'ssh.write' && exactKeys(payload, ['sessionId', 'data']) && typeof payload.sessionId === 'string' && UUID.test(payload.sessionId) &&
      typeof payload.data === 'string' && payload.data.length <= MAX_TERMINAL_INPUT_CHARS) return { ok: true, result: value as unknown as WriteSshTerminalRequest };
  if (value.command === 'ssh.paste' && exactKeys(payload, ['sessionId']) && typeof payload.sessionId === 'string' && UUID.test(payload.sessionId)) {
    return { ok: true, result: value as unknown as PasteSshTerminalRequest };
  }
  if (value.command === 'ssh.resize' && exactKeys(payload, ['sessionId', 'columns', 'rows']) && typeof payload.sessionId === 'string' && UUID.test(payload.sessionId) &&
      validSize(payload.columns, payload.rows)) return { ok: true, result: value as unknown as ResizeSshTerminalRequest };
  if (value.command === 'ssh.ack' && exactKeys(payload, ['sessionId', 'sequence']) && typeof payload.sessionId === 'string' && UUID.test(payload.sessionId) &&
      Number.isSafeInteger(payload.sequence) && (payload.sequence as number) > 0) return { ok: true, result: value as unknown as AcknowledgeSshTerminalRequest };
  if (value.command === 'ssh.close' && exactKeys(payload, ['sessionId']) && typeof payload.sessionId === 'string' && UUID.test(payload.sessionId)) {
    return { ok: true, result: value as unknown as CloseSshTerminalRequest };
  }
  if (value.command === 'telnet.open' && exactKeys(payload, ['sessionId', 'host', 'port', 'columns', 'rows']) &&
      typeof payload.sessionId === 'string' && UUID.test(payload.sessionId) && typeof payload.host === 'string' && Number.isInteger(payload.port) &&
      canonicalizeRemoteEndpoint({ host: payload.host, port: payload.port }) !== undefined && validSize(payload.columns, payload.rows)) {
    return { ok: true, result: value as unknown as OpenTelnetTerminalRequest };
  }
  if (value.command === 'telnet.write' && exactKeys(payload, ['sessionId', 'data']) && typeof payload.sessionId === 'string' && UUID.test(payload.sessionId) &&
      typeof payload.data === 'string' && payload.data.length <= MAX_TERMINAL_INPUT_CHARS) return { ok: true, result: value as unknown as WriteTelnetTerminalRequest };
  if (value.command === 'telnet.paste' && exactKeys(payload, ['sessionId']) && typeof payload.sessionId === 'string' && UUID.test(payload.sessionId)) {
    return { ok: true, result: value as unknown as PasteTelnetTerminalRequest };
  }
  if (value.command === 'telnet.resize' && exactKeys(payload, ['sessionId', 'columns', 'rows']) && typeof payload.sessionId === 'string' && UUID.test(payload.sessionId) &&
      validSize(payload.columns, payload.rows)) return { ok: true, result: value as unknown as ResizeTelnetTerminalRequest };
  if (value.command === 'telnet.ack' && exactKeys(payload, ['sessionId', 'sequence']) && typeof payload.sessionId === 'string' && UUID.test(payload.sessionId) &&
      Number.isSafeInteger(payload.sequence) && (payload.sequence as number) > 0) return { ok: true, result: value as unknown as AcknowledgeTelnetTerminalRequest };
  if (value.command === 'telnet.close' && exactKeys(payload, ['sessionId']) && typeof payload.sessionId === 'string' && UUID.test(payload.sessionId)) {
    return { ok: true, result: value as unknown as CloseTelnetTerminalRequest };
  }
  if (value.command === 'ftp.open' && exactKeys(payload, ['sessionId', 'host', 'port', 'secure']) && typeof payload.sessionId === 'string' && UUID.test(payload.sessionId) &&
      typeof payload.host === 'string' && Number.isInteger(payload.port) && typeof payload.secure === 'boolean' &&
      canonicalizeFtpEndpoint({ host: payload.host, port: payload.port, secure: payload.secure }) !== undefined) {
    return { ok: true, result: value as unknown as OpenFtpFilesRequest };
  }
  if (value.command === 'ftp.files.list' && exactKeys(payload, ['sessionId', 'path']) && typeof payload.sessionId === 'string' &&
      UUID.test(payload.sessionId) && isFtpRemotePath(payload.path)) return { ok: true, result: value as unknown as ListFtpDirectoryRequest };
  if (value.command === 'ftp.files.upload' && exactKeys(payload, ['sessionId', 'operationId', 'remoteDirectory']) &&
      typeof payload.sessionId === 'string' && UUID.test(payload.sessionId) && typeof payload.operationId === 'string' && UUID.test(payload.operationId) &&
      isFtpRemotePath(payload.remoteDirectory)) return { ok: true, result: value as unknown as UploadFtpFileRequest };
  if (value.command === 'ftp.files.download' && exactKeys(payload, ['sessionId', 'operationId', 'remotePath']) &&
      typeof payload.sessionId === 'string' && UUID.test(payload.sessionId) && typeof payload.operationId === 'string' && UUID.test(payload.operationId) &&
      isFtpRemotePath(payload.remotePath)) return { ok: true, result: value as unknown as DownloadFtpFileRequest };
  if (value.command === 'ftp.files.cancel' && exactKeys(payload, ['sessionId', 'operationId']) &&
      typeof payload.sessionId === 'string' && UUID.test(payload.sessionId) && typeof payload.operationId === 'string' && UUID.test(payload.operationId)) {
    return { ok: true, result: value as unknown as CancelFtpTransferRequest };
  }
  if (value.command === 'ftp.close' && exactKeys(payload, ['sessionId']) && typeof payload.sessionId === 'string' && UUID.test(payload.sessionId)) {
    return { ok: true, result: value as unknown as CloseFtpFilesRequest };
  }
  if (value.command === 'rdp.launch' && exactKeys(payload, ['host', 'port']) && typeof payload.host === 'string' && Number.isInteger(payload.port) &&
      canonicalizeRdpEndpoint({ host: payload.host, port: payload.port }) !== undefined) {
    return { ok: true, result: value as unknown as LaunchRdpViewerRequest };
  }
  if (value.command === 'vnc.launch' && exactKeys(payload, ['host', 'port']) && typeof payload.host === 'string' && Number.isInteger(payload.port) &&
      canonicalizeVncEndpoint({ host: payload.host, port: payload.port }) !== undefined) {
    return { ok: true, result: value as unknown as LaunchVncViewerRequest };
  }
  if ((value.command === 'ssh.host.approve' || value.command === 'ssh.host.reject') && exactKeys(payload, ['token']) &&
      typeof payload.token === 'string' && TRUST_TOKEN.test(payload.token)) return { ok: true, result: value as unknown as DecideSshHostRequest };
  if (value.command === 'ssh.host.revoke' && exactKeys(payload, ['host', 'port'])) {
    const endpoint = canonicalizeSshHostEndpoint({ host: payload.host, port: payload.port });
    if (endpoint && endpoint.host === payload.host && endpoint.port === payload.port) return { ok: true, result: value as unknown as RevokeSshHostRequest };
    return failure('INVALID_REQUEST');
  }
  if (value.command === 'ssh.files.list' && exactKeys(payload, ['sessionId', 'path']) && typeof payload.sessionId === 'string' &&
      UUID.test(payload.sessionId) && isRemotePath(payload.path)) return { ok: true, result: value as unknown as ListSshDirectoryRequest };
  if (value.command === 'ssh.files.upload' && exactKeys(payload, ['sessionId', 'operationId', 'remoteDirectory']) &&
      typeof payload.sessionId === 'string' && UUID.test(payload.sessionId) && typeof payload.operationId === 'string' && UUID.test(payload.operationId) &&
      isRemotePath(payload.remoteDirectory)) return { ok: true, result: value as unknown as UploadSshFileRequest };
  if (value.command === 'ssh.files.download' && exactKeys(payload, ['sessionId', 'operationId', 'remotePath']) &&
      typeof payload.sessionId === 'string' && UUID.test(payload.sessionId) && typeof payload.operationId === 'string' && UUID.test(payload.operationId) &&
      isRemotePath(payload.remotePath)) return { ok: true, result: value as unknown as DownloadSshFileRequest };
  if (value.command === 'ssh.files.read-text' && exactKeys(payload, ['sessionId', 'operationId', 'remotePath']) &&
      typeof payload.sessionId === 'string' && UUID.test(payload.sessionId) && typeof payload.operationId === 'string' && UUID.test(payload.operationId) &&
      isRemotePath(payload.remotePath) && payload.remotePath !== '.' && payload.remotePath !== '/') {
    return { ok: true, result: value as unknown as ReadSshTextFileRequest };
  }
  if (value.command === 'ssh.files.write-text' && exactKeys(payload, ['sessionId', 'operationId', 'remotePath', 'content', 'expectedRevision']) &&
      typeof payload.sessionId === 'string' && UUID.test(payload.sessionId) && typeof payload.operationId === 'string' && UUID.test(payload.operationId) &&
      isRemotePath(payload.remotePath) && payload.remotePath !== '.' && payload.remotePath !== '/' && typeof payload.content === 'string' &&
      remoteTextByteLength(payload.content) !== undefined && isRemoteTextRevision(payload.expectedRevision)) {
    return { ok: true, result: value as unknown as SaveSshTextFileRequest };
  }
  if (value.command === 'ssh.files.cancel' && exactKeys(payload, ['sessionId', 'operationId']) &&
      typeof payload.sessionId === 'string' && UUID.test(payload.sessionId) && typeof payload.operationId === 'string' && UUID.test(payload.operationId)) {
    return { ok: true, result: value as unknown as CancelSshTransferRequest };
  }
  if (value.command === 'session.list' && exactKeys(payload, ['query']) && normalizeSessionSearch(payload.query) !== undefined) {
    return { ok: true, result: value as unknown as ListSessionsRequest };
  }
  if (value.command === 'session.create' && normalizeSavedSessionDraft(payload)) return { ok: true, result: value as unknown as CreateSessionRequest };
  if (value.command === 'session.favorite' && exactKeys(payload, ['id', 'favorite']) && isSessionDefinitionId(payload.id) && typeof payload.favorite === 'boolean') {
    return { ok: true, result: value as unknown as SetSessionFavoriteRequest };
  }
  if (value.command === 'session.delete' && exactKeys(payload, ['id']) && isSessionDefinitionId(payload.id)) {
    return { ok: true, result: value as unknown as DeleteSessionRequest };
  }
  if (value.command === 'session.folder.list' && exactKeys(payload, [])) return { ok: true, result: value as unknown as ListSessionFoldersRequest };
  if (value.command === 'session.folder.create' && normalizeSessionFolderDraft(payload)) return { ok: true, result: value as unknown as CreateSessionFolderRequest };
  if (value.command === 'session.folder.rename' && exactKeys(payload, ['id', 'name']) && isSessionFolderId(payload.id) &&
      normalizeSessionFolderName(payload.name) === payload.name) return { ok: true, result: value as unknown as RenameSessionFolderRequest };
  if (value.command === 'session.folder.move' && exactKeys(payload, ['id', 'parentId']) && isSessionFolderId(payload.id) &&
      (payload.parentId === null || isSessionFolderId(payload.parentId))) return { ok: true, result: value as unknown as MoveSessionFolderRequest };
  if (value.command === 'session.folder.delete' && exactKeys(payload, ['id']) && isSessionFolderId(payload.id)) {
    return { ok: true, result: value as unknown as DeleteSessionFolderRequest };
  }
  if (value.command === 'session.folder.export' && exactKeys(payload, ['id']) && isSessionFolderId(payload.id)) {
    return { ok: true, result: value as unknown as ExportSessionFolderRequest };
  }
  if (value.command === 'session.folder.import' && exactKeys(payload, [])) {
    return { ok: true, result: value as unknown as ImportSessionFolderRequest };
  }
  if (value.command === 'session.move' && exactKeys(payload, ['id', 'folderId']) && isSessionDefinitionId(payload.id) &&
      (payload.folderId === null || isSessionFolderId(payload.folderId))) return { ok: true, result: value as unknown as MoveSessionRequest };
  if (value.command === 'tunnel.list' && exactKeys(payload, [])) return { ok: true, result: value as unknown as ListSshTunnelsRequest };
  if (value.command === 'tunnel.save' && normalizeSshTunnelDraft(payload)) return { ok: true, result: value as unknown as SaveSshTunnelRequest };
  if ((value.command === 'tunnel.delete' || value.command === 'tunnel.start' || value.command === 'tunnel.stop') &&
      exactKeys(payload, ['id']) && isTunnelId(payload.id)) {
    if (value.command === 'tunnel.delete') return { ok: true, result: value as unknown as DeleteSshTunnelRequest };
    if (value.command === 'tunnel.start') return { ok: true, result: value as unknown as StartSshTunnelRequest };
    return { ok: true, result: value as unknown as StopSshTunnelRequest };
  }
  if (value.command === 'macro.list' && exactKeys(payload, [])) return { ok: true, result: value as unknown as ListMacrosRequest };
  if (value.command === 'macro.create' && normalizeMacroDraft(payload)) return { ok: true, result: value as unknown as CreateMacroRequest };
  if (value.command === 'macro.update' && (exactKeys(payload, ['id', 'name', 'steps']) || exactKeys(payload, ['id', 'name', 'description', 'steps'])) && isMacroId(payload.id) &&
      normalizeMacroDraft({ name: payload.name, ...(Object.hasOwn(payload, 'description') ? { description: payload.description } : {}), steps: payload.steps })) {
    return { ok: true, result: value as unknown as UpdateMacroRequest };
  }
  if (value.command === 'macro.delete' && exactKeys(payload, ['id']) && isMacroId(payload.id)) return { ok: true, result: value as unknown as DeleteMacroRequest };
  if (value.command === 'macro.shortcut.list' && exactKeys(payload, [])) return { ok: true, result: value as unknown as ListMacroShortcutsRequest };
  if (value.command === 'macro.shortcut.set' && exactKeys(payload, ['macroId', 'code']) && isMacroId(payload.macroId) && isMacroShortcutCode(payload.code)) {
    return { ok: true, result: value as unknown as SetMacroShortcutRequest };
  }
  if (value.command === 'macro.shortcut.delete' && exactKeys(payload, ['macroId']) && isMacroId(payload.macroId)) {
    return { ok: true, result: value as unknown as DeleteMacroShortcutRequest };
  }
  if (value.command === 'preferences.get' && exactKeys(payload, [])) return { ok: true, result: value as unknown as GetWorkbenchPreferencesRequest };
  if (value.command === 'preferences.save' && exactKeys(payload, ['preferences']) && normalizeWorkbenchPreferences(payload.preferences)) {
    return { ok: true, result: value as unknown as SaveWorkbenchPreferencesRequest };
  }
  if (typeof value.command === 'string' && ['app.describe', 'terminal.open', 'terminal.write', 'terminal.paste', 'terminal.resize', 'terminal.ack', 'terminal.close',
    'ssh.open', 'ssh.write', 'ssh.paste', 'ssh.resize', 'ssh.ack', 'ssh.close', 'sftp.open', 'sftp.close', 'ssh.host.approve', 'ssh.host.reject', 'ssh.host.revoke', 'ssh.files.list',
    'ssh.files.upload', 'ssh.files.download', 'ssh.files.read-text', 'ssh.files.write-text', 'ssh.files.cancel',
    'telnet.open', 'telnet.write', 'telnet.paste', 'telnet.resize', 'telnet.ack', 'telnet.close',
    'ftp.open', 'ftp.files.list', 'ftp.files.upload', 'ftp.files.download', 'ftp.files.cancel', 'ftp.close', 'rdp.launch', 'vnc.launch',
    'session.list', 'session.create', 'session.favorite', 'session.delete', 'session.folder.list', 'session.folder.create', 'session.folder.rename',
    'session.folder.move', 'session.folder.delete', 'session.folder.export', 'session.folder.import', 'session.move',
    'tunnel.list', 'tunnel.save', 'tunnel.delete', 'tunnel.start', 'tunnel.stop', 'macro.list', 'macro.create', 'macro.update', 'macro.delete',
    'macro.shortcut.list', 'macro.shortcut.set', 'macro.shortcut.delete', 'preferences.get', 'preferences.save'].includes(value.command)) {
    return failure('INVALID_REQUEST');
  }
  return failure('UNKNOWN_COMMAND');
}

function validError(value: unknown): value is AppError {
  if (!record(value) || !exactKeys(value, ['code', 'target', 'retryable'])) return false;
  return ERROR_CODES.includes(value.code as ErrorCode) && (value.target === 'application' || value.target === 'terminal') && typeof value.retryable === 'boolean';
}

function validSnapshot(value: unknown): value is WorkbenchSnapshot {
  if (!record(value) || !exactKeys(value, ['name', 'version', 'platform', 'stage'])) return false;
  return value.name === 'MultiRemoteTerminal' && typeof value.version === 'string' && value.version.length <= 64 &&
    typeof value.platform === 'string' && value.platform.length <= 32 && value.stage === 'foundation';
}

function validOpenResult(value: unknown, shell: LocalShell): value is OpenTerminalResult {
  if (!record(value) || !exactKeys(value, ['sessionId', 'shell', 'state'])) return false;
  return typeof value.sessionId === 'string' && UUID.test(value.sessionId) && value.shell === shell &&
    ['running', 'exited', 'failed'].includes(value.state as string);
}

function validSshOpenResult(value: unknown, request: OpenSshTerminalRequest | OpenSftpFilesRequest): value is OpenSshTerminalResult {
  if (!record(value) || !exactKeys(value, ['sessionId', 'endpoint', 'state'])) return false;
  const endpoint = canonicalizeSshHostEndpoint(value.endpoint);
  const requested = canonicalizeSshHostEndpoint({ host: request.payload.host, port: request.payload.port });
  return value.sessionId === request.payload.sessionId && endpoint !== undefined && requested !== undefined && endpoint.host === requested.host &&
    endpoint.port === requested.port && ['running', 'exited', 'failed'].includes(value.state as string);
}

function validTelnetOpenResult(value: unknown, request: OpenTelnetTerminalRequest): value is OpenTelnetTerminalResult {
  if (!record(value) || !exactKeys(value, ['sessionId', 'endpoint', 'state'])) return false;
  const endpoint = canonicalizeRemoteEndpoint(value.endpoint);
  const requested = canonicalizeRemoteEndpoint({ host: request.payload.host, port: request.payload.port });
  return value.sessionId === request.payload.sessionId && endpoint !== undefined && requested !== undefined && endpoint.host === requested.host &&
    endpoint.port === requested.port && ['running', 'exited', 'failed'].includes(value.state as string);
}

function validFtpOpenResult(value: unknown, request: OpenFtpFilesRequest): value is FtpFilesSession {
  if (!record(value) || !exactKeys(value, ['sessionId', 'endpoint', 'state']) || value.sessionId !== request.payload.sessionId || value.state !== 'running') return false;
  if (!isCanonicalFtpEndpoint(value.endpoint)) return false;
  const endpoint = canonicalizeFtpEndpoint(value.endpoint);
  const requested = canonicalizeFtpEndpoint({ host: request.payload.host, port: request.payload.port, secure: request.payload.secure });
  return endpoint !== undefined && requested !== undefined && endpoint.host === requested.host && endpoint.port === requested.port && endpoint.secure === requested.secure;
}

export function isCommandReply(value: unknown, request: CommandRequest): value is CommandReply<unknown> {
  if (!record(value) || value.requestId !== request.requestId || typeof value.ok !== 'boolean') return false;
  if (value.ok) {
    if (!exactKeys(value, ['requestId', 'ok', 'result'])) return false;
    if (request.command === 'app.describe') return validSnapshot(value.result);
    if (request.command === 'terminal.open') return validOpenResult(value.result, request.payload.shell);
    if (request.command === 'ssh.open') return validSshOpenResult(value.result, request);
    if (request.command === 'sftp.open') return validSshOpenResult(value.result, request);
    if (request.command === 'telnet.open') return validTelnetOpenResult(value.result, request);
    if (request.command === 'ssh.files.list') return isRemoteDirectoryListing(value.result);
    if (request.command === 'ssh.files.upload') return isFileTransferResult(value.result) && value.result.direction === 'upload';
    if (request.command === 'ssh.files.download') return isFileTransferResult(value.result) && value.result.direction === 'download';
    if (request.command === 'ssh.files.read-text') return isRemoteTextFile(value.result) && value.result.path === request.payload.remotePath;
    if (request.command === 'ssh.files.write-text') return isRemoteTextFileSaveResult(value.result) && value.result.path === request.payload.remotePath &&
      value.result.bytesSaved === remoteTextByteLength(request.payload.content);
    if (request.command === 'ftp.open') return validFtpOpenResult(value.result, request);
    if (request.command === 'ftp.files.list') return isFtpDirectoryListing(value.result);
    if (request.command === 'ftp.files.upload') return isFtpTransferResult(value.result) && value.result.direction === 'upload';
    if (request.command === 'ftp.files.download') return isFtpTransferResult(value.result) && value.result.direction === 'download';
    if (request.command === 'session.list') return Array.isArray(value.result) && value.result.every(isSavedSessionDefinition);
    if (request.command === 'session.create') return isSavedSessionDefinition(value.result);
    if (request.command === 'rdp.launch') {
      if (!record(value.result) || !exactKeys(value.result, ['provider', 'endpoint', 'state'])) return false;
      const endpoint = canonicalizeRemoteEndpoint(value.result.endpoint);
      const requested = canonicalizeRemoteEndpoint(request.payload);
      return value.result.provider === 'external' && value.result.state === 'launch-requested' && endpoint !== undefined && requested !== undefined &&
        endpoint.host === requested.host && endpoint.port === requested.port;
    }
    if (request.command === 'vnc.launch') {
      if (!record(value.result) || !exactKeys(value.result, ['provider', 'endpoint', 'state'])) return false;
      const endpoint = canonicalizeVncEndpoint(value.result.endpoint);
      const requested = canonicalizeVncEndpoint(request.payload);
      return value.result.provider === 'external' && value.result.state === 'launch-requested' && endpoint !== undefined && requested !== undefined &&
        endpoint.host === requested.host && endpoint.port === requested.port;
    }
    if (request.command === 'session.folder.list') return Array.isArray(value.result) && value.result.every(isSavedSessionFolder);
    if (request.command === 'session.folder.create') return isSavedSessionFolder(value.result);
    if (request.command === 'session.folder.export') return isFolderExportResult(value.result);
    if (request.command === 'session.folder.import') return isFolderImportResult(value.result);
    if (request.command === 'tunnel.list') return Array.isArray(value.result) && value.result.every(isSshTunnelSnapshot);
    if (request.command === 'tunnel.save') return isSshTunnelDefinition(value.result);
    if (request.command === 'tunnel.delete') return record(value.result) && exactKeys(value.result, []);
    if (request.command === 'tunnel.start' || request.command === 'tunnel.stop') {
      return isTunnelRunStatus(value.result) && value.result.tunnelId === request.payload.id;
    }
    if (request.command === 'macro.list') return Array.isArray(value.result) && value.result.every(isMacroDefinition);
    if (request.command === 'macro.create' || request.command === 'macro.update') return isMacroDefinition(value.result);
    if (request.command === 'macro.delete') return record(value.result) && exactKeys(value.result, []);
    if (request.command === 'macro.shortcut.list') return Array.isArray(value.result) && value.result.every(isMacroShortcutBinding);
    if (request.command === 'macro.shortcut.set') return isMacroShortcutBinding(value.result) && value.result.macroId === request.payload.macroId &&
      value.result.code === request.payload.code;
    if (request.command === 'macro.shortcut.delete') return record(value.result) && exactKeys(value.result, []);
    if (request.command === 'preferences.get' || request.command === 'preferences.save') return isWorkbenchPreferences(value.result);
    return record(value.result) && exactKeys(value.result, []);
  }
  return exactKeys(value, ['requestId', 'ok', 'error']) && validError(value.error);
}

function isSshTunnelSnapshot(value: unknown): value is SshTunnelSnapshot {
  return record(value) && exactKeys(value, ['definition', 'status']) && isSshTunnelDefinition(value.definition) &&
    isTunnelRunStatus(value.status) && value.status.tunnelId === value.definition.id;
}

export function isTunnelStatusEvent(value: unknown): value is TunnelRunStatus {
  return isTunnelRunStatus(value);
}

function isFolderExportResult(value: unknown): value is SessionFolderExportResult {
  return record(value) && exactKeys(value, ['folderCount', 'sessionCount']) &&
    isCount(value.folderCount, 1) && isCount(value.sessionCount) && value.folderCount + value.sessionCount <= 100_000;
}

function isFolderImportResult(value: unknown): value is SessionFolderImportResult {
  return record(value) && exactKeys(value, ['folderCount', 'sessionCount', 'createdFolderCount', 'createdSessionCount']) &&
    isCount(value.folderCount, 1) && isCount(value.sessionCount) && isCount(value.createdFolderCount) && isCount(value.createdSessionCount) &&
    value.createdFolderCount <= value.folderCount && value.createdSessionCount <= value.sessionCount &&
    value.folderCount + value.sessionCount <= 100_000;
}

function isCount(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= 100_000;
}

export function isSshTrustEvent(value: unknown): value is SshTrustEvent {
  if (!record(value) || !UUID.test(typeof value.sessionId === 'string' ? value.sessionId : '') || typeof value.kind !== 'string') return false;
  if (value.kind === 'changed') {
    const endpoint = canonicalizeSshHostEndpoint({ host: value.host, port: value.port });
    return exactKeys(value, ['kind', 'sessionId', 'host', 'port', 'algorithm', 'fingerprint']) && endpoint !== undefined &&
      endpoint.host === value.host && typeof value.algorithm === 'string' && value.algorithm.length <= 128 &&
      typeof value.fingerprint === 'string' && /^SHA256:[A-Za-z0-9+/]{43}$/.test(value.fingerprint);
  }
  if (value.kind === 'challenge' && exactKeys(value, ['kind', 'sessionId', 'challenge']) && record(value.challenge) &&
      exactKeys(value.challenge, ['token', 'host', 'port', 'algorithm', 'fingerprint'])) {
    const challenge = value.challenge;
    const endpoint = canonicalizeSshHostEndpoint({ host: challenge.host, port: challenge.port });
    return typeof challenge.token === 'string' && TRUST_TOKEN.test(challenge.token) && endpoint !== undefined && endpoint.host === challenge.host &&
      typeof challenge.algorithm === 'string' && challenge.algorithm.length <= 128 && typeof challenge.fingerprint === 'string' &&
      /^SHA256:[A-Za-z0-9+/]{43}$/.test(challenge.fingerprint);
  }
  return false;
}

export function isDescribeReply(value: unknown, requestId: string): value is DescribeReply {
  const request: DescribeRequest = { command: 'app.describe', requestId, contractVersion: 1, payload: {} };
  return isCommandReply(value, request);
}

export function isTerminalEvent(value: unknown): value is LocalTerminalEvent {
  if (!record(value) || typeof value.sessionId !== 'string' || !UUID.test(value.sessionId) || typeof value.kind !== 'string') return false;
  if (value.kind === 'data') return exactKeys(value, ['kind', 'sessionId', 'sequence', 'data']) && Number.isSafeInteger(value.sequence) &&
    (value.sequence as number) > 0 && typeof value.data === 'string' && value.data.length <= MAX_TERMINAL_INPUT_CHARS;
  if (value.kind === 'exit') return exactKeys(value, ['kind', 'sessionId', 'exitCode']) && Number.isSafeInteger(value.exitCode);
  if (value.kind === 'failure') return exactKeys(value, ['kind', 'sessionId', 'error']) && validError(value.error) && value.error.target === 'terminal';
  return false;
}

export function isFtpTransferEvent(value: unknown): value is FtpTransferProgress {
  return isFtpTransferProgress(value);
}

export function isSshTransferEvent(value: unknown): value is FileTransferProgress {
  return isFileTransferProgress(value);
}
