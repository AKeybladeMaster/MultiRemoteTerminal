import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';

export type NativeSshLogDialogAction = 'cancel-consent' | 'cancel-save' | 'save' | 'close-app';
export type NativeSshCredentialBundleDialogAction = 'cancel-credential-export' | 'export-credential' | 'cancel-credential-import' | 'import-credential';
export type NativeCustomLogoDialogAction = 'cancel-logo' | 'select-logo';
export type NativeLocalTextDialogAction = 'cancel-local-text' | 'select-local-text';

export async function runNativeSshLogDialog(action: NativeSshLogDialogAction, filePath?: string, targetProcessId?: number): Promise<void> {
  if (action === 'save' && (!filePath || !filePath.toLowerCase().endsWith('.log'))) {
    throw new Error('Selecting the native SSH log dialog requires a .log path.');
  }
  if (action === 'close-app' && (!targetProcessId || !Number.isSafeInteger(targetProcessId))) {
    throw new Error('Closing the packaged app requires its process ID.');
  }
  await runNativeDialog(action, filePath, targetProcessId, 'SSH session log');
}

export async function runNativeSshCredentialBundleDialog(action: NativeSshCredentialBundleDialogAction, filePath?: string): Promise<void> {
  if ((action === 'export-credential' || action === 'import-credential') &&
      (!filePath || !filePath.toLowerCase().endsWith('.mrtcred'))) {
    throw new Error('Selecting the native credential bundle dialog requires a .mrtcred path.');
  }
  await runNativeDialog(action, filePath, undefined, 'SSH credential bundle');
}

export async function runNativeCustomLogoDialog(action: NativeCustomLogoDialogAction, filePath?: string): Promise<void> {
  if (action === 'select-logo' && (!filePath || !filePath.toLowerCase().endsWith('.png'))) {
    throw new Error('Selecting the native custom logo dialog requires a .png path.');
  }
  await runNativeDialog(action, filePath, undefined, 'custom logo');
}

export async function runNativeLocalTextDialog(action: NativeLocalTextDialogAction, filePath?: string): Promise<void> {
  if (action === 'select-local-text' && (!filePath || !filePath.toLowerCase().endsWith('.txt'))) {
    throw new Error('Selecting the native local text dialog requires a .txt path.');
  }
  await runNativeDialog(action, filePath, undefined, 'local text file');
}

async function runNativeDialog(action: NativeSshLogDialogAction | NativeSshCredentialBundleDialogAction | NativeCustomLogoDialogAction | NativeLocalTextDialogAction,
  filePath: string | undefined, targetProcessId: number | undefined, description: string): Promise<void> {
  if (process.platform !== 'win32') throw new Error(`Native ${description} dialog automation is Windows-only.`);
  const executable = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    resolve('tests/e2e/windows-native-dialog.ps1'), '-Action', action];
  if (filePath) args.push('-FilePath', filePath);
  if (targetProcessId) args.push('-TargetProcessId', String(targetProcessId));
  const child = spawn(executable, args, { cwd: resolve('.'), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let errorText = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', chunk => { errorText += String(chunk); });

  await new Promise<void>((resolveExit, rejectExit) => {
    let timedOut = false;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) rejectExit(error);
      else resolveExit();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 35_000);
    child.once('error', error => finish(error));
    child.once('exit', (code, signal) => {
      if (timedOut) finish(new Error(`Timed out automating the native ${description} dialog.`));
      else if (code !== 0) finish(new Error(`Native ${description} dialog automation failed (${signal ?? code}): ${errorText.trim()}`));
      else finish();
    });
  });
}
