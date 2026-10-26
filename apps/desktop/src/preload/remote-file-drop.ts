import { MAX_REMOTE_FILE_DROP_COUNT, isRemoteFileDropEvent, parseRemoteFileDropRegistrationRequest } from '../../../../packages/contracts/src/commands.ts';
import type { RemoteFileDropEvent } from '../../../../packages/contracts/src/commands.ts';
import { failure } from '../../../../packages/domain/src/errors.ts';

const DROP_TARGET_SELECTOR = '[data-mrt-remote-file-drop-target="true"]';
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

interface DropTarget {
  getAttribute(name: string): string | null;
  closest(selector: string): DropTarget | null;
}

type DropFileList = ArrayLike<unknown>;

interface TrustedFileDropEvent {
  readonly type: string;
  readonly isTrusted: boolean;
  readonly target: DropTarget | null;
  readonly dataTransfer: { readonly files: DropFileList } | null;
  preventDefault(): void;
}

export interface RemoteFileDropDocument {
  addEventListener(type: 'drop', listener: (event: Event) => void, capture: true): void;
  removeEventListener(type: 'drop', listener: (event: Event) => void, capture: true): void;
}

export interface RemoteFileDropStore {
  subscribe(listener: (event: unknown) => void): () => void;
  simulateDropFromTest(files: readonly unknown[], target: unknown): void;
  dispose(): void;
}

export interface NativeDroppedFile {
  readonly name: string;
}

export interface RemoteFileDropContextAttributes {
  readonly sessionId: string;
  readonly transport: 'sftp' | 'ftp';
  readonly remoteDirectory: string;
}

export function installRemoteFileDropStore(
  documentTarget: RemoteFileDropDocument,
  getPathForFile: (file: unknown) => string,
  register: (request: unknown) => Promise<unknown>,
): RemoteFileDropStore {
  const listeners = new Set<(event: unknown) => void>();
  let disposed = false;

  const notify = (event: RemoteFileDropEvent): void => {
    for (const listener of listeners) {
      try { listener(event); } catch { /* Renderer callbacks cannot affect file-handle ownership. */ }
    }
  };

  const contextFor = (event: TrustedFileDropEvent): RemoteFileDropContextAttributes | undefined => {
    const target = event.target?.closest(DROP_TARGET_SELECTOR);
    const sessionId = target?.getAttribute('data-mrt-remote-file-session-id') ?? '';
    const transport = target?.getAttribute('data-mrt-remote-file-transport');
    const remoteDirectory = target?.getAttribute('data-mrt-remote-file-directory') ?? '';
    if (!SESSION_ID.test(sessionId) || (transport !== 'sftp' && transport !== 'ftp') || remoteDirectory.length === 0) return undefined;
    return { sessionId, transport, remoteDirectory };
  };

  const handleDrop = (rawEvent: Event, synthetic = false): void => {
    const event = rawEvent as unknown as TrustedFileDropEvent;
    if (disposed || event.type !== 'drop' || (!event.isTrusted && !synthetic)) return;
    const context = contextFor(event);
    if (!context) return;
    event.preventDefault();
    const files = Array.from(event.dataTransfer?.files ?? []) as NativeDroppedFile[];
    if (files.length === 0) return;
    if (files.length > MAX_REMOTE_FILE_DROP_COUNT) {
      notify({ ...context, ...failure('OUTPUT_LIMIT') });
      return;
    }
    const localPaths = files.map(file => {
      try { return getPathForFile(file); } catch { return ''; }
    });
    const parsed = parseRemoteFileDropRegistrationRequest({ ...context, localPaths });
    if (!parsed.ok || localPaths.some(path => path.length === 0)) {
      notify({ ...context, ...failure(parsed.ok ? 'FORBIDDEN' : parsed.error.code) });
      return;
    }
    void register(parsed.result).then(result => {
      if (disposed) return;
      if (isRemoteFileDropEvent(result) && result.sessionId === context.sessionId && result.transport === context.transport &&
          result.remoteDirectory === context.remoteDirectory) notify(result);
      else notify({ ...context, ...failure('UNAVAILABLE') });
    }, () => {
      if (!disposed) notify({ ...context, ...failure('UNAVAILABLE') });
    });
  };

  const observeDrop = (event: Event): void => handleDrop(event);
  documentTarget.addEventListener('drop', observeDrop, true);
  return Object.freeze({
    subscribe(listener: (event: unknown) => void): () => void {
      if (typeof listener !== 'function' || disposed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    simulateDropFromTest(files: readonly unknown[], target: unknown): void {
      handleDrop({ type: 'drop', isTrusted: false, target: target as DropTarget, dataTransfer: { files }, preventDefault() {} } as unknown as Event, true);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      documentTarget.removeEventListener('drop', observeDrop, true);
      listeners.clear();
    }
  });
}
