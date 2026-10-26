import { test, expect, _electron as electron } from '@playwright/test';
import { createServer as createNetServer } from 'node:net';
import type { AddressInfo, Server, Socket } from 'node:net';
import { createSecureContext, createServer as createTlsServer, TLSSocket } from 'node:tls';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

interface LoggedCommand { readonly verb: string; readonly encrypted: boolean; }

test('FTPS validates the server certificate and encrypts the FTP data channel', async () => {
  test.setTimeout(90_000);
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'mrt-ftps-e2e-'));
  const uploadPath = join(temporaryRoot, 'ftps-upload.txt');
  const uploadBytes = Buffer.from('FTPS protected upload fixture\n');
  const certificatePath = resolve('tests/fixtures/ftps-test-cert.pem');
  const serverPfx = await readFile(resolve('tests/fixtures/ftps-test-server.pfx'));
  const secureContext = createSecureContext({ pfx: serverPfx, passphrase: 'mrt-ftps-test-only' });
  const tlsSessionServer = createTlsServer({ secureContext });
  const trackedSockets = new Set<Socket>();
  const trackedTlsSockets = new Set<TLSSocket>();
  const passiveServers = new Set<Server>();
  const commands: LoggedCommand[] = [];
  const fixtureEvents: string[] = [];
  const tlsErrors: string[] = [];
  const uploadedFiles: Buffer[] = [];
  let protectedDataChannelCount = 0;
  let unprotectedTransferAttempt = false;
  const server = createNetServer(rawControlSocket => {
    fixtureEvents.push('control connection');
    trackedSockets.add(rawControlSocket);
    rawControlSocket.on('error', error => { tlsErrors.push(error.message); fixtureEvents.push(`raw error: ${error.message}`); });
    rawControlSocket.once('close', () => { trackedSockets.delete(rawControlSocket); fixtureEvents.push('raw close'); });
    let controlSocket: Socket | TLSSocket = rawControlSocket;
    let controlEncrypted = false;
    let input = '';
    let passiveServer: Server | undefined;
    let dataSocket: TLSSocket | undefined;
    let transferKind: 'list' | 'upload' | undefined;
    let uploadChunks: Buffer[] = [];

    const reply = (line: string) => {
      if (!controlSocket.destroyed) controlSocket.write(`${line}\r\n`);
    };
    const startTransfer = () => {
      if (!dataSocket || !transferKind) return;
      if (!controlEncrypted || !dataSocket.encrypted) unprotectedTransferAttempt = true;
      if (transferKind === 'list') {
        const listing = Buffer.from('-rw-r--r-- 1 mrt mrt 20 Oct 26 12:00 ftps-visible.txt\r\n');
        transferKind = undefined;
        dataSocket.end(listing, () => reply('226 Listing complete'));
        return;
      }
    };
    const beginPassive = (extended: boolean) => {
      if (passiveServer?.listening) passiveServer.close();
      passiveServer = createNetServer(rawDataSocket => {
        trackedSockets.add(rawDataSocket);
        rawDataSocket.on('error', error => tlsErrors.push(error.message));
        rawDataSocket.once('close', () => trackedSockets.delete(rawDataSocket));
        rawDataSocket.pause();
        const protectedSocket = new TLSSocket(rawDataSocket, {
          isServer: true,
          secureContext,
          server: tlsSessionServer
        });
        dataSocket = protectedSocket;
        trackedTlsSockets.add(protectedSocket);
        protectedSocket.on('error', error => tlsErrors.push(error.message));
        protectedSocket.once('close', () => trackedTlsSockets.delete(protectedSocket));
        protectedSocket.on('data', chunk => {
          if (transferKind === 'upload') uploadChunks.push(Buffer.from(chunk));
        });
        protectedSocket.once('end', () => {
          if (transferKind !== 'upload') return;
          uploadedFiles.push(Buffer.concat(uploadChunks));
          transferKind = undefined;
          reply('226 Upload complete');
        });
        protectedSocket.once('secure', () => {
          protectedDataChannelCount++;
          startTransfer();
        });
        protectedSocket.resume();
      });
      passiveServers.add(passiveServer);
      passiveServer.on('error', () => {});
      passiveServer.listen(0, '127.0.0.1', () => {
        const address = passiveServer?.address();
        if (!address || typeof address === 'string') { reply('425 Could not start passive mode'); return; }
        if (extended) reply(`229 Entering Extended Passive Mode (|||${address.port}|)`);
        else {
          const high = Math.floor(address.port / 256);
          const low = address.port % 256;
          reply(`227 Entering Passive Mode (127,0,0,1,${high},${low})`);
        }
      });
    };
    const onControlData = (chunk: Buffer) => {
      input += chunk.toString('utf8');
      for (;;) {
        const newline = input.indexOf('\n');
        if (newline < 0) break;
        const line = input.slice(0, newline).replace(/\r$/u, '');
        input = input.slice(newline + 1);
        const separator = line.indexOf(' ');
        const verb = (separator < 0 ? line : line.slice(0, separator)).toUpperCase();
        const argument = separator < 0 ? '' : line.slice(separator + 1);
        commands.push({ verb, encrypted: controlEncrypted });
        if (verb === 'AUTH' && argument.toUpperCase() === 'TLS') {
          rawControlSocket.removeListener('data', onControlData);
          rawControlSocket.pause();
          rawControlSocket.write('234 Begin TLS negotiation\r\n', () => {
            fixtureEvents.push('AUTH TLS reply flushed');
            const upgradedSocket = new TLSSocket(rawControlSocket, {
              isServer: true,
              secureContext,
              server: tlsSessionServer
            });
            fixtureEvents.push('control TLS socket constructed');
            controlSocket = upgradedSocket;
            trackedTlsSockets.add(upgradedSocket);
            upgradedSocket.on('error', error => { tlsErrors.push(error.message); fixtureEvents.push(`control TLS error: ${error.message}`); });
            upgradedSocket.once('close', () => trackedTlsSockets.delete(upgradedSocket));
            upgradedSocket.on('data', onControlData);
            upgradedSocket.once('secure', () => {
              fixtureEvents.push('control TLS secure');
              controlEncrypted = true;
            });
            upgradedSocket.resume();
          });
          return;
        }
        if (verb === 'FEAT') reply('211-Features\r\n EPSV\r\n PASV\r\n UTF8\r\n211 End');
        else if (verb === 'USER') reply('331 Password required');
        else if (verb === 'PASS') reply('230 Login successful');
        else if (verb === 'PBSZ') reply(argument === '0' ? '200 PBSZ=0' : '501 PBSZ must be zero');
        else if (verb === 'PROT') {
          if (argument.toUpperCase() === 'P') reply('200 Data channel protected');
          else reply('536 Protected data channel required');
        }
        else if (verb === 'SYST') reply('215 UNIX Type: L8');
        else if (verb === 'TYPE' || verb === 'OPTS' || verb === 'NOOP' || (verb === 'EPSV' && argument.toUpperCase() === 'ALL')) reply('200 Command okay');
        else if (verb === 'PWD') reply('257 "/" is current directory');
        else if (verb === 'CWD') reply('250 Directory changed');
        else if (verb === 'EPSV') beginPassive(true);
        else if (verb === 'PASV') beginPassive(false);
        else if (verb === 'LIST' || verb === 'NLST') {
          transferKind = 'list';
          if (!commands.some(command => command.verb === 'PROT' && command.encrypted)) unprotectedTransferAttempt = true;
          reply('150 Opening protected listing');
          startTransfer();
        }
        else if (verb === 'STOU') {
          if (argument !== '') { reply('501 STOU does not accept a pathname'); continue; }
          transferKind = 'upload';
          uploadChunks = [];
          if (!commands.some(command => command.verb === 'PROT' && command.encrypted)) unprotectedTransferAttempt = true;
          reply('150 FILE: protected-upload.txt');
          startTransfer();
        }
        else if (verb === 'QUIT') { reply('221 Goodbye'); controlSocket.end(); }
        else reply('502 Command not implemented');
      }
    };
    controlSocket.on('data', onControlData);
    rawControlSocket.write('220 MRT explicit FTPS fixture ready\r\n');
    rawControlSocket.once('close', () => { if (passiveServer?.listening) passiveServer.close(); });
  });

  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  const launchApp = (trustedCertificate: boolean, profile: string) => {
    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] =>
      entry[1] !== undefined && entry[0] !== 'ELECTRON_RUN_AS_NODE' && entry[0] !== 'NODE_EXTRA_CA_CERTS'));
    env.MRT_E2E = '1';
    const certificateArgument = trustedCertificate ? [`--mrt-e2e-ftp-ca=${certificatePath}`] : [];
    return electron.launch({
      args: [resolve('apps/desktop'), `--user-data-dir=${profile}`, '--mrt-e2e-ftp-credentials', '--mrt-e2e-ftp-transfers',
        `--mrt-e2e-ftp-upload-file=${uploadPath}`, ...certificateArgument],
      env
    });
  };
  const connect = async (trustedCertificate: boolean, profileName: string, port: number) => {
    const profile = join(temporaryRoot, profileName);
    await mkdir(profile);
    const application = await launchApp(trustedCertificate, profile);
    app = application;
    const mainFlags = await application.evaluate(() => ({
      ftpCredentials: process.argv.includes('--mrt-e2e-ftp-credentials'),
      ftpCa: process.argv.some(argument => argument.startsWith('--mrt-e2e-ftp-ca='))
    }));
    const page = await application.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Connect to FTP / FTPS files', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Connect to FTP or FTPS files' });
    await dialog.getByLabel('Host name or IP address').fill('127.0.0.1');
    await dialog.getByLabel('Port').fill(String(port));
    await dialog.getByLabel('Connection security').selectOption('ftps');
    await expect(dialog.getByRole('note')).toContainText('normal certificate validation');
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
    return { page, dialog, mainFlags, application };
  };

  try {
    await writeFile(uploadPath, uploadBytes);
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(0, '127.0.0.1', resolveListen);
    });
    const port = (server.address() as AddressInfo).port;

    const untrusted = await connect(false, 'untrusted-profile', port);
    await expect(untrusted.dialog.getByRole('alert')).toContainText('Could not connect to the FTPS server', { timeout: 15_000 });
    expect(commands).toContainEqual({ verb: 'AUTH', encrypted: false });
    expect(fixtureEvents).not.toContain('control TLS secure');
    expect(commands.some(command => command.verb === 'USER' || command.verb === 'PASS')).toBe(false);
    await app?.close();
    app = undefined;
    commands.length = 0;
    fixtureEvents.push('trusted attempt begins');

    const trusted = await connect(true, 'trusted-profile', port);
    const browser = trusted.page.getByTestId('remote-file-browser');
    try { await expect(browser).toBeVisible({ timeout: 20_000 }); }
    catch (error) {
      const mainState = await trusted.application.evaluate(() => ({
        mrtE2e: process.env.MRT_E2E,
        ftpCredentialPrompts: (globalThis as typeof globalThis & { __mrtE2EFtpCredentialPromptCount?: number }).__mrtE2EFtpCredentialPromptCount
      }));
      throw new Error(`FTPS commands=${JSON.stringify(commands)}, fixture=${JSON.stringify(fixtureEvents)}, mainFlags=${JSON.stringify(trusted.mainFlags)}, mainState=${JSON.stringify(mainState)}, TLS errors=${JSON.stringify(tlsErrors)}, data TLS=${protectedDataChannelCount}; ${String(error)}`);
    }
    await expect(browser.getByText('ftps-visible.txt', { exact: true })).toBeVisible({ timeout: 15_000 });
    await browser.getByRole('button', { name: 'Upload file', exact: true }).click();
    await expect.poll(() => uploadedFiles.length, { timeout: 15_000 }).toBe(1);

    expect(commands.filter(command => command.verb === 'AUTH')).toHaveLength(1);
    expect(commands.some(command => command.verb === 'USER' && command.encrypted)).toBe(true);
    expect(commands.some(command => command.verb === 'PASS' && command.encrypted)).toBe(true);
    expect(commands.some(command => command.verb === 'PBSZ' && command.encrypted)).toBe(true);
    expect(commands.some(command => command.verb === 'PROT' && command.encrypted)).toBe(true);
    expect(commands.some(command => command.verb === 'STOU' && command.encrypted)).toBe(true);
    expect(commands.some(command => command.verb === 'LIST' && command.encrypted)).toBe(true);
    expect(protectedDataChannelCount).toBeGreaterThanOrEqual(2);
    expect(unprotectedTransferAttempt).toBe(false);
    expect(uploadedFiles[0]?.equals(uploadBytes)).toBe(true);
  } finally {
    await app?.close();
    for (const socket of trackedTlsSockets) socket.destroy();
    for (const socket of trackedSockets) socket.destroy();
    for (const passive of passiveServers) {
      if (passive.listening) await new Promise<void>(resolveClose => passive.close(() => resolveClose()));
    }
    if (server.listening) await new Promise<void>(resolveClose => server.close(() => resolveClose()));
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
