import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';

export type NativeSshLogDialogAction = 'cancel-consent' | 'cancel-save' | 'save' | 'close-app';

export async function runNativeSshLogDialog(action: NativeSshLogDialogAction, filePath?: string, targetProcessId?: number): Promise<void> {
  if (process.platform !== 'win32') throw new Error('Native SSH log dialog automation is Windows-only.');
  if (action === 'save' && (!filePath || !filePath.toLowerCase().endsWith('.log'))) {
    throw new Error('Selecting the native SSH log dialog requires a .log path.');
  }
  if (action === 'close-app' && (!targetProcessId || !Number.isSafeInteger(targetProcessId))) {
    throw new Error('Closing the packaged app requires its process ID.');
  }

  const executable = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    resolve('tests/e2e/windows-native-ssh-log-dialog.ps1'), '-Action', action];
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
      if (timedOut) finish(new Error('Timed out automating the native SSH session log dialog.'));
      else if (code !== 0) finish(new Error(`Native SSH log dialog automation failed (${signal ?? code}): ${errorText.trim()}`));
      else finish();
    });
  });
}
