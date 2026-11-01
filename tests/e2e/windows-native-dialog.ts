import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';

export type NativeSshLogDialogAction = 'cancel-consent' | 'cancel-save' | 'save' | 'close-app';
export type NativeSshCredentialPromptAction = 'submit-ssh-credential';
export type NativeSshCredentialBundleDialogAction = 'cancel-credential-export' | 'export-credential' | 'cancel-credential-import' | 'import-credential';
export type NativeCustomLogoDialogAction = 'cancel-logo' | 'select-logo';
export type NativeLocalTextDialogAction = 'cancel-local-text' | 'select-local-text';
export type NativeTransferRecoveryFolderAction = 'cancel-transfer-folder' | 'select-transfer-folder';
export type NativeRemoteForwardConfirmationAction = 'cancel-remote-forward' | 'accept-remote-forward';
export type NativePublicTunnelConfirmationAction = 'cancel-public-tunnel' | 'accept-public-tunnel';

export async function runNativeSshLogDialog(action: NativeSshLogDialogAction, filePath: string | undefined, targetProcessId: number): Promise<void> {
  if (action === 'save' && (!filePath || !filePath.toLowerCase().endsWith('.log'))) {
    throw new Error('Selecting the native SSH log dialog requires a .log path.');
  }
  await runNativeDialog(action, filePath, targetProcessId, 'SSH session log');
}

export async function runNativeSshCredentialPrompt(username: string, password: string, targetProcessId: number): Promise<void> {
  // SendKeys treats printable punctuation as key syntax; package fixtures use an alphanumeric alphabet.
  if (!/^[A-Za-z0-9]+$/u.test(username) || username.length > 256 || !/^[A-Za-z0-9]+$/u.test(password) || password.length > 256 ||
      !Number.isSafeInteger(targetProcessId) || targetProcessId < 1) {
    throw new Error('Native SSH credential prompt automation requires alphanumeric fixture values and a valid app process ID.');
  }
  await runNativeDialog('submit-ssh-credential', undefined, targetProcessId, 'Windows SSH credential prompt', JSON.stringify({ username, password }));
}

export async function runNativeSshCredentialBundleDialog(action: NativeSshCredentialBundleDialogAction, filePath: string | undefined,
  targetProcessId: number): Promise<void> {
  if ((action === 'export-credential' || action === 'import-credential') &&
      (!filePath || !filePath.toLowerCase().endsWith('.mrtcred'))) {
    throw new Error('Selecting the native credential bundle dialog requires a .mrtcred path.');
  }
  await runNativeDialog(action, filePath, targetProcessId, 'SSH credential bundle');
}

export async function runNativeCustomLogoDialog(action: NativeCustomLogoDialogAction, filePath: string | undefined,
  targetProcessId: number): Promise<void> {
  if (action === 'select-logo' && (!filePath || !filePath.toLowerCase().endsWith('.png'))) {
    throw new Error('Selecting the native custom logo dialog requires a .png path.');
  }
  await runNativeDialog(action, filePath, targetProcessId, 'custom logo');
}

export async function runNativeLocalTextDialog(action: NativeLocalTextDialogAction, filePath: string | undefined,
  targetProcessId: number): Promise<void> {
  if (action === 'select-local-text' && (!filePath || !filePath.toLowerCase().endsWith('.txt'))) {
    throw new Error('Selecting the native local text dialog requires a .txt path.');
  }
  await runNativeDialog(action, filePath, targetProcessId, 'local text file');
}

export async function runNativeTransferRecoveryFolderDialog(action: NativeTransferRecoveryFolderAction, folderPath: string | undefined,
  targetProcessId: number): Promise<void> {
  if (action === 'select-transfer-folder' && !folderPath) throw new Error('Selecting an interrupted download folder requires its path.');
  await runNativeDialog(action, folderPath, targetProcessId, 'interrupted download folder');
}

export async function runNativeRemoteForwardConfirmation(action: NativeRemoteForwardConfirmationAction, targetProcessId: number): Promise<void> {
  if (!Number.isSafeInteger(targetProcessId) || targetProcessId < 1) throw new Error('Remote-forward consent automation requires the app process ID.');
  await runNativeDialog(action, undefined, targetProcessId, 'remote-forward exposure confirmation');
}

export async function runNativePublicTunnelConfirmation(action: NativePublicTunnelConfirmationAction, targetProcessId: number): Promise<void> {
  if (!Number.isSafeInteger(targetProcessId) || targetProcessId < 1) throw new Error('Public-tunnel consent automation requires the app process ID.');
  await runNativeDialog(action, undefined, targetProcessId, 'public-tunnel exposure confirmation');
}

async function runNativeDialog(action: NativeSshLogDialogAction | NativeSshCredentialPromptAction | NativeSshCredentialBundleDialogAction |
  NativeCustomLogoDialogAction | NativeLocalTextDialogAction | NativeTransferRecoveryFolderAction |
  NativeRemoteForwardConfirmationAction | NativePublicTunnelConfirmationAction,
  filePath: string | undefined, targetProcessId: number, description: string, stdinInput?: string): Promise<void> {
  if (process.platform !== 'win32') throw new Error(`Native ${description} dialog automation is Windows-only.`);
  if (!Number.isSafeInteger(targetProcessId) || targetProcessId < 1) {
    throw new Error(`Native ${description} dialog automation requires a valid app process ID.`);
  }
  const executable = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    resolve('tests/e2e/windows-native-dialog.ps1'), '-Action', action];
  if (filePath) args.push('-FilePath', filePath);
  args.push('-TargetProcessId', String(targetProcessId));
  const child = spawn(executable, args, { cwd: resolve('.'), windowsHide: true, stdio: [stdinInput === undefined ? 'ignore' : 'pipe', 'ignore', 'pipe'] });
  let errorText = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', chunk => { errorText += String(chunk); });
  if (stdinInput !== undefined) {
    if (!child.stdin) throw new Error(`Could not provide fixture data to the native ${description} helper.`);
    child.stdin.end(stdinInput);
  }

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
      else if (code !== 0) finish(new Error(action === 'submit-ssh-credential'
        ? 'Native Windows SSH credential prompt automation failed.'
        : `Native ${description} dialog action '${action}' failed (${signal ?? code}): ${errorText.trim()}`));
      else finish();
    });
  });
}
