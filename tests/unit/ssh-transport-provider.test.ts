import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createSshTransportProvider } from '../../apps/desktop/src/workers/ssh-transport-provider.ts';
import type { SshTransportChannel as ClientChannel, SshTransportClient as Client, SshTransportConfig as ConnectConfig } from '../../apps/desktop/src/workers/ssh-transport-provider.ts';
import type { SshHostKeyParser } from '../../apps/desktop/src/adapters/host-key-evidence.ts';
import type { LocalTerminalEvent } from '../../packages/application/src/local-terminals.ts';
import type { HostKeyEvidence, SshHostEndpoint } from '../../packages/domain/src/host-trust.ts';
import type { TerminalSize } from '../../packages/domain/src/local-terminal.ts';

const endpoint: SshHostEndpoint = { host: 'server.example.net', port: 22 };
const size: TerminalSize = { columns: 90, rows: 30 };
const sessionId = '11111111-1111-4111-8111-111111111111';

function hostKey(): Buffer {
  const algorithm = Buffer.from('ssh-ed25519', 'ascii');
  const key = Buffer.alloc(4 + algorithm.length + 32);
  key.writeUInt32BE(algorithm.length, 0);
  algorithm.copy(key, 4);
  for (let index = 4 + algorithm.length; index < key.length; index += 1) key[index] = index & 0xff;
  return key;
}

class FakeClient extends EventEmitter {
  config: ConnectConfig | undefined;
  readonly channel = new PassThrough() as ClientChannel & PassThrough;
  ended = false;
  shellSize: { cols?: number; rows?: number; term?: string } | undefined;
  windowSize: [number, number, number, number] | undefined;

  connect(config: ConnectConfig): this { this.config = config; return this; }
  shell(window: { cols?: number; rows?: number; term?: string }, callback: (error: Error | undefined, channel?: ClientChannel) => void): this {
    this.shellSize = window;
    this.channel.setWindow = (rows, cols, height, width) => { this.windowSize = [rows, cols, height, width]; };
    callback(undefined, this.channel);
    return this;
  }
  end(): this { this.ended = true; return this; }
}

function keyParser(): SshHostKeyParser {
  return (() => ({ type: 'ssh-ed25519', isPrivateKey: () => false })) as unknown as SshHostKeyParser;
}

test('SSH provider verifies the raw host key, clears its password after auth, and streams/resizes bounded terminal output', async () => {
  const client = new FakeClient();
  const events: LocalTerminalEvent[] = [];
  const provider = createSshTransportProvider({ create: () => client as unknown as Client, parseHostKey: keyParser() }, event => events.push(event));
  const verified: HostKeyEvidence[] = [];
  const opened = provider.open(sessionId, endpoint, { username: 'alice', password: 'secret-value' }, size, async evidence => {
    verified.push(evidence);
    return true;
  });

  assert.equal(client.config?.host, endpoint.host);
  assert.equal(client.config?.port, endpoint.port);
  assert.deepEqual(client.config?.authHandler, ['password']);
  assert.equal(client.config?.hostHash, undefined);
  const verifier = client.config?.hostVerifier as (key: Buffer, callback: (accepted: boolean) => void) => void;
  const verification = new Promise<boolean>(resolve => verifier(hostKey(), resolve));
  assert.equal(await verification, true);
  assert.equal(verified.length, 1);
  assert.equal(verified[0]?.algorithm, 'ssh-ed25519');

  client.emit('ready');
  await opened;
  assert.equal(client.config?.password, undefined);
  assert.deepEqual(client.shellSize, { term: 'xterm-256color', cols: 90, rows: 30 });

  const received = new Promise<LocalTerminalEvent>(resolve => {
    const timer = setTimeout(() => { throw new Error('Remote output event was not emitted'); }, 1_000);
    const poll = () => {
      const event = events.find(item => item.kind === 'data');
      if (event) { clearTimeout(timer); resolve(event); }
      else setImmediate(poll);
    };
    poll();
  });
  client.channel.push('remote café\r\n');
  const output = await received;
  assert.equal(output.kind, 'data');
  if (output.kind === 'data') assert.equal(output.data, 'remote café\r\n');
  await provider.acknowledgeOutput(sessionId, 1);
  await provider.write(sessionId, 'echo ready\r');
  await provider.resize(sessionId, { columns: 120, rows: 40 });
  assert.deepEqual(client.windowSize, [40, 120, 0, 0]);
  await provider.close(sessionId);
  assert.equal(client.ended, true);
  await provider.acknowledgeOutput(sessionId, 2);
});

test('SSH authentication failure is categorized and closes the transport', async () => {
  const client = new FakeClient();
  const provider = createSshTransportProvider({ create: () => client as unknown as Client, parseHostKey: keyParser() }, () => {});
  const opened = provider.open(sessionId, endpoint, { username: 'alice', password: 'wrong' }, size, async () => true);
  client.emit('error', Object.assign(new Error('All configured authentication methods failed'), { level: 'client-authentication' }));
  await assert.rejects(opened, error => (error as { code?: string }).code === 'AUTHENTICATION_FAILED');
  assert.equal(client.ended, true);
});

test('SSH host-key rejection keeps its security category when ssh2 reports the handshake failure', async () => {
  const client = new FakeClient();
  const provider = createSshTransportProvider({ create: () => client as unknown as Client, parseHostKey: keyParser() }, () => {});
  const opened = provider.open(sessionId, endpoint, { username: 'alice', password: 'secret' }, size, async () => false);
  const verifier = client.config?.hostVerifier as (key: Buffer, callback: (accepted: boolean) => void) => void;
  const verification = new Promise<boolean>(resolve => verifier(hostKey(), resolve));
  assert.equal(await verification, false);
  client.emit('error', Object.assign(new Error('Host key verification failed'), { level: 'client-authentication' }));
  await assert.rejects(opened, error => (error as { code?: string }).code === 'HOST_KEY_REJECTED');
  assert.equal(client.ended, true);
});

test('SSH close during handshake ends the socket and rejects a late host approval', async () => {
  const client = new FakeClient();
  const provider = createSshTransportProvider({ create: () => client as unknown as Client, parseHostKey: keyParser() }, () => {});
  let releaseTrust!: (accepted: boolean) => void;
  const opened = provider.open(sessionId, endpoint, { username: 'alice', password: 'temporary' }, size,
    () => new Promise<boolean>(resolve => { releaseTrust = resolve; }));
  const verifier = client.config?.hostVerifier as (key: Buffer, callback: (accepted: boolean) => void) => void;
  const verification = new Promise<boolean>(resolve => verifier(hostKey(), resolve));
  await Promise.resolve();
  assert.equal(typeof releaseTrust, 'function');

  await provider.close(sessionId);
  await assert.rejects(opened, error => (error as { code?: string }).code === 'UNAVAILABLE');
  releaseTrust(true);
  assert.equal(await verification, false);
  assert.equal(client.ended, true);
});
