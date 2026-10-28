import { canonicalizeSshHostEndpoint, isHostKeyEvidence } from '../../../../packages/domain/src/host-trust.ts';
import type { SshHostEndpoint, TrustedHostKey } from '../../../../packages/domain/src/host-trust.ts';
import { isSavedSessionDefinition, isSessionDefinitionId, isSessionFolderId, normalizeSavedSessionDraft, normalizeSessionSearch } from '../../../../packages/domain/src/session-definition.ts';
import type { SavedSessionDefinition, SavedSessionDraft } from '../../../../packages/domain/src/session-definition.ts';
import { isSavedSessionFolder, normalizeSessionFolderDraft, normalizeSessionFolderName } from '../../../../packages/domain/src/session-folder.ts';
import type { SavedSessionFolder, SavedSessionFolderDraft } from '../../../../packages/domain/src/session-folder.ts';
import { StorageOperationError } from '../../../../packages/application/src/storage-errors.ts';
import { isSshTunnelDefinition, isTunnelId, normalizeSshTunnelDraft } from '../../../../packages/domain/src/ssh-tunnel.ts';
import type { SshTunnelDefinition, SshTunnelDraft } from '../../../../packages/domain/src/ssh-tunnel.ts';
import { isMacroDefinition, isMacroId, normalizeMacroDraft } from '../../../../packages/domain/src/macro.ts';
import type { MacroDefinition, MacroDraft } from '../../../../packages/domain/src/macro.ts';
import { isMacroShortcutBinding, isMacroShortcutCode } from '../../../../packages/domain/src/macro-shortcut.ts';
import type { MacroShortcutBinding, MacroShortcutCode } from '../../../../packages/domain/src/macro-shortcut.ts';
import { isCurrentWorkbenchPreferences, isWorkbenchPreferences, normalizeWorkbenchPreferences } from '../../../../packages/domain/src/workbench-preferences.ts';
import type { WorkbenchPreferences } from '../../../../packages/domain/src/workbench-preferences.ts';
import { MAX_WORKBENCH_SETTINGS_TEMPLATE_BYTES } from '../../../../packages/domain/src/workbench-settings-template.ts';
import { basename, dirname, isAbsolute } from 'node:path';
import { parseCredentialReference } from '../../../../packages/domain/src/credentials.ts';
import type { CredentialReference } from '../../../../packages/domain/src/credentials.ts';
import type { ImportedSshCredentialReference, SshCredentialBundleProfile } from '../../../../packages/application/src/ssh-credential-bundle.ts';
import { MAX_SSH_CREDENTIAL_BUNDLE_BYTES, MAX_SSH_CREDENTIAL_BUNDLE_ENTRIES } from '../../../../packages/application/src/ssh-credential-bundle.ts';

export const STORAGE_WORKER_PROTOCOL_VERSION = 1;
const MAX_MIGRATION_ENTRIES = 100_000;
const MAX_MIGRATION_BYTES = 16 * 1024 * 1024;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type StorageWorkerRequest =
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'hostTrust.find'; readonly endpoint: SshHostEndpoint }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'hostTrust.trustIfAbsent'; readonly identity: TrustedHostKey }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'hostTrust.remove'; readonly endpoint: SshHostEndpoint }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'hostTrust.importLegacy'; readonly identities: readonly TrustedHostKey[] }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'session.list'; readonly query: string }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'session.count' }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'session.get'; readonly id: string }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'session.credential.get'; readonly id: string }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'session.credential.list' }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'session.credential.set'; readonly id: string; readonly reference: CredentialReference | null; readonly expectedReference: CredentialReference | null }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'session.credential.attach-imported'; readonly credentials: readonly ImportedSshCredentialReference[] }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'session.credential.clear-all' }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'session.create'; readonly draft: SavedSessionDraft }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'session.remember'; readonly draft: SavedSessionDraft }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'session.favorite'; readonly id: string; readonly favorite: boolean }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'session.remove'; readonly id: string }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'session.folder.list' }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'session.folder.create'; readonly draft: SavedSessionFolderDraft }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'session.folder.rename'; readonly id: string; readonly name: string }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'session.folder.move'; readonly id: string; readonly parentId: string | null }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'session.folder.remove'; readonly id: string }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'session.folder.export'; readonly folderId: string; readonly path: string; readonly temporaryPath: string }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'session.folder.import'; readonly path: string }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'session.move'; readonly id: string; readonly folderId: string | null }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'macro.list' }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'macro.create'; readonly draft: MacroDraft }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'macro.update'; readonly id: string; readonly draft: MacroDraft }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'macro.remove'; readonly id: string }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'macro.shortcut.list' }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'macro.shortcut.set'; readonly macroId: string; readonly code: MacroShortcutCode }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'macro.shortcut.remove'; readonly macroId: string }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'preferences.get' }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'preferences.save'; readonly preferences: WorkbenchPreferences }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'preferences.template.export'; readonly path: string; readonly temporaryPath: string; readonly preferences: WorkbenchPreferences }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'preferences.template.import'; readonly path: string }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'credential.bundle.read'; readonly path: string }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'credential.bundle.write'; readonly path: string; readonly temporaryPath: string; readonly contents: Uint8Array }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'tunnel.list' }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'tunnel.get'; readonly id: string }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'tunnel.save'; readonly draft: SshTunnelDraft }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'tunnel.remove'; readonly id: string }
  | { readonly version: 1; readonly type: 'request'; readonly requestId: string; readonly command: 'shutdown' };

export type StorageWorkerResult =
  | { readonly kind: 'identity'; readonly value: TrustedHostKey | null }
  | { readonly kind: 'insert'; readonly value: 'inserted' | 'matched' | 'changed' }
  | { readonly kind: 'removed'; readonly value: boolean }
  | { readonly kind: 'migrated'; readonly value: { readonly sourceCount: number; readonly verifiedCount: number } }
  | { readonly kind: 'sessions'; readonly value: readonly SavedSessionDefinition[] }
  | { readonly kind: 'sessionCount'; readonly value: number }
  | { readonly kind: 'folders'; readonly value: readonly SavedSessionFolder[] }
  | { readonly kind: 'folder'; readonly value: SavedSessionFolder }
  | { readonly kind: 'session'; readonly value: SavedSessionDefinition }
  | { readonly kind: 'sessionLookup'; readonly value: SavedSessionDefinition | null }
  | { readonly kind: 'credentialReference'; readonly value: CredentialReference | null }
  | { readonly kind: 'sshCredentialReferences'; readonly value: readonly SshCredentialBundleProfile[] }
  | { readonly kind: 'changed'; readonly value: boolean }
  | { readonly kind: 'folderExport'; readonly value: { readonly folderCount: number; readonly sessionCount: number } }
  | { readonly kind: 'folderImport'; readonly value: { readonly folderCount: number; readonly sessionCount: number; readonly createdFolderCount: number; readonly createdSessionCount: number } }
  | { readonly kind: 'tunnels'; readonly value: readonly SshTunnelDefinition[] }
  | { readonly kind: 'tunnelLookup'; readonly value: SshTunnelDefinition | null }
  | { readonly kind: 'tunnel'; readonly value: SshTunnelDefinition }
  | { readonly kind: 'macroDefinitions'; readonly value: readonly MacroDefinition[] }
  | { readonly kind: 'macroDefinition'; readonly value: MacroDefinition }
  | { readonly kind: 'macroLookup'; readonly value: MacroDefinition | null }
  | { readonly kind: 'macroShortcuts'; readonly value: readonly MacroShortcutBinding[] }
  | { readonly kind: 'macroShortcut'; readonly value: MacroShortcutBinding }
  | { readonly kind: 'preferences'; readonly value: WorkbenchPreferences }
  | { readonly kind: 'preferencesTemplateExport'; readonly value: { readonly bytesSaved: number } }
  | { readonly kind: 'encryptedCredentialBundle'; readonly value: Uint8Array }
  | { readonly kind: 'encryptedCredentialBundleWrite'; readonly value: { readonly bytesSaved: number } }
  | { readonly kind: 'shutdown' };

export type StorageWorkerErrorCode = 'BUSY' | 'CONFLICT' | 'CORRUPT' | 'INVALID_BUNDLE' | 'NOT_FOUND' | 'UNAVAILABLE';

export type StorageWorkerMessage =
  | { readonly version: 1; readonly type: 'ready' }
  | { readonly version: 1; readonly type: 'startup-error'; readonly errorCode: StorageWorkerErrorCode }
  | { readonly version: 1; readonly type: 'reply'; readonly requestId: string; readonly ok: true; readonly result: StorageWorkerResult }
  | { readonly version: 1; readonly type: 'reply'; readonly requestId: string; readonly ok: false; readonly errorCode: StorageWorkerErrorCode };

export function storageWorkerErrorCode(error: unknown): StorageWorkerErrorCode {
  if (error instanceof StorageOperationError) {
    if (error.kind === 'busy') return 'BUSY';
    if (error.kind === 'conflict') return 'CONFLICT';
    if (error.kind === 'corrupt') return 'CORRUPT';
    if (error.kind === 'invalid') return 'INVALID_BUNDLE';
    if (error.kind === 'not-found') return 'NOT_FOUND';
  }
  return 'UNAVAILABLE';
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function endpoint(value: unknown): value is SshHostEndpoint {
  if (!record(value) || !exactKeys(value, ['host', 'port'])) return false;
  const canonical = canonicalizeSshHostEndpoint(value);
  return canonical !== undefined && canonical.host === value.host && canonical.port === value.port;
}

function identity(value: unknown): value is TrustedHostKey {
  if (!record(value) || !exactKeys(value, ['endpoint', 'algorithm', 'fingerprint', 'publicKey', 'trustedAt', 'approvalSource']) ||
      !endpoint(value.endpoint) || !Number.isSafeInteger(value.trustedAt) || (value.trustedAt as number) < 0 || value.approvalSource !== 'user') return false;
  return isHostKeyEvidence({ algorithm: value.algorithm, fingerprint: value.fingerprint, publicKey: value.publicKey });
}

export function parseStorageWorkerRequest(value: unknown): StorageWorkerRequest | undefined {
  if (!record(value) || value.version !== STORAGE_WORKER_PROTOCOL_VERSION || value.type !== 'request' ||
      typeof value.requestId !== 'string' || !REQUEST_ID.test(value.requestId) || typeof value.command !== 'string') return undefined;
  if (value.command === 'hostTrust.find' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'endpoint']) && endpoint(value.endpoint)) return value as unknown as StorageWorkerRequest;
  if (value.command === 'hostTrust.trustIfAbsent' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'identity']) && identity(value.identity)) return value as unknown as StorageWorkerRequest;
  if (value.command === 'hostTrust.remove' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'endpoint']) && endpoint(value.endpoint)) return value as unknown as StorageWorkerRequest;
  if (value.command === 'hostTrust.importLegacy' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'identities']) && Array.isArray(value.identities) && value.identities.length <= MAX_MIGRATION_ENTRIES) {
    let totalBytes = 0;
    for (const item of value.identities) {
      if (!identity(item)) return undefined;
      totalBytes += item.publicKey.byteLength;
      if (totalBytes > MAX_MIGRATION_BYTES) return undefined;
    }
    return value as unknown as StorageWorkerRequest;
  }
  if (value.command === 'session.list' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'query']) && normalizeSessionSearch(value.query) !== undefined) {
    return value as unknown as StorageWorkerRequest;
  }
  if (value.command === 'session.count' && exactKeys(value, ['version', 'type', 'requestId', 'command'])) return value as unknown as StorageWorkerRequest;
  if (value.command === 'session.get' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'id']) && isSessionDefinitionId(value.id)) {
    return value as unknown as StorageWorkerRequest;
  }
  if (value.command === 'session.credential.get' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'id']) && isSessionDefinitionId(value.id)) {
    return value as unknown as StorageWorkerRequest;
  }
  if (value.command === 'session.credential.list' && exactKeys(value, ['version', 'type', 'requestId', 'command'])) return value as unknown as StorageWorkerRequest;
  if (value.command === 'session.credential.set' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'id', 'reference', 'expectedReference']) &&
      isSessionDefinitionId(value.id) && (value.reference === null || parseCredentialReference(value.reference)) &&
      (value.expectedReference === null || parseCredentialReference(value.expectedReference))) return value as unknown as StorageWorkerRequest;
  if (value.command === 'session.credential.attach-imported' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'credentials']) &&
      Array.isArray(value.credentials) && value.credentials.length > 0 && value.credentials.length <= MAX_SSH_CREDENTIAL_BUNDLE_ENTRIES &&
      value.credentials.every(isImportedSshCredentialReference) && new Set(value.credentials.map(item => item.sessionId)).size === value.credentials.length &&
      new Set(value.credentials.map(item => item.reference)).size === value.credentials.length) return value as unknown as StorageWorkerRequest;
  if (value.command === 'session.credential.clear-all' && exactKeys(value, ['version', 'type', 'requestId', 'command'])) return value as unknown as StorageWorkerRequest;
  if (value.command === 'session.create' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'draft']) && normalizeSavedSessionDraft(value.draft)) {
    return value as unknown as StorageWorkerRequest;
  }
  if (value.command === 'session.remember' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'draft']) && normalizeSavedSessionDraft(value.draft)) {
    return value as unknown as StorageWorkerRequest;
  }
  if (value.command === 'session.favorite' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'id', 'favorite']) &&
      isSessionDefinitionId(value.id) && typeof value.favorite === 'boolean') return value as unknown as StorageWorkerRequest;
  if (value.command === 'session.remove' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'id']) && isSessionDefinitionId(value.id)) {
    return value as unknown as StorageWorkerRequest;
  }
  if (value.command === 'session.folder.list' && exactKeys(value, ['version', 'type', 'requestId', 'command'])) return value as unknown as StorageWorkerRequest;
  if (value.command === 'session.folder.create' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'draft']) && normalizeSessionFolderDraft(value.draft)) {
    return value as unknown as StorageWorkerRequest;
  }
  if (value.command === 'session.folder.rename' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'id', 'name']) &&
      isSessionFolderId(value.id) && normalizeSessionFolderName(value.name) === value.name) return value as unknown as StorageWorkerRequest;
  if (value.command === 'session.folder.move' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'id', 'parentId']) &&
      isSessionFolderId(value.id) && (value.parentId === null || isSessionFolderId(value.parentId))) return value as unknown as StorageWorkerRequest;
  if (value.command === 'session.folder.remove' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'id']) && isSessionFolderId(value.id)) {
    return value as unknown as StorageWorkerRequest;
  }
  if (value.command === 'session.folder.export' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'folderId', 'path', 'temporaryPath']) &&
      isSessionFolderId(value.folderId) && isFilePath(value.path) && isExportTemporaryPath(value.path, value.temporaryPath)) return value as unknown as StorageWorkerRequest;
  if (value.command === 'session.folder.import' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'path']) && isFilePath(value.path)) {
    return value as unknown as StorageWorkerRequest;
  }
  if (value.command === 'session.move' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'id', 'folderId']) &&
      isSessionDefinitionId(value.id) && (value.folderId === null || isSessionFolderId(value.folderId))) return value as unknown as StorageWorkerRequest;
  if (value.command === 'macro.list' && exactKeys(value, ['version', 'type', 'requestId', 'command'])) return value as unknown as StorageWorkerRequest;
  if (value.command === 'macro.create' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'draft']) && normalizeMacroDraft(value.draft)) {
    return value as unknown as StorageWorkerRequest;
  }
  if (value.command === 'macro.update' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'id', 'draft']) &&
      isMacroId(value.id) && normalizeMacroDraft(value.draft)) return value as unknown as StorageWorkerRequest;
  if (value.command === 'macro.remove' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'id']) && isMacroId(value.id)) {
    return value as unknown as StorageWorkerRequest;
  }
  if (value.command === 'macro.shortcut.list' && exactKeys(value, ['version', 'type', 'requestId', 'command'])) return value as unknown as StorageWorkerRequest;
  if (value.command === 'macro.shortcut.set' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'macroId', 'code']) &&
      isMacroId(value.macroId) && isMacroShortcutCode(value.code)) return value as unknown as StorageWorkerRequest;
  if (value.command === 'macro.shortcut.remove' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'macroId']) && isMacroId(value.macroId)) {
    return value as unknown as StorageWorkerRequest;
  }
  if (value.command === 'preferences.get' && exactKeys(value, ['version', 'type', 'requestId', 'command'])) return value as unknown as StorageWorkerRequest;
  if (value.command === 'preferences.save' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'preferences']) &&
      normalizeWorkbenchPreferences(value.preferences)) return value as unknown as StorageWorkerRequest;
  if (value.command === 'preferences.template.export' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'path', 'temporaryPath', 'preferences']) &&
      isFilePath(value.path) && isExportTemporaryPath(value.path, value.temporaryPath) && isCurrentWorkbenchPreferences(value.preferences)) {
    return value as unknown as StorageWorkerRequest;
  }
  if (value.command === 'preferences.template.import' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'path']) && isFilePath(value.path)) {
    return value as unknown as StorageWorkerRequest;
  }
  if (value.command === 'credential.bundle.read' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'path']) && isFilePath(value.path)) {
    return value as unknown as StorageWorkerRequest;
  }
  if (value.command === 'credential.bundle.write' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'path', 'temporaryPath', 'contents']) &&
      isFilePath(value.path) && isExportTemporaryPath(value.path, value.temporaryPath) && value.contents instanceof Uint8Array &&
      value.contents.byteLength > 0 && value.contents.byteLength <= MAX_SSH_CREDENTIAL_BUNDLE_BYTES) return value as unknown as StorageWorkerRequest;
  if (value.command === 'tunnel.list' && exactKeys(value, ['version', 'type', 'requestId', 'command'])) return value as unknown as StorageWorkerRequest;
  if ((value.command === 'tunnel.get' || value.command === 'tunnel.remove') && exactKeys(value, ['version', 'type', 'requestId', 'command', 'id']) &&
      isTunnelId(value.id)) return value as unknown as StorageWorkerRequest;
  if (value.command === 'tunnel.save' && exactKeys(value, ['version', 'type', 'requestId', 'command', 'draft']) && normalizeSshTunnelDraft(value.draft)) {
    return value as unknown as StorageWorkerRequest;
  }
  if (value.command === 'shutdown' && exactKeys(value, ['version', 'type', 'requestId', 'command'])) return value as unknown as StorageWorkerRequest;
  return undefined;
}

export function parseStorageWorkerMessage(value: unknown): StorageWorkerMessage | undefined {
  if (!record(value) || value.version !== STORAGE_WORKER_PROTOCOL_VERSION || typeof value.type !== 'string') return undefined;
  if (value.type === 'ready' && exactKeys(value, ['version', 'type'])) return value as unknown as StorageWorkerMessage;
  if (value.type === 'startup-error' && exactKeys(value, ['version', 'type', 'errorCode']) && isErrorCode(value.errorCode)) return value as unknown as StorageWorkerMessage;
  if (value.type !== 'reply' || !REQUEST_ID.test(String(value.requestId)) || typeof value.ok !== 'boolean') return undefined;
  if (!value.ok && exactKeys(value, ['version', 'type', 'requestId', 'ok', 'errorCode']) && isErrorCode(value.errorCode)) return value as unknown as StorageWorkerMessage;
  if (!value.ok || !exactKeys(value, ['version', 'type', 'requestId', 'ok', 'result']) || !parseResult(value.result)) return undefined;
  return value as unknown as StorageWorkerMessage;
}

function parseResult(value: unknown): value is StorageWorkerResult {
  if (!record(value) || typeof value.kind !== 'string') return false;
  if (value.kind === 'identity' && exactKeys(value, ['kind', 'value']) && (value.value === null || identity(value.value))) return true;
  if (value.kind === 'insert' && exactKeys(value, ['kind', 'value']) && ['inserted', 'matched', 'changed'].includes(String(value.value))) return true;
  if (value.kind === 'removed' && exactKeys(value, ['kind', 'value']) && typeof value.value === 'boolean') return true;
  if (value.kind === 'migrated' && exactKeys(value, ['kind', 'value']) && record(value.value) && exactKeys(value.value, ['sourceCount', 'verifiedCount']) &&
      Number.isSafeInteger(value.value.sourceCount) && value.value.sourceCount === value.value.verifiedCount && (value.value.sourceCount as number) >= 0) return true;
  if (value.kind === 'sessions' && exactKeys(value, ['kind', 'value']) && Array.isArray(value.value) && value.value.every(isSavedSessionDefinition)) return true;
  if (value.kind === 'sessionCount' && exactKeys(value, ['kind', 'value']) && Number.isSafeInteger(value.value) && (value.value as number) >= 0) return true;
  if (value.kind === 'folders' && exactKeys(value, ['kind', 'value']) && Array.isArray(value.value) && value.value.every(isSavedSessionFolder)) return true;
  if (value.kind === 'folder' && exactKeys(value, ['kind', 'value']) && isSavedSessionFolder(value.value)) return true;
  if (value.kind === 'session' && exactKeys(value, ['kind', 'value']) && isSavedSessionDefinition(value.value)) return true;
  if (value.kind === 'sessionLookup' && exactKeys(value, ['kind', 'value']) && (value.value === null || isSavedSessionDefinition(value.value))) return true;
  if (value.kind === 'credentialReference' && exactKeys(value, ['kind', 'value']) && (value.value === null || parseCredentialReference(value.value))) return true;
  if (value.kind === 'sshCredentialReferences' && exactKeys(value, ['kind', 'value']) && Array.isArray(value.value) &&
      value.value.length <= MAX_SSH_CREDENTIAL_BUNDLE_ENTRIES && value.value.every(isSshCredentialBundleProfile)) return true;
  if (value.kind === 'changed' && exactKeys(value, ['kind', 'value']) && typeof value.value === 'boolean') return true;
  if (value.kind === 'folderExport' && exactKeys(value, ['kind', 'value']) && isRecordCounts(value.value, ['folderCount', 'sessionCount'])) return true;
  if (value.kind === 'folderImport' && exactKeys(value, ['kind', 'value']) && isRecordCounts(value.value,
    ['folderCount', 'sessionCount', 'createdFolderCount', 'createdSessionCount'])) {
    const counts = value.value as Record<'folderCount' | 'sessionCount' | 'createdFolderCount' | 'createdSessionCount', number>;
    return counts.folderCount > 0 && counts.createdFolderCount <= counts.folderCount && counts.createdSessionCount <= counts.sessionCount &&
      counts.folderCount + counts.sessionCount <= MAX_MIGRATION_ENTRIES;
  }
  if (value.kind === 'tunnels' && exactKeys(value, ['kind', 'value']) && Array.isArray(value.value) && value.value.every(isSshTunnelDefinition)) return true;
  if (value.kind === 'tunnelLookup' && exactKeys(value, ['kind', 'value']) && (value.value === null || isSshTunnelDefinition(value.value))) return true;
  if (value.kind === 'tunnel' && exactKeys(value, ['kind', 'value']) && isSshTunnelDefinition(value.value)) return true;
  if (value.kind === 'macroDefinitions' && exactKeys(value, ['kind', 'value']) && Array.isArray(value.value) && value.value.every(isMacroDefinition)) return true;
  if (value.kind === 'macroDefinition' && exactKeys(value, ['kind', 'value']) && isMacroDefinition(value.value)) return true;
  if (value.kind === 'macroLookup' && exactKeys(value, ['kind', 'value']) && (value.value === null || isMacroDefinition(value.value))) return true;
  if (value.kind === 'macroShortcuts' && exactKeys(value, ['kind', 'value']) && Array.isArray(value.value) && value.value.every(isMacroShortcutBinding)) return true;
  if (value.kind === 'macroShortcut' && exactKeys(value, ['kind', 'value']) && isMacroShortcutBinding(value.value)) return true;
  if (value.kind === 'preferences' && exactKeys(value, ['kind', 'value']) && isWorkbenchPreferences(value.value)) return true;
  if (value.kind === 'preferencesTemplateExport' && exactKeys(value, ['kind', 'value']) && record(value.value) &&
      exactKeys(value.value, ['bytesSaved']) && Number.isSafeInteger(value.value.bytesSaved) &&
      (value.value.bytesSaved as number) > 0 && (value.value.bytesSaved as number) <= MAX_WORKBENCH_SETTINGS_TEMPLATE_BYTES) return true;
  if (value.kind === 'encryptedCredentialBundle' && exactKeys(value, ['kind', 'value']) && value.value instanceof Uint8Array &&
      value.value.byteLength > 0 && value.value.byteLength <= MAX_SSH_CREDENTIAL_BUNDLE_BYTES) return true;
  if (value.kind === 'encryptedCredentialBundleWrite' && exactKeys(value, ['kind', 'value']) && record(value.value) &&
      exactKeys(value.value, ['bytesSaved']) && Number.isSafeInteger(value.value.bytesSaved) && (value.value.bytesSaved as number) > 0 &&
      (value.value.bytesSaved as number) <= MAX_SSH_CREDENTIAL_BUNDLE_BYTES) return true;
  return value.kind === 'shutdown' && exactKeys(value, ['kind']);
}

function isImportedSshCredentialReference(value: unknown): value is ImportedSshCredentialReference {
  if (!record(value) || !exactKeys(value, ['sessionId', 'host', 'port', 'reference']) || !isSessionDefinitionId(value.sessionId) ||
      !parseCredentialReference(value.reference)) return false;
  return endpoint({ host: value.host, port: value.port });
}

function isSshCredentialBundleProfile(value: unknown): value is SshCredentialBundleProfile {
  return record(value) && exactKeys(value, ['profile', 'reference']) && isSavedSessionDefinition(value.profile) &&
    value.profile.kind === 'ssh' && parseCredentialReference(value.reference) !== undefined;
}

function isRecordCounts(value: unknown, keys: readonly string[]): value is Record<string, number> {
  return record(value) && exactKeys(value, keys) && keys.every(key => Number.isSafeInteger(value[key]) && (value[key] as number) >= 0 && (value[key] as number) <= MAX_MIGRATION_ENTRIES);
}

function isFilePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 32_767 && !value.includes('\0') && isAbsolute(value);
}

function isExportTemporaryPath(destination: string, value: unknown): value is string {
  if (!isFilePath(value) || dirname(value) !== dirname(destination)) return false;
  const prefix = `.${basename(destination)}.`;
  const filename = basename(value);
  if (!filename.startsWith(prefix) || !filename.endsWith('.tmp')) return false;
  const requestId = filename.slice(prefix.length, -'.tmp'.length);
  return REQUEST_ID.test(requestId);
}

function isErrorCode(value: unknown): value is StorageWorkerErrorCode {
  return value === 'BUSY' || value === 'CONFLICT' || value === 'CORRUPT' || value === 'INVALID_BUNDLE' || value === 'NOT_FOUND' || value === 'UNAVAILABLE';
}
