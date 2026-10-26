import { lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, isAbsolute } from 'node:path';
import { MAX_REMOTE_FILE_DROP_COUNT } from '../../../../packages/contracts/src/commands.ts';
import type { RemoteFileDropContext, RemoteFileDropHandle } from '../../../../packages/contracts/src/commands.ts';
import { isRemoteFileName } from '../../../../packages/domain/src/remote-files.ts';
import type { ErrorCode } from '../../../../packages/domain/src/errors.ts';

const HANDLE_TTL_MS = 10 * 60_000;
const MAX_PENDING_HANDLES = MAX_REMOTE_FILE_DROP_COUNT;

interface StoredDroppedUpload extends RemoteFileDropHandle, RemoteFileDropContext {
  readonly senderId: number;
  readonly localPath: string;
  readonly expiresAt: number;
}

export interface DroppedUploadSelection {
  readonly localPath: string;
  readonly fileName: string;
}

export type DropRegistrationOutcome =
  | { readonly ok: true; readonly result: readonly RemoteFileDropHandle[] }
  | { readonly ok: false; readonly error: ErrorCode };

function fileError(error: unknown): ErrorCode {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  if (code === 'ENOENT' || code === 'ENOTDIR') return 'NOT_FOUND';
  if (code === 'EACCES' || code === 'EPERM') return 'FORBIDDEN';
  return 'UNAVAILABLE';
}

export class DroppedUploadRegistry {
  private readonly entries = new Map<string, StoredDroppedUpload>();
  private readonly now: () => number;
  private readonly makeToken: () => string;
  private readonly senderGeneration = new Map<number, number>();
  private generation = 0;
  private pendingReservations = 0;

  constructor(now: () => number = () => Date.now(), makeToken: () => string = () => randomUUID()) {
    this.now = now;
    this.makeToken = makeToken;
  }

  async register(senderId: number, context: RemoteFileDropContext, localPaths: readonly string[]): Promise<DropRegistrationOutcome> {
    if (!Number.isSafeInteger(senderId) || senderId < 1 || !Array.isArray(localPaths) || localPaths.length < 1 ||
        localPaths.length > MAX_REMOTE_FILE_DROP_COUNT) return { ok: false, error: 'INVALID_REQUEST' };
    this.prune();
    if (this.entries.size + this.pendingReservations + localPaths.length > MAX_PENDING_HANDLES) return { ok: false, error: 'OUTPUT_LIMIT' };
    const generation = this.generation;
    const currentSenderGeneration = this.senderGeneration.get(senderId) ?? 0;
    this.pendingReservations += localPaths.length;
    try {
      const prepared: Array<{ localPath: string; fileName: string; size: number }> = [];
      for (const localPath of localPaths) {
        if (typeof localPath !== 'string' || localPath.length === 0 || localPath.length > 32_768 || localPath.includes('\0') || !isAbsolute(localPath)) {
          return { ok: false, error: 'INVALID_REQUEST' };
        }
        let stats: Awaited<ReturnType<typeof lstat>>;
        try { stats = await lstat(localPath); }
        catch (error) { return { ok: false, error: fileError(error) }; }
        if (!stats.isFile() || stats.isSymbolicLink()) return { ok: false, error: 'FORBIDDEN' };
        const fileName = basename(localPath);
        const size = Number(stats.size);
        if (!isRemoteFileName(fileName) || !Number.isSafeInteger(size) || size < 0) return { ok: false, error: 'OUTPUT_LIMIT' };
        prepared.push({ localPath, fileName, size });
      }
      if (generation !== this.generation || currentSenderGeneration !== (this.senderGeneration.get(senderId) ?? 0)) {
        return { ok: false, error: 'FORBIDDEN' };
      }
      const expiresAt = this.now() + HANDLE_TTL_MS;
      const handles = prepared.map(file => {
        let token = this.makeToken();
        while (this.entries.has(token)) token = this.makeToken();
        const handle: StoredDroppedUpload = { ...context, ...file, token, senderId, expiresAt };
        this.entries.set(token, handle);
        return { token, fileName: file.fileName, size: file.size };
      });
      return { ok: true, result: handles };
    } finally {
      this.pendingReservations -= localPaths.length;
    }
  }

  consume(senderId: number, context: RemoteFileDropContext, token: string): DroppedUploadSelection | undefined {
    this.prune();
    const handle = this.entries.get(token);
    if (!handle || handle.senderId !== senderId || handle.sessionId !== context.sessionId || handle.transport !== context.transport ||
        handle.remoteDirectory !== context.remoteDirectory) return undefined;
    this.entries.delete(token);
    return { localPath: handle.localPath, fileName: handle.fileName };
  }

  discard(senderId: number, context: RemoteFileDropContext, tokens: readonly string[]): void {
    this.prune();
    for (const token of tokens) {
      const handle = this.entries.get(token);
      if (handle?.senderId === senderId && handle.sessionId === context.sessionId && handle.transport === context.transport &&
          handle.remoteDirectory === context.remoteDirectory) this.entries.delete(token);
    }
  }

  clearSender(senderId: number): void {
    this.senderGeneration.set(senderId, (this.senderGeneration.get(senderId) ?? 0) + 1);
    for (const [token, handle] of this.entries) if (handle.senderId === senderId) this.entries.delete(token);
  }

  clear(): void { this.generation++; this.entries.clear(); }

  get pendingCount(): number { this.prune(); return this.entries.size; }

  private prune(): void {
    const now = this.now();
    for (const [token, handle] of this.entries) if (handle.expiresAt < now) this.entries.delete(token);
  }
}
