import { randomUUID } from 'node:crypto';
import type { UtilityProcess } from 'electron';
import { LocalTextFileProviderError } from '../../../../packages/application/src/local-text-editor.ts';
import type { LocalTextFilePayload, LocalTextFileProvider, LocalTextFileProviderErrorCode } from '../../../../packages/application/src/local-text-editor.ts';
import type { LocalTextFileSaveResult } from '../../../../packages/domain/src/local-text-file.ts';
import { LOCAL_TEXT_WORKER_PROTOCOL_VERSION, parseLocalTextWorkerMessage } from '../workers/local-text-worker-protocol.ts';
import type { LocalTextWorkerRequest } from '../workers/local-text-worker-protocol.ts';

interface WorkerLaunchOptions {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly serviceName: string;
  readonly stdio: 'ignore';
}

export type LocalTextWorkerLauncher = (workerPath: string, args: string[], options: WorkerLaunchOptions) => UtilityProcess;

const OPERATION_TIMEOUT_MS = 15_000;
const EXIT_TIMEOUT_MS = 1_000;

export class LocalTextFilesWorkerHost implements LocalTextFileProvider {
  private readonly workerPath: string;
  private readonly appRoot: string;
  private readonly launchWorker: LocalTextWorkerLauncher;
  private readonly workers = new Set<UtilityProcess>();
  private disposed = false;

  constructor(workerPath: string, appRoot: string, launchWorker: LocalTextWorkerLauncher) {
    this.workerPath = workerPath;
    this.appRoot = appRoot;
    this.launchWorker = launchWorker;
  }

  async read(absolutePath: string): Promise<LocalTextFilePayload> {
    const result = await this.request({ version: LOCAL_TEXT_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(), command: 'read', path: absolutePath });
    if (!('fileName' in result)) throw new LocalTextFileProviderError('UNAVAILABLE');
    return result;
  }

  async save(absolutePath: string, content: string, expectedRevision: string): Promise<LocalTextFileSaveResult> {
    const result = await this.request({ version: LOCAL_TEXT_WORKER_PROTOCOL_VERSION, type: 'request', requestId: randomUUID(), command: 'save',
      path: absolutePath, content, expectedRevision });
    if ('fileName' in result) throw new LocalTextFileProviderError('UNAVAILABLE');
    return result;
  }

  async shutdown(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const workers = [...this.workers];
    const exits = workers.map(worker => waitForExit(worker));
    for (const worker of workers) {
      try { worker.kill(); } catch { /* Exit handlers settle active operations. */ }
    }
    await Promise.all(exits);
  }

  private async request(request: LocalTextWorkerRequest): Promise<LocalTextFilePayload | LocalTextFileSaveResult> {
    if (this.disposed) throw new LocalTextFileProviderError('CANCELLED');
    let worker: UtilityProcess;
    try {
      worker = this.launchWorker(this.workerPath, [], {
        cwd: process.resourcesPath ?? this.appRoot,
        env: {},
        serviceName: 'MultiRemoteTerminal local text file provider',
        stdio: 'ignore'
      });
    } catch { throw new LocalTextFileProviderError('UNAVAILABLE'); }
    this.workers.add(worker);

    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => finish(new LocalTextFileProviderError('TIMEOUT')), OPERATION_TIMEOUT_MS);
      const finish = (error?: Error, result?: LocalTextFilePayload | LocalTextFileSaveResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.workers.delete(worker);
        if (error) {
          try { worker.kill(); } catch { /* The worker may already have exited. */ }
          reject(error);
        } else if (result) resolve(result);
        else reject(new LocalTextFileProviderError('UNAVAILABLE'));
      };
      worker.on('message', value => {
        const message = parseLocalTextWorkerMessage(value);
        if (!message || message.requestId !== request.requestId) {
          finish(new LocalTextFileProviderError('UNAVAILABLE'));
          return;
        }
        if (!message.ok) {
          finish(new LocalTextFileProviderError(message.errorCode as LocalTextFileProviderErrorCode));
          return;
        }
        const result = message.result;
        if ((request.command === 'read' && 'fileName' in result) || (request.command === 'save' && !('fileName' in result))) finish(undefined, result);
        else finish(new LocalTextFileProviderError('UNAVAILABLE'));
        try { worker.kill(); } catch { /* The response has already settled the operation. */ }
      });
      worker.on('exit', () => finish(new LocalTextFileProviderError('UNAVAILABLE')));
      try { worker.postMessage(request); }
      catch { finish(new LocalTextFileProviderError('UNAVAILABLE')); }
    });
  }
}

async function waitForExit(worker: UtilityProcess): Promise<void> {
  await new Promise<void>(resolve => {
    const timer = setTimeout(resolve, EXIT_TIMEOUT_MS);
    worker.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}
