import { test, expect, _electron as electron } from '@playwright/test';
import type { Page } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const unicodeSample = String.fromCodePoint(0x416, 0x96ea, 0x1f642);

function electronEnvironment(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] =>
    entry[1] !== undefined && entry[0] !== 'ELECTRON_RUN_AS_NODE'));
}

async function runPaletteCommand(page: Page, label: string): Promise<void> {
  await page.keyboard.press('Control+Shift+P');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await palette.getByRole('button', { name: label, exact: true }).click();
}

async function selectTerminal(page: Page, title: string) {
  const tab = page.getByRole('tab').filter({ hasText: title }).first();
  await expect(tab).toBeVisible();
  await tab.click();
  const panelId = await tab.getAttribute('aria-controls');
  if (!panelId) throw new Error(`Missing terminal panel for ${title}`);
  return page.locator(`#${panelId}`);
}

async function sendLine(page: Page, title: string, line: string, marker: string | RegExp) {
  const panel = await selectTerminal(page, title);
  await panel.locator('.terminal-host').click({ position: { x: 80, y: 60 } });
  await page.keyboard.type(line);
  await page.keyboard.press('Enter');
  const rows = panel.locator('.xterm-rows');
  await expect(rows).toContainText(marker, { timeout: 15_000 });
  return { panel, rows };
}

async function confirmCloseActiveTerminal(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'Close active terminal' }).click();
  const confirmation = page.getByRole('alertdialog');
  await expect(confirmation).toContainText(title);
  await confirmation.getByRole('button', { name: 'Close terminal' }).click();
}

function systemExecutable(name: string): string {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
  return join(systemRoot, 'System32', name);
}

function windowsPowerShellExecutable(): string {
  return join(systemExecutable(''), 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function processIsRunning(pid: number): boolean {
  const result = execFileSync(systemExecutable('tasklist.exe'), ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
    encoding: 'utf8', windowsHide: true
  });
  return result.includes(`"${pid}"`);
}

function parentProcessId(pid: number): number {
  const result = execFileSync(windowsPowerShellExecutable(), ['-NoProfile', '-NonInteractive', '-Command',
    `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').ParentProcessId`], {
    encoding: 'utf8', windowsHide: true
  });
  return Number(result.trim());
}

function powerShellProcessIds(): number[] {
  const result = execFileSync(windowsPowerShellExecutable(),
    ['-NoProfile', '-NonInteractive', '-Command',
      `Get-CimInstance Win32_Process -Filter \"Name = 'powershell.exe'\" | Where-Object ProcessId -ne $PID | ForEach-Object ProcessId`], {
      encoding: 'utf8', windowsHide: true
    });
  return result.split(/\r?\n/).map(value => Number(value.trim())).filter(value => Number.isSafeInteger(value) && value > 0);
}

async function readPowerShellPid(page: Page, title: string): Promise<number> {
  const { rows } = await sendLine(page, title, "Write-Output ('MRT-' + 'PID:' + $PID)", /MRT-PID:\d+/);
  const matches = [...(await rows.innerText()).matchAll(/MRT-PID:(\d+)/g)];
  const pid = Number(matches.at(-1)?.[1]);
  expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
  return pid;
}

async function readPowerShellSize(page: Page, title: string): Promise<{ readonly columns: number; readonly rows: number }> {
  const { rows } = await sendLine(page, title,
    "Write-Output ('MRT-SIZE:' + $Host.UI.RawUI.WindowSize.Width + 'x' + $Host.UI.RawUI.WindowSize.Height)", /MRT-SIZE:\d+x\d+/);
  const match = (await rows.innerText()).match(/MRT-SIZE:(\d+)x(\d+)/);
  const columns = Number(match?.[1]);
  const rowCount = Number(match?.[2]);
  expect(Number.isSafeInteger(columns) && columns > 1).toBe(true);
  expect(Number.isSafeInteger(rowCount) && rowCount > 0).toBe(true);
  return { columns, rows: rowCount };
}

function waitForExit(child: ReturnType<typeof spawn>, timeoutMs: number): Promise<number> {
  return new Promise((resolveExit, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Second application instance did not exit after failing to acquire the lock'));
    }, timeoutMs);
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', code => {
      clearTimeout(timer);
      resolveExit(code ?? -1);
    });
  });
}

test('a second application process exits under the same profile while the primary window stays open', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'mrt-single-instance-'));
  const app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`], env: electronEnvironment() });
  let secondInstance: ReturnType<typeof spawn> | undefined;
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    const executable = await app.evaluate(() => process.execPath);
    secondInstance = spawn(executable, [resolve('apps/desktop'), `--user-data-dir=${profile}`], {
      env: electronEnvironment(), windowsHide: true, stdio: 'ignore'
    });
    expect(await waitForExit(secondInstance, 10_000)).toBe(0);
    expect(app.process()?.exitCode).toBeNull();
    await expect(page.locator('.workbench')).toHaveCount(1);
  } finally {
    secondInstance?.kill();
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('Windows local terminal workbench operates real shells, handles 10 tabs and closes their processes', async () => {
  test.skip(process.platform !== 'win32', 'ConPTY acceptance evidence is required on Windows');
  test.setTimeout(180_000);
  const profile = await mkdtemp(join(tmpdir(), 'mrt-terminal-e2e-'));
  const existingPowerShellPids = new Set(powerShellProcessIds());
  const app = await electron.launch({
    args: [resolve('apps/desktop'), `--user-data-dir=${profile}`, '--force-device-scale-factor=2', '--mrt-e2e-delay-first-terminal-open'],
    env: electronEnvironment()
  });
  try {
    const page = await app.firstWindow();
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    expect(await app.evaluate(() => process.argv.includes('--mrt-e2e-delay-first-terminal-open'))).toBe(true);
    const openingCancel = page.getByRole('button', { name: 'Cancel opening PowerShell terminal' });
    await expect(openingCancel).toBeVisible({ timeout: 15_000 });
    const newPowerShellPids = () => powerShellProcessIds().filter(pid => !existingPowerShellPids.has(pid));
    await expect.poll(() => newPowerShellPids().length, { timeout: 10_000, intervals: [100, 250, 500] }).toBeGreaterThan(0);
    await openingCancel.click();
    await expect(page.getByRole('tab')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'No terminal is open' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Opening terminals' })).toHaveCount(0, { timeout: 15_000 });
    await expect.poll(() => newPowerShellPids(), { timeout: 10_000, intervals: [100, 250, 500] }).toEqual([]);
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await runPaletteCommand(page, 'New PowerShell terminal');
    await expect(page.getByRole('tab', { name: /PowerShell session 1/ })).toBeVisible();
    await expect(page.getByRole('tabpanel')).toBeVisible();

    const isolation = await page.evaluate(async () => {
      const globals = globalThis as unknown as Record<string, unknown>;
      return { require: typeof globals.require, process: typeof globals.process, Buffer: typeof globals.Buffer,
        bridge: Object.keys(window.multiRemoteTerminal), snapshot: await window.multiRemoteTerminal.describe() };
    });
    expect(isolation.require).toBe('undefined');
    expect(isolation.process).toBe('undefined');
    expect(isolation.Buffer).toBe('undefined');
    expect(isolation.bridge).toEqual(['describe', 'openTerminal', 'writeTerminal', 'resizeTerminal', 'acknowledgeTerminalOutput', 'closeTerminal', 'onTerminalEvent']);
    expect(isolation.snapshot.ok).toBe(true);
    const rendererProcesses = await app.evaluate(({ app }) => app.getAppMetrics().filter(metric => metric.type === 'Tab'));
    expect(rendererProcesses.length).toBeGreaterThan(0);
    expect(rendererProcesses.every(renderer => renderer.sandboxed)).toBe(true);

    const invalidShell = await page.evaluate(() => window.multiRemoteTerminal.openTerminal(crypto.randomUUID(), 'sh' as never, 80, 24));
    expect(invalidShell.ok).toBe(false);
    if (!invalidShell.ok) expect(invalidShell.error.code).toBe('INVALID_REQUEST');

    const unicodeCommand = `$u='${unicodeSample}'; Write-Output ('MRT-UNICODE:' + $u.Length + ':' + $u)`;
    await app.evaluate(({ clipboard }, value) => clipboard.writeText(value), unicodeCommand);
    const firstPanel = await selectTerminal(page, 'PowerShell session 1');
    await firstPanel.locator('.terminal-host').click({ position: { x: 80, y: 60 } });
    await page.keyboard.press('Control+V');
    await page.keyboard.press('Enter');
    await expect(firstPanel.locator('.xterm-rows')).toContainText(`MRT-UNICODE:4:${unicodeSample}`, { timeout: 15_000 });

    await app.evaluate(({ clipboard }, value) => clipboard.writeText(value), "Write-Output ('MRT-' + 'PASTE:clipboard-ok')");
    await firstPanel.locator('.terminal-host').click({ position: { x: 80, y: 60 } });
    await page.keyboard.press('Control+V');
    await page.keyboard.press('Enter');
    await expect(firstPanel.locator('.xterm-rows')).toContainText('MRT-PASTE:clipboard-ok', { timeout: 15_000 });

    await page.keyboard.press('Control+Shift+P');
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
    await expect(page.locator('#palette-search')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('button', { name: 'New cmd terminal' })).toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('tab', { name: /cmd session 1/ })).toBeVisible();
    await sendLine(page, 'cmd session 1', 'echo MRT-CMD:%RANDOM%', /MRT-CMD:\d+/);

    for (let index = 0; index < 8; index++) {
      await runPaletteCommand(page, 'New PowerShell terminal');
      await expect(page.getByRole('tab').filter({ hasText: /PowerShell session/ })).toHaveCount(index + 2);
    }
    await expect(page.getByRole('tab')).toHaveCount(10);
    await page.keyboard.press('Control+Tab');
    await expect(page.getByRole('tab', { name: /PowerShell session 9/ })).toHaveAttribute('aria-selected', 'true');
    const sessionNineTab = page.getByRole('tab', { name: /PowerShell session 9/ });
    await sessionNineTab.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('tab', { name: /PowerShell session 8/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: /PowerShell session 8/ })).toBeFocused();

    const processIds: number[] = [];
    for (let index = 1; index <= 9; index++) processIds.push(await readPowerShellPid(page, `PowerShell session ${index}`));
    expect(new Set(processIds).size).toBe(9);

    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await expect(page.locator('.workbench')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f3f6fa');
    await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBe(2);
    const originalWidth = await page.evaluate(() => innerWidth);
    const largeShellSize = await readPowerShellSize(page, 'PowerShell session 9');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(900, 700));
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(originalWidth);
    let narrowShellColumns = largeShellSize.columns;
    await expect.poll(async () => {
      narrowShellColumns = (await readPowerShellSize(page, 'PowerShell session 9')).columns;
      return narrowShellColumns;
    }, { timeout: 10_000, intervals: [250] }).toBeLessThan(largeShellSize.columns);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1180, 800));
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeGreaterThan(originalWidth - 5);
    await page.screenshot({ path: 'test-results/terminal-light-200pct.png', fullPage: true });
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#142231');
    await page.screenshot({ path: 'test-results/terminal-dark-200pct.png', fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(pageErrors).toEqual([]);

    await selectTerminal(page, 'cmd session 1');
    await page.getByRole('button', { name: 'Close active terminal' }).click();
    const firstConfirmation = page.getByRole('alertdialog');
    await expect(firstConfirmation).toContainText('cmd session 1');
    await expect(firstConfirmation.getByRole('button', { name: 'Keep terminal' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(firstConfirmation.getByRole('button', { name: 'Close terminal' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(firstConfirmation).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /cmd session 1/ })).toBeVisible();
    await confirmCloseActiveTerminal(page, 'cmd session 1');
    await expect(page.getByRole('tab', { name: /cmd session 1/ })).toHaveCount(0);
    for (let index = 9; index >= 1; index--) {
      await selectTerminal(page, `PowerShell session ${index}`);
      await confirmCloseActiveTerminal(page, `PowerShell session ${index}`);
      await expect(page.getByRole('tab', { name: new RegExp(`PowerShell session ${index}\\b`) })).toHaveCount(0);
    }
    await expect(page.getByRole('heading', { name: 'No terminal is open' })).toBeVisible();
    await Promise.all(processIds.map(pid => expect.poll(() => processIsRunning(pid), { timeout: 12_000, intervals: [100, 250, 500] }).toBe(false)));

    for (let index = 0; index < 3; index++) {
      const title = `PowerShell session ${10 + index}`;
      await runPaletteCommand(page, 'New PowerShell terminal');
      await expect(page.getByRole('tab', { name: new RegExp(title) })).toBeVisible();
      const pid = await readPowerShellPid(page, title);
      await confirmCloseActiveTerminal(page, title);
      await expect(page.getByRole('tab', { name: new RegExp(title) })).toHaveCount(0);
      await expect.poll(() => processIsRunning(pid), { timeout: 12_000, intervals: [100, 250, 500] }).toBe(false);
    }

    const crashTitle = 'PowerShell session 13';
    await runPaletteCommand(page, 'New PowerShell terminal');
    await expect(page.getByRole('tab', { name: new RegExp(crashTitle) })).toBeVisible();
    const crashShellPid = await readPowerShellPid(page, crashTitle);
    const workerPid = parentProcessId(crashShellPid);
    expect(workerPid).toBeGreaterThan(0);
    expect(workerPid).not.toBe(await app.evaluate(() => process.pid));
    expect(processIsRunning(workerPid)).toBe(true);
    execFileSync(systemExecutable('taskkill.exe'), ['/F', '/PID', String(workerPid)], { encoding: 'utf8', windowsHide: true });
    await expect(page.getByRole('alert')).toContainText('UNAVAILABLE', { timeout: 15_000 });
    await expect(page.locator('.status-bar')).toContainText('failed');
    await expect.poll(() => processIsRunning(crashShellPid), { timeout: 12_000, intervals: [100, 250, 500] }).toBe(false);

    await runPaletteCommand(page, 'New PowerShell terminal');
    await expect(page.getByRole('tab', { name: /PowerShell session 14/ })).toBeVisible();
    await sendLine(page, 'PowerShell session 14', "Write-Output ('MRT-WORKER:' + 'restarted')", 'MRT-WORKER:restarted');
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('100% scale themes render and CSP/Electron policy deny injected capabilities', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'mrt-security-'));
  const app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`, '--force-device-scale-factor=1'], env: electronEnvironment() });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await expect(page.getByRole('tab', { name: /PowerShell session 1/ })).toBeVisible();
    await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBe(1);
    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await expect(page.locator('.workbench')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f3f6fa');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/terminal-light-100pct.png', fullPage: true });
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await expect(page.locator('.workbench')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#142231');
    await page.screenshot({ path: 'test-results/terminal-dark-100pct.png', fullPage: true });
    const result = await page.evaluate(async () => {
      const globals = globalThis as unknown as Record<string, unknown>;
      globals.injectionExecuted = false;
      const script = document.createElement('script');
      script.textContent = 'globalThis.injectionExecuted = true';
      document.body.append(script);
      const sample = document.querySelector('.terminal-host');
      if (sample) sample.innerHTML = '<img src=x onerror="globalThis.injectionExecuted = true">';
      const blockedFetch = await fetch('file:///C:/Windows/win.ini').then(() => false, () => true);
      const popup = window.open('https://example.com');
      const permission = await navigator.permissions.query({ name: 'geolocation' });
      return { injected: globals.injectionExecuted, blockedFetch, popup: popup === null, permission: permission.state };
    });
    expect(result).toEqual({ injected: false, blockedFetch: true, popup: true, permission: 'denied' });
    await page.evaluate(() => {
      const link = document.createElement('a'); link.href = 'https://example.com'; document.body.append(link); link.click();
    });
    const retained = await app.evaluate(async ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.executeJavaScript(
      '({ url: location.href, wordmark: document.querySelector(".wordmark")?.textContent })'));
    expect(retained).toEqual({ url: 'mrt://app/index.html', wordmark: 'MultiRemoteTerminal' });
    expect(app.windows()).toHaveLength(1);
    const badRequest = await app.evaluate(async ({ net }) => (await net.fetch('mrt://app/private.db')).status);
    expect(badRequest).toBe(403);
    const foreignReply = await app.evaluate(async ({ BrowserWindow }, preload) => {
      const foreign = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false } });
      try {
        await foreign.loadURL('mrt://app/index.html');
        return await foreign.webContents.executeJavaScript('window.multiRemoteTerminal.describe()');
      } finally { foreign.destroy(); }
    }, resolve('dist/preload/bridge.cjs'));
    expect(foreignReply.ok).toBe(false);
    if (!foreignReply.ok) expect(foreignReply.error.code).toBe('UNAVAILABLE');
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
