import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { HostTrustStoreError } from '../../../../packages/application/src/host-trust.ts';
import { SqliteHostTrustRepository, toHostTrustStoreError } from '../adapters/sqlite-host-trust-repository.ts';
import { SqliteSessionCatalogRepository } from '../adapters/sqlite-session-catalog-repository.ts';
import { SqliteTunnelRepository } from '../adapters/sqlite-tunnel-repository.ts';
import { SqliteMacroCatalogRepository } from '../adapters/sqlite-macro-catalog-repository.ts';
import { SqliteMacroShortcutRepository } from '../adapters/sqlite-macro-shortcut-repository.ts';
import { SqliteTransferRecoveryRepository } from '../adapters/sqlite-transfer-recovery-repository.ts';
import { backupBeforeSqliteMigration } from '../adapters/sqlite-migration-backup.ts';
import { CURRENT_SCHEMA_VERSION } from '../adapters/sqlite-host-trust-repository.ts';
import { SqliteWorkbenchPreferencesRepository } from '../adapters/sqlite-workbench-preferences-repository.ts';
import { readWorkbenchSettingsTemplate, writeWorkbenchSettingsTemplate } from '../adapters/workbench-settings-template-files.ts';
import { readEncryptedSshCredentialBundle, writeEncryptedSshCredentialBundle } from '../adapters/ssh-credential-bundle-files.ts';
import { parseStorageWorkerRequest, storageWorkerErrorCode, STORAGE_WORKER_PROTOCOL_VERSION } from './storage-protocol.ts';

const parent = process.parentPort;
if (!parent) throw new Error('Storage worker requires an Electron utility process');

const databasePath = process.env.MRT_STORAGE_DB_PATH;

let repository: SqliteHostTrustRepository;
let sessionCatalogRepository: SqliteSessionCatalogRepository;
let tunnelRepository: SqliteTunnelRepository;
let macroCatalogRepository: SqliteMacroCatalogRepository;
let macroShortcutRepository: SqliteMacroShortcutRepository;
let workbenchPreferencesRepository: SqliteWorkbenchPreferencesRepository;
let transferRecoveryRepository: SqliteTransferRecoveryRepository;
let appRunId = '';
let database: DatabaseSync | undefined;
try {
  if (!databasePath || !isAbsolute(databasePath)) throw new Error('Storage worker requires an absolute database path');
  const configuredAppRunId = process.env.MRT_APP_RUN_ID;
  if (!configuredAppRunId || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(configuredAppRunId)) {
    throw new Error('Storage worker requires an app run id');
  }
  appRunId = configuredAppRunId;
  await mkdir(dirname(databasePath), { recursive: true });
  database = new DatabaseSync(databasePath, {
    timeout: 5_000,
    enableForeignKeyConstraints: true,
    allowExtension: false,
    defensive: true
  });
  database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  await backupBeforeSqliteMigration(database, databasePath, CURRENT_SCHEMA_VERSION);
  repository = new SqliteHostTrustRepository(database);
  repository.migrate();
  sessionCatalogRepository = new SqliteSessionCatalogRepository(database);
  tunnelRepository = new SqliteTunnelRepository(database);
  macroCatalogRepository = new SqliteMacroCatalogRepository(database);
  macroShortcutRepository = new SqliteMacroShortcutRepository(database);
  workbenchPreferencesRepository = new SqliteWorkbenchPreferencesRepository(database);
  transferRecoveryRepository = new SqliteTransferRecoveryRepository(database);
  transferRecoveryRepository.markPreviousRunsInterrupted(appRunId);
} catch (error) {
  const normalizedError = toHostTrustStoreError(error);
  const errorCode = storageWorkerErrorCode(normalizedError);
  try { parent.postMessage({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'startup-error', errorCode }); } catch { /* Main observes worker exit. */ }
  try { database?.close(); } catch { /* Startup failure must not leave SQLite open while the worker exits. */ }
  process.exit(1);
}

function send(value: unknown): void {
  try { parent.postMessage(value); } catch { /* The main process owns worker teardown. */ }
}

let closed = false;
parent.on('message', async event => {
  const request = parseStorageWorkerRequest(event.data);
  if (!request) return;
  const requestId = request.requestId;
  try {
    if (closed) throw new HostTrustStoreError('unavailable');
    if (request.command === 'hostTrust.find') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'identity', value: repository.find(request.endpoint) ?? null } });
    } else if (request.command === 'hostTrust.trustIfAbsent') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'insert', value: repository.trustIfAbsent(request.identity) } });
    } else if (request.command === 'hostTrust.remove') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'removed', value: repository.remove(request.endpoint) } });
    } else if (request.command === 'hostTrust.importLegacy') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'migrated', value: repository.importLegacy(request.identities) } });
    } else if (request.command === 'session.list') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'sessions', value: await sessionCatalogRepository.listSessions(request.query) } });
    } else if (request.command === 'session.count') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'sessionCount', value: await sessionCatalogRepository.countSessions() } });
    } else if (request.command === 'session.get') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'sessionLookup', value: await sessionCatalogRepository.getSessionDefinition(request.id) ?? null } });
    } else if (request.command === 'session.credential.get') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'credentialReference', value: await sessionCatalogRepository.getSessionCredentialReference(request.id) ?? null } });
    } else if (request.command === 'session.credential.list') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'sshCredentialReferences', value: await sessionCatalogRepository.listSshCredentials() } });
    } else if (request.command === 'session.credential.set') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'changed', value: await sessionCatalogRepository.setSessionCredentialReference(request.id, request.reference, request.expectedReference) } });
    } else if (request.command === 'session.credential.attach-imported') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'changed', value: await sessionCatalogRepository.attachImportedSshCredentials(request.credentials) } });
    } else if (request.command === 'session.credential.clear-all') {
      await sessionCatalogRepository.clearAllSessionCredentialReferences();
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'changed', value: true } });
    } else if (request.command === 'session.create') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'session', value: await sessionCatalogRepository.createSession(request.draft) } });
    } else if (request.command === 'session.remember') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'session', value: await sessionCatalogRepository.rememberSession(request.draft) } });
    } else if (request.command === 'session.favorite') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'changed', value: await sessionCatalogRepository.setFavorite(request.id, request.favorite) } });
    } else if (request.command === 'session.remove') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'changed', value: await sessionCatalogRepository.removeSession(request.id) } });
    } else if (request.command === 'session.folder.list') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'folders', value: await sessionCatalogRepository.listFolders() } });
    } else if (request.command === 'session.folder.create') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'folder', value: await sessionCatalogRepository.createFolder(request.draft) } });
    } else if (request.command === 'session.folder.rename') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'changed', value: await sessionCatalogRepository.renameFolder(request.id, request.name) } });
    } else if (request.command === 'session.folder.move') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'changed', value: await sessionCatalogRepository.moveFolder(request.id, request.parentId) } });
    } else if (request.command === 'session.folder.remove') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'changed', value: await sessionCatalogRepository.removeFolder(request.id) } });
    } else if (request.command === 'session.folder.export') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'folderExport', value: await sessionCatalogRepository.exportFolderToFileUsingTemporaryPath(request.folderId, request.path, request.temporaryPath) } });
    } else if (request.command === 'session.folder.import') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'folderImport', value: await sessionCatalogRepository.importFolderFromFile(request.path) } });
    } else if (request.command === 'session.move') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'changed', value: await sessionCatalogRepository.moveSession(request.id, request.folderId) } });
    } else if (request.command === 'macro.list') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'macroDefinitions', value: macroCatalogRepository.listMacros() } });
    } else if (request.command === 'macro.create') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'macroDefinition', value: macroCatalogRepository.createMacro(request.draft) } });
    } else if (request.command === 'macro.update') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'macroLookup', value: macroCatalogRepository.updateMacro(request.id, request.draft) ?? null } });
    } else if (request.command === 'macro.remove') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'changed', value: macroCatalogRepository.removeMacro(request.id) } });
    } else if (request.command === 'macro.shortcut.list') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'macroShortcuts', value: macroShortcutRepository.list() } });
    } else if (request.command === 'macro.shortcut.set') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'macroShortcut', value: macroShortcutRepository.set(request.macroId, request.code) } });
    } else if (request.command === 'macro.shortcut.remove') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'changed', value: macroShortcutRepository.remove(request.macroId) } });
    } else if (request.command === 'preferences.get') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'preferences', value: workbenchPreferencesRepository.read() } });
    } else if (request.command === 'preferences.save') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'preferences', value: workbenchPreferencesRepository.save(request.preferences) } });
    } else if (request.command === 'preferences.template.export') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'preferencesTemplateExport', value: await writeWorkbenchSettingsTemplate(request.path, request.temporaryPath, request.preferences) } });
    } else if (request.command === 'preferences.template.import') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'preferences', value: await readWorkbenchSettingsTemplate(request.path) } });
    } else if (request.command === 'credential.bundle.read') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'encryptedCredentialBundle', value: await readEncryptedSshCredentialBundle(request.path) } });
    } else if (request.command === 'credential.bundle.write') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'encryptedCredentialBundleWrite', value: await writeEncryptedSshCredentialBundle(request.path, request.temporaryPath, request.contents) } });
    } else if (request.command === 'tunnel.list') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'tunnels', value: await tunnelRepository.listSshTunnels() } });
    } else if (request.command === 'tunnel.get') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'tunnelLookup', value: await tunnelRepository.getSshTunnel(request.id) ?? null } });
    } else if (request.command === 'tunnel.save') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'tunnel', value: await tunnelRepository.saveSshTunnel(request.draft) } });
    } else if (request.command === 'tunnel.remove') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'removed', value: await tunnelRepository.removeSshTunnel(request.id) } });
    } else if (request.command === 'transferRecovery.begin') {
      transferRecoveryRepository.begin({ operationId: request.operationId, runId: appRunId, transport: request.transport,
        direction: request.direction, fileName: request.fileName });
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true, result: { kind: 'changed', value: true } });
    } else if (request.command === 'transferRecovery.progress') {
      transferRecoveryRepository.updateProgress(request.operationId, request.bytesTransferred, request.totalBytes);
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true, result: { kind: 'changed', value: true } });
    } else if (request.command === 'transferRecovery.artifacts') {
      transferRecoveryRepository.updateRemoteArtifactNames(request.operationId, request.remoteArtifactNames);
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true, result: { kind: 'changed', value: true } });
    } else if (request.command === 'transferRecovery.finish') {
      transferRecoveryRepository.finish({ operationId: request.operationId, state: request.state,
        bytesTransferred: request.bytesTransferred, totalBytes: request.totalBytes, errorCode: request.errorCode });
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true, result: { kind: 'changed', value: true } });
    } else if (request.command === 'transferRecovery.list') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'fileTransferRecoveryPage', value: transferRecoveryRepository.listInterrupted(request.cursor) } });
    } else if (request.command === 'transferRecovery.find') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'fileTransferRecoveryLookup', value: transferRecoveryRepository.findInterrupted(request.operationId) ?? null } });
    } else if (request.command === 'transferRecovery.dismiss') {
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true,
        result: { kind: 'changed', value: transferRecoveryRepository.dismiss(request.operationId) } });
    } else {
      closed = true;
      repository.close();
      send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: true, result: { kind: 'shutdown' } });
    }
  } catch (error) {
    send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'reply', requestId, ok: false, errorCode: storageWorkerErrorCode(error) });
  }
});

send({ version: STORAGE_WORKER_PROTOCOL_VERSION, type: 'ready' });
