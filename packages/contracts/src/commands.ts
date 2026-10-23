import type { AppError, ErrorCode, Outcome } from '../../domain/src/errors.ts';
import { failure } from '../../domain/src/errors.ts';
import { isLocalShell, MAX_TERMINAL_COLUMNS, MAX_TERMINAL_INPUT_CHARS, MAX_TERMINAL_ROWS } from '../../domain/src/local-terminal.ts';
import type { LocalShell } from '../../domain/src/local-terminal.ts';
import type { LocalTerminalEvent, LocalTerminalSession } from '../../application/src/local-terminals.ts';
import type { SshTerminalSession, SshTrustEvent } from '../../application/src/ssh-terminals.ts';
import type { WorkbenchSnapshot } from '../../application/src/workbench.ts';
import { canonicalizeSshHostEndpoint } from '../../domain/src/host-trust.ts';

export const CONTRACT_VERSION = 1;
export const COMMAND_CHANNEL = 'mrt:command:v1';
export const TERMINAL_EVENT_CHANNEL = 'mrt:terminal-event:v1';
export const SSH_TRUST_EVENT_CHANNEL = 'mrt:ssh-trust-event:v1';
export const APP_URL = 'mrt://app/index.html';

export function isAppDocument(value: string): boolean {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.href === APP_URL;
  } catch { return false; }
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
export type ResizeTerminalRequest = Request<'terminal.resize', { readonly sessionId: string; readonly columns: number; readonly rows: number }>;
export type AcknowledgeTerminalRequest = Request<'terminal.ack', { readonly sessionId: string; readonly sequence: number }>;
export type CloseTerminalRequest = Request<'terminal.close', { readonly sessionId: string }>;
export type OpenSshTerminalRequest = Request<'ssh.open', { readonly sessionId: string; readonly host: string; readonly port: number; readonly columns: number; readonly rows: number }>;
export type WriteSshTerminalRequest = Request<'ssh.write', { readonly sessionId: string; readonly data: string }>;
export type ResizeSshTerminalRequest = Request<'ssh.resize', { readonly sessionId: string; readonly columns: number; readonly rows: number }>;
export type AcknowledgeSshTerminalRequest = Request<'ssh.ack', { readonly sessionId: string; readonly sequence: number }>;
export type CloseSshTerminalRequest = Request<'ssh.close', { readonly sessionId: string }>;
export type DecideSshHostRequest = Request<'ssh.host.approve' | 'ssh.host.reject', { readonly token: string }>;
export type RevokeSshHostRequest = Request<'ssh.host.revoke', { readonly host: string; readonly port: number }>;
export type CommandRequest = DescribeRequest | OpenTerminalRequest | WriteTerminalRequest | ResizeTerminalRequest | AcknowledgeTerminalRequest | CloseTerminalRequest |
  OpenSshTerminalRequest | WriteSshTerminalRequest | ResizeSshTerminalRequest | AcknowledgeSshTerminalRequest | CloseSshTerminalRequest | DecideSshHostRequest | RevokeSshHostRequest;

export type CommandReply<T> = Outcome<T> & { readonly requestId: string };
export type DescribeReply = CommandReply<WorkbenchSnapshot>;
export type OpenTerminalResult = Pick<LocalTerminalSession, 'sessionId' | 'shell' | 'state'>;
export type OpenSshTerminalResult = Pick<SshTerminalSession, 'sessionId' | 'endpoint' | 'state'>;
export type OpenTerminalReply = CommandReply<OpenTerminalResult>;
export type OpenSshTerminalReply = CommandReply<OpenSshTerminalResult>;
export type TerminalActionReply = CommandReply<Record<string, never>>;

export interface DesktopBridge {
  describe(): Promise<DescribeReply>;
  openTerminal(sessionId: string, shell: LocalShell, columns: number, rows: number): Promise<OpenTerminalReply>;
  writeTerminal(sessionId: string, data: string): Promise<TerminalActionReply>;
  resizeTerminal(sessionId: string, columns: number, rows: number): Promise<TerminalActionReply>;
  acknowledgeTerminalOutput(sessionId: string, sequence: number): Promise<TerminalActionReply>;
  closeTerminal(sessionId: string): Promise<TerminalActionReply>;
  openSshTerminal(sessionId: string, host: string, port: number, columns: number, rows: number): Promise<OpenSshTerminalReply>;
  writeSshTerminal(sessionId: string, data: string): Promise<TerminalActionReply>;
  resizeSshTerminal(sessionId: string, columns: number, rows: number): Promise<TerminalActionReply>;
  acknowledgeSshTerminalOutput(sessionId: string, sequence: number): Promise<TerminalActionReply>;
  closeSshTerminal(sessionId: string): Promise<TerminalActionReply>;
  approveSshHost(token: string): Promise<TerminalActionReply>;
  rejectSshHost(token: string): Promise<TerminalActionReply>;
  revokeSshHost(host: string, port: number): Promise<TerminalActionReply>;
  onTerminalEvent(listener: (event: LocalTerminalEvent) => void): () => void;
  onSshTrustEvent(listener: (event: SshTrustEvent) => void): () => void;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRUST_TOKEN = /^[A-Za-z0-9_-]{16,256}$/;
const ERROR_CODES: readonly ErrorCode[] = ['INVALID_REQUEST', 'UNKNOWN_COMMAND', 'FORBIDDEN', 'UNAVAILABLE', 'TIMEOUT', 'BUSY', 'NOT_FOUND', 'CANCELLED', 'OUTPUT_LIMIT',
  'AUTHENTICATION_FAILED', 'HOST_KEY_REJECTED', 'HOST_KEY_CHANGED'];

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
  if (value.command === 'terminal.resize' && exactKeys(payload, ['sessionId', 'columns', 'rows']) && typeof payload.sessionId === 'string' && UUID.test(payload.sessionId) &&
      validSize(payload.columns, payload.rows)) return { ok: true, result: value as unknown as ResizeTerminalRequest };
  if (value.command === 'terminal.ack' && exactKeys(payload, ['sessionId', 'sequence']) && typeof payload.sessionId === 'string' && UUID.test(payload.sessionId) &&
      Number.isSafeInteger(payload.sequence) && (payload.sequence as number) > 0) return { ok: true, result: value as unknown as AcknowledgeTerminalRequest };
  if (value.command === 'terminal.close' && exactKeys(payload, ['sessionId']) && typeof payload.sessionId === 'string' && UUID.test(payload.sessionId)) {
    return { ok: true, result: value as unknown as CloseTerminalRequest };
  }
  if (value.command === 'ssh.open' && exactKeys(payload, ['sessionId', 'host', 'port', 'columns', 'rows']) &&
      typeof payload.sessionId === 'string' && UUID.test(payload.sessionId) && typeof payload.host === 'string' && Number.isInteger(payload.port) &&
      canonicalizeSshHostEndpoint({ host: payload.host, port: payload.port }) !== undefined && validSize(payload.columns, payload.rows)) {
    return { ok: true, result: value as unknown as OpenSshTerminalRequest };
  }
  if (value.command === 'ssh.write' && exactKeys(payload, ['sessionId', 'data']) && typeof payload.sessionId === 'string' && UUID.test(payload.sessionId) &&
      typeof payload.data === 'string' && payload.data.length <= MAX_TERMINAL_INPUT_CHARS) return { ok: true, result: value as unknown as WriteSshTerminalRequest };
  if (value.command === 'ssh.resize' && exactKeys(payload, ['sessionId', 'columns', 'rows']) && typeof payload.sessionId === 'string' && UUID.test(payload.sessionId) &&
      validSize(payload.columns, payload.rows)) return { ok: true, result: value as unknown as ResizeSshTerminalRequest };
  if (value.command === 'ssh.ack' && exactKeys(payload, ['sessionId', 'sequence']) && typeof payload.sessionId === 'string' && UUID.test(payload.sessionId) &&
      Number.isSafeInteger(payload.sequence) && (payload.sequence as number) > 0) return { ok: true, result: value as unknown as AcknowledgeSshTerminalRequest };
  if (value.command === 'ssh.close' && exactKeys(payload, ['sessionId']) && typeof payload.sessionId === 'string' && UUID.test(payload.sessionId)) {
    return { ok: true, result: value as unknown as CloseSshTerminalRequest };
  }
  if ((value.command === 'ssh.host.approve' || value.command === 'ssh.host.reject') && exactKeys(payload, ['token']) &&
      typeof payload.token === 'string' && TRUST_TOKEN.test(payload.token)) return { ok: true, result: value as unknown as DecideSshHostRequest };
  if (value.command === 'ssh.host.revoke' && exactKeys(payload, ['host', 'port'])) {
    const endpoint = canonicalizeSshHostEndpoint({ host: payload.host, port: payload.port });
    if (endpoint && endpoint.host === payload.host && endpoint.port === payload.port) return { ok: true, result: value as unknown as RevokeSshHostRequest };
    return failure('INVALID_REQUEST');
  }
  if (typeof value.command === 'string' && ['app.describe', 'terminal.open', 'terminal.write', 'terminal.resize', 'terminal.ack', 'terminal.close',
    'ssh.open', 'ssh.write', 'ssh.resize', 'ssh.ack', 'ssh.close', 'ssh.host.approve', 'ssh.host.reject', 'ssh.host.revoke'].includes(value.command)) {
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

function validSshOpenResult(value: unknown, request: OpenSshTerminalRequest): value is OpenSshTerminalResult {
  if (!record(value) || !exactKeys(value, ['sessionId', 'endpoint', 'state'])) return false;
  const endpoint = canonicalizeSshHostEndpoint(value.endpoint);
  const requested = canonicalizeSshHostEndpoint({ host: request.payload.host, port: request.payload.port });
  return value.sessionId === request.payload.sessionId && endpoint !== undefined && requested !== undefined && endpoint.host === requested.host &&
    endpoint.port === requested.port && ['running', 'exited', 'failed'].includes(value.state as string);
}

export function isCommandReply(value: unknown, request: CommandRequest): value is CommandReply<unknown> {
  if (!record(value) || value.requestId !== request.requestId || typeof value.ok !== 'boolean') return false;
  if (value.ok) {
    if (!exactKeys(value, ['requestId', 'ok', 'result'])) return false;
    if (request.command === 'app.describe') return validSnapshot(value.result);
    if (request.command === 'terminal.open') return validOpenResult(value.result, request.payload.shell);
    if (request.command === 'ssh.open') return validSshOpenResult(value.result, request);
    return record(value.result) && exactKeys(value.result, []);
  }
  return exactKeys(value, ['requestId', 'ok', 'error']) && validError(value.error);
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
