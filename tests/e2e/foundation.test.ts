import { test, expect, _electron as electron } from '@playwright/test';
import type { Page } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const unicodeSample = String.fromCodePoint(0x416, 0x96ea, 0x1f642);
let nextPowerShellSizeProbe = 0;

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
  const marker = `MRT-SIZE-${++nextPowerShellSizeProbe}`;
  const outputPattern = new RegExp(`${marker}:(\\d+)x(\\d+)`);
  const { rows } = await sendLine(page, title,
    `Write-Output ('${marker}:' + $Host.UI.RawUI.WindowSize.Width + 'x' + $Host.UI.RawUI.WindowSize.Height)`, outputPattern);
  const match = (await rows.innerText()).match(outputPattern);
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

test('a second application process exits and focuses the primary window under the same profile', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'mrt-single-instance-'));
  const app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`], env: electronEnvironment() });
  let secondInstance: ReturnType<typeof spawn> | undefined;
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await app.evaluate(electron => electron.BrowserWindow.getAllWindows()[0]?.minimize());
    await expect.poll(() => app.evaluate(electron => electron.BrowserWindow.getAllWindows()[0]?.isMinimized())).toBe(true);
    const executable = await app.evaluate(() => process.execPath);
    secondInstance = spawn(executable, [resolve('apps/desktop'), `--user-data-dir=${profile}`], {
      env: electronEnvironment(), windowsHide: true, stdio: 'ignore'
    });
    expect(await waitForExit(secondInstance, 10_000)).toBe(0);
    expect(app.process()?.exitCode).toBeNull();
    await expect.poll(() => app.evaluate(electron => ({
      visible: electron.BrowserWindow.getAllWindows()[0]?.isVisible(),
      minimized: electron.BrowserWindow.getAllWindows()[0]?.isMinimized(),
      focused: electron.BrowserWindow.getAllWindows()[0]?.isFocused()
    })), { timeout: 10_000 }).toEqual({ visible: true, minimized: false, focused: true });
    await expect(page.locator('.workbench')).toHaveCount(1);
  } finally {
    secondInstance?.kill();
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('SSH quick connect validates the address before any credential prompt and returns focus on cancel', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'mrt-ssh-connect-e2e-'));
  const app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`, '--force-device-scale-factor=1'], env: electronEnvironment() });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    const workerReply = await app.evaluate(async ({ utilityProcess }, { workerPath, appRoot }) => new Promise<unknown>((resolveReply, rejectReply) => {
      const requestId = '00000000-0000-4000-8000-000000000001';
      const child = utilityProcess.fork(workerPath, [], { cwd: appRoot, env: { MRT_APP_ROOT: appRoot }, stdio: 'ignore' });
      let settled = false;
      const finish = (error?: Error, value?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill();
        if (error) rejectReply(error);
        else resolveReply(value);
      };
      const timer = setTimeout(() => finish(new Error('SSH worker did not acknowledge shutdown')), 10_000);
      child.once('error', error => finish(new Error(String(error))));
      child.once('exit', code => finish(new Error(`SSH worker exited before replying (${code})`)));
      child.on('message', value => {
        const message = value as { requestId?: unknown };
        if (message?.requestId === requestId) finish(undefined, message);
      });
      child.once('spawn', () => child.postMessage({ version: 1, type: 'request', requestId, command: 'shutdown' }));
    }), { workerPath: resolve('dist/host/apps/desktop/src/workers/ssh-worker.js'), appRoot: resolve('apps/desktop') });
    expect(workerReply).toEqual({ version: 1, type: 'reply', requestId: '00000000-0000-4000-8000-000000000001', ok: true, result: {} });
    const connectButton = page.getByRole('button', { name: 'Connect to SSH' }).first();
    await connectButton.click();
    const dialog = page.getByRole('dialog', { name: 'Connect to an SSH server' });
    await expect(dialog).toBeVisible();
    const hostInput = page.getByLabel('Host name or IP address');
    await expect(hostInput).toBeFocused();
    await page.screenshot({ path: 'test-results/ssh-quick-connect-100pct.png', fullPage: true });
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Enter a host name or IP address.');
    await hostInput.fill('https://server.example.com');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Enter a valid DNS name or IP address.');
    await expect(hostInput).toBeFocused();
    await expect(page.getByRole('tab')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(connectButton).toBeFocused();
    await expect(page.locator('.status-bar')).toContainText('Local');
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('saved sessions save, search, favorite, reopen and delete through the workbench', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'mrt-session-catalog-e2e-'));
  const app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`], env: electronEnvironment() });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await expect(page.getByRole('tab', { name: /PowerShell session 1/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('No saved sessions yet.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Saved sessions', exact: true })).toHaveText('Saved sessions');
    await expect(page.getByLabel('0 saved sessions')).toBeVisible();
    await page.getByRole('button', { name: 'Save active session', exact: true }).click();
    const saveDialog = page.getByRole('dialog', { name: 'Save active session' });
    await expect(saveDialog).toBeVisible();
    const sessionNameInput = saveDialog.getByLabel('Session name');
    await expect(sessionNameInput).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(saveDialog.getByRole('button', { name: 'Save session', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(sessionNameInput).toBeFocused();
    await sessionNameInput.fill('Reusable PowerShell');
    await saveDialog.getByRole('button', { name: 'Save session', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save active session', exact: true })).toBeFocused();
    const search = page.getByRole('searchbox', { name: 'Search saved sessions' });
    const openSaved = page.getByRole('button', { name: 'Open Reusable PowerShell', exact: true });
    await expect(openSaved).toBeVisible();
    await expect(page.getByLabel('1 saved session')).toBeVisible();
    await openSaved.click({ button: 'right' });
    await expect(page.locator('.terminal-tab-menu')).toHaveCount(0);
    await page.getByRole('button', { name: 'Make favorite Reusable PowerShell', exact: true }).click();
    const favorite = page.getByRole('button', { name: 'Remove favorite from Reusable PowerShell', exact: true });
    await expect(favorite).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ path: 'test-results/saved-session-catalog.png', fullPage: true });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(820, 700));
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(900);
    await page.screenshot({ path: 'test-results/saved-session-catalog-narrow.png', fullPage: true });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(700, 480));
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(740);
    await expect(search).toBeVisible();
    await expect(page.getByRole('button', { name: 'PowerShell session 1 running' })).toBeVisible();
    const paletteHint = page.getByRole('button', { name: /Command palette/ });
    await paletteHint.scrollIntoViewIfNeeded();
    await expect(paletteHint).toBeVisible();
    await page.screenshot({ path: 'test-results/saved-session-catalog-min-width.png', fullPage: true });
    await search.fill('reusable power');
    await expect(openSaved).toBeVisible();
    await openSaved.click();
    await expect(page.getByRole('tab')).toHaveCount(2);
    await expect(page.getByRole('tab').filter({ hasText: 'Reusable PowerShell' })).toHaveCount(1);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Actions for saved session Reusable PowerShell' }).click();
    await page.getByRole('button', { name: 'Delete saved session Reusable PowerShell', exact: true }).click();
    await expect(page.getByText('No saved sessions match this search.')).toBeVisible();
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('terminal tabs close by Ctrl+W or middle-click and expose terminal-only actions', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'mrt-terminal-tab-actions-e2e-'));
  const app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`], env: electronEnvironment() });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    const title = 'PowerShell session 1';
    const marker = 'MRT-TAB-CONTEXT-CLEARED';
    const { rows } = await sendLine(page, title, `Write-Output '${marker}'`, marker);
    const tab = page.getByRole('tab', { name: new RegExp(title) });

    await tab.click({ button: 'right' });
    const menu = page.getByRole('menu', { name: `Terminal actions for ${title}` });
    await expect(menu).toBeVisible();
    await page.screenshot({ path: 'test-results/terminal-tab-context-menu.png', fullPage: true });
    await expect(menu.getByRole('menuitem', { name: 'Copy selection' })).toBeFocused();
    await menu.getByRole('menuitem', { name: 'Clear terminal' }).click();
    await expect(rows).not.toContainText(marker);

    await page.locator('.terminal-host').click({ position: { x: 80, y: 60 } });
    await page.keyboard.press('Control+W');
    let confirmation = page.getByRole('alertdialog');
    await expect(confirmation).toContainText(title);
    await confirmation.getByRole('button', { name: 'Keep terminal' }).click();
    await expect(tab).toBeVisible();

    await tab.click({ button: 'middle' });
    confirmation = page.getByRole('alertdialog');
    await expect(confirmation).toContainText(title);
    await confirmation.getByRole('button', { name: 'Keep terminal' }).click();
    await expect(tab).toBeVisible();

    await tab.click({ button: 'right' });
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Close terminal' }).click();
    confirmation = page.getByRole('alertdialog');
    await expect(confirmation).toContainText(title);
    await confirmation.getByRole('button', { name: 'Close terminal' }).click();
    await expect(page.getByRole('tab')).toHaveCount(0);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('saved-session folders create, nest, move, rename, delete safely and persist across restart', async () => {
  test.setTimeout(60_000);
  const profile = await mkdtemp(join(tmpdir(), 'mrt-session-folders-e2e-'));
  let app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`], env: electronEnvironment() });
  try {
    let page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await expect(page.getByRole('tab', { name: /PowerShell session 1/ })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Save active session', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Save active session' });
    await dialog.getByLabel('Session name').fill('Folder saved shell');
    await dialog.getByRole('button', { name: 'Save session', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open Folder saved shell', exact: true })).toBeVisible();

    await page.getByRole('button', { name: '+ Folder', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Create folder' });
    await dialog.getByLabel('Folder name').fill('Work');
    await dialog.getByRole('button', { name: 'Create folder', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Collapse folder Work', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Actions for folder Work' }).click();
    await page.getByRole('button', { name: 'Create subfolder in Work', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Create folder' });
    await dialog.getByLabel('Folder name').fill('Lab');
    await dialog.getByRole('button', { name: 'Create folder', exact: true }).click();

    await page.getByRole('button', { name: 'Actions for saved session Folder saved shell' }).click();
    await page.getByRole('button', { name: 'Move saved session Folder saved shell', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Move Folder saved shell' });
    await dialog.getByLabel('Move to').selectOption({ label: 'Work / Lab' });
    await dialog.getByRole('button', { name: 'Move', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open Folder saved shell', exact: true })).toBeVisible();
    await page.screenshot({ path: 'test-results/saved-session-folders.png', fullPage: true });
    await page.getByRole('button', { name: 'Open Folder saved shell', exact: true }).click();
    await expect(page.getByRole('tab').filter({ hasText: 'Folder saved shell' })).toHaveCount(1);

    await page.getByRole('button', { name: 'Actions for folder Work' }).click();
    await page.getByRole('button', { name: 'Rename folder Work', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Rename Work' });
    await dialog.getByLabel('Folder name').fill('Projects');
    await dialog.getByRole('button', { name: 'Save name', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Collapse folder Projects', exact: true })).toBeVisible();

    await page.getByRole('button', { name: '+ Folder', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Create folder' });
    await dialog.getByLabel('Folder name').fill('Archive');
    await dialog.getByRole('button', { name: 'Create folder', exact: true }).click();
    await page.getByRole('button', { name: 'Actions for folder Projects' }).click();
    await page.getByRole('button', { name: 'Move folder Projects', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Move Projects' });
    await dialog.getByLabel('Move under').selectOption({ label: 'Archive' });
    await dialog.getByRole('button', { name: 'Move', exact: true }).click();
    await page.getByRole('button', { name: 'Actions for folder Archive' }).click();
    await page.getByRole('button', { name: 'Rename folder Archive', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Rename Archive' });
    await dialog.getByLabel('Folder name').fill('Team');
    await dialog.getByRole('button', { name: 'Save name', exact: true }).click();
    await page.getByRole('button', { name: 'Actions for folder Team' }).click();
    page.once('dialog', nativeDialog => nativeDialog.accept());
    await page.getByRole('button', { name: 'Delete folder Team', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Collapse folder Projects', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Collapse folder Lab', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open Folder saved shell', exact: true })).toBeVisible();

    await app.close();
    app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`], env: electronEnvironment() });
    page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Collapse folder Projects', exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Expand folder Lab', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Expand folder Lab', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Collapse folder Lab', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Open Folder saved shell', exact: true }).click();
    await expect(page.getByRole('tab').filter({ hasText: 'Folder saved shell' })).toHaveCount(1);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('a timed-out saved-session write must be checked before retrying, even after dialog dismissal', async () => {
  test.setTimeout(30_000);
  const profile = await mkdtemp(join(tmpdir(), 'mrt-session-timeout-e2e-'));
  const app = await electron.launch({
    args: [resolve('apps/desktop'), `--user-data-dir=${profile}`, '--mrt-e2e-delay-first-session-create-reply'],
    env: electronEnvironment()
  });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await expect(page.getByRole('tab', { name: /PowerShell session 1/ })).toBeVisible({ timeout: 15_000 });
    const saveButton = page.getByRole('button', { name: 'Save active session', exact: true });
    await saveButton.click();
    let dialog = page.getByRole('dialog', { name: 'Save active session' });
    await dialog.getByLabel('Session name').fill('Timed save reconciliation');
    await dialog.getByRole('button', { name: 'Save session', exact: true }).click();

    dialog = page.getByRole('dialog', { name: 'Check save status' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByRole('alert')).toHaveText('Saving could not be confirmed. Check Saved sessions before trying again.');
    await expect(dialog.getByLabel('Session name')).toBeDisabled();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    await saveButton.click();
    dialog = page.getByRole('dialog', { name: 'Check save status' });
    await expect(dialog).toBeVisible();
    const checkButton = dialog.getByRole('button', { name: 'Check saved sessions', exact: true });
    await expect(checkButton).toBeFocused();
    await expect(dialog.getByRole('button', { name: 'Save session', exact: true })).toHaveCount(0);
    await checkButton.click();

    await expect(page.locator('.alert-strip > span')).toHaveText('This session is already saved. Open it from Saved sessions instead of saving it again.');
    await expect(page.getByRole('button', { name: 'Open Timed save reconciliation', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Actions for saved session Timed save reconciliation' }).click();
    await expect(page.getByRole('button', { name: 'Delete saved session Timed save reconciliation', exact: true })).toHaveCount(1);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('SQLite storage worker migrates host trust and shuts down inside Electron', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'mrt-storage-worker-e2e-'));
  const app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`], env: electronEnvironment() });
  const databasePath = join(profile, 'storage-smoke.sqlite');
  const algorithm = 'ssh-ed25519';
  const algorithmBytes = Buffer.from(algorithm, 'ascii');
  const publicKey = Buffer.concat([Buffer.from([0, 0, 0, algorithmBytes.length]), algorithmBytes, Buffer.alloc(32, 41)]);
  const fingerprint = `SHA256:${createHash('sha256').update(publicKey).digest('base64').replace(/=+$/, '')}`;
  const identity = {
    endpoint: { host: 'storage.example', port: 2222 }, algorithm, fingerprint,
    publicKey: Uint8Array.from(publicKey), trustedAt: 1_800_000_000_041, approvalSource: 'user'
  } as const;
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    const reply = await app.evaluate(async ({ utilityProcess }, { workerPath, appRoot, databasePath, identity }) => new Promise<unknown>((resolveReply, rejectReply) => {
      const requestIds = Array.from({ length: 8 }, (_unused, index) => `00000000-0000-4000-8000-${String(index + 2).padStart(12, '0')}`);
      const replies: { imported?: unknown; found?: unknown; created?: unknown; searched?: unknown; favorited?: unknown; favoriteChecked?: unknown; removed?: unknown; shutdown?: unknown } = {};
      const child = utilityProcess.fork(workerPath, [], { cwd: appRoot, env: { MRT_STORAGE_DB_PATH: databasePath }, stdio: 'ignore' });
      const send = (index: number, command: string, payload: Record<string, unknown> = {}) => child.postMessage({
        version: 1, type: 'request', requestId: requestIds[index], command, ...payload
      });
      const observed: string[] = [];
      let settled = false;
      const finish = (error?: Error, value?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) rejectReply(error);
        else resolveReply(value);
      };
      const timer = setTimeout(() => { child.kill(); finish(new Error(`SQLite storage worker did not shut down; replies: ${observed.join(', ') || 'none'}`)); }, 10_000);
      child.once('error', error => finish(new Error(String(error))));
      child.once('exit', code => replies.shutdown ? finish(undefined, replies) : finish(new Error(`SQLite storage worker exited before replying (${code})`)));
      child.on('message', value => {
        const message = value as { type?: unknown; requestId?: unknown; ok?: unknown; result?: { kind?: unknown; value?: unknown } };
        observed.push(message.type === 'reply' ? `${String(message.requestId)}:${String(message.ok)}` : String(message.type));
        if (message.type === 'ready') send(0, 'hostTrust.importLegacy', { identities: [identity] });
        else if (message.type === 'startup-error') finish(new Error('SQLite storage worker failed to initialize'));
        else if (typeof message.requestId === 'string' && message.ok !== true) finish(new Error(`SQLite storage worker rejected ${message.requestId}`));
        else if (message.requestId === requestIds[0] && message.ok === true) {
          replies.imported = message.result?.value;
          send(1, 'hostTrust.find', { endpoint: identity.endpoint });
        } else if (message.requestId === requestIds[1] && message.ok === true) {
          const saved = message.result?.value as typeof identity | null | undefined;
          replies.found = saved ? {
            endpoint: saved.endpoint, algorithm: saved.algorithm, fingerprint: saved.fingerprint,
            publicKeyBase64: Buffer.from(saved.publicKey).toString('base64'), trustedAt: saved.trustedAt,
            approvalSource: saved.approvalSource
          } : null;
          send(2, 'session.create', { draft: { kind: 'ssh', name: 'Storage gateway', host: 'catalog.example', port: 2200 } });
        } else if (message.requestId === requestIds[2] && message.ok === true) {
          const saved = message.result?.value as { id?: unknown; kind?: unknown; name?: unknown; host?: unknown; port?: unknown; favorite?: unknown };
          replies.created = saved;
          if (typeof saved?.id !== 'string') { finish(new Error('SQLite storage worker returned an invalid saved session')); return; }
          send(3, 'session.list', { query: 'CATALOG.EXAMPLE' });
        } else if (message.requestId === requestIds[3] && message.ok === true) {
          replies.searched = message.result?.value;
          const saved = replies.created as { id: string };
          send(4, 'session.favorite', { id: saved.id, favorite: true });
        } else if (message.requestId === requestIds[4] && message.ok === true) {
          replies.favorited = message.result?.value;
          send(5, 'session.list', { query: '' });
        } else if (message.requestId === requestIds[5] && message.ok === true) {
          const saved = replies.created as { id: string };
          const items = message.result?.value as { id?: string; favorite?: boolean }[];
          replies.favoriteChecked = items.find(item => item.id === saved.id)?.favorite;
          send(6, 'session.remove', { id: saved.id });
        } else if (message.requestId === requestIds[6] && message.ok === true) {
          replies.removed = message.result?.value;
          send(7, 'shutdown');
        } else if (message.requestId === requestIds[7] && message.ok === true) {
          replies.shutdown = message.result;
          child.kill();
        }
      });
    }), { workerPath: resolve('dist/host/apps/desktop/src/workers/storage-worker.js'), appRoot: resolve('apps/desktop'), databasePath, identity });
    expect(reply).toEqual({
      imported: { sourceCount: 1, verifiedCount: 1 },
      found: { endpoint: identity.endpoint, algorithm, fingerprint, publicKeyBase64: publicKey.toString('base64'),
        trustedAt: identity.trustedAt, approvalSource: 'user' },
      created: expect.objectContaining({ kind: 'ssh', name: 'Storage gateway', host: 'catalog.example', port: 2200, favorite: false }),
      searched: [expect.objectContaining({ name: 'Storage gateway', host: 'catalog.example' })],
      favorited: true, favoriteChecked: true, removed: true,
      shutdown: { kind: 'shutdown' }
    });
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      expect((database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(1);
      expect((database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ssh_host_keys'").get())).toBeTruthy();
      expect(database.prepare('SELECT count(*) AS count FROM ssh_host_keys').get()).toEqual({ count: 1 });
      expect(database.prepare('SELECT count(*) AS count FROM session_definitions').get()).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('Windows multi-tab terminal dimensions track a resized Electron window', async () => {
  test.skip(process.platform !== 'win32', 'ConPTY resize acceptance evidence is required on Windows');
  const profile = await mkdtemp(join(tmpdir(), 'mrt-terminal-resize-e2e-'));
  const app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`, '--force-device-scale-factor=2'], env: electronEnvironment() });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.visually-hidden[role="status"]')).toContainText('Ready', { timeout: 15_000 });
    await expect(page.getByRole('tab', { name: /PowerShell session 1/ })).toBeVisible();
    for (let index = 0; index < 8; index++) {
      await runPaletteCommand(page, 'New PowerShell terminal');
      await expect(page.getByRole('tab').filter({ hasText: /PowerShell session/ })).toHaveCount(index + 2);
    }
    await expect(page.getByRole('tab')).toHaveCount(9);
    for (let index = 1; index <= 9; index++) {
      const tab = page.getByRole('tab').filter({ hasText: new RegExp(`PowerShell session ${index}\\b`) });
      await expect(tab.locator('.state-dot')).toHaveClass(/running/);
    }
    await expect(page.locator('.terminal-workspace')).toHaveAttribute('data-opening', 'false');
    const originalViewport = await page.evaluate(() => ({ innerWidth, innerHeight }));
    const originalWidth = originalViewport.innerWidth;
    const otherShellSize = await readPowerShellSize(page, 'PowerShell session 8');
    const largeShellSize = await readPowerShellSize(page, 'PowerShell session 9');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(900, 600));
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(originalWidth);
    await expect.poll(() => page.evaluate(() => innerHeight)).toBeLessThan(originalViewport.innerHeight);
    await expect.poll(async () => {
      const resized = await readPowerShellSize(page, 'PowerShell session 9');
      return { columns: resized.columns < largeShellSize.columns, rows: resized.rows < largeShellSize.rows };
    }, { timeout: 10_000, intervals: [250] }).toEqual({ columns: true, rows: true });
    await expect.poll(async () => {
      const resized = await readPowerShellSize(page, 'PowerShell session 8');
      return { columns: resized.columns < otherShellSize.columns, rows: resized.rows < otherShellSize.rows };
    }, { timeout: 10_000, intervals: [250] }).toEqual({ columns: true, rows: true });
  } finally {
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
    expect(isolation.bridge).toEqual(['describe', 'openTerminal', 'writeTerminal', 'resizeTerminal', 'acknowledgeTerminalOutput', 'closeTerminal',
      'openSshTerminal', 'writeSshTerminal', 'resizeSshTerminal', 'acknowledgeSshTerminalOutput', 'closeSshTerminal', 'approveSshHost', 'rejectSshHost', 'revokeSshHost',
      'listSavedSessions', 'createSavedSession', 'setSavedSessionFavorite', 'deleteSavedSession',
      'listSavedSessionFolders', 'createSavedSessionFolder', 'renameSavedSessionFolder', 'moveSavedSessionFolder', 'deleteSavedSessionFolder', 'moveSavedSession',
      'onTerminalEvent', 'onSshTrustEvent']);
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
    const sessionTabs = page.getByRole('tab');
    const sessionNineTab = page.getByRole('tab', { name: /PowerShell session 9/ });
    await expect(sessionNineTab).toHaveAttribute('aria-selected', 'true');
    const selectedBefore = await sessionTabs.evaluateAll(tabs => tabs.findIndex(tab => tab.getAttribute('aria-selected') === 'true'));
    const nextTab = sessionTabs.nth((selectedBefore + 1) % await sessionTabs.count());
    await page.keyboard.press('Control+Tab');
    await expect(nextTab).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Control+Shift+Tab');
    await expect(sessionNineTab).toHaveAttribute('aria-selected', 'true');
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
