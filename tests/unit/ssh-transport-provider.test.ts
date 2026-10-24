import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { Socket, connect as connectTcp, createServer } from 'node:net';
import type { Server } from 'node:net';
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

class ForwardingFakeClient extends FakeClient {
  forwardOut(_sourceAddress: string, _sourcePort: number, destinationAddress: string, destinationPort: number,
    callback: (error: Error | undefined, channel: ClientChannel) => void): this {
    const upstream = connectTcp(destinationPort, destinationAddress);
    upstream.once('connect', () => callback(undefined, upstream as unknown as ClientChannel));
    upstream.once('error', error => callback(error, undefined as unknown as ClientChannel));
    return this;
  }
}

class ForwardingTargetCaptureClient extends FakeClient {
  readonly destinations: Array<{ readonly host: string; readonly port: number }> = [];
  forwardOut(_sourceAddress: string, _sourcePort: number, destinationAddress: string, destinationPort: number,
    callback: (error: Error | undefined, channel: ClientChannel) => void): this {
    this.destinations.push({ host: destinationAddress, port: destinationPort });
    callback(undefined, new PassThrough() as unknown as ClientChannel);
    return this;
  }
}

class RemoteForwardingFakeClient extends FakeClient {
  readonly forwardInCalls: Array<{ readonly address: string; readonly port: number }> = [];
  readonly unforwardInCalls: Array<{ readonly address: string; readonly port: number }> = [];
  readonly assignedPort = 47_321;
  readonly acknowledgeUnforward: boolean;
  constructor(acknowledgeUnforward = true) { super(); this.acknowledgeUnforward = acknowledgeUnforward; }
  forwardIn(address: string, port: number, callback?: (error: Error | undefined, port: number) => void): this {
    this.forwardInCalls.push({ address, port });
    callback?.(undefined, port === 0 ? this.assignedPort : 0);
    return this;
  }
  unforwardIn(address: string, port: number, callback?: (error?: Error) => void): this {
    this.unforwardInCalls.push({ address, port });
    if (this.acknowledgeUnforward) callback?.();
    return this;
  }
  attemptRemoteConnection(port: number): { readonly channel?: PassThrough; readonly rejected: boolean } {
    const channel = new PassThrough();
    let accepted = false;
    let rejected = false;
    this.emit('tcp connection', { destIP: '127.0.0.1', destPort: port, srcIP: '127.0.0.1', srcPort: 53_222 },
      () => { accepted = true; return channel as unknown as ClientChannel; }, () => { rejected = true; });
    return { ...(accepted ? { channel } : {}), rejected };
  }
  emitRemoteConnection(port: number): PassThrough {
    const result = this.attemptRemoteConnection(port);
    if (result.rejected || !result.channel) throw new Error('Loopback forwarded connection was rejected');
    return result.channel;
  }
}

class DelayedRemoteForwardingFakeClient extends RemoteForwardingFakeClient {
  private forwardInCallback: ((error: Error | undefined, port: number) => void) | undefined;
  override forwardIn(address: string, port: number, callback?: (error: Error | undefined, port: number) => void): this {
    this.forwardInCalls.push({ address, port });
    this.forwardInCallback = callback;
    return this;
  }
  completeForwardIn(error?: Error, port = this.assignedPort): void {
    this.forwardInCallback?.(error, port);
  }
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

test('standalone SFTP authenticates without requesting a shell and lists files over the same transport', async () => {
  const sftp = new FakeSftp([]);
  const client = new FakeClient(sftp);
  const provider = createSshTransportProvider({ create: () => client as unknown as Client, parseHostKey: keyParser() }, () => {});
  const opened = provider.openFiles(sessionId, endpoint, { username: 'alice', password: 'secret-value' }, async () => true);
  client.emit('ready');
  await opened;

  assert.equal(client.shellSize, undefined, 'file-only connections do not request a shell channel');
  assert.equal(client.config?.password, undefined, 'the in-memory SSH client password is cleared after authentication');
  assert.deepEqual(await provider.listRemoteDirectory(sessionId, '.'), { path: '/home/alice', entries: [], truncated: false });
  await assert.rejects(provider.write(sessionId, 'whoami'), error => (error as { code?: string }).code === 'UNAVAILABLE');
  await provider.close(sessionId);
  assert.equal(sftp.ended, true);
  assert.equal(client.ended, true);
});

test('local SSH forwarding binds only on loopback, relays TCP bytes, and releases the listener on stop', async () => {
  const target: Server = createServer(socket => socket.pipe(socket));
  const targetPort = await listen(target);
  const client = new ForwardingFakeClient();
  const provider = createSshTransportProvider({ create: () => client as unknown as Client, parseHostKey: keyParser() }, () => {});
  const opened = provider.openFiles(sessionId, endpoint, { username: 'alice', password: 'secret-value' }, async () => true);
  client.emit('ready');
  await opened;
  const definition = { id: '33333333-3333-4333-8333-333333333333', sessionId, name: 'Echo', mode: 'local' as const,
    bindHost: '127.0.0.1' as const, bindPort: 0, targetHost: '127.0.0.1', targetPort, createdAt: '2026-10-24T00:00:00.000Z' };
  const bindPort = await provider.startForward(sessionId, definition);
  assert.ok(bindPort > 0);
  assert.equal(client.shellSize, undefined, 'local forwarding uses a files-only SSH connection without requesting a shell');
  assert.equal(await exchange(bindPort, 'through-forward'), 'through-forward');
  assert.equal(await exchangeAfterHalfClose(bindPort, 'half-close-through-forward'), 'half-close-through-forward');
  await provider.stopForward(sessionId, definition.id);
  assert.equal(await canConnect(bindPort), false, 'stopping closes the bound loopback port');
  await provider.close(sessionId);
  await closeServer(target);
});

test('dynamic SSH forwarding handles SOCKS5 no-auth CONNECT and rejects unsupported commands', async () => {
  const target: Server = createServer(socket => socket.pipe(socket));
  const targetPort = await listen(target);
  const client = new ForwardingFakeClient();
  const provider = createSshTransportProvider({ create: () => client as unknown as Client, parseHostKey: keyParser() }, () => {});
  try {
    const opened = provider.openFiles(sessionId, endpoint, { username: 'alice', password: 'secret-value' }, async () => true);
    client.emit('ready');
    await opened;
    const definition = { id: '33333333-3333-4333-8333-333333333341', sessionId, name: 'Browser proxy', mode: 'dynamic' as const,
      bindHost: '127.0.0.1' as const, bindPort: 0, createdAt: '2026-10-24T00:00:00.000Z' };
    const bindPort = await provider.startForward(sessionId, definition);

    const result = await socksRequest(bindPort, targetPort, 1, [0], 'through-socks');
    assert.deepEqual(result.methodReply, Buffer.from([5, 0]));
    assert.deepEqual(result.connectReply.subarray(0, 2), Buffer.from([5, 0]));
    assert.equal(result.echoed, 'through-socks');

    const unsupported = await socksRequest(bindPort, targetPort, 3, [0]);
    assert.deepEqual(unsupported.methodReply, Buffer.from([5, 0]));
    assert.deepEqual(unsupported.connectReply.subarray(0, 2), Buffer.from([5, 7]), 'UDP ASSOCIATE is rejected as unsupported');

    const noAuthentication = await socksRequest(bindPort, targetPort, 1, [2]);
    assert.deepEqual(noAuthentication.methodReply, Buffer.from([5, 0xff]), 'credentials are never requested or accepted');
    await provider.stopForward(sessionId, definition.id);
    assert.equal(await canConnect(bindPort), false, 'stopping the dynamic forward releases its listener');
  } finally {
    await provider.close(sessionId);
    await closeServer(target);
  }
});

test('dynamic SOCKS rejection keeps its connection counted until close and releases the slots', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const client = new ForwardingFakeClient();
  const provider = createSshTransportProvider({ create: () => client as unknown as Client, parseHostKey: keyParser() }, () => {});
  const sockets: Socket[] = [];
  try {
    const opened = provider.openFiles(sessionId, endpoint, { username: 'alice', password: 'secret-value' }, async () => true);
    client.emit('ready');
    await opened;
    const definition = { id: '33333333-3333-4333-8333-333333333343', sessionId, name: 'Bounded SOCKS proxy', mode: 'dynamic' as const,
      bindHost: '127.0.0.1' as const, bindPort: 0, createdAt: '2026-10-24T00:00:00.000Z' };
    const bindPort = await provider.startForward(sessionId, definition);

    const rejectMalformedGreeting = (): Promise<Buffer> => new Promise(resolve => {
      const socket = new Socket({ allowHalfOpen: true });
      sockets.push(socket);
      let received = Buffer.alloc(0);
      socket.connect(bindPort, '127.0.0.1');
      socket.once('connect', () => socket.write(Buffer.from([4, 0])));
      socket.on('data', chunk => {
        received = Buffer.concat([received, chunk]);
        if (received.length >= 2) resolve(received);
      });
      socket.once('close', () => resolve(received));
      socket.once('error', () => resolve(received));
    });

    const initialReplies = await Promise.all(Array.from({ length: 64 }, rejectMalformedGreeting));
    for (const reply of initialReplies) assert.deepEqual(reply, Buffer.from([5, 0xff]));

    const overflowReply = await rejectMalformedGreeting();
    assert.equal(overflowReply.length, 0, 'the 65th socket is dropped while 64 rejected client sockets remain open');

    const clientCloseEvents = sockets.map(socket => socket.destroyed ? Promise.resolve() : new Promise<void>(resolve => socket.once('close', resolve)));
    for (const socket of sockets) socket.destroy();
    await Promise.all(clientCloseEvents);
    await new Promise<void>(resolve => setImmediate(resolve));

    const availableSlot = new Socket({ allowHalfOpen: true });
    sockets.push(availableSlot);
    const methodReply = new Promise<Buffer>(resolve => {
      let received = Buffer.alloc(0);
      availableSlot.connect(bindPort, '127.0.0.1');
      availableSlot.once('connect', () => availableSlot.write(Buffer.from([5, 1, 0])));
      availableSlot.on('data', chunk => {
        received = Buffer.concat([received, chunk]);
        if (received.length >= 2) resolve(received);
      });
      availableSlot.once('close', () => resolve(received));
      availableSlot.once('error', () => resolve(received));
    });
    assert.deepEqual(await methodReply, Buffer.from([5, 0]), 'closed rejected sockets release their connection slots');
  } finally {
    for (const socket of sockets) socket.destroy();
    await provider.close(sessionId);
    context.mock.timers.reset();
  }
});

test('dynamic SOCKS forwarding passes IPv6 CONNECT destinations through SSH unchanged', async () => {
  const client = new ForwardingTargetCaptureClient();
  const provider = createSshTransportProvider({ create: () => client as unknown as Client, parseHostKey: keyParser() }, () => {});
  try {
    const opened = provider.openFiles(sessionId, endpoint, { username: 'alice', password: 'secret-value' }, async () => true);
    client.emit('ready');
    await opened;
    const definition = { id: '33333333-3333-4333-8333-333333333342', sessionId, name: 'IPv6 proxy', mode: 'dynamic' as const,
      bindHost: '127.0.0.1' as const, bindPort: 0, createdAt: '2026-10-24T00:00:00.000Z' };
    const bindPort = await provider.startForward(sessionId, definition);
    const targetPort = 443;
    const result = await socksRequest(bindPort, targetPort, 1, [0], undefined, 4,
      Buffer.from('20010db8000000000000000000000001', 'hex'));
    assert.deepEqual(result.connectReply.subarray(0, 2), Buffer.from([5, 0]));
    assert.deepEqual(client.destinations, [{ host: '2001:db8:0:0:0:0:0:1', port: targetPort }]);
    await provider.stopForward(sessionId, definition.id);
  } finally { await provider.close(sessionId); }
});

test('remote SSH forwarding requests only a loopback bind, relays to a local destination, and unbinds on stop', async () => {
  const target: Server = createServer(socket => socket.pipe(socket));
  const targetPort = await listen(target);
  const client = new RemoteForwardingFakeClient();
  const provider = createSshTransportProvider({ create: () => client as unknown as Client, parseHostKey: keyParser() }, () => {});
  try {
    const opened = provider.openFiles(sessionId, endpoint, { username: 'alice', password: 'secret-value' }, async () => true);
    client.emit('ready');
    await opened;
    const definition = { id: '33333333-3333-4333-8333-333333333336', sessionId, name: 'Reverse echo', mode: 'remote' as const,
      bindHost: '127.0.0.1' as const, bindPort: 0, targetHost: '127.0.0.1', targetPort, createdAt: '2026-10-24T00:00:00.000Z' };
    const bindPort = await provider.startForward(sessionId, definition);
    assert.equal(bindPort, client.assignedPort);
    assert.deepEqual(client.forwardInCalls, [{ address: '127.0.0.1', port: 0 }]);
    assert.equal(client.shellSize, undefined, 'remote forwarding uses a files-only SSH connection without requesting a shell');

    const channel = client.emitRemoteConnection(bindPort);
    const echoed = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for reverse forwarded bytes')), 2_000);
      channel.once('data', data => { clearTimeout(timer); resolve(data.toString('utf8')); });
      channel.once('error', error => { clearTimeout(timer); reject(error); });
    });
    channel.write('through-reverse-forward');
    assert.equal(await echoed, 'through-reverse-forward');

    await provider.stopForward(sessionId, definition.id);
    assert.deepEqual(client.unforwardInCalls, [{ address: '127.0.0.1', port: bindPort }]);
    assert.equal(channel.destroyed, true);
  } finally {
    await provider.close(sessionId);
    await closeServer(target);
  }
});

test('remote SSH forwarding rejects connections beyond the 64-channel bound and closes accepted channels on stop', async () => {
  const target: Server = createServer();
  const targetPort = await listen(target);
  const client = new RemoteForwardingFakeClient();
  const provider = createSshTransportProvider({ create: () => client as unknown as Client, parseHostKey: keyParser() }, () => {});
  try {
    const opened = provider.openFiles(sessionId, endpoint, { username: 'alice', password: 'secret-value' }, async () => true);
    client.emit('ready');
    await opened;
    const definition = { id: '33333333-3333-4333-8333-333333333337', sessionId, name: 'Bounded reverse echo', mode: 'remote' as const,
      bindHost: '127.0.0.1' as const, bindPort: 0, targetHost: '127.0.0.1', targetPort, createdAt: '2026-10-24T00:00:00.000Z' };
    const bindPort = await provider.startForward(sessionId, definition);
    const attempts = Array.from({ length: 65 }, () => client.attemptRemoteConnection(bindPort));
    assert.equal(attempts.filter(attempt => attempt.channel).length, 64);
    assert.equal(attempts.filter(attempt => attempt.rejected).length, 1);

    await provider.stopForward(sessionId, definition.id);
    assert.ok(attempts.filter(attempt => attempt.channel).every(attempt => attempt.channel?.destroyed));
  } finally {
    await provider.close(sessionId);
    await closeServer(target);
  }
});

test('a remote forwarded channel is closed when connecting to its local destination exceeds the open deadline', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const client = new RemoteForwardingFakeClient();
  const destinationSockets: PassThrough[] = [];
  const provider = createSshTransportProvider({ create: () => client as unknown as Client, parseHostKey: keyParser() }, () => {}, () => {
    const socket = new PassThrough();
    destinationSockets.push(socket);
    return socket as unknown as Socket;
  });
  try {
    const opened = provider.openFiles(sessionId, endpoint, { username: 'alice', password: 'secret-value' }, async () => true);
    client.emit('ready');
    await opened;
    const definition = { id: '33333333-3333-4333-8333-333333333339', sessionId, name: 'Slow reverse destination', mode: 'remote' as const,
      bindHost: '127.0.0.1' as const, bindPort: 0, targetHost: '127.0.0.1', targetPort: 5432, createdAt: '2026-10-24T00:00:00.000Z' };
    const bindPort = await provider.startForward(sessionId, definition);
    const channel = client.emitRemoteConnection(bindPort);
    assert.equal(destinationSockets.length, 1);

    context.mock.timers.tick(15_000);
    assert.equal(channel.destroyed, true);
    assert.equal(destinationSockets[0]?.destroyed, true);
    const retry = client.attemptRemoteConnection(bindPort);
    assert.ok(retry.channel, 'the timed-out connection releases its slot');
    retry.channel?.destroy();
  } finally {
    await provider.close(sessionId);
    context.mock.timers.reset();
  }
});

test('a late remote bind result is explicitly unbound after the setup timeout', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const client = new DelayedRemoteForwardingFakeClient();
  const provider = createSshTransportProvider({ create: () => client as unknown as Client, parseHostKey: keyParser() }, () => {});
  try {
    const opened = provider.openFiles(sessionId, endpoint, { username: 'alice', password: 'secret-value' }, async () => true);
    client.emit('ready');
    await opened;
    const definition = { id: '33333333-3333-4333-8333-333333333338', sessionId, name: 'Delayed reverse bind', mode: 'remote' as const,
      bindHost: '127.0.0.1' as const, bindPort: 0, targetHost: '127.0.0.1', targetPort: 5432, createdAt: '2026-10-24T00:00:00.000Z' };
    const starting = provider.startForward(sessionId, definition);
    context.mock.timers.tick(10_000);
    await assert.rejects(starting, error => (error as { readonly code?: string }).code === 'TIMEOUT');

    client.completeForwardIn();
    assert.deepEqual(client.unforwardInCalls, [{ address: '127.0.0.1', port: client.assignedPort }]);
  } finally {
    await provider.close(sessionId);
    context.mock.timers.reset();
  }
});

test('a missing remote unbind acknowledgement cannot hold stop beyond its deadline', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const client = new RemoteForwardingFakeClient(false);
  const provider = createSshTransportProvider({ create: () => client as unknown as Client, parseHostKey: keyParser() }, () => {});
  try {
    const opened = provider.openFiles(sessionId, endpoint, { username: 'alice', password: 'secret-value' }, async () => true);
    client.emit('ready');
    await opened;
    const definition = { id: '33333333-3333-4333-8333-333333333340', sessionId, name: 'Unacknowledged reverse bind', mode: 'remote' as const,
      bindHost: '127.0.0.1' as const, bindPort: 0, targetHost: '127.0.0.1', targetPort: 5432, createdAt: '2026-10-24T00:00:00.000Z' };
    const bindPort = await provider.startForward(sessionId, definition);
    const stopping = provider.stopForward(sessionId, definition.id);
    assert.deepEqual(client.unforwardInCalls, [{ address: '127.0.0.1', port: bindPort }]);

    context.mock.timers.tick(1_500);
    await stopping;
    assert.equal(client.ended, false, 'the worker provider remains available until the controller closes the dedicated SSH runtime');
    await provider.close(sessionId);
    assert.equal(client.ended, true, 'closing the dedicated transport drops an unacknowledged server-side bind');
  } finally {
    await provider.close(sessionId);
    context.mock.timers.reset();
  }
});

test('established SSH forwarded connections stay open beyond the channel-open timeout', async () => {
  const target: Server = createServer(socket => socket.pipe(socket));
  const targetPort = await listen(target);
  const client = new ForwardingFakeClient();
  const provider = createSshTransportProvider({ create: () => client as unknown as Client, parseHostKey: keyParser() }, () => {});
  const opened = provider.openFiles(sessionId, endpoint, { username: 'alice', password: 'secret-value' }, async () => true);
  client.emit('ready');
  await opened;
  const definition = { id: '33333333-3333-4333-8333-333333333334', sessionId, name: 'Long-lived echo', mode: 'local' as const,
    bindHost: '127.0.0.1' as const, bindPort: 0, targetHost: '127.0.0.1', targetPort, createdAt: '2026-10-24T00:00:00.000Z' };
  const bindPort = await provider.startForward(sessionId, definition);
  const socket = connectTcp(bindPort, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    await new Promise(resolve => setTimeout(resolve, 16_000));
    assert.equal(socket.destroyed, false, 'an established channel must not keep the open timeout armed');
    const echoed = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Long-lived forwarded echo timed out')), 2_000);
      socket.once('data', chunk => { clearTimeout(timer); resolve(chunk.toString('utf8')); });
      socket.once('error', error => { clearTimeout(timer); reject(error); });
    });
    socket.write('still-forwarded');
    assert.equal(await echoed, 'still-forwarded');
  } finally {
    socket.destroy();
    await provider.stopForward(sessionId, definition.id);
    await provider.close(sessionId);
    await closeServer(target);
  }
});

test('an actual occupied loopback port returns CONFLICT and leaves no listener behind', async () => {
  const occupied: Server = createServer();
  const bindPort = await listen(occupied);
  const client = new ForwardingFakeClient();
  const provider = createSshTransportProvider({ create: () => client as unknown as Client, parseHostKey: keyParser() }, () => {});
  const opened = provider.openFiles(sessionId, endpoint, { username: 'alice', password: 'secret-value' }, async () => true);
  client.emit('ready');
  await opened;
  const definition = { id: '33333333-3333-4333-8333-333333333335', sessionId, name: 'Occupied', mode: 'local' as const,
    bindHost: '127.0.0.1' as const, bindPort, targetHost: '127.0.0.1', targetPort: 1, createdAt: '2026-10-24T00:00:00.000Z' };

  try {
    await assert.rejects(provider.startForward(sessionId, definition), error => (error as { code?: string }).code === 'CONFLICT');
    await closeServer(occupied);
    assert.equal(await canConnect(bindPort), false, 'the failed bind must not leave a loopback listener behind');
    const retryPort = await provider.startForward(sessionId, { ...definition, id: '33333333-3333-4333-8333-333333333336' });
    assert.equal(retryPort, bindPort, 'the formerly occupied port can be reused after its owner closes');
    await provider.stopForward(sessionId, '33333333-3333-4333-8333-333333333336');
    assert.equal(await canConnect(bindPort), false, 'stopping the retry releases its port');
  } finally {
    await closeServer(occupied);
    await provider.close(sessionId);
  }
});

async function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') { reject(new Error('Expected an IP listener')); return; }
      resolve(address.port);
    });
  });
}

function socksRequest(bindPort: number, targetPort: number, command: number, methods: readonly number[], payload?: string,
  addressType: 1 | 3 | 4 = 1, addressBytes: Buffer = Buffer.from([127, 0, 0, 1])): Promise<{
  readonly methodReply: Buffer;
  readonly connectReply: Buffer;
  readonly echoed?: string;
}> {
  return new Promise((resolve, reject) => {
    const socket = connectTcp(bindPort, '127.0.0.1');
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('SOCKS5 request timed out')); }, 3_000);
    let state: 'methods' | 'reply' | 'echo' = 'methods';
    let received = Buffer.alloc(0);
    let methodReply: Buffer | undefined;
    let connectReply: Buffer | undefined;
    const finish = (error?: Error, result?: { readonly methodReply: Buffer; readonly connectReply: Buffer; readonly echoed?: string }): void => {
      clearTimeout(timer);
      if (error) reject(error);
      else if (result) resolve(result);
    };
    socket.once('connect', () => socket.write(Buffer.from([5, methods.length, ...methods])));
    socket.on('data', chunk => {
      try {
        received = Buffer.concat([received, chunk]);
        if (state === 'methods' && received.length >= 2) {
          methodReply = received.subarray(0, 2);
          received = received.subarray(2);
          if (methodReply[1] === 0xff) {
            finish(undefined, { methodReply, connectReply: Buffer.alloc(0) });
            socket.destroy();
            return;
          }
          state = 'reply';
          const addressField = addressType === 3 ? Buffer.concat([Buffer.from([addressBytes.length]), addressBytes]) : addressBytes;
          socket.write(Buffer.concat([Buffer.from([5, command, 0, addressType]), addressField,
            Buffer.from([targetPort >> 8, targetPort & 0xff])]));
        }
        if (state === 'reply' && received.length >= 10) {
          connectReply = received.subarray(0, 10);
          received = received.subarray(10);
          if (connectReply[1] !== 0 || !payload) {
            finish(undefined, { methodReply: methodReply!, connectReply });
            socket.destroy();
            return;
          }
          state = 'echo';
          socket.write(Buffer.from(payload));
        }
        if (state === 'echo' && received.length >= Buffer.byteLength(payload!)) {
          finish(undefined, { methodReply: methodReply!, connectReply: connectReply!, echoed: received.toString('utf8') });
          socket.destroy();
        }
      } catch (error) { finish(error instanceof Error ? error : new Error('Invalid SOCKS5 test response')); socket.destroy(); }
    });
    socket.once('error', error => finish(error));
  });
}

function exchange(port: number, data: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connectTcp(port, '127.0.0.1');
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('Forwarded echo timed out')); }, 2_000);
    socket.once('connect', () => socket.write(data));
    socket.once('data', chunk => { clearTimeout(timer); socket.end(); resolve(chunk.toString('utf8')); });
    socket.once('error', error => { clearTimeout(timer); reject(error); });
  });
}

function exchangeAfterHalfClose(port: number, data: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connectTcp(port, '127.0.0.1');
    let received = '';
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('Half-closed forwarded echo timed out')); }, 2_000);
    socket.on('data', chunk => { received += chunk.toString('utf8'); });
    socket.once('connect', () => socket.end(data));
    socket.once('end', () => { clearTimeout(timer); resolve(received); });
    socket.once('error', error => { clearTimeout(timer); reject(error); });
  });
}

function canConnect(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = connectTcp(port, '127.0.0.1');
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, 1_000);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.once('error', () => { clearTimeout(timer); resolve(false); });
  });
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>(resolve => server.close(() => resolve()));
}

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
