import { isHostKeyEvidence } from '../../../../packages/domain/src/host-trust.ts';
import type { SshHostEndpoint } from '../../../../packages/domain/src/host-trust.ts';
import { canonicalizeSshHostEndpoint } from '../../../../packages/domain/src/host-trust.ts';
import { isTerminalSize } from '../../../../packages/domain/src/local-terminal.ts';
import type { TerminalSize } from '../../../../packages/domain/src/local-terminal.ts';
import type { SshAuthenticationCredentials, SshConnectionGatewayCredentials, SshTerminalCredentials } from '../../../../packages/application/src/ssh-terminals.ts';
import { MAX_SSH_PRIVATE_KEY_BYTES } from '../../../../packages/application/src/ssh-terminals.ts';
import { normalizeSshGatewayRoute } from '../../../../packages/domain/src/ssh-route.ts';
import { isTerminalEvent } from '../../../../packages/contracts/src/commands.ts';
import type { LocalTerminalEvent } from '../../../../packages/application/src/local-terminals.ts';
import { isRemoteDirectoryListing, isRemotePath } from '../../../../packages/domain/src/remote-files.ts';
import type { RemoteDirectoryListing } from '../../../../packages/domain/src/remote-files.ts';
import { isRemoteTextFile, isRemoteTextFileSaveResult, isRemoteTextRevision, remoteTextByteLength } from '../../../../packages/domain/src/remote-text-file.ts';
import type { RemoteTextFile, RemoteTextFileSaveResult } from '../../../../packages/domain/src/remote-text-file.ts';
import { isRemoteFileName } from '../../../../packages/domain/src/remote-files.ts';
import { isFileTransferConflictPolicy, isFileTransferProgress, isFileTransferResult } from '../../../../packages/domain/src/file-transfer.ts';
import type { FileTransferConflictPolicy, FileTransferProgress, FileTransferResult } from '../../../../packages/domain/src/file-transfer.ts';
import { isSshTunnelDefinition, isTunnelId } from '../../../../packages/domain/src/ssh-tunnel.ts';
import type { SshTunnelDefinition } from '../../../../packages/domain/src/ssh-tunnel.ts';
import { isAbsoluteNormalizedLocalPath } from './local-transfer-target.ts';

export const SSH_WORKER_PROTOCOL_VERSION = 1;
export const MAX_SSH_PASSWORD_LENGTH = 65_536;
export const MAX_SSH_USERNAME_LENGTH = 512;

export type SshWorkerRequest =
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'open'; readonly sessionId: string; readonly endpoint: SshHostEndpoint;
      readonly credentials: SshAuthenticationCredentials; readonly size: TerminalSize; readonly gatewayHops?: readonly SshConnectionGatewayCredentials[] }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'open-files'; readonly sessionId: string; readonly endpoint: SshHostEndpoint; readonly credentials: SshAuthenticationCredentials }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'write'; readonly sessionId: string; readonly data: string }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'resize'; readonly sessionId: string; readonly size: TerminalSize }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'ack'; readonly sessionId: string; readonly sequence: number }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'files.list'; readonly sessionId: string; readonly path: string }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'files.upload'; readonly sessionId: string;
      readonly operationId: string; readonly localPath: string; readonly remoteDirectory: string; readonly fileName: string;
      readonly conflictPolicy: FileTransferConflictPolicy }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'files.download'; readonly sessionId: string;
      readonly operationId: string; readonly remotePath: string; readonly localPath: string; readonly conflictPolicy: FileTransferConflictPolicy }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'files.read-text'; readonly sessionId: string;
      readonly operationId: string; readonly remotePath: string }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'files.write-text'; readonly sessionId: string;
      readonly operationId: string; readonly remotePath: string; readonly content: string; readonly expectedRevision: string }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'files.cancel'; readonly sessionId: string; readonly operationId: string }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'tunnel.forward.start'; readonly sessionId: string; readonly definition: SshTunnelDefinition }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'tunnel.forward.stop'; readonly sessionId: string; readonly tunnelId: string }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'close'; readonly sessionId: string }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'shutdown' }
  | { readonly version: 1; readonly type: 'host-key-result'; readonly sessionId: string; readonly checkId: string; readonly accepted: boolean };

export type SshWorkerErrorCode = 'INVALID_REQUEST' | 'UNAVAILABLE' | 'NOT_SUPPORTED' | 'CANCELLED' | 'BUSY' | 'TIMEOUT' | 'OUTPUT_LIMIT' |
  'AUTHENTICATION_FAILED' | 'HOST_KEY_REJECTED' | 'HOST_KEY_CHANGED' | 'CONFLICT' | 'NOT_FOUND' | 'FORBIDDEN';

export type SshWorkerMessage =
  | { readonly version: 1; readonly type: 'reply'; readonly requestId: string; readonly ok: true; readonly result: Record<string, never> | RemoteDirectoryListing |
      FileTransferResult | RemoteTextFile | RemoteTextFileSaveResult | { readonly bindPort: number } }
  | { readonly version: 1; readonly type: 'reply'; readonly requestId: string; readonly ok: false; readonly errorCode: SshWorkerErrorCode }
  | { readonly version: 1; readonly type: 'progress'; readonly requestId: string; readonly progress: FileTransferProgress }
  | { readonly version: 1; readonly type: 'event'; readonly event: LocalTerminalEvent }
  | { readonly version: 1; readonly type: 'host-key'; readonly sessionId: string; readonly checkId: string; readonly endpoint: SshHostEndpoint; readonly evidence: { readonly algorithm: string; readonly fingerprint: string; readonly publicKey: Uint8Array } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ERROR_CODES: readonly SshWorkerErrorCode[] = ['INVALID_REQUEST', 'UNAVAILABLE', 'NOT_SUPPORTED', 'CANCELLED', 'BUSY', 'TIMEOUT', 'OUTPUT_LIMIT',
  'AUTHENTICATION_FAILED', 'HOST_KEY_REJECTED', 'HOST_KEY_CHANGED', 'CONFLICT', 'NOT_FOUND', 'FORBIDDEN'];

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function isCanonicalEndpoint(value: unknown): value is SshHostEndpoint {
  const endpoint = canonicalizeSshHostEndpoint(value);
  return endpoint !== undefined && record(value) && endpoint.host === value.host && endpoint.port === value.port;
}

function isUsername(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_SSH_USERNAME_LENGTH && value.trim() === value && !value.includes('\0');
}

function isPasswordCredentials(value: unknown): value is SshTerminalCredentials {
  return record(value) && exactKeys(value, ['username', 'password']) && typeof value.username === 'string' &&
    isUsername(value.username) &&
    typeof value.password === 'string' && value.password.length <= MAX_SSH_PASSWORD_LENGTH && !value.password.includes('\0');
}

function isAuthenticationCredentials(value: unknown): value is SshAuthenticationCredentials {
  if (isPasswordCredentials(value)) return true;
  return record(value) && exactKeys(value, ['username', 'privateKey', 'passphrase']) && isUsername(value.username) &&
    value.privateKey instanceof Uint8Array && value.privateKey.byteLength > 0 && value.privateKey.byteLength <= MAX_SSH_PRIVATE_KEY_BYTES &&
    typeof value.passphrase === 'string' && value.passphrase.length <= MAX_SSH_PASSWORD_LENGTH && !value.passphrase.includes('\0');
}

function isGatewayHops(value: unknown, target: unknown): value is readonly SshConnectionGatewayCredentials[] {
  if (!isCanonicalEndpoint(target) || !Array.isArray(value) || value.length > 2) return false;
  const endpoints: SshHostEndpoint[] = [];
  for (const hop of value) {
    if (!record(hop) || !exactKeys(hop, ['endpoint', 'credentials']) || !isCanonicalEndpoint(hop.endpoint) || !isPasswordCredentials(hop.credentials)) return false;
    endpoints.push(hop.endpoint);
  }
  return normalizeSshGatewayRoute(endpoints, target) !== undefined;
}

export function parseSshWorkerInput(value: unknown): SshWorkerRequest | undefined {
  if (!record(value) || value.version !== SSH_WORKER_PROTOCOL_VERSION || typeof value.type !== 'string') return undefined;
  if (value.type === 'host-key-result' && exactKeys(value, ['version', 'type', 'sessionId', 'checkId', 'accepted']) &&
      isUuid(value.sessionId) && isUuid(value.checkId) && typeof value.accepted === 'boolean') return value as unknown as SshWorkerRequest;
  if (value.type !== 'request' || !isUuid(value.requestId) || typeof value.command !== 'string') return undefined;
  if (value.command === 'open' && (exactKeys(value, ['version', 'type', 'requestId', 'command', 'sessionId', 'endpoint', 'credentials', 'size']) ||
      (exactKeys(value, ['version', 'type', 'requestId', 'command', 'sessionId', 'endpoint', 'credentials', 'size', 'gatewayHops']) &&
        isGatewayHops(value.gatewayHops, value.endpoint))) && isUuid(value.sessionId) && isCanonicalEndpoint(value.endpoint) &&
      isAuthenticationCredentials(value.credentials) && isTerminalSize(value.size)) {
    return value as unknown as SshWorkerRequest;
  }
  if (value.command === 'open-files' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'sessionId', 'endpoint', 'credentials']) &&
      isUuid(value.sessionId) && isCanonicalEndpoint(value.endpoint) && isAuthenticationCredentials(value.credentials)) return value as unknown as SshWorkerRequest;
  if (value.command === 'write' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'sessionId', 'data']) &&
      isUuid(value.sessionId) && typeof value.data === 'string' && value.data.length <= 16_384) return value as unknown as SshWorkerRequest;
  if (value.command === 'resize' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'sessionId', 'size']) &&
      isUuid(value.sessionId) && isTerminalSize(value.size)) return value as unknown as SshWorkerRequest;
  if (value.command === 'ack' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'sessionId', 'sequence']) &&
      isUuid(value.sessionId) && Number.isSafeInteger(value.sequence) && (value.sequence as number) > 0) return value as unknown as SshWorkerRequest;
  if (value.command === 'files.list' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'sessionId', 'path']) &&
      isUuid(value.sessionId) && isRemotePath(value.path)) return value as unknown as SshWorkerRequest;
  if (value.command === 'files.upload' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'sessionId', 'operationId', 'localPath',
    'remoteDirectory', 'fileName', 'conflictPolicy']) && isUuid(value.sessionId) && isUuid(value.operationId) &&
      isAbsoluteNormalizedLocalPath(value.localPath) &&
      isRemotePath(value.remoteDirectory) && isRemoteFileName(value.fileName) && isFileTransferConflictPolicy(value.conflictPolicy)) {
    return value as unknown as SshWorkerRequest;
  }
  if (value.command === 'files.download' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'sessionId', 'operationId', 'remotePath',
    'localPath', 'conflictPolicy']) && isUuid(value.sessionId) && isUuid(value.operationId) && isRemotePath(value.remotePath) &&
      isAbsoluteNormalizedLocalPath(value.localPath) &&
      isFileTransferConflictPolicy(value.conflictPolicy)) return value as unknown as SshWorkerRequest;
  if (value.command === 'files.read-text' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'sessionId', 'operationId', 'remotePath']) &&
      isUuid(value.sessionId) && isUuid(value.operationId) && isRemotePath(value.remotePath) && value.remotePath !== '.' && value.remotePath !== '/') {
    return value as unknown as SshWorkerRequest;
  }
  if (value.command === 'files.write-text' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'sessionId', 'operationId', 'remotePath', 'content', 'expectedRevision']) &&
      isUuid(value.sessionId) && isUuid(value.operationId) && isRemotePath(value.remotePath) && value.remotePath !== '.' && value.remotePath !== '/' &&
      typeof value.content === 'string' && remoteTextByteLength(value.content) !== undefined && isRemoteTextRevision(value.expectedRevision)) {
    return value as unknown as SshWorkerRequest;
  }
  if (value.command === 'files.cancel' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'sessionId', 'operationId']) &&
      isUuid(value.sessionId) && isUuid(value.operationId)) return value as unknown as SshWorkerRequest;
  if (value.command === 'tunnel.forward.start' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'sessionId', 'definition']) &&
      isUuid(value.sessionId) && isSshTunnelDefinition(value.definition)) return value as unknown as SshWorkerRequest;
  if (value.command === 'tunnel.forward.stop' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'sessionId', 'tunnelId']) &&
      isUuid(value.sessionId) && isTunnelId(value.tunnelId)) return value as unknown as SshWorkerRequest;
  if (value.command === 'close' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'sessionId']) && isUuid(value.sessionId)) return value as unknown as SshWorkerRequest;
  if (value.command === 'shutdown' && exactKeys(value, ['version', 'type', 'requestId', 'command'])) return value as unknown as SshWorkerRequest;
  return undefined;
}

export function parseSshWorkerMessage(value: unknown): SshWorkerMessage | undefined {
  if (!record(value) || value.version !== SSH_WORKER_PROTOCOL_VERSION || typeof value.type !== 'string') return undefined;
  if (value.type === 'progress' && exactKeys(value, ['version', 'type', 'requestId', 'progress']) && isUuid(value.requestId) &&
      isFileTransferProgress(value.progress)) return value as unknown as SshWorkerMessage;
  if (value.type === 'reply' && isUuid(value.requestId) && typeof value.ok === 'boolean') {
    if (value.ok && exactKeys(value, ['version', 'type', 'requestId', 'ok', 'result']) && record(value.result) &&
        (exactKeys(value.result, []) || isRemoteDirectoryListing(value.result) || isFileTransferResult(value.result) || isRemoteTextFile(value.result) ||
          isRemoteTextFileSaveResult(value.result) ||
          isPortResult(value.result))) {
      return value as unknown as SshWorkerMessage;
    }
    if (!value.ok && exactKeys(value, ['version', 'type', 'requestId', 'ok', 'errorCode']) && ERROR_CODES.includes(value.errorCode as SshWorkerErrorCode)) {
      return value as unknown as SshWorkerMessage;
    }
  }
  if (value.type === 'host-key' && exactKeys(value, ['version', 'type', 'sessionId', 'checkId', 'endpoint', 'evidence']) &&
      isUuid(value.sessionId) && isUuid(value.checkId) && isCanonicalEndpoint(value.endpoint) && isHostKeyEvidence(value.evidence)) {
    return value as unknown as SshWorkerMessage;
  }
  if (value.type === 'event' && exactKeys(value, ['version', 'type', 'event']) && isTerminalEvent(value.event)) {
    return value as unknown as SshWorkerMessage;
  }
  return undefined;
}

function isPortResult(value: Record<string, unknown>): value is { readonly bindPort: number } {
  return exactKeys(value, ['bindPort']) && Number.isSafeInteger(value.bindPort) && (value.bindPort as number) >= 1 && (value.bindPort as number) <= 65_535;
}
