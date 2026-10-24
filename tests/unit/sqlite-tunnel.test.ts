import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SqliteHostTrustRepository } from '../../apps/desktop/src/adapters/sqlite-host-trust-repository.ts';
import { SqliteSessionCatalogRepository } from '../../apps/desktop/src/adapters/sqlite-session-catalog-repository.ts';
import { SqliteTunnelRepository } from '../../apps/desktop/src/adapters/sqlite-tunnel-repository.ts';
import { StorageOperationError } from '../../packages/application/src/storage-errors.ts';

test('SQLite persists local, remote and dynamic forwards against saved SSH and SFTP profiles only', async () => {
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
    const saved = await tunnels.saveSshTunnel(draft);
    assert.equal(saved.mode, 'local');
    if (saved.mode !== 'local') throw new Error('Expected a local tunnel');
    assert.deepEqual({ name: saved.name, bindHost: saved.bindHost, bindPort: saved.bindPort, targetHost: saved.targetHost },
      { name: 'Database', bindHost: '127.0.0.1', bindPort: 0, targetHost: 'db.internal' });
    assert.deepEqual(await tunnels.listSshTunnels(), [saved]);
    assert.deepEqual(await tunnels.getSshTunnel(saved.id), saved);
    assert.equal((await sessions.getSessionDefinition(ssh.id))?.id, ssh.id);

    const metrics = await tunnels.saveSshTunnel({ ...draft, name: 'Metrics', bindPort: 15_433 });
    const queue = await tunnels.saveSshTunnel({ ...draft, name: 'Queue', bindPort: 15_434 });
    const remote = await tunnels.saveSshTunnel({ ...draft, name: 'Reverse API', mode: 'remote', targetHost: '127.0.0.1', targetPort: 3000 });
    assert.equal(remote.mode, 'remote');
    assert.equal((await tunnels.getSshTunnel(remote.id))?.mode, 'remote');
    const dynamic = await tunnels.saveSshTunnel({ sessionId: ssh.id, name: 'Browser proxy', mode: 'dynamic', bindHost: '127.0.0.1', bindPort: 0 });
    assert.equal(dynamic.mode, 'dynamic');
    assert.deepEqual(await tunnels.getSshTunnel(dynamic.id), dynamic);
    const dynamicRow = database.prepare('SELECT target_host, target_port FROM tunnel_definitions WHERE id = ?').get(dynamic.id) as
      { readonly target_host: unknown; readonly target_port: unknown } | undefined;
    assert.equal(dynamicRow?.target_host, null, 'dynamic definitions persist without a fixed destination');
    assert.equal(dynamicRow?.target_port, null, 'dynamic definitions persist without a fixed destination');
    assert.equal((await tunnels.listSshTunnels()).length, 5, 'the catalog stores local, remote and dynamic definitions');

    const updated = await tunnels.saveSshTunnel({ ...draft, id: saved.id, sessionId: sftp.id, name: 'SFTP database', bindPort: 15432 });
    assert.equal(updated.id, saved.id);
    assert.equal(updated.sessionId, sftp.id);
    assert.equal(updated.bindPort, 15_432);
    await assert.rejects(() => tunnels.saveSshTunnel({ ...draft, sessionId: ftp.id }),
      error => error instanceof StorageOperationError && error.kind === 'invalid');
    await assert.rejects(() => tunnels.saveSshTunnel({ ...draft, bindHost: '0.0.0.0' as '127.0.0.1' }),
      error => error instanceof StorageOperationError && error.kind === 'invalid');

    assert.equal(await sessions.removeSession(sftp.id), true);
    assert.equal(await tunnels.getSshTunnel(saved.id), undefined, 'deleting its saved SSH profile cascades the dependent tunnel');
    assert.deepEqual((await tunnels.listSshTunnels()).map(tunnel => tunnel.name).sort(), [dynamic.name, metrics.name, queue.name, remote.name]);
  } finally { database.close(); }
});
