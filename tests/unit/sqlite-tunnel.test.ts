import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SqliteHostTrustRepository } from '../../apps/desktop/src/adapters/sqlite-host-trust-repository.ts';
import { SqliteSessionCatalogRepository } from '../../apps/desktop/src/adapters/sqlite-session-catalog-repository.ts';
import { SqliteTunnelRepository } from '../../apps/desktop/src/adapters/sqlite-tunnel-repository.ts';
import { StorageOperationError } from '../../packages/application/src/storage-errors.ts';

test('SQLite persists named loopback forwards against saved SSH and SFTP profiles only', async () => {
  const database = new DatabaseSync(':memory:');
  try {
    new SqliteHostTrustRepository(database).migrate();
    const sessions = new SqliteSessionCatalogRepository(database);
    const tunnels = new SqliteTunnelRepository(database);
    const ssh = await sessions.createSession({ kind: 'ssh', name: 'Gateway', host: 'gateway.example.net', port: 22 });
    const sftp = await sessions.createSession({ kind: 'sftp', name: 'Files', host: 'files.example.net', port: 2222 });
    const ftp = await sessions.createSession({ kind: 'ftp', name: 'FTP', host: 'ftp.example.net', port: 21, secure: false });

    const draft = { sessionId: ssh.id, name: 'Database', mode: 'local' as const, bindHost: '127.0.0.1' as const, bindPort: 0,
      targetHost: 'DB.INTERNAL.', targetPort: 5432 };
    const saved = await tunnels.saveLocalTunnel(draft);
    assert.deepEqual({ name: saved.name, bindHost: saved.bindHost, bindPort: saved.bindPort, targetHost: saved.targetHost },
      { name: 'Database', bindHost: '127.0.0.1', bindPort: 0, targetHost: 'db.internal' });
    assert.deepEqual(await tunnels.listLocalTunnels(), [saved]);
    assert.deepEqual(await tunnels.getLocalTunnel(saved.id), saved);
    assert.equal((await sessions.getSessionDefinition(ssh.id))?.id, ssh.id);

    const metrics = await tunnels.saveLocalTunnel({ ...draft, name: 'Metrics', bindPort: 15_433 });
    const queue = await tunnels.saveLocalTunnel({ ...draft, name: 'Queue', bindPort: 15_434 });
    assert.equal((await tunnels.listLocalTunnels()).length, 3, 'the catalog stores more than two definitions');

    const updated = await tunnels.saveLocalTunnel({ ...draft, id: saved.id, sessionId: sftp.id, name: 'SFTP database', bindPort: 15432 });
    assert.equal(updated.id, saved.id);
    assert.equal(updated.sessionId, sftp.id);
    assert.equal(updated.bindPort, 15_432);
    await assert.rejects(() => tunnels.saveLocalTunnel({ ...draft, sessionId: ftp.id }),
      error => error instanceof StorageOperationError && error.kind === 'invalid');
    await assert.rejects(() => tunnels.saveLocalTunnel({ ...draft, bindHost: '0.0.0.0' as '127.0.0.1' }),
      error => error instanceof StorageOperationError && error.kind === 'invalid');

    assert.equal(await sessions.removeSession(sftp.id), true);
    assert.equal(await tunnels.getLocalTunnel(saved.id), undefined, 'deleting its saved SSH profile cascades the dependent tunnel');
    assert.deepEqual((await tunnels.listLocalTunnels()).map(tunnel => tunnel.name).sort(), [metrics.name, queue.name]);
  } finally { database.close(); }
});
