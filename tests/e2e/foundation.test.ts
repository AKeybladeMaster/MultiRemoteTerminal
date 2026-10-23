import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

function electronEnvironment(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] =>
    entry[1] !== undefined && entry[0] !== 'ELECTRON_RUN_AS_NODE'));
}

test('Windows secure shell: real preload, renderer isolation, status, keyboard and themes', async () => {
  test.skip(process.platform !== 'win32', 'Windows acceptance evidence is required');
  const profile = await mkdtemp(join(tmpdir(), 'mrt-e2e-'));
  const env = electronEnvironment();
  const app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`], env });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await expect(page.getByRole('heading', { name: 'A workspace for your terminals.' })).toBeVisible();
    await expect(page.getByRole('status')).toHaveText('Ready · win32 · version 0.0.0');
    const isolation = await page.evaluate(async () => {
      const globals = globalThis as unknown as Record<string, unknown>;
      return { require: typeof globals.require, process: typeof globals.process, Buffer: typeof globals.Buffer,
        bridge: Object.keys(window.multiRemoteTerminal), snapshot: await window.multiRemoteTerminal.describe() };
    });
    expect(isolation.require).toBe('undefined');
    expect(isolation.process).toBe('undefined');
    expect(isolation.Buffer).toBe('undefined');
    expect(isolation.bridge).toEqual(['describe']);
    expect(isolation.snapshot.ok).toBe(true);
    const renderers = await app.evaluate(({ app }) => app.getAppMetrics().filter(metric => metric.type === 'Tab'));
    expect(renderers.length).toBeGreaterThan(0);
    expect(renderers.every(renderer => renderer.sandboxed)).toBe(true);

    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to preview' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('main')).toBeFocused();
    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await expect(page.locator('.workbench')).toHaveAttribute('data-theme', 'light');
    await page.getByRole('button', { name: 'Refresh app status' }).click();
    await expect(page.getByRole('status')).toContainText('Ready');
    await page.screenshot({ path: 'test-results/foundation-light.png', fullPage: true });
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await page.screenshot({ path: 'test-results/foundation-dark.png', fullPage: true });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(2));
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(800);
    await expect(page.getByRole('button', { name: 'Switch to light theme' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]?.webContents.capturePage())?.toPNG().toString('base64'));
    expect(png).toBeDefined();
    if (png) await writeFile('test-results/foundation-200pct.png', Buffer.from(png, 'base64'));
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('CSP and Electron policy deny injected code, file reads, navigation, windows and permissions', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'mrt-security-'));
  const env = electronEnvironment();
  const app = await electron.launch({ args: [resolve('apps/desktop'), `--user-data-dir=${profile}`], env });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('status')).toContainText('Ready');
    const result = await page.evaluate(async () => {
      const globals = globalThis as unknown as Record<string, unknown>;
      globals.injectionExecuted = false;
      const script = document.createElement('script');
      script.textContent = 'globalThis.injectionExecuted = true';
      document.body.append(script);
      const sample = document.querySelector('.terminal-sample');
      if (sample) sample.textContent = '<img src=x onerror="globalThis.injectionExecuted = true">';
      const blockedFetch = await fetch('file:///C:/Windows/win.ini').then(() => false, () => true);
      const popup = window.open('https://example.com');
      const permission = await navigator.permissions.query({ name: 'geolocation' });
      return { injected: globals.injectionExecuted, blockedFetch, popup: popup === null, permission: permission.state };
    });
    expect(result).toEqual({ injected: false, blockedFetch: true, popup: true, permission: 'denied' });
    await page.evaluate(() => {
      const link = document.createElement('a'); link.href = 'https://example.com'; document.body.append(link); link.click();
    });
    // Playwright waits indefinitely for some cancelled navigations. Inspect the retained
    // document through Electron after the policy decision, rather than weakening the policy.
    const retained = await app.evaluate(async ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.executeJavaScript(
      '({url: location.href, heading: document.querySelector("h1")?.textContent})'));
    expect(retained).toEqual({ url: 'mrt://app/index.html', heading: 'A workspace for your terminals.' });
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
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
