import { chromium, test, expect } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { getCurrentFuseWire, FuseState, FuseV1Options, FuseVersion } from '@electron/fuses';
import { copyFile, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve, win32 } from 'node:path';

function cleanEnvironment(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] =>
    entry[1] !== undefined && entry[0] !== 'ELECTRON_RUN_AS_NODE' && !entry[0].startsWith('PORTABLE_EXECUTABLE_')));
}

interface PackagedApp {
  readonly process: ReturnType<typeof spawn>;
  readonly browser: Browser;
  readonly page: Page;
}

async function reserveLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not reserve a loopback port for the portable smoke');
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close(error => error ? rejectClose(error) : resolveClose());
  });
  return address.port;
}

async function waitForProcessExit(child: ReturnType<typeof spawn>, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise(resolveExit => {
    const finish = (exited: boolean) => {
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      resolveExit(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once('exit', onExit);
  });
}

async function terminateProcessTree(child: ReturnType<typeof spawn>): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const taskkill = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
  const result = spawnSync(taskkill, ['/PID', String(child.pid), '/T', '/F'], { timeout: 10_000, windowsHide: true, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0 && child.exitCode === null && child.signalCode === null) {
    throw new Error(`Could not stop the packaged app process tree: ${result.stderr || result.stdout || result.status}`);
  }
  if (!await waitForProcessExit(child, 10_000)) throw new Error('The packaged app process did not exit after taskkill');
}

async function connectToPackagedApp(debugPort: number): Promise<Browser> {
  let browser: Browser | undefined;
  await expect.poll(async () => {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, { timeout: 1_000 });
      return true;
    } catch {
      return false;
    }
  }, { timeout: 60_000, intervals: [100, 250, 500, 1_000] }).toBe(true);
  if (!browser) throw new Error('The packaged app did not publish its loopback DevTools endpoint');
  return browser;
}

async function launchPackagedApp(executable: string, args: readonly string[] = []): Promise<PackagedApp> {
  const debugPort = await reserveLoopbackPort();
  const appProcess = spawn(executable, [
    '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${debugPort}`, ...args
  ], { env: cleanEnvironment(), stdio: 'ignore', windowsHide: true });
  if (!appProcess.pid) throw new Error('The packaged app launcher did not start');

  let browser: Browser | undefined;
  try {
    browser = await connectToPackagedApp(debugPort);
    const context = browser.contexts()[0];
    if (!context) throw new Error('The packaged app did not expose its browser context');
    await expect.poll(() => context.pages().length, { timeout: 30_000 }).toBeGreaterThan(0);
    const page = context.pages()[0];
    if (!page) throw new Error('The packaged app did not create a window');
    return { process: appProcess, browser, page };
  } catch (error) {
    if (browser) await browser.close().catch(() => undefined);
    await terminateProcessTree(appProcess);
    throw error;
  }
}

async function closePackagedApp(app: PackagedApp): Promise<void> {
  await app.page.close().catch(() => undefined);
  const exitedGracefully = await waitForProcessExit(app.process, 30_000);
  await app.browser.close().catch(() => undefined);
  if (!exitedGracefully) await terminateProcessTree(app.process);
}

async function expectLocalPowerShellTerminal(page: Page): Promise<void> {
  const existingTabCount = await page.getByRole('tab').count();
  await page.keyboard.press('Control+Shift+P');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await palette.getByRole('button', { name: 'New PowerShell terminal', exact: true }).click();
  await expect.poll(() => page.getByRole('tab').count(), { timeout: 20_000 }).toBeGreaterThan(existingTabCount);
  const tab = page.getByRole('tab').last();
  await expect(tab).toBeVisible();
  const panelId = await tab.getAttribute('aria-controls');
  if (!panelId) throw new Error('Packaged PowerShell terminal has no panel');
  const panel = page.locator(`#${panelId}`);
  await tab.click();
  await expect(panel.locator('.terminal-host')).toBeVisible();
  await panel.locator('.terminal-host').click({ position: { x: 80, y: 60 } });
  await page.keyboard.type("Write-Output 'MRT-PACKAGED-LOCAL-SHELL'");
  await page.keyboard.press('Enter');
  await expect(panel.locator('.xterm-rows')).toContainText('MRT-PACKAGED-LOCAL-SHELL', { timeout: 20_000 });
}

async function expectLocalBashTerminal(page: Page): Promise<void> {
  const existingTabCount = await page.getByRole('tab').count();
  await page.keyboard.press('Control+Shift+P');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await palette.getByRole('button', { name: 'New Bash terminal', exact: true }).click();
  await expect.poll(() => page.getByRole('tab').count(), { timeout: 20_000 }).toBeGreaterThan(existingTabCount);
  const tab = page.getByRole('tab').last();
  await expect(tab).toBeVisible();
  const panelId = await tab.getAttribute('aria-controls');
  if (!panelId) throw new Error('Packaged Bash terminal has no panel');
  const panel = page.locator(`#${panelId}`);
  await tab.click();
  await expect(panel.locator('.terminal-host')).toBeVisible();
  await panel.locator('.terminal-host').click({ position: { x: 80, y: 60 } });
  await page.keyboard.type("printf 'MRT-PACKAGED-%s\\n' 'BASH-OK'");
  await page.keyboard.press('Enter');
  await expect(panel.locator('.xterm-rows')).toContainText('MRT-PACKAGED-BASH-OK', { timeout: 20_000 });
}

async function expectPackagedWindow(page: Page, userData: string, resourcesPath: string, options: {
  readonly deviceScaleFactor?: number;
  readonly emulateOffline?: boolean;
} = {}): Promise<void> {
  await expect(page.getByRole('heading', { name: 'No terminal is open' })).toBeVisible({ timeout: 30_000 });
  expect((await stat(join(resourcesPath, 'credential-prompt.ps1'))).isFile()).toBe(true);
  if (options.deviceScaleFactor !== undefined) {
    await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBe(options.deviceScaleFactor);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  if (options.emulateOffline) {
    await page.context().setOffline(true);
    const geolocationPermission = await page.evaluate(async () => (await navigator.permissions.query({ name: 'geolocation' })).state);
    expect(geolocationPermission).toBe('denied');

    const helpButton = page.getByRole('button', { name: 'Help', exact: true });
    await helpButton.click();
    const help = page.getByRole('dialog', { name: 'Help & keyboard shortcuts' });
    await expect(help.getByRole('heading', { name: 'Troubleshooting' })).toBeVisible();
    await help.getByRole('button', { name: 'Close', exact: true }).click();

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Workbench settings' });
    await settings.getByLabel('Startup greeting').fill('Offline package profile \u2014 caf\u00e9');
    await settings.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(settings.getByText('Settings saved.', { exact: true })).toBeVisible();
    await settings.getByRole('button', { name: 'Close', exact: true }).click();
  }
  await expectLocalPowerShellTerminal(page);
  await expectLocalBashTerminal(page);
  const serialPorts = await page.evaluate(() => window.multiRemoteTerminal.listSerialPorts());
  expect(serialPorts.ok).toBe(true);
  if (serialPorts.ok) expect(Array.isArray(serialPorts.result)).toBe(true);
  const profile = await stat(userData);
  expect(profile.isDirectory()).toBe(true);
  expect((await stat(join(userData, 'multiremote-terminal.sqlite'))).isFile()).toBe(true);
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex').toUpperCase();
}

async function corruptPackagedAsarHeaderHash(archivePath: string): Promise<void> {
  const archive = await readFile(archivePath);
  if (archive.length < 16) throw new Error('Packaged ASAR is too short to contain its header');
  const headerLength = archive.readUInt32LE(12);
  if (headerLength === 0 || 16 + headerLength > archive.length) throw new Error('Packaged ASAR header bounds are invalid');
  const header = archive.toString('utf8', 16, 16 + headerLength);
  const integrityHash = /"integrity"\s*:\s*\{\s*"algorithm"\s*:\s*"SHA256"\s*,\s*"hash"\s*:\s*"([0-9a-f]{64})"/iu.exec(header);
  const hashValue = integrityHash?.[1];
  if (!integrityHash || integrityHash.index === undefined || !hashValue) throw new Error('Packaged ASAR has no SHA-256 integrity metadata');
  const hashOffset = 16 + integrityHash.index + integrityHash[0].indexOf(hashValue);
  const currentByte = archive[hashOffset];
  if (currentByte === undefined) throw new Error('Packaged ASAR integrity hash offset is invalid');
  archive[hashOffset] = currentByte === 0x30 ? 0x31 : 0x30;
  await writeFile(archivePath, archive);
}

test('Windows package disables unused Electron entry points and validates its ASAR', async () => {
  test.skip(process.platform !== 'win32' || process.arch !== 'x64' || process.env.MRT_PACKAGE_E2E !== '1',
    'Run on Windows x64 through package:win:smoke');

  const executable = resolve('artifacts/windows/win-unpacked/MultiRemoteTerminal.exe');
  const fuses = await getCurrentFuseWire(executable);
  expect(fuses.version).toBe(FuseVersion.V1);
  const expected = [
    [FuseV1Options.RunAsNode, FuseState.DISABLE],
    [FuseV1Options.EnableCookieEncryption, FuseState.ENABLE],
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseState.DISABLE],
    [FuseV1Options.EnableNodeCliInspectArguments, FuseState.DISABLE],
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseState.ENABLE],
    [FuseV1Options.OnlyLoadAppFromAsar, FuseState.ENABLE],
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot, FuseState.DISABLE],
    [FuseV1Options.GrantFileProtocolExtraPrivileges, FuseState.DISABLE],
    [FuseV1Options.WasmTrapHandlers, FuseState.ENABLE]
  ] as const;
  for (const [fuse, state] of expected) expect(fuses[fuse]).toBe(state);
});

test('Windows x64 artifacts have per-artifact CycloneDX SBOMs and verified SHA-256 manifests', async () => {
  test.skip(process.platform !== 'win32' || process.arch !== 'x64' || process.env.MRT_PACKAGE_E2E !== '1',
    'Run on Windows x64 through package:win:smoke');
  const artifacts = resolve('artifacts/windows');
  const outputs = [
    { artifact: 'MultiRemoteTerminal Setup 0.0.0.exe', kind: 'nsis-installer' },
    { artifact: 'MultiRemoteTerminal 0.0.0.exe', kind: 'portable-executable' }
  ];
  const checksums = (await readFile(join(artifacts, 'SHA256SUMS.txt'), 'utf8')).split(/\r?\n/u);

  for (const output of outputs) {
    const artifactBytes = await readFile(join(artifacts, output.artifact));
    const bomName = `${output.artifact}.cdx.json`;
    const bomContents = await readFile(join(artifacts, bomName), 'utf8');
    const bom = JSON.parse(bomContents) as {
      readonly bomFormat: string;
      readonly specVersion: string;
      readonly components: readonly { readonly name: string; readonly version: string; readonly 'bom-ref': string }[];
      readonly dependencies: readonly { readonly ref: string; readonly dependsOn: readonly string[] }[];
      readonly metadata: { readonly component: {
        readonly name: string;
        readonly hashes: readonly { readonly alg: string; readonly content: string }[];
        readonly properties: readonly { readonly name: string; readonly value: string }[];
      } };
    };
    expect(bom.bomFormat).toBe('CycloneDX');
    expect(bom.specVersion).toBe('1.6');
    expect(bom.metadata.component.name).toBe('MultiRemoteTerminal');
    expect(bom.metadata.component.hashes).toContainEqual({ alg: 'SHA-256', content: sha256(artifactBytes) });
    expect(bom.components.some(component => component.name === 'electron' && component.version === '45.0.0')).toBe(true);
    expect(bom.components.some(component => component.name === '@playwright/test' || component.name === 'electron-builder')).toBe(false);
    expect(bom.metadata.component.properties.find(property => property.name === 'mrt:distribution:kind')?.value).toBe(output.kind);
    const signatureStatus = bom.metadata.component.properties.find(property => property.name === 'mrt:authenticode:status')?.value;
    expect(['Valid', 'NotSigned']).toContain(signatureStatus);
    if (process.env.MRT_SIGNED_RELEASE === '1') expect(signatureStatus).toBe('Valid');

    const knownReferences = new Set([
      ...bom.components.map(component => component['bom-ref']),
      ...bom.dependencies.map(dependency => dependency.ref)
    ]);
    for (const dependency of bom.dependencies) {
      expect(knownReferences.has(dependency.ref)).toBe(true);
      for (const target of dependency.dependsOn) expect(knownReferences.has(target)).toBe(true);
    }
    expect(checksums).toContain(`${sha256(artifactBytes)}  ${output.artifact}`);
    expect(checksums).toContain(`${sha256(bomContents)}  ${bomName}`);
  }
});

test('NSIS package works offline at 200% scale, persists local settings, and uninstalls', async () => {
  test.skip(process.platform !== 'win32' || process.arch !== 'x64' || process.env.MRT_PACKAGE_E2E !== '1',
    'Run on Windows x64 through package:win:smoke; signature verification is outside this smoke');
  test.setTimeout(240_000);
  const artifacts = resolve('artifacts/windows');
  const installer = join(artifacts, 'MultiRemoteTerminal Setup 0.0.0.exe');
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'mrt-installer-smoke-'));
  const installDirectory = join(temporaryRoot, 'installed');
  let app: PackagedApp | undefined;
  try {
    const installResult = spawnSync(installer, ['/S', `/D=${installDirectory}`], { timeout: 120_000, windowsHide: true, encoding: 'utf8' });
    if (installResult.error) throw installResult.error;
    expect(installResult.status, installResult.stderr).toBe(0);

    const executable = join(installDirectory, 'MultiRemoteTerminal.exe');
    await expect.poll(async () => (await stat(executable).catch(() => undefined)) !== undefined, { timeout: 30_000 }).toBe(true);
    const profile = join(temporaryRoot, 'user-data');
    const launchInstalled = () => launchPackagedApp(executable, [
      '--mrt-e2e-delay-first-terminal-open', '--mrt-e2e-delay-first-session-create-reply',
      `--user-data-dir=${profile}`, '--force-device-scale-factor=2'
    ]);
    app = await launchInstalled();
    await expectPackagedWindow(app.page, profile, join(installDirectory, 'resources'), { deviceScaleFactor: 2, emulateOffline: true });
    const savedName = 'Packaged smoke session';
    await app.page.getByRole('button', { name: 'Save active session', exact: true }).click();
    const saveDialog = app.page.getByRole('dialog', { name: 'Save active session' });
    await saveDialog.getByLabel('Session name').fill(savedName);
    await saveDialog.getByRole('button', { name: 'Save session', exact: true }).click();
    await expect(app.page.getByRole('button', { name: `Open ${savedName}`, exact: true })).toBeVisible({ timeout: 8_000 });
    expect(win32.resolve(profile).toLowerCase()).not.toContain(win32.resolve(installDirectory).toLowerCase());
    await closePackagedApp(app);
    app = undefined;

    app = await launchInstalled();
    const reopenedPage = app.page;
    await expect(reopenedPage.getByRole('heading', { name: 'No terminal is open' })).toBeVisible({ timeout: 30_000 });
    await reopenedPage.context().setOffline(true);
    await expect(reopenedPage.getByRole('region', { name: 'Startup greeting' })).toContainText('Offline package profile \u2014 caf\u00e9');
    await closePackagedApp(app);
    app = undefined;

    await corruptPackagedAsarHeaderHash(join(installDirectory, 'resources', 'app.asar'));
    const tamperedProfile = join(temporaryRoot, 'tampered-profile');
    const tamperedApp = spawn(executable, [`--user-data-dir=${tamperedProfile}`], {
      env: cleanEnvironment(), stdio: 'ignore', windowsHide: true
    });
    if (!tamperedApp.pid) throw new Error('The tampered package process did not start');
    const exitedAfterTampering = await waitForProcessExit(tamperedApp, 15_000);
    if (!exitedAfterTampering) {
      await terminateProcessTree(tamperedApp);
      throw new Error('The installed app stayed running after its ASAR integrity metadata was altered');
    }
    expect(tamperedApp.exitCode).not.toBeNull();

    const uninstaller = (await readdir(installDirectory)).find(name => /^uninstall.*\.exe$/iu.test(name));
    if (!uninstaller) throw new Error('The NSIS install did not include an uninstaller');
    const uninstallResult = spawnSync(join(installDirectory, uninstaller), ['/S'], { timeout: 120_000, windowsHide: true, encoding: 'utf8' });
    if (uninstallResult.error) throw uninstallResult.error;
    expect(uninstallResult.status, uninstallResult.stderr).toBe(0);
    await expect.poll(async () => (await stat(installDirectory).catch(() => undefined)) === undefined, { timeout: 30_000 }).toBe(true);
  } finally {
    if (app) await closePackagedApp(app);
    const uninstaller = (await readdir(installDirectory).catch(() => [])).find(name => /^uninstall.*\.exe$/iu.test(name));
    if (uninstaller) spawnSync(join(installDirectory, uninstaller), ['/S'], { timeout: 120_000, windowsHide: true });
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
  }
});

test('portable app opens a usable terminal and keeps profile data beside the executable', async () => {
  test.skip(process.platform !== 'win32' || process.arch !== 'x64' || process.env.MRT_PACKAGE_E2E !== '1',
    'Run on Windows x64 through package:win:smoke; signature verification is outside this smoke');
  test.setTimeout(180_000);
  const portableArtifact = resolve('artifacts/windows/MultiRemoteTerminal 0.0.0.exe');
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'mrt-portable-smoke-'));
  const portableExecutable = join(temporaryRoot, 'MultiRemoteTerminal.exe');
  await copyFile(portableArtifact, portableExecutable);
  let app: PackagedApp | undefined;
  try {
    const expected = win32.join(temporaryRoot, 'MultiRemoteTerminal-data');
    app = await launchPackagedApp(portableExecutable);
    await expect.poll(async () => (await stat(join(expected, 'multiremote-terminal.sqlite')).catch(() => undefined)) !== undefined,
      { timeout: 60_000, intervals: [200, 500, 1_000] }).toBe(true);
    await expect(app.page.getByRole('heading', { name: 'MultiRemoteTerminal terminal workspace' })).toBeVisible({ timeout: 30_000 });
    await expectLocalPowerShellTerminal(app.page);
    await expectLocalBashTerminal(app.page);
    expect(app.process.exitCode).toBeNull();
    const profileStat = await stat(expected);
    expect(profileStat.isDirectory()).toBe(true);
  } finally {
    if (app) await closePackagedApp(app);
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
  }
});
