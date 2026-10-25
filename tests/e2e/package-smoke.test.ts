import { chromium, test, expect, _electron as electron } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { copyFile, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve, win32 } from 'node:path';

function cleanEnvironment(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] =>
    entry[1] !== undefined && entry[0] !== 'ELECTRON_RUN_AS_NODE' && !entry[0].startsWith('PORTABLE_EXECUTABLE_')));
}

type ElectronApp = Awaited<ReturnType<typeof electron.launch>>;

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

async function expectPackagedWindow(app: ElectronApp): Promise<{ readonly userData: string }> {
  const page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: 'No terminal is open' })).toBeVisible({ timeout: 30_000 });
  const metadata = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, userData: app.getPath('userData'), appPath: app.getAppPath() }));
  expect(metadata.packaged).toBe(true);
  await expectLocalPowerShellTerminal(page);
  const serialPorts = await page.evaluate(() => window.multiRemoteTerminal.listSerialPorts());
  expect(serialPorts.ok).toBe(true);
  if (serialPorts.ok) expect(Array.isArray(serialPorts.result)).toBe(true);
  const profile = await stat(metadata.userData);
  expect(profile.isDirectory()).toBe(true);
  expect(metadata.appPath.toLowerCase()).toContain('resources');
  return { userData: metadata.userData };
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex').toUpperCase();
}

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

test('NSIS installs a runnable per-user app and silently uninstalls it', async () => {
  test.skip(process.platform !== 'win32' || process.arch !== 'x64' || process.env.MRT_PACKAGE_E2E !== '1',
    'Run on Windows x64 through package:win:smoke; signature verification is outside this smoke');
  test.setTimeout(240_000);
  const artifacts = resolve('artifacts/windows');
  const installer = join(artifacts, 'MultiRemoteTerminal Setup 0.0.0.exe');
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'mrt-installer-smoke-'));
  const installDirectory = join(temporaryRoot, 'installed');
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    const installResult = spawnSync(installer, ['/S', `/D=${installDirectory}`], { timeout: 120_000, windowsHide: true, encoding: 'utf8' });
    if (installResult.error) throw installResult.error;
    expect(installResult.status, installResult.stderr).toBe(0);

    const executable = join(installDirectory, 'MultiRemoteTerminal.exe');
    await expect.poll(async () => (await stat(executable).catch(() => undefined)) !== undefined, { timeout: 30_000 }).toBe(true);
    const environment = cleanEnvironment();
    const profile = join(temporaryRoot, 'user-data');
    app = await electron.launch({ executablePath: executable, args: [`--user-data-dir=${profile}`], env: environment });
    const { userData } = await expectPackagedWindow(app);
    expect(win32.resolve(userData).toLowerCase()).not.toContain(win32.resolve(installDirectory).toLowerCase());
    await app.close();
    app = undefined;

    const uninstaller = (await readdir(installDirectory)).find(name => /^uninstall.*\.exe$/iu.test(name));
    if (!uninstaller) throw new Error('The NSIS install did not include an uninstaller');
    const uninstallResult = spawnSync(join(installDirectory, uninstaller), ['/S'], { timeout: 120_000, windowsHide: true, encoding: 'utf8' });
    if (uninstallResult.error) throw uninstallResult.error;
    expect(uninstallResult.status, uninstallResult.stderr).toBe(0);
    await expect.poll(async () => (await stat(installDirectory).catch(() => undefined)) === undefined, { timeout: 30_000 }).toBe(true);
  } finally {
    if (app) await app.close();
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
  const debugPort = await reserveLoopbackPort();
  let browser: Browser | undefined;
  let portableApp: ReturnType<typeof spawn> | undefined;
  try {
    const environment = cleanEnvironment();
    const expected = win32.join(temporaryRoot, 'MultiRemoteTerminal-data');
    portableApp = spawn(portableExecutable, [
      '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${debugPort}`
    ], { env: environment, stdio: 'ignore', windowsHide: true });
    if (!portableApp.pid) throw new Error('The portable launcher did not start');
    await expect.poll(async () => (await stat(join(expected, 'multiremote-terminal.sqlite')).catch(() => undefined)) !== undefined,
      { timeout: 60_000, intervals: [200, 500, 1_000] }).toBe(true);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, { timeout: 60_000 });
    const context = browser.contexts()[0];
    if (!context) throw new Error('The portable app did not expose its browser context');
    await expect.poll(() => context.pages().length, { timeout: 30_000 }).toBeGreaterThan(0);
    const page = context.pages()[0];
    if (!page) throw new Error('The portable app did not create a window');
    await expect(page.getByRole('heading', { name: 'MultiRemoteTerminal terminal workspace' })).toBeVisible({ timeout: 30_000 });
    await expectLocalPowerShellTerminal(page);
    expect(portableApp.exitCode).toBeNull();
    const profileStat = await stat(expected);
    expect(profileStat.isDirectory()).toBe(true);
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    if (portableApp?.pid && portableApp.exitCode === null && portableApp.signalCode === null) {
      const taskkill = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
      const result = spawnSync(taskkill, ['/PID', String(portableApp.pid), '/T', '/F'], { windowsHide: true, encoding: 'utf8' });
      if (result.error) throw result.error;
      if (result.status !== 0 && portableApp.exitCode === null && portableApp.signalCode === null) {
        throw new Error(`Could not stop the portable app process tree: ${result.stderr || result.stdout || result.status}`);
      }
      await new Promise<void>((resolveExit, rejectExit) => {
        const child = portableApp;
        if (!child || child.exitCode !== null || child.signalCode !== null) {
          resolveExit();
          return;
        }
        const onExit = () => { clearTimeout(timer); resolveExit(); };
        const timer = setTimeout(() => {
          child.removeListener('exit', onExit);
          rejectExit(new Error('The portable app process did not exit after taskkill'));
        }, 10_000);
        child.once('exit', onExit);
      });
    }
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
  }
});
