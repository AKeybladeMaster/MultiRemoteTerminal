import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { createSocket } from 'node:dgram';
import type { RemoteInfo, Socket } from 'node:dgram';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTftpServerController } from '../../packages/application/src/tftp-server.ts';
import type { TftpServerProvider } from '../../packages/application/src/tftp-server.ts';
import { createCancellationSource } from '../../packages/application/src/cancellation.ts';
import { ReadOnlyTftpServer } from '../../apps/desktop/src/workers/tftp-server.ts';

const selection = { absolutePath: 'C:\\fixtures\\firmware', folderName: 'firmware' };

function readRequest(fileName: string): Buffer {
  return Buffer.concat([Buffer.from([0, 1]), Buffer.from(fileName, 'utf8'), Buffer.from([0]), Buffer.from('octet\0', 'ascii')]);
}

function sendPacket(socket: Socket, packet: Buffer, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.send(packet, port, '127.0.0.1', error => error ? reject(error) : resolve());
  });
}

interface ReceivedTftpPacket {
  readonly packet: Buffer;
  readonly remote: RemoteInfo;
}

function receivePacket(socket: Socket, timeoutMs: number): Promise<ReceivedTftpPacket> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      socket.removeListener('message', onMessage);
      socket.removeListener('error', onError);
    };
    const onMessage = (packet: Buffer, remote: RemoteInfo): void => {
      cleanup();
      resolve({ packet, remote });
    };
    const onError = (error: Error): void => { cleanup(); reject(error); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Timed out waiting for TFTP response')); }, timeoutMs);
    socket.on('message', onMessage);
    socket.on('error', onError);
  });
}

function closeUdpSocket(socket: Socket): Promise<void> {
  return new Promise(resolve => {
    socket.once('close', resolve);
    try { socket.close(); } catch { resolve(); }
  });
}

function harness(start: () => Promise<number> = async () => 51_234) {
  const exits = new Set<() => void>();
  const calls = { starts: 0, stops: 0, shutdowns: 0 };
  const provider: TftpServerProvider = {
    async start() { calls.starts++; return start(); },
    async stop() { calls.stops++; },
    async shutdown() { calls.shutdowns++; },
    subscribeToExit(listener) { exits.add(listener); return () => exits.delete(listener); }
  };
  return { controller: createTftpServerController(provider), calls, emitExit() { for (const listener of exits) listener(); } };
}

test('TFTP controller publishes loopback status and shutdown is idempotent', async () => {
  const { controller, calls } = harness();
  const events: string[] = [];
  controller.subscribe(status => events.push(status.state));

  assert.deepEqual(controller.getStatus(), { state: 'stopped' });
  assert.deepEqual(await controller.start(selection, 0), {
    ok: true, result: { state: 'running', address: '127.0.0.1', port: 51_234, folderName: 'firmware' }
  });
  assert.deepEqual(controller.getStatus(), { state: 'running', address: '127.0.0.1', port: 51_234, folderName: 'firmware' });
  await Promise.all([controller.closeAll(), controller.closeAll()]);

  assert.deepEqual(events, ['running', 'stopped']);
  assert.deepEqual(calls, { starts: 1, stops: 1, shutdowns: 1 });
  assert.deepEqual(await controller.start(selection, 69), { ok: false, error: { code: 'UNAVAILABLE', target: 'application', retryable: true } });
});

test('TFTP controller rejects overlapping starts and cleans up a cancelled startup', async () => {
  let finishStart!: (port: number) => void;
  const { controller, calls } = harness(() => new Promise<number>(resolve => { finishStart = resolve; }));
  const cancellation = createCancellationSource();
  const starting = controller.start(selection, 69, cancellation);
  await new Promise<void>(resolve => setImmediate(resolve));

  assert.deepEqual(await controller.start(selection, 69), {
    ok: false, error: { code: 'BUSY', target: 'application', retryable: true }
  });
  cancellation.abort();
  finishStart(51_235);

  assert.deepEqual(await starting, { ok: false, error: { code: 'CANCELLED', target: 'application', retryable: false } });
  assert.equal(controller.getStatus().state, 'stopped');
  assert.equal(calls.stops, 1);
  await controller.closeAll();
});

test('unexpected TFTP worker exit clears the running status', async () => {
  const { controller, emitExit } = harness();
  const events: string[] = [];
  controller.subscribe(status => events.push(status.state));
  await controller.start(selection, 69);

  emitExit();

  assert.deepEqual(controller.getStatus(), { state: 'stopped' });
  assert.deepEqual(events, ['running', 'stopped']);
  await controller.closeAll();
});

test('read-only TFTP serves a UTF-8 top-level filename longer than the former ASCII limit', async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), 'mrt-tftp-unicode-name-'));
  const fileName = `report-${'界'.repeat(140)}-🙂.bin`;
  const contents = Buffer.from('unicode filename payload');
  await writeFile(join(rootDirectory, fileName), contents);
  const server = new ReadOnlyTftpServer();
  let client: Socket | undefined;
  try {
    const port = await server.start(rootDirectory, 0);
    client = createSocket('udp4');
    const responsePromise = receivePacket(client, 2_000);
    await sendPacket(client, readRequest(fileName), port);
    const response = await responsePromise;
    assert.deepEqual([...response.packet.subarray(0, 4)], [0, 3, 0, 1]);
    assert.deepEqual(response.packet.subarray(4), contents);
  } finally {
    try {
      await server.stop();
    } finally {
      try { if (client) await closeUdpSocket(client); }
      finally { await rm(rootDirectory, { recursive: true, force: true }); }
    }
  }
});

test('TFTP server bounds pending file opens and rejects the next request as busy', async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), 'mrt-tftp-pending-'));
  let openCount = 0;
  let releaseAllOpens = false;
  const releasePendingOpens: Array<() => void> = [];
  const openedCountWaiters = new Map<number, () => void>();
  const server = new ReadOnlyTftpServer(undefined, async (_rootDirectory, fileName) => {
    if (fileName.startsWith('active-')) return { handle: { close: async () => {} } as unknown as FileHandle, size: 0 };
    openCount++;
    openedCountWaiters.get(openCount)?.();
    await new Promise<void>(resolve => {
      if (releaseAllOpens) resolve();
      else releasePendingOpens.push(resolve);
    });
    return { handle: { close: async () => {} } as unknown as FileHandle, size: 0 };
  });
  const clients: Socket[] = [];

  try {
    const port = await server.start(rootDirectory, 0);
    for (let requestNumber = 1; requestNumber <= 7; requestNumber++) {
      const client = createSocket('udp4');
      clients.push(client);
      const dataReplyPromise = receivePacket(client, 2_000);
      await sendPacket(client, readRequest(`active-${requestNumber}.bin`), port);
      const dataReply = await dataReplyPromise;
      assert.equal(dataReply.packet.readUInt16BE(0), 3);
    }
    await new Promise<void>(resolve => setImmediate(resolve));
    const pendingClients: Socket[] = [];

    for (let requestNumber = 1; requestNumber <= 8; requestNumber++) {
      const pendingClient = createSocket('udp4');
      pendingClients.push(pendingClient);
      clients.push(pendingClient);
      const openedPromise = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          openedCountWaiters.delete(requestNumber);
          reject(new Error(`Timed out waiting for TFTP file open ${requestNumber}`));
        }, 2_000);
        openedCountWaiters.set(requestNumber, () => {
          clearTimeout(timer);
          resolve();
        });
      });
      await sendPacket(pendingClient, readRequest(`pending-${requestNumber}.bin`), port);
      await openedPromise;
    }

    const rejectedClient = createSocket('udp4');
    clients.push(rejectedClient);
    const busyReplyPromise = receivePacket(rejectedClient, 2_000);
    await sendPacket(rejectedClient, readRequest('pending-9.bin'), port);
    const busyReply = await busyReplyPromise;
    assert.equal(busyReply.packet.readUInt16BE(0), 5);
    assert.equal(busyReply.packet.readUInt16BE(2), 0);
    assert.equal(busyReply.packet.toString('ascii', 4, busyReply.packet.length - 1), 'Server is busy');
    assert.equal(openCount, 8, 'the busy ninth RRQ must not enter the file opener');

    const promotedResponsesPromise = Promise.all(pendingClients.map(pendingClient => receivePacket(pendingClient, 5_000)));
    releaseAllOpens = true;
    for (const release of releasePendingOpens.splice(0)) release();
    const promotedResponses = await promotedResponsesPromise;
    const busyResponses = promotedResponses.filter(({ packet }) => packet.readUInt16BE(0) === 5 && packet.readUInt16BE(2) === 0);
    const dataResponses = promotedResponses.filter(({ packet }) => packet.readUInt16BE(0) === 3);
    assert.equal(dataResponses.length, 1, 'only one pending transfer can fill the final active slot');
    assert.equal(busyResponses.length, 7, 'remaining pending transfers are rejected when active capacity is exhausted');
    assert.ok(busyResponses.every(({ packet }) => packet.toString('ascii', 4, packet.length - 1) === 'Server is busy'),
      'every transfer rejected at promotion reports the bounded busy response');
  } finally {
    releaseAllOpens = true;
    for (const release of releasePendingOpens) release();
    try {
      await server.stop();
    } finally {
      try {
        await Promise.all(clients.map(closeUdpSocket));
      } finally {
        await rm(rootDirectory, { recursive: true, force: true });
      }
    }
  }
});
