import { randomUUID } from 'node:crypto';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { StorageOperationError } from '../../../../packages/application/src/storage-errors.ts';
import type { LocalTunnelCatalog } from '../../../../packages/application/src/ssh-tunnels.ts';
import type { LocalTunnelDefinition, LocalTunnelDraft } from '../../../../packages/domain/src/ssh-tunnel.ts';
import { isLocalTunnelDefinition, isTunnelId, normalizeLocalTunnelDraft } from '../../../../packages/domain/src/ssh-tunnel.ts';

interface TunnelRow {
  readonly id: unknown;
  readonly session_id: unknown;
  readonly name: unknown;
  readonly mode: unknown;
  readonly bind_host: unknown;
  readonly bind_port: unknown;
  readonly target_host: unknown;
  readonly target_port: unknown;
  readonly created_at: unknown;
}

export class SqliteTunnelRepository implements LocalTunnelCatalog {
  private readonly listStatement: StatementSync;
  private readonly findStatement: StatementSync;
  private readonly findSshSession: StatementSync;
  private readonly insertStatement: StatementSync;
  private readonly updateStatement: StatementSync;
  private readonly deleteStatement: StatementSync;

  constructor(database: DatabaseSync) {
    this.listStatement = database.prepare(`SELECT id, session_id, name, mode, bind_host, bind_port, target_host, target_port, created_at
      FROM tunnel_definitions WHERE mode = 'local' ORDER BY created_at, id`);
    this.findStatement = database.prepare(`SELECT id, session_id, name, mode, bind_host, bind_port, target_host, target_port, created_at
      FROM tunnel_definitions WHERE id = ? AND mode = 'local'`);
    this.findSshSession = database.prepare(`SELECT kind, options_json FROM session_definitions WHERE id = ?`);
    this.insertStatement = database.prepare(`INSERT INTO tunnel_definitions
      (id, session_id, name, mode, bind_host, bind_port, target_host, target_port, enabled, created_at)
      VALUES (?, ?, ?, 'local', '127.0.0.1', ?, ?, ?, 0, ?)`);
    this.updateStatement = database.prepare(`UPDATE tunnel_definitions SET session_id = ?, name = ?, bind_host = '127.0.0.1',
      bind_port = ?, target_host = ?, target_port = ?, enabled = 0 WHERE id = ? AND mode = 'local'`);
    this.deleteStatement = database.prepare(`DELETE FROM tunnel_definitions WHERE id = ? AND mode = 'local'`);
  }

  async listLocalTunnels(): Promise<readonly LocalTunnelDefinition[]> {
    try {
      return (this.listStatement.all() as unknown as TunnelRow[]).map(decodeTunnelRow);
    } catch (error) { throw mapTunnelError(error); }
  }

  async getLocalTunnel(id: string): Promise<LocalTunnelDefinition | undefined> {
    try {
      if (!isTunnelId(id)) throw new StorageOperationError('invalid');
      const row = this.findStatement.get(id) as unknown as TunnelRow | undefined;
      return row ? decodeTunnelRow(row) : undefined;
    } catch (error) { throw mapTunnelError(error); }
  }

  async saveLocalTunnel(input: LocalTunnelDraft): Promise<LocalTunnelDefinition> {
    try {
      const draft = normalizeLocalTunnelDraft(input);
      if (!draft) throw new StorageOperationError('invalid');
      const session = this.findSshSession.get(draft.sessionId) as { readonly kind: unknown; readonly options_json: unknown } | undefined;
      if (!session) throw new StorageOperationError('not-found');
      if (session.kind !== 'ssh' || !(session.options_json === '{}' || session.options_json === '{"sftpOnly":true}')) {
        throw new StorageOperationError('invalid');
      }
      const id = draft.id ?? randomUUID();
      const current = this.findStatement.get(id) as unknown as TunnelRow | undefined;
      const createdAt = current ? decodeTunnelRow(current).createdAt : new Date().toISOString();
      if (current) {
        this.updateStatement.run(draft.sessionId, draft.name, draft.bindPort, draft.targetHost, draft.targetPort, id);
      } else {
        this.insertStatement.run(id, draft.sessionId, draft.name, draft.bindPort, draft.targetHost, draft.targetPort, createdAt);
      }
      const saved = this.findStatement.get(id) as unknown as TunnelRow | undefined;
      if (!saved) throw new StorageOperationError('corrupt');
      return decodeTunnelRow(saved);
    } catch (error) { throw mapTunnelError(error); }
  }

  async removeLocalTunnel(id: string): Promise<boolean> {
    try {
      if (!isTunnelId(id)) throw new StorageOperationError('invalid');
      return Number(this.deleteStatement.run(id).changes) > 0;
    } catch (error) { throw mapTunnelError(error); }
  }
}

function decodeTunnelRow(row: TunnelRow): LocalTunnelDefinition {
  if (typeof row.name !== 'string' || row.name.trim().length === 0) throw new StorageOperationError('corrupt');
  const value = { id: row.id, sessionId: row.session_id, name: row.name, mode: row.mode, bindHost: row.bind_host, bindPort: row.bind_port,
    targetHost: row.target_host, targetPort: row.target_port, createdAt: row.created_at };
  if (!isLocalTunnelDefinition(value)) throw new StorageOperationError('corrupt');
  return value;
}

function mapTunnelError(error: unknown): StorageOperationError {
  if (error instanceof StorageOperationError) return error;
  if (typeof error === 'object' && error !== null && 'code' in error && String((error as { code?: unknown }).code).startsWith('SQLITE_CONSTRAINT')) {
    return new StorageOperationError('conflict');
  }
  return new StorageOperationError('unavailable');
}
