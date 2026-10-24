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
  readonly sftpChannel: FakeSftp | undefined;
  readonly sftpError: Error | undefined;
  constructor(sftpChannel?: FakeSftp, sftpError?: Error) {
    super();
    this.sftpChannel = sftpChannel;
    this.sftpError = sftpError;
  }

  connect(config: ConnectConfig): this { this.config = config; return this; }
  shell(window: { cols?: number; rows?: number; term?: string }, callback: (error: Error | undefined, channel?: ClientChannel) => void): this {
    this.shellSize = window;
    this.channel.setWindow = (rows, cols, height, width) => { this.windowSize = [rows, cols, height, width]; };
    callback(undefined, this.channel);
    return this;
  }
  sftp(callback: (error: Error | undefined, channel?: unknown) => void): this {
    callback(this.sftpError, this.sftpChannel);
    return this;
  }
  end(): this { this.ended = true; return this; }
}

class DelayedSftpClient extends FakeClient {
  sftpCalls = 0;
  readonly sftpCallbacks: Array<(error: Error | undefined, channel?: unknown) => void> = [];
  override sftp(callback: (error: Error | undefined, channel?: unknown) => void): this {
    this.sftpCalls += 1;
    this.sftpCallbacks.push(callback);
    return this;
  }
}

class FakeSftp extends EventEmitter {
  ended = false;
  private readCount = 0;
  readonly entries: Array<{ readonly filename: string; readonly attrs: {
    readonly size: number; readonly mtime: number; isSymbolicLink(): boolean; isDirectory(): boolean; isFile(): boolean
  } }>;
  readonly delayRead: boolean;
  constructor(entries: Array<{ readonly filename: string; readonly attrs: {
    readonly size: number; readonly mtime: number; isSymbolicLink(): boolean; isDirectory(): boolean; isFile(): boolean
  } }>, delayRead = false) { super(); this.entries = entries; this.delayRead = delayRead; }
  realpath(_path: string, callback: (error: Error | undefined, path: string) => void): void { callback(undefined, '/home/alice'); }
  opendir(_path: string, callback: (error: Error | undefined, handle: Buffer) => void): void { callback(undefined, Buffer.from('dir')); }
  readdir(_handle: Buffer, callback: (error: Error | undefined, entries: typeof this.entries) => void): void {
    this.readCount += 1;
    if (this.readCount === 1 && this.delayRead) return;
    else if (this.readCount === 1) callback(undefined, this.entries);
    else callback(Object.assign(new Error('End of file'), { code: 1 }), []);
  }
  close(_handle: Buffer, callback: (error?: Error) => void): void { callback(); }
  end(): void { this.ended = true; this.emit('close'); }
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

test('SSH SFTP browser reuses the trusted connection, identifies links, bounds listings and closes its channel', async () => {
  const entries = Array.from({ length: 505 }, (_, index) => ({
    filename: `item-${String(index).padStart(3, '0')}`,
    attrs: {
      size: index, mtime: 1_800_000_000,
      isSymbolicLink: () => index === 1,
      isDirectory: () => index === 0,
      isFile: () => index > 1
    }
  }));
  const sftp = new FakeSftp(entries);
  const client = new FakeClient(sftp);
  const provider = createSshTransportProvider({ create: () => client as unknown as Client, parseHostKey: keyParser() }, () => {});
  const opened = provider.open(sessionId, endpoint, { username: 'alice', password: 'secret' }, size, async () => true);
  client.emit('ready');
  await opened;

  const listing = await provider.listRemoteDirectory(sessionId, '.');
  assert.equal(listing.path, '/home/alice');
  assert.equal(listing.entries.length, 500);
  assert.equal(listing.truncated, true);
  assert.equal(listing.entries[0]?.kind, 'directory');
  assert.equal(listing.entries.find(entry => entry.name === 'item-001')?.kind, 'symlink');
  assert.equal(client.sftpChannel, sftp, 'the SFTP subsystem is opened on the existing SSH client');
  await provider.close(sessionId);
  assert.equal(sftp.ended, true);
  assert.equal(client.ended, true);
});

test('cancelling a remote listing closes only the SFTP channel and leaves the SSH terminal usable', async () => {
  const sftp = new FakeSftp([], true);
  const client = new FakeClient(sftp);
  const provider = createSshTransportProvider({ create: () => client as unknown as Client, parseHostKey: keyParser() }, () => {});
  const opened = provider.open(sessionId, endpoint, { username: 'alice', password: 'secret' }, size, async () => true);
  client.emit('ready');
  await opened;

  const cancellation = new AbortController();
  const listing = provider.listRemoteDirectory(sessionId, '.', cancellation.signal);
  await new Promise<void>(resolve => setImmediate(resolve));
  cancellation.abort();
  await assert.rejects(listing, error => (error as { code?: string }).code === 'CANCELLED');
  assert.equal(sftp.ended, true);
  await provider.write(sessionId, 'echo still connected\r');
  assert.equal(client.ended, false);
  await provider.close(sessionId);
});

test('cancelling while the SFTP subsystem is opening settles immediately and closes a late channel', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const sftp = new FakeSftp([]);
  const client = new DelayedSftpClient(sftp);
  const provider = createSshTransportProvider({ create: () => client as unknown as Client, parseHostKey: keyParser() }, () => {});
  const opened = provider.open(sessionId, endpoint, { username: 'alice', password: 'secret' }, size, async () => true);
  client.emit('ready');
  await opened;

  const cancellation = new AbortController();
  const listing = provider.listRemoteDirectory(sessionId, '.', cancellation.signal);
  assert.equal(client.sftpCalls, 1);
  cancellation.abort();
  const result = await Promise.race([
    listing.then(() => 'RESOLVED', error => (error as { code?: string }).code ?? 'UNKNOWN'),
    new Promise<string>(resolve => setImmediate(() => resolve('STILL_PENDING')))
  ]);
  const competing = provider.listRemoteDirectory(sessionId, '.');
  const competingResult = await Promise.race([
    competing.then(() => 'RESOLVED', error => (error as { code?: string }).code ?? 'UNKNOWN'),
    new Promise<string>(resolve => setImmediate(() => resolve('STILL_PENDING')))
  ]);
  const openCountAfterRetry = client.sftpCalls;
  const shellSurvivedCancellation = !client.ended;
  client.sftpCallbacks[0]?.(undefined, sftp);
  client.sftpCallbacks[1]?.(undefined, new FakeSftp([]));
  await new Promise<void>(resolve => setImmediate(resolve));
  await Promise.allSettled([competing]);
  const lateChannelClosed = sftp.ended;
  await provider.close(sessionId);
  context.mock.timers.reset();

  assert.equal(result, 'CANCELLED');
  assert.equal(competingResult, 'BUSY');
  assert.equal(openCountAfterRetry, 1);
  assert.equal(shellSurvivedCancellation, true);
  assert.equal(lateChannelClosed, true);
});

test('an unanswered cancelled SFTP open stays guarded until its watchdog closes the transport', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const client = new DelayedSftpClient();
  const provider = createSshTransportProvider({ create: () => client as unknown as Client, parseHostKey: keyParser() }, () => {});
  const opened = provider.open(sessionId, endpoint, { username: 'alice', password: 'secret' }, size, async () => true);
  client.emit('ready');
  await opened;

  const cancellation = new AbortController();
  const listing = provider.listRemoteDirectory(sessionId, '.', cancellation.signal);
  cancellation.abort();
  await assert.rejects(listing, error => (error as { code?: string }).code === 'CANCELLED');
  const retry = provider.listRemoteDirectory(sessionId, '.');
  const retryResult = await Promise.race([
    retry.then(() => 'RESOLVED', error => (error as { code?: string }).code ?? 'UNKNOWN'),
    new Promise<string>(resolve => setImmediate(() => resolve('STILL_PENDING')))
  ]);
  const openCountAfterRetry = client.sftpCalls;

  context.mock.timers.tick(15_000);
  assert.equal(client.ended, true);
  await assert.rejects(provider.listRemoteDirectory(sessionId, '.'), error => (error as { code?: string }).code === 'UNAVAILABLE');
  context.mock.timers.reset();
  assert.equal(retryResult, 'BUSY');
  assert.equal(openCountAfterRetry, 1);
});

test('an unavailable SFTP subsystem produces a clear capability error without closing SSH', async () => {
  const client = new FakeClient(undefined, new Error('Unable to start subsystem: sftp'));
  const provider = createSshTransportProvider({ create: () => client as unknown as Client, parseHostKey: keyParser() }, () => {});
  const opened = provider.open(sessionId, endpoint, { username: 'alice', password: 'secret' }, size, async () => true);
  client.emit('ready');
  await opened;
  await assert.rejects(provider.listRemoteDirectory(sessionId, '.'), error => (error as { code?: string }).code === 'NOT_SUPPORTED');
  assert.equal(client.ended, false);
  await provider.write(sessionId, 'echo still connected\r');
  await provider.close(sessionId);
});
