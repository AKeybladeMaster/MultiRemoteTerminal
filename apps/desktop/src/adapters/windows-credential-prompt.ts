import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { win32 as path } from 'node:path';
import type { Readable } from 'node:stream';
import type { CredentialPrompt, CredentialPromptCancellation, CredentialPromptPurpose, CredentialPromptResult } from '../../../../packages/application/src/credential-prompt.ts';

const MAX_HELPER_OUTPUT_BYTES = 65_536;
const DEFAULT_TIMEOUT_MS = 120_000;
const PURPOSE_MESSAGE: Readonly<Record<CredentialPromptPurpose, string>> = Object.freeze({
  'ssh-password': 'Enter the SSH account credential.',
  'ssh-key-passphrase': 'Unlock the selected SSH private key.',
  'master-password': 'Enter the vault master password.'
});
const CANCELLED: CredentialPromptResult = Object.freeze({ kind: 'cancelled' });
const UNAVAILABLE: CredentialPromptResult = Object.freeze({ kind: 'unavailable' });
const TIMED_OUT: CredentialPromptResult = Object.freeze({ kind: 'timeout' });

export interface SystemDirectoryBridge {
  getSystemDirectory(): string;
}

export interface PromptProcess {
  readonly stdout: Pick<Readable, 'on'> | null;
  once(event: 'error', listener: (error: Error) => void): this;
  once(event: 'close', listener: (code: number | null) => void): this;
  kill(): boolean;
}

export interface PromptSpawnOptions {
  readonly shell: false;
  readonly windowsHide: true;
  readonly stdio: ['ignore', 'pipe', 'ignore'];
}

export type PromptProcessSpawner = (executable: string, args: string[], options: PromptSpawnOptions) => PromptProcess;

export interface WindowsCredentialPromptOptions {
  readonly systemDirectory: SystemDirectoryBridge;
  readonly helperPath: string;
  readonly pathExists?: (path: string) => boolean;
  readonly spawn?: PromptProcessSpawner;
  readonly timeoutMs?: number;
}

export function resolveWindowsPowerShellPath(systemDirectory: string, pathExists: (candidate: string) => boolean): string | undefined {
  if (typeof systemDirectory !== 'string' || !path.isAbsolute(systemDirectory)) return undefined;
  const executable = path.join(systemDirectory, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  try {
    return pathExists(executable) ? executable : undefined;
  } catch {
    return undefined;
  }
}

function isPurpose(value: unknown): value is CredentialPromptPurpose {
  return typeof value === 'string' && Object.hasOwn(PURPOSE_MESSAGE, value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function decodeReply(bytes: Buffer): CredentialPromptResult {
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { return UNAVAILABLE; }
  if (!isRecord(parsed)) return UNAVAILABLE;
  if (parsed.kind === 'cancelled' && hasExactKeys(parsed, ['kind'])) return CANCELLED;
  if (parsed.kind === 'unavailable' && hasExactKeys(parsed, ['kind'])) return UNAVAILABLE;
  if (parsed.kind !== 'provided' || !hasExactKeys(parsed, ['kind', 'username', 'secret']) ||
      typeof parsed.username !== 'string' || parsed.username.length > 512 || parsed.username.includes('\0') ||
      typeof parsed.secret !== 'string' || parsed.secret.length > 65_536) return UNAVAILABLE;
  return { kind: 'provided', username: parsed.username, secret: parsed.secret };
}

const defaultSpawn: PromptProcessSpawner = (executable, args, options) =>
  nodeSpawn(executable, args, options) as PromptProcess;

export function createWindowsCredentialPrompt(options: WindowsCredentialPromptOptions): CredentialPrompt {
  const pathExists = options.pathExists ?? existsSync;
  const spawnProcess = options.spawn ?? defaultSpawn;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return Object.freeze({
    prompt(purpose: CredentialPromptPurpose, signal?: CredentialPromptCancellation): Promise<CredentialPromptResult> {
      if (!isPurpose(purpose) || !Number.isFinite(timeoutMs) || timeoutMs < 1) return Promise.resolve(UNAVAILABLE);
      if (signal?.aborted) return Promise.resolve(CANCELLED);
      let executable: string | undefined;
      try { executable = resolveWindowsPowerShellPath(options.systemDirectory.getSystemDirectory(), pathExists); }
      catch { return Promise.resolve(UNAVAILABLE); }
      if (!executable || !path.isAbsolute(options.helperPath)) return Promise.resolve(UNAVAILABLE);
      try { if (!pathExists(options.helperPath)) return Promise.resolve(UNAVAILABLE); }
      catch { return Promise.resolve(UNAVAILABLE); }

      const args = ['-NoLogo', '-NoProfile', '-WindowStyle', 'Hidden', '-File', options.helperPath, '-Message', PURPOSE_MESSAGE[purpose]];
      return new Promise(resolve => {
        let child: PromptProcess;
        try {
          child = spawnProcess(executable, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
        } catch {
          resolve(UNAVAILABLE);
          return;
        }
        if (!child.stdout) {
          child.kill();
          resolve(UNAVAILABLE);
          return;
        }

        let settled = false;
        let receivedBytes = 0;
        const chunks: Buffer[] = [];
        function wipe(): void {
          for (const chunk of chunks) chunk.fill(0);
          chunks.length = 0;
        }
        function finish(result: CredentialPromptResult): void {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          wipe();
          resolve(result);
        }
        function onAbort(): void {
          try { child.kill(); } catch { /* The result remains cancelled even if the process already exited. */ }
          finish(CANCELLED);
        }

        const timer = setTimeout(() => {
          try { child.kill(); } catch { /* Timeout remains the observed result. */ }
          finish(TIMED_OUT);
        }, timeoutMs);

        child.stdout.on('data', chunk => {
          if (settled) return;
          let bytes: Buffer;
          if (Buffer.isBuffer(chunk)) bytes = chunk;
          else if (typeof chunk === 'string') bytes = Buffer.from(chunk, 'utf8');
          else {
            try { child.kill(); } catch { /* The helper result is rejected. */ }
            finish(UNAVAILABLE);
            return;
          }
          receivedBytes += bytes.length;
          if (receivedBytes > MAX_HELPER_OUTPUT_BYTES) {
            try { child.kill(); } catch { /* The helper result is rejected. */ }
            finish(UNAVAILABLE);
            return;
          }
          chunks.push(Buffer.from(bytes));
        });
        child.once('error', () => finish(UNAVAILABLE));
        child.once('close', code => {
          if (settled) return;
          if (code !== 0) { finish(UNAVAILABLE); return; }
          const output = Buffer.concat(chunks);
          const result = decodeReply(output);
          output.fill(0);
          finish(result);
        });
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) onAbort();
      });
    }
  });
}
