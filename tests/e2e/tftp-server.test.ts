import { spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import { createSocket } from 'node:dgram';
import type { RemoteInfo, Socket } from 'node:dgram';
import { test, expect, _electron as electron } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

interface ReceivedPacket {
  readonly packet: Buffer;
  readonly remote: RemoteInfo;
}

function receivePacket(socket: Socket, timeoutMs = 5_000, stage = 'TFTP transfer'): Promise<ReceivedPacket> {
  return new Promise((resolvePacket, rejectPacket) => {
    const timer = setTimeout(() => finish(new Error(`Timed out waiting for ${stage} packet`)), timeoutMs);
    const onMessage = (packet: Buffer, remote: RemoteInfo) => finish(undefined, { packet, remote });
    const onError = (error: Error) => finish(error);
    const finish = (error?: Error, result?: ReceivedPacket): void => {
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

function bindUdpSocket(socket: Socket, port: number, address = '127.0.0.1'): Promise<void> {
  return new Promise((resolveBind, rejectBind) => {
    const timer = setTimeout(() => finish(new Error('Timed out binding UDP socket')), 3_000);
    const onListening = (): void => finish();
    const onError = (error: Error): void => finish(error);
    const finish = (error?: Error): void => {
      clearTimeout(timer);
      socket.removeListener('listening', onListening);
      socket.removeListener('error', onError);
      if (error) rejectBind(error);
      else resolveBind();
    };
    socket.once('listening', onListening);
    socket.once('error', onError);
    try { socket.bind(port, address); }
    catch (error) { finish(error instanceof Error ? error : new Error('UDP bind failed')); }
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

function curlText(result: SpawnSyncReturns<Buffer>): string {
  return Buffer.concat([result.stderr ?? Buffer.alloc(0), result.stdout ?? Buffer.alloc(0)]).toString('utf8');
}

test('local TFTP server transfers files, rejects unsafe requests, and stops cleanly', async () => {
  test.setTimeout(90_000);
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'mrt-tftp-e2e-'));
  const sharedRoot = join(temporaryRoot, 'shared');
  const profile = join(temporaryRoot, 'profile');
  const writeFixturePath = join(temporaryRoot, 'write-fixture.bin');
  const fixture = Buffer.alloc(1_024);
  for (let index = 0; index < fixture.length; index++) fixture[index] = index % 251;
  const curlPath = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'curl.exe');
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  let clientBound = false;
  const client = createSocket('udp4');

  try {
    await mkdir(sharedRoot);
    await mkdir(profile);
    await writeFile(join(sharedRoot, 'fixture.bin'), fixture);
    await writeFile(writeFixturePath, fixture);

    const curlVersion = spawnSync(curlPath, ['--disable', '--version'], { timeout: 5_000, maxBuffer: 1_048_576 });
    expect(curlVersion.error, `Windows curl.exe is required: ${curlText(curlVersion)}`).toBeUndefined();
    expect(curlVersion.status, curlText(curlVersion)).toBe(0);
    const versionText = Buffer.concat([curlVersion.stdout ?? Buffer.alloc(0), curlVersion.stderr ?? Buffer.alloc(0)]).toString('utf8');
    const protocols = /^Protocols:\s*(.+)$/imu.exec(versionText)?.[1]?.toLowerCase().split(/\s+/u) ?? [];
    expect(protocols, `The installed curl.exe must include TFTP: ${versionText}`).toContain('tftp');

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

    const writeRejection = spawnSync(curlPath, ['--disable', '--tftp-no-options', '--verbose', '--max-time', '5',
      '--upload-file', writeFixturePath, `tftp://127.0.0.1:${listenerPort}/should-not-exist.bin`], { timeout: 8_000, maxBuffer: 1_048_576 });
    const traversalRejection = spawnSync(curlPath, ['--disable', '--tftp-no-options', '--path-as-is', '--verbose', '--max-time', '5',
      `tftp://127.0.0.1:${listenerPort}/../outside.txt`], { timeout: 8_000, maxBuffer: 1_048_576 });
    const transfer = spawnSync(curlPath, ['--disable', '--tftp-no-options', '--verbose', '--max-time', '15',
      `tftp://127.0.0.1:${listenerPort}/fixture.bin`], { timeout: 20_000, maxBuffer: 1_048_576 });

    await bindUdpSocket(client, 0);
    clientBound = true;

    await dialog.getByRole('button', { name: 'Stop server' }).click();
    await expect(serverStatus).toHaveText('Stopped.');
    const stoppedPortProbe = createSocket('udp4');
    try { await bindUdpSocket(stoppedPortProbe, listenerPort); }
    finally { try { stoppedPortProbe.close(); } catch { /* The bind itself reports cleanup failures. */ } }

    await dialog.getByRole('button', { name: 'Browse…' }).click();
    await expect(dialog.locator('.tftp-server-folder')).toHaveText(basename(sharedRoot));
    await dialog.getByLabel('UDP port').fill('0');
    await dialog.getByRole('button', { name: 'Start server' }).click();
    await expect(serverStatus).toContainText('Running at 127.0.0.1:');
    const runningPort = Number((await serverStatus.innerText()).match(/127\.0\.0\.1:(\d+)/u)?.[1]);
    expect(Number.isInteger(runningPort) && runningPort > 0).toBe(true);

    await application.close();
    application = undefined;
    const postShutdownReply = receivePacket(client, 500, 'post-shutdown RRQ');
    await sendPacket(client, tftpRequest(1, 'fixture.bin'), runningPort);
    await expect(postShutdownReply).rejects.toThrow('Timed out waiting for post-shutdown RRQ packet');

    const releasedPortProbe = createSocket('udp4');
    try { await bindUdpSocket(releasedPortProbe, runningPort); }
    finally { try { releasedPortProbe.close(); } catch { /* The bind itself reports cleanup failures. */ } }

    const transferDiagnostics = `status=${String(transfer.status)}, error=${transfer.error?.message ?? 'none'}, ` +
      `stderr=${(transfer.stderr ?? Buffer.alloc(0)).toString('utf8')}`;
    const writeRejectionDiagnostics = curlText(writeRejection);
    expect(writeRejection.error, writeRejectionDiagnostics).toBeUndefined();
    expect(writeRejection.status, writeRejectionDiagnostics).toBe(69);
    expect(writeRejectionDiagnostics, writeRejectionDiagnostics).toMatch(/TFTP error: Uploads are disabled/iu);
    const traversalRejectionDiagnostics = curlText(traversalRejection);
    expect(traversalRejection.error, traversalRejectionDiagnostics).toBeUndefined();
    expect(traversalRejection.status, traversalRejectionDiagnostics).toBe(69);
    expect(traversalRejectionDiagnostics, traversalRejectionDiagnostics).toMatch(/TFTP error: Only top-level file names are allowed/iu);
    expect(transfer.error, transferDiagnostics).toBeUndefined();
    expect(transfer.status, transferDiagnostics).toBe(0);
    expect(transfer.stdout ?? Buffer.alloc(0), transferDiagnostics).toEqual(fixture);
  } finally {
    if (clientBound) client.close();
    await application?.close();
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
