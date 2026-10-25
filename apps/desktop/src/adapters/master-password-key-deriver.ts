import { randomUUID } from 'node:crypto';

const DERIVATION_TIMEOUT_MS = 30_000;
const DERIVATION_PROTOCOL_VERSION = 1;

export type MasterPasswordKdfErrorKind = 'cancelled' | 'timeout' | 'unavailable';

export class MasterPasswordKdfError extends Error {
  readonly kind: MasterPasswordKdfErrorKind;
  constructor(kind: MasterPasswordKdfErrorKind) {
    super('Master-password key derivation failed');
    this.name = 'MasterPasswordKdfError';
    this.kind = kind;
  }
}

export interface MasterPasswordKeyDeriver {
  derive(password: Uint8Array, salt: Uint8Array, signal: AbortSignal): Promise<Buffer>;
}

export interface KdfUtilityProcess {
  on(event: 'message', listener: (message: unknown) => void): this;
  once(event: 'exit', listener: (code: number) => void): this;
  postMessage(message: unknown): void;
  kill(): void;
}

export type KdfUtilityLauncher = (workerPath: string, options: {
  readonly cwd: string;
  readonly env: { readonly MRT_APP_ROOT: string };
  readonly serviceName: string;
  readonly stdio: 'ignore';
}) => KdfUtilityProcess;

export class MasterPasswordKeyDeriverAdapter implements MasterPasswordKeyDeriver {
  private readonly workerPath: string;
  private readonly appRoot: string;
  private readonly launch: KdfUtilityLauncher;
  private readonly timeoutMs: number;

  constructor(workerPath: string, appRoot: string, launch: KdfUtilityLauncher, timeoutMs = DERIVATION_TIMEOUT_MS) {
    this.workerPath = workerPath;
    this.appRoot = appRoot;
    this.launch = launch;
    this.timeoutMs = timeoutMs;
  }

  derive(password: Uint8Array, salt: Uint8Array, signal: AbortSignal): Promise<Buffer> {
    if (password.byteLength === 0 || password.byteLength > 1024 || salt.byteLength !== 16) {
      return Promise.reject(new MasterPasswordKdfError('unavailable'));
    }
    if (signal.aborted) return Promise.reject(new MasterPasswordKdfError('cancelled'));
    let worker: KdfUtilityProcess;
    try {
      worker = this.launch(this.workerPath, {
        cwd: this.appRoot,
        env: { MRT_APP_ROOT: this.appRoot },
        serviceName: 'MultiRemoteTerminal master-password key derivation',
        stdio: 'ignore'
      });
    } catch {
      return Promise.reject(new MasterPasswordKdfError('unavailable'));
    }

    const requestId = randomUUID();
    const passwordCopy = new Uint8Array(password);
    const saltCopy = new Uint8Array(salt);
    return new Promise<Buffer>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => finishError('timeout'), this.timeoutMs);
      const onAbort = () => finishError('cancelled');
      const finishError = (kind: MasterPasswordKdfErrorKind): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        passwordCopy.fill(0);
        saltCopy.fill(0);
        try { worker.kill(); } catch { /* The failed result remains authoritative. */ }
        reject(new MasterPasswordKdfError(kind));
      };
      worker.on('message', value => {
        if (!isRecord(value) || Object.keys(value).length !== 4 || value.version !== DERIVATION_PROTOCOL_VERSION ||
            value.type !== 'result' || value.requestId !== requestId || !(value.key instanceof Uint8Array) || value.key.byteLength !== 32) {
          finishError('unavailable');
          return;
        }
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        passwordCopy.fill(0);
        saltCopy.fill(0);
        const key = Buffer.from(value.key);
        value.key.fill(0);
        try { worker.kill(); } catch { /* The completed key remains valid. */ }
        resolve(key);
      });
      worker.once('exit', () => {
        if (!settled) finishError('unavailable');
      });
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) {
        finishError('cancelled');
        return;
      }
      try {
        worker.postMessage({ version: DERIVATION_PROTOCOL_VERSION, type: 'derive', requestId, password: passwordCopy, salt: saltCopy });
        passwordCopy.fill(0);
        saltCopy.fill(0);
      } catch {
        finishError('unavailable');
      }
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
