import { spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import { createSocket } from 'node:dgram';
import type { RemoteInfo, Socket } from 'node:dgram';
import { test, expect, _electron as electron } from '@playwright/test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

interface ReceivedPacket {
  readonly packet: Buffer;
  readonly remote: RemoteInfo;
}

function receivePacket(
  socket: Socket,
  timeoutMs = 5_000,
  stage = 'TFTP transfer',
  matches: (packet: Buffer, remote: RemoteInfo) => boolean = () => true
): Promise<ReceivedPacket> {
  return new Promise((resolvePacket, rejectPacket) => {
    const timer = setTimeout(() => finish(new Error(`Timed out waiting for ${stage} packet`)), timeoutMs);
    const onMessage = (packet: Buffer, remote: RemoteInfo): void => {
      if (matches(packet, remote)) finish(undefined, { packet, remote });
    };
    const onError = (error: Error) => finish(error);
    const finish = (error?: Error, result?: ReceivedPacket): void => {
      clearTimeout(timer);
      socket.removeListener('message', onMessage);
      socket.removeListener('error', onError);
      if (error) rejectPacket(error);
      else if (result) resolvePacket(result);
    };
    socket.on('message', onMessage);
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

function tftpAcknowledgement(block: number): Buffer {
  const packet = Buffer.alloc(4);
  packet.writeUInt16BE(4, 0);
  packet.writeUInt16BE(block, 2);
  return packet;
}

function curlText(result: SpawnSyncReturns<Buffer>): string {
  return Buffer.concat([result.stderr ?? Buffer.alloc(0), result.stdout ?? Buffer.alloc(0)]).toString('utf8');
}

test('local TFTP server transfers files, rejects unsafe requests, and stops cleanly', async () => {
  const longLifetimeAcceptance = process.env.MRT_TFTP_LIFETIME_ACCEPTANCE === '1';
  test.setTimeout(longLifetimeAcceptance ? 420_000 : 90_000);
  if (longLifetimeAcceptance) {
    test.info().annotations.push({ type: 'acceptance', description: 'Keep TFTP running beyond 360 seconds before transfer and explicit stop checks.' });
  }
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'mrt-tftp-e2e-'));
  const sharedRoot = join(temporaryRoot, 'shared');
  const profile = join(temporaryRoot, 'profile');
  const writeFixturePath = join(temporaryRoot, 'write-fixture.bin');
  const outsideFilePath = join(temporaryRoot, 'outside.bin');
  const oversizedFixturePath = join(sharedRoot, 'oversized.bin');
  const linkedFixturePath = join(sharedRoot, 'linked.bin');
  const capacityFileNames = Array.from({ length: 9 }, (_value, index) => `capacity-${index}.bin`);
  const fixture = Buffer.alloc(1_024);
  const oversizedFixture = Buffer.alloc(16 * 1024 * 1024 + 1, 0x5a);
  for (let index = 0; index < fixture.length; index++) fixture[index] = index % 251;
  const curlPath = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'curl.exe');
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  let clientBound = false;
  const client = createSocket('udp4');

  try {
    await mkdir(sharedRoot);
    await mkdir(profile);
    await writeFile(join(sharedRoot, 'fixture.bin'), fixture);
    await writeFile(oversizedFixturePath, oversizedFixture);
    await writeFile(outsideFilePath, fixture);
    let fileSymlinkAvailable = true;
    try { await symlink(outsideFilePath, linkedFixturePath, 'file'); }
    catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if (code !== 'EPERM' && code !== 'EACCES') throw error;
      fileSymlinkAvailable = false;
      test.info().annotations.push({
        type: 'environment-limit',
        description: `Windows denied file-symlink creation (${code}); runtime symlink rejection was not exercised.`
      });
    }
    for (const fileName of capacityFileNames) await writeFile(join(sharedRoot, fileName), fixture);
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

    if (longLifetimeAcceptance) {
      const waitStartedAt = performance.now();
      await new Promise<void>(resolveLifetime => setTimeout(resolveLifetime, 360_500));
      expect(performance.now() - waitStartedAt).toBeGreaterThan(360_000);
      await expect(serverStatus).toContainText('Running at 127.0.0.1:');
    }

    const writeRejection = spawnSync(curlPath, ['--disable', '--tftp-no-options', '--verbose', '--max-time', '5',
      '--upload-file', writeFixturePath, `tftp://127.0.0.1:${listenerPort}/should-not-exist.bin`], { timeout: 8_000, maxBuffer: 1_048_576 });
    const traversalRejection = spawnSync(curlPath, ['--disable', '--tftp-no-options', '--path-as-is', '--verbose', '--max-time', '5',
      `tftp://127.0.0.1:${listenerPort}/../outside.txt`], { timeout: 8_000, maxBuffer: 1_048_576 });
    const linkRejection = fileSymlinkAvailable ? spawnSync(curlPath, ['--disable', '--tftp-no-options', '--verbose', '--max-time', '5',
      `tftp://127.0.0.1:${listenerPort}/linked.bin`], { timeout: 8_000, maxBuffer: 1_048_576 }) : undefined;
    const oversizedRejection = spawnSync(curlPath, ['--disable', '--tftp-no-options', '--verbose', '--max-time', '5',
      `tftp://127.0.0.1:${listenerPort}/oversized.bin`], { timeout: 8_000, maxBuffer: 1_048_576 });
    const transfer = spawnSync(curlPath, ['--disable', '--tftp-no-options', '--verbose', '--max-time', '15',
      `tftp://127.0.0.1:${listenerPort}/fixture.bin`], { timeout: 20_000, maxBuffer: 1_048_576 });

    await bindUdpSocket(client, 0);
    clientBound = true;

    const firstDataPromise = receivePacket(client, 5_000, 'first active-transfer DATA block');
    await sendPacket(client, tftpRequest(1, 'fixture.bin'), listenerPort);
    const firstData = await firstDataPromise;
    expect(firstData.packet.readUInt16BE(0)).toBe(3);
    expect(firstData.packet.readUInt16BE(2)).toBe(1);
    expect(firstData.packet.byteLength).toBe(516);
    expect(firstData.remote.address).toBe('127.0.0.1');
    expect(firstData.remote.port).not.toBe(listenerPort);

    const secondDataPromise = receivePacket(client, 5_000, 'second active-transfer DATA block');
    await sendPacket(client, tftpAcknowledgement(1), firstData.remote.port);
    const secondData = await secondDataPromise;
    expect(secondData.packet.readUInt16BE(0)).toBe(3);
    expect(secondData.packet.readUInt16BE(2)).toBe(2);
    expect(secondData.packet.byteLength).toBe(516);
    expect(secondData.remote.address).toBe(firstData.remote.address);
    expect(secondData.remote.port).toBe(firstData.remote.port);

    let transferPacketsWhileStoppingOrAfterStop = 0;
    const countTransferPacket = (_packet: Buffer, remote: RemoteInfo): void => {
      if (remote.address === firstData.remote.address && remote.port === firstData.remote.port) transferPacketsWhileStoppingOrAfterStop++;
    };
    client.on('message', countTransferPacket);
    try {
      await dialog.getByRole('button', { name: 'Stop server' }).click();
      await expect(serverStatus).toHaveText('Stopped.');
      await new Promise<void>(resolveQuietPeriod => setTimeout(resolveQuietPeriod, 1_500));
    } finally {
      client.removeListener('message', countTransferPacket);
    }
    expect(transferPacketsWhileStoppingOrAfterStop).toBe(0);

    const stoppedTransferPortProbe = createSocket('udp4');
    try { await bindUdpSocket(stoppedTransferPortProbe, firstData.remote.port); }
    finally { try { stoppedTransferPortProbe.close(); } catch { /* The bind itself reports transfer cleanup failures. */ } }

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

    const activeCapacityReplies: ReceivedPacket[] = [];
    const activeTransferPorts = new Set<number>();
    for (const fileName of capacityFileNames.slice(0, 8)) {
      const activeReplyPromise = receivePacket(client, 5_000, 'bounded active TFTP slot', (packet, remote) =>
        packet.readUInt16BE(0) === 3 && !activeTransferPorts.has(remote.port));
      if (activeCapacityReplies.length === 1) await new Promise<void>(resolveRetry => setTimeout(resolveRetry, 1_100));
      await sendPacket(client, tftpRequest(1, fileName), runningPort);
      const activeReply = await activeReplyPromise;
      activeCapacityReplies.push(activeReply);
      activeTransferPorts.add(activeReply.remote.port);
    }
    expect(activeCapacityReplies).toHaveLength(8);
    for (const { packet, remote } of activeCapacityReplies) {
      expect(packet.readUInt16BE(2)).toBe(1);
      expect(remote.address).toBe('127.0.0.1');
      expect(remote.port).not.toBe(runningPort);
    }
    expect(activeTransferPorts.size).toBe(8);
    const busyReplyPromise = receivePacket(client, 5_000, 'ninth active TFTP request rejection', packet =>
      packet.readUInt16BE(0) === 5 && packet.readUInt16BE(2) === 0 && packet.subarray(4).toString('utf8').replace(/\0$/u, '') === 'Server is busy');
    await sendPacket(client, tftpRequest(1, capacityFileNames[8]!), runningPort);
    const busyReply = await busyReplyPromise;
    expect(busyReply.remote.address).toBe('127.0.0.1');
    expect(busyReply.remote.port).not.toBe(runningPort);
    expect(activeTransferPorts.has(busyReply.remote.port)).toBe(false);

    await dialog.getByRole('button', { name: 'Stop server' }).click();
    await expect(serverStatus).toHaveText('Stopped.');
    for (const transferPort of activeTransferPorts) {
      const stoppedTransferPortProbe = createSocket('udp4');
      try { await bindUdpSocket(stoppedTransferPortProbe, transferPort); }
      finally { try { stoppedTransferPortProbe.close(); } catch { /* The bind itself reports transfer cleanup failures. */ } }
    }

    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.getByTestId('tftp-server-open').click();
    const shutdownDialog = page.getByRole('dialog', { name: 'Local TFTP server' });
    await shutdownDialog.getByRole('button', { name: /Browse/u }).click();
    await expect(shutdownDialog.locator('.tftp-server-folder')).toHaveText(basename(sharedRoot));
    await shutdownDialog.getByLabel('UDP port').fill('0');
    await shutdownDialog.getByRole('button', { name: 'Start server' }).click();
    const shutdownStatus = shutdownDialog.locator('.tftp-server-status');
    await expect(shutdownStatus).toContainText('Running at 127.0.0.1:');
    const shutdownPort = Number((await shutdownStatus.innerText()).match(/127\.0\.0\.1:(\d+)/u)?.[1]);
    expect(Number.isInteger(shutdownPort) && shutdownPort > 0).toBe(true);

    await application.close();
    application = undefined;
    const postShutdownReply = receivePacket(client, 500, 'post-shutdown RRQ');
    await sendPacket(client, tftpRequest(1, 'fixture.bin'), shutdownPort);
    await expect(postShutdownReply).rejects.toThrow('Timed out waiting for post-shutdown RRQ packet');

    const releasedPortProbe = createSocket('udp4');
    try { await bindUdpSocket(releasedPortProbe, shutdownPort); }
    finally { try { releasedPortProbe.close(); } catch { /* The bind itself reports cleanup failures. */ } }

    const transferDiagnostics = `status=${String(transfer.status)}, error=${transfer.error?.message ?? 'none'}, ` +
      `stdoutBytes=${(transfer.stdout ?? Buffer.alloc(0)).byteLength}, stderr=${(transfer.stderr ?? Buffer.alloc(0)).toString('utf8')}`;
    const writeRejectionDiagnostics = curlText(writeRejection);
    expect(writeRejection.error, writeRejectionDiagnostics).toBeUndefined();
    expect(writeRejection.status, writeRejectionDiagnostics).toBe(69);
    expect(writeRejectionDiagnostics, writeRejectionDiagnostics).toMatch(/TFTP error: Uploads are disabled/iu);
    const traversalRejectionDiagnostics = curlText(traversalRejection);
    expect(traversalRejection.error, traversalRejectionDiagnostics).toBeUndefined();
    expect(traversalRejection.status, traversalRejectionDiagnostics).toBe(69);
    expect(traversalRejectionDiagnostics, traversalRejectionDiagnostics).toMatch(/TFTP error: Only top-level file names are allowed/iu);
    if (linkRejection) {
      const linkRejectionDiagnostics = curlText(linkRejection);
      expect(linkRejection.error, linkRejectionDiagnostics).toBeUndefined();
      expect(linkRejection.status, linkRejectionDiagnostics).toBe(69);
      expect(linkRejectionDiagnostics, linkRejectionDiagnostics).toMatch(/TFTP error: Access denied/iu);
    }
    const oversizedRejectionDiagnostics = curlText(oversizedRejection);
    expect(oversizedRejection.error, oversizedRejectionDiagnostics).toBeUndefined();
    expect(oversizedRejection.status, oversizedRejectionDiagnostics).toBe(70);
    expect(oversizedRejectionDiagnostics, oversizedRejectionDiagnostics).toMatch(/TFTP error: File is too large/iu);
    expect(transfer.error, transferDiagnostics).toBeUndefined();
    expect(transfer.status, transferDiagnostics).toBe(0);
    expect(transfer.stdout ?? Buffer.alloc(0), transferDiagnostics).toEqual(fixture);
  } finally {
    try {
      if (clientBound) client.close();
    } finally {
      try { await application?.close(); }
      finally { await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
    }
  }
});

test('renderer crash stops the unauthenticated TFTP server', async () => {
  test.setTimeout(60_000);
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'mrt-tftp-renderer-crash-'));
  const sharedRoot = join(temporaryRoot, 'shared');
  const profile = join(temporaryRoot, 'profile');
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;

  try {
    await mkdir(sharedRoot);
    await mkdir(profile);
    await writeFile(join(sharedRoot, 'fixture.bin'), Buffer.from('tftp cleanup'));
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
    await dialog.getByRole('button', { name: /Browse/u }).click();
    await expect(dialog.locator('.tftp-server-folder')).toHaveText(basename(sharedRoot));
    await dialog.getByLabel('UDP port').fill('0');
    await dialog.getByRole('button', { name: 'Start server' }).click();
    const serverStatus = dialog.locator('.tftp-server-status');
    await expect(serverStatus).toContainText('Running at 127.0.0.1:', { timeout: 15_000 });
    const serverPort = Number((await serverStatus.innerText()).match(/127\.0\.0\.1:(\d+)/u)?.[1]);
    expect(Number.isInteger(serverPort) && serverPort > 0).toBe(true);

    await application.evaluate(({ BrowserWindow }) => {
      const current = BrowserWindow.getAllWindows()[0];
      if (!current) throw new Error('The workbench window is missing.');
      return new Promise<void>(resolveCrash => {
        current.webContents.once('render-process-gone', () => resolveCrash());
        current.webContents.forcefullyCrashRenderer();
      });
    });
    await expect.poll(() => application!.evaluate(({ app }) => app.isReady())).toBe(true);

    const releasedPortProbe = createSocket('udp4');
    try { await bindUdpSocket(releasedPortProbe, serverPort); }
    finally { try { releasedPortProbe.close(); } catch { /* Binding reports listener cleanup failures. */ } }
  } finally {
    try { await application?.close(); }
    finally { await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
  }
});
