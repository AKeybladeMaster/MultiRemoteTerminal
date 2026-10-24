import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { HostTrustStoreError } from '../../../../packages/application/src/host-trust.ts';
import type { HostTrustInsertResult } from '../../../../packages/application/src/host-trust.ts';
import { canonicalizeSshHostEndpoint, isHostKeyEvidence, sameHostKey } from '../../../../packages/domain/src/host-trust.ts';
import type { SshHostEndpoint, TrustedHostKey } from '../../../../packages/domain/src/host-trust.ts';

const CURRENT_SCHEMA_VERSION = 2;
const SCHEMA_V1 = `
CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES folders(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 256),
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX folders_root_name ON folders(name) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX folders_child_name ON folders(parent_id, name) WHERE parent_id IS NOT NULL;

CREATE TABLE session_definitions (
  id TEXT PRIMARY KEY,
  folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK(kind IN ('local', 'ssh', 'telnet', 'rlogin', 'mosh', 'rdp', 'vnc', 'serial', 'ftp', 'xdmcp')),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 256),
  host TEXT,
  port INTEGER CHECK(port IS NULL OR port BETWEEN 1 AND 65535),
  username TEXT,
  credential_ref TEXT,
  options_json TEXT NOT NULL DEFAULT '{}',
  options_version INTEGER NOT NULL CHECK(options_version > 0),
  favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX session_definitions_folder_name ON session_definitions(folder_id, name);
CREATE INDEX session_definitions_kind_favorite ON session_definitions(kind, favorite);

CREATE TABLE session_tags (
  session_id TEXT NOT NULL REFERENCES session_definitions(id) ON DELETE CASCADE,
  tag TEXT NOT NULL CHECK(length(tag) BETWEEN 1 AND 128),
  PRIMARY KEY(session_id, tag)
);

CREATE TABLE tunnel_definitions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session_definitions(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK(mode IN ('local', 'remote', 'dynamic')),
  bind_host TEXT NOT NULL,
  bind_port INTEGER NOT NULL CHECK(bind_port BETWEEN 0 AND 65535),
  target_host TEXT,
  target_port INTEGER CHECK(target_port IS NULL OR target_port BETWEEN 1 AND 65535),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
  created_at TEXT NOT NULL
);
CREATE INDEX tunnel_definitions_session ON tunnel_definitions(session_id);

CREATE TABLE macro_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 256),
  description TEXT,
  steps_json TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK(schema_version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE macro_bindings (
  macro_id TEXT NOT NULL REFERENCES macro_definitions(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES session_definitions(id) ON DELETE CASCADE,
  PRIMARY KEY(macro_id, session_id)
);

CREATE TABLE ssh_host_keys (
  id TEXT PRIMARY KEY,
  canonical_host TEXT NOT NULL,
  port INTEGER NOT NULL CHECK(port BETWEEN 1 AND 65535),
  key_algorithm TEXT NOT NULL,
  public_key_base64 TEXT NOT NULL,
  sha256_fingerprint TEXT NOT NULL,
  trusted_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source = 'user'),
  UNIQUE(canonical_host, port)
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK(schema_version > 0),
  updated_at TEXT NOT NULL
);

CREATE TABLE file_transfer_jobs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session_definitions(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK(direction IN ('upload', 'download')),
  source TEXT NOT NULL,
  destination TEXT NOT NULL,
  state TEXT NOT NULL,
  bytes_total INTEGER CHECK(bytes_total IS NULL OR bytes_total >= 0),
  bytes_done INTEGER NOT NULL DEFAULT 0 CHECK(bytes_done >= 0),
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX file_transfer_jobs_state_created ON file_transfer_jobs(state, created_at);

CREATE TABLE provider_config (
  provider_id TEXT PRIMARY KEY,
  path TEXT,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  last_checked_at TEXT
);

CREATE TABLE daemon_definitions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  bind_host TEXT NOT NULL,
  port INTEGER NOT NULL CHECK(port BETWEEN 1 AND 65535),
  config_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  target_id TEXT,
  outcome TEXT NOT NULL,
  at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_events_at ON audit_events(at);
`;
const SCHEMA_V2 = `ALTER TABLE tunnel_definitions ADD COLUMN name TEXT NOT NULL DEFAULT 'Local forward';`;

export interface HostTrustMigrationResult {
  readonly sourceCount: number;
  readonly verifiedCount: number;
}

interface StoredHostKeyRow {
  readonly id: unknown;
  readonly canonical_host: unknown;
  readonly port: unknown;
  readonly key_algorithm: unknown;
  readonly public_key_base64: unknown;
  readonly sha256_fingerprint: unknown;
  readonly trusted_at: unknown;
  readonly source: unknown;
}

export class SqliteHostTrustRepository {
  private readonly database: DatabaseSync;
  private findByEndpoint!: StatementSync;
  private insert!: StatementSync;
  private removeByEndpoint!: StatementSync;

  constructor(database: DatabaseSync) {
    this.database = database;
  }

  migrate(): void {
    try {
      const row = this.database.prepare('PRAGMA user_version').get() as { readonly user_version?: unknown } | undefined;
      const version = row?.user_version;
      if (!Number.isSafeInteger(version) || (version as number) < 0 || (version as number) > CURRENT_SCHEMA_VERSION) {
        throw new HostTrustStoreError('corrupt');
      }
      let currentVersion = version as number;
      if (currentVersion === 0) {
        this.transaction(() => {
          this.database.exec(SCHEMA_V1);
          this.database.exec('PRAGMA user_version = 1');
        });
        currentVersion = 1;
      }
      if (currentVersion === 1) {
        this.transaction(() => {
          this.database.exec(SCHEMA_V2);
          this.database.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`);
        });
        currentVersion = CURRENT_SCHEMA_VERSION;
      }
      if (currentVersion !== CURRENT_SCHEMA_VERSION) throw new HostTrustStoreError('corrupt');
      this.prepareStatements();
    } catch (error) {
      throw mapStoreError(error);
    }
  }

  find(endpoint: SshHostEndpoint): TrustedHostKey | undefined {
    try {
      const canonical = checkedEndpoint(endpoint);
      const row = this.findByEndpoint.get(canonical.host, canonical.port) as StoredHostKeyRow | undefined;
      return row ? decodeRow(row) : undefined;
    } catch (error) {
      throw mapStoreError(error);
    }
  }

  trustIfAbsent(identity: TrustedHostKey): HostTrustInsertResult {
    try {
      const candidate = encodeIdentity(identity);
      return this.transaction(() => this.insertIfAbsent(candidate));
    } catch (error) {
      throw mapStoreError(error);
    }
  }

  importLegacy(identities: readonly TrustedHostKey[]): HostTrustMigrationResult {
    if (!Array.isArray(identities) || identities.length > 100_000) throw new HostTrustStoreError('corrupt');
    try {
      return this.transaction(() => {
        const validated = identities.map(encodeIdentity);
        for (const candidate of validated) {
          if (this.insertIfAbsent(candidate) === 'changed') throw new HostTrustStoreError('corrupt');
        }
        let verifiedCount = 0;
        for (const candidate of validated) {
          const stored = this.find(candidate.endpoint);
          if (!stored || !sameHostKey(stored, candidate) || stored.trustedAt !== candidate.trustedAt) {
            throw new HostTrustStoreError('corrupt');
          }
          verifiedCount += 1;
        }
        if (verifiedCount !== validated.length) throw new HostTrustStoreError('corrupt');
        return { sourceCount: validated.length, verifiedCount };
      });
    } catch (error) {
      throw mapStoreError(error);
    }
  }

  remove(endpoint: SshHostEndpoint): boolean {
    try {
      const canonical = checkedEndpoint(endpoint);
      const result = this.removeByEndpoint.run(canonical.host, canonical.port);
      return Number(result.changes) > 0;
    } catch (error) {
      throw mapStoreError(error);
    }
  }

  close(): void {
    this.database.close();
  }

  private insertIfAbsent(identity: TrustedHostKey): HostTrustInsertResult {
    const existingRow = this.findByEndpoint.get(identity.endpoint.host, identity.endpoint.port) as StoredHostKeyRow | undefined;
    if (existingRow) return sameHostKey(decodeRow(existingRow), identity) ? 'matched' : 'changed';
    this.insert.run(randomUUID(), identity.endpoint.host, identity.endpoint.port, identity.algorithm,
      Buffer.from(identity.publicKey).toString('base64'), identity.fingerprint, new Date(identity.trustedAt).toISOString(), identity.approvalSource);
    return 'inserted';
  }

  private prepareStatements(): void {
    this.findByEndpoint = this.database.prepare(`
      SELECT id, canonical_host, port, key_algorithm, public_key_base64, sha256_fingerprint, trusted_at, source
      FROM ssh_host_keys WHERE canonical_host = ? AND port = ?
    `);
    this.insert = this.database.prepare(`
      INSERT INTO ssh_host_keys (id, canonical_host, port, key_algorithm, public_key_base64, sha256_fingerprint, trusted_at, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.removeByEndpoint = this.database.prepare('DELETE FROM ssh_host_keys WHERE canonical_host = ? AND port = ?');
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      try { this.database.exec('ROLLBACK'); } catch { /* Preserve the original store error. */ }
      throw error;
    }
  }
}

function checkedEndpoint(input: SshHostEndpoint): SshHostEndpoint {
  const endpoint = canonicalizeSshHostEndpoint(input);
  if (!endpoint || endpoint.host !== input.host || endpoint.port !== input.port) throw new HostTrustStoreError('unavailable');
  return endpoint;
}

function encodeIdentity(identity: TrustedHostKey): TrustedHostKey {
  const endpoint = canonicalizeSshHostEndpoint(identity?.endpoint);
  const evidence = { algorithm: identity?.algorithm, fingerprint: identity?.fingerprint, publicKey: identity?.publicKey };
  if (!endpoint || endpoint.host !== identity.endpoint.host || endpoint.port !== identity.endpoint.port ||
      !isHostKeyEvidence(evidence) || !Number.isSafeInteger(identity.trustedAt) || identity.trustedAt < 0 || identity.approvalSource !== 'user') {
    throw new HostTrustStoreError('unavailable');
  }
  if (fingerprintOf(identity.publicKey) !== identity.fingerprint) throw new HostTrustStoreError('unavailable');
  return { endpoint, algorithm: identity.algorithm, fingerprint: identity.fingerprint,
    publicKey: Uint8Array.from(identity.publicKey), trustedAt: identity.trustedAt, approvalSource: 'user' };
}

function decodeRow(row: StoredHostKeyRow): TrustedHostKey {
  if (typeof row.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(row.id) || typeof row.canonical_host !== 'string' ||
      !Number.isSafeInteger(row.port) || typeof row.key_algorithm !== 'string' || typeof row.public_key_base64 !== 'string' ||
      typeof row.sha256_fingerprint !== 'string' || typeof row.trusted_at !== 'string' || row.source !== 'user') {
    throw new HostTrustStoreError('corrupt');
  }
  const endpoint = canonicalizeSshHostEndpoint({ host: row.canonical_host, port: row.port });
  const publicKey = Buffer.from(row.public_key_base64, 'base64');
  const trustedAt = Date.parse(row.trusted_at);
  if (!endpoint || endpoint.host !== row.canonical_host || endpoint.port !== row.port || publicKey.length === 0 || publicKey.length > 64 * 1024 ||
      publicKey.toString('base64') !== row.public_key_base64 || !Number.isSafeInteger(trustedAt) || new Date(trustedAt).toISOString() !== row.trusted_at ||
      !isHostKeyEvidence({ algorithm: row.key_algorithm, fingerprint: row.sha256_fingerprint, publicKey }) || fingerprintOf(publicKey) !== row.sha256_fingerprint) {
    throw new HostTrustStoreError('corrupt');
  }
  return { endpoint, algorithm: row.key_algorithm, fingerprint: row.sha256_fingerprint,
    publicKey: Uint8Array.from(publicKey), trustedAt, approvalSource: 'user' };
}

function fingerprintOf(publicKey: Uint8Array): string {
  return `SHA256:${createHash('sha256').update(publicKey).digest('base64').replace(/=+$/, '')}`;
}

export function toHostTrustStoreError(error: unknown): HostTrustStoreError {
  if (error instanceof HostTrustStoreError) return error;
  const sqliteCode = isRecord(error) && typeof error.errcode === 'number' ? error.errcode & 0xff : undefined;
  const message = error instanceof Error ? error.message : '';
  if (sqliteCode === 5 || sqliteCode === 6 || /SQLITE_(?:BUSY|LOCKED)|database is (?:locked|busy)/i.test(message)) {
    return new HostTrustStoreError('busy');
  }
  if (sqliteCode === 11 || sqliteCode === 26 || /SQLITE_(?:CORRUPT|NOTADB)|database disk image is malformed|not a database/i.test(message)) {
    return new HostTrustStoreError('corrupt');
  }
  return new HostTrustStoreError('unavailable');
}

function mapStoreError(error: unknown): HostTrustStoreError {
  return toHostTrustStoreError(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
