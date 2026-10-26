import { test, expect, _electron as electron } from '@playwright/test';
import { createSocket } from 'node:dgram';
import type { RemoteInfo, Socket } from 'node:dgram';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

function receivePacket(socket: Socket, timeoutMs = 5_000, stage = 'TFTP transfer'): Promise<{ readonly packet: Buffer; readonly remote: RemoteInfo }> {
  return new Promise((resolvePacket, rejectPacket) => {
    const timer = setTimeout(() => finish(new Error(`Timed out waiting for ${stage} packet`)), timeoutMs);
    const onMessage = (packet: Buffer, remote: RemoteInfo) => finish(undefined, { packet, remote });
    const onError = (error: Error) => finish(error);
    const finish = (error?: Error, result?: { readonly packet: Buffer; readonly remote: RemoteInfo }): void => {
      clearTimeout(timer);
      socket.removeListener('message', onMessage);
      socket.removeListener('error', onError);
      if (error) rejectPacket(error);
      else if (result) resolvePacket(result);
    };
    socket.once('message', onMessage);
    socket.once('error', onError);
  });
}

function sendPacket(socket: Socket, packet: Buffer, port: number): Promise<void> {
  return new Promise((resolveSend, rejectSend) => {
    socket.send(packet, port, '127.0.0.1', error => error ? rejectSend(error) : resolveSend());
  });
}

function tftpRequest(opcode: number, fileName: string): Buffer {
  return Buffer.concat([Buffer.from([0, opcode]), Buffer.from(fileName, 'ascii'), Buffer.from([0]), Buffer.from('octet\0', 'ascii')]);
}

function tftpError(packet: Buffer): boolean { return packet.length >= 5 && packet.readUInt16BE(0) === 5; }

test('local TFTP server serves read-only loopback files and stops cleanly', async () => {
  test.setTimeout(90_000);
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'mrt-tftp-e2e-'));
  const sharedRoot = join(temporaryRoot, 'shared');
  const profile = join(temporaryRoot, 'profile');
  const fixture = Buffer.alloc(1_024);
  for (let index = 0; index < fixture.length; index++) fixture[index] = index % 251;
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  const client = createSocket('udp4');
  let clientBound = false;
  try {
    await mkdir(sharedRoot);
    await mkdir(profile);
    await writeFile(join(sharedRoot, 'fixture.bin'), fixture);
    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] =>
      entry[1] !== undefined && entry[0] !== 'ELECTRON_RUN_AS_NODE' && entry[0] !== 'NODE_EXTRA_CA_CERTS'));
    env.MRT_E2E = '1';
    application = await electron.launch({
      args: [resolve('apps/desktop'), `--user-data-dir=${profile}`, '--mrt-e2e-tftp-server', `--mrt-e2e-tftp-root=${sharedRoot}`], env
    });
    const page = await application.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await page.getByTestId('tftp-server-open').click();
    const dialog = page.getByRole('dialog', { name: 'Local TFTP server' });
    await expect(dialog.getByRole('note')).toContainText('Any local process');
    await expect(dialog.getByText('Reads top-level regular files in octet mode. Files over 16 MiB are refused.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Browse…' }).click();
    await expect(dialog.locator('.tftp-server-folder')).toHaveText(basename(sharedRoot));
    await dialog.getByLabel('UDP port').fill('0');
    await dialog.getByRole('button', { name: 'Start server' }).click();
    const serverStatus = dialog.locator('.tftp-server-status');
    try { await expect(serverStatus).toContainText('Running at 127.0.0.1:', { timeout: 15_000 }); }
    catch (error) { throw new Error(`TFTP dialog after start: ${await dialog.innerText()}; ${String(error)}`); }
    const status = await serverStatus.innerText();
    const listenerPort = Number(status.match(/127\.0\.0\.1:(\d+)/u)?.[1]);
    expect(Number.isInteger(listenerPort) && listenerPort > 0).toBe(true);

    await new Promise<void>((resolveBind, rejectBind) => {
      client.once('error', rejectBind);
      client.bind(0, '127.0.0.1', resolveBind);
    });
    clientBound = true;
    const chunks: Buffer[] = [];
    let transferId: number | undefined;
    let block = 1;
    await sendPacket(client, tftpRequest(1, 'fixture.bin'), listenerPort);
    let received = await receivePacket(client, 5_000, `read block ${block}`);
    for (;;) {
      const { packet, remote } = received;
      expect(tftpError(packet)).toBe(false);
      expect(packet.readUInt16BE(0)).toBe(3);
      expect(packet.readUInt16BE(2)).toBe(block);
      transferId ??= remote.port;
      expect(remote.port).toBe(transferId);
      expect(remote.port).not.toBe(listenerPort);
      const data = packet.subarray(4);
      chunks.push(data);
      const ack = Buffer.alloc(4);
      ack.writeUInt16BE(4, 0);
      ack.writeUInt16BE(block, 2);
      if (data.length < 512) {
        await sendPacket(client, ack, transferId);
        break;
      }
      const nextBlock = receivePacket(client, 5_000, `read block ${block + 1}`);
      await sendPacket(client, ack, transferId);
      block++;
      received = await nextBlock;
    }
    expect(block).toBe(3);
    expect(Buffer.concat(chunks)).toEqual(fixture);

    await sendPacket(client, tftpRequest(2, 'should-not-exist.bin'), listenerPort);
    const writeReply = await receivePacket(client, 5_000, 'write rejection');
    expect(tftpError(writeReply.packet)).toBe(true);
    await sendPacket(client, tftpRequest(1, '../outside.txt'), listenerPort);
    const traversalReply = await receivePacket(client, 5_000, 'traversal rejection');
    expect(tftpError(traversalReply.packet)).toBe(true);

    await dialog.getByRole('button', { name: 'Stop server' }).click();
    await expect(serverStatus).toHaveText('Stopped.');
    await expect(dialog.getByRole('button', { name: 'Start server' })).toBeDisabled();

    await dialog.getByRole('button', { name: 'Browse…' }).click();
    await dialog.getByLabel('UDP port').fill('0');
    await dialog.getByRole('button', { name: 'Start server' }).click();
    await expect(serverStatus).toContainText('Running at 127.0.0.1:');
    const runningPort = Number((await serverStatus.innerText()).match(/127\.0\.0\.1:(\d+)/u)?.[1]);
    expect(Number.isInteger(runningPort) && runningPort > 0).toBe(true);
    await application.close();
    application = undefined;
    await sendPacket(client, tftpRequest(1, 'fixture.bin'), runningPort);
    await expect(receivePacket(client, 500, 'post-shutdown')).rejects.toThrow('Timed out waiting for post-shutdown packet');
  } finally {
    if (clientBound) client.close();
    await application?.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
