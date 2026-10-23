import type * as NodePty from 'node-pty';
import { win32 } from 'node:path';
import { failure } from '../../../../packages/domain/src/errors.ts';
import type { LocalShell, TerminalSize } from '../../../../packages/domain/src/local-terminal.ts';
import type { LocalTerminalEvent, LocalTerminalProvider } from '../../../../packages/application/src/local-terminals.ts';

const OUTPUT_LIMIT_BYTES = 1_048_576;
const OUTPUT_PAUSE_BYTES = 65_536;
const OUTPUT_RESUME_BYTES = 32_768;
const OUTPUT_CHUNK_CHARS = 16_384;
const CLOSE_TIMEOUT_MS = 2_000;

export function resolveShellExecutable(shell: LocalShell, systemRoot = process.env.SystemRoot): string {
  if (!systemRoot || !win32.isAbsolute(systemRoot)) throw new Error('Windows system directory is unavailable');
  return shell === 'powershell'
    ? win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : win32.join(systemRoot, 'System32', 'cmd.exe');
}

interface OutputChunk {
  readonly data: string;
  readonly bytes: number;
}

interface PtySession {
  readonly pty: NodePty.IPty;
  readonly chunks: OutputChunk[];
  disposeData: NodePty.IDisposable;
  disposeExit: NodePty.IDisposable;
  readonly exited: Promise<void>;
  resolveExit: () => void;
  queuedBytes: number;
  sequence: number;
  inFlight: (OutputChunk & { readonly sequence: number }) | undefined;
  exitCode: number | undefined;
  closing: boolean;
}

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(offset + OUTPUT_CHUNK_CHARS, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1] ?? '') && /[\uDC00-\uDFFF]/.test(text[end] ?? '')) end--;
    chunks.push(text.slice(offset, end));
    offset = end;
  }
  return chunks;
}

export class LocalPtyProvider implements LocalTerminalProvider {
  private readonly sessions = new Map<string, PtySession>();
  private readonly listeners = new Set<(event: LocalTerminalEvent) => void>();
  private readonly ptySpawn: typeof NodePty.spawn;

  constructor(ptySpawn: typeof NodePty.spawn) { this.ptySpawn = ptySpawn; }

  async open(sessionId: string, shell: LocalShell, size: TerminalSize): Promise<void> {
    if (process.platform !== 'win32') throw new Error('ConPTY is only available on Windows');
    if (this.sessions.has(sessionId)) throw new Error('Terminal session already exists');
    const executable = resolveShellExecutable(shell);
    const args = shell === 'powershell' ? ['-NoLogo', '-NoProfile'] : ['/Q', '/D', '/K', 'chcp 65001'];
    const home = process.env.USERPROFILE || process.env.HOME;
    const terminal = this.ptySpawn(executable, args, {
      name: 'xterm-256color', cols: size.columns, rows: size.rows,
      ...(home ? { cwd: home } : {}),
      env: process.env,
      useConpty: true, useConptyDll: true, conptyInheritCursor: true
    });

    let resolveExit = () => {};
    const exited = new Promise<void>(resolve => { resolveExit = resolve; });
    const state: PtySession = {
      pty: terminal, chunks: [], disposeData: { dispose() {} }, disposeExit: { dispose() {} }, exited, resolveExit,
      queuedBytes: 0, sequence: 0, inFlight: undefined, exitCode: undefined, closing: false
    };
    state.disposeData = terminal.onData(data => this.queueOutput(sessionId, state, data));
    state.disposeExit = terminal.onExit(({ exitCode }) => {
      state.exitCode = exitCode;
      state.resolveExit();
      if (state.closing) {
        this.publish({ kind: 'exit', sessionId, exitCode });
        this.removeSession(sessionId, state);
        return;
      }
      this.flushOutput(sessionId, state);
    });
    this.sessions.set(sessionId, state);
  }

  processId(sessionId: string): number {
    return this.requireSession(sessionId).pty.pid;
  }

  async write(sessionId: string, data: string): Promise<void> {
    const state = this.requireSession(sessionId);
    if (state.closing) throw new Error('Terminal is closing');
    state.pty.write(data);
  }

  async resize(sessionId: string, size: TerminalSize): Promise<void> {
    const state = this.requireSession(sessionId);
    if (state.closing) throw new Error('Terminal is closing');
    state.pty.resize(size.columns, size.rows);
  }

  async acknowledgeOutput(sessionId: string, sequence: number): Promise<void> {
    const state = this.requireSession(sessionId);
    if (!state.inFlight || sequence !== state.inFlight.sequence) return;
    state.queuedBytes -= state.inFlight.bytes;
    state.inFlight = undefined;
    if (state.queuedBytes <= OUTPUT_RESUME_BYTES) state.pty.resume();
    this.flushOutput(sessionId, state);
  }

  async close(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    state.closing = true;
    state.chunks.length = 0;
    state.inFlight = undefined;
    state.queuedBytes = 0;
    state.disposeData.dispose();
    try { state.pty.kill(); } catch { /* The exit signal below remains authoritative. */ }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([state.exited, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Terminal close timed out')), CLOSE_TIMEOUT_MS);
      })]);
    } finally {
      clearTimeout(timer);
      this.removeSession(sessionId, state);
    }
  }

  async shutdown(): Promise<void> {
    const results = await Promise.allSettled([...this.sessions.keys()].map(sessionId => this.close(sessionId)));
    const failed = results.some(result => result.status === 'rejected');
    this.listeners.clear();
    if (failed) throw new Error('One or more terminal processes did not close');
  }

  subscribe(listener: (event: LocalTerminalEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private requireSession(sessionId: string): PtySession {
    const state = this.sessions.get(sessionId);
    if (!state) throw new Error('Unknown terminal session');
    return state;
  }

  private queueOutput(sessionId: string, state: PtySession, data: string): void {
    if (state.closing || state.exitCode !== undefined || !data) return;
    const addedBytes = Buffer.byteLength(data, 'utf8');
    if (state.queuedBytes + addedBytes > OUTPUT_LIMIT_BYTES) {
      state.chunks.length = 0;
      state.inFlight = undefined;
      state.queuedBytes = 0;
      state.closing = true;
      state.disposeData.dispose();
      this.publish({ kind: 'failure', sessionId, error: failure('OUTPUT_LIMIT', 'terminal').error });
      try { state.pty.kill(); } catch { /* Exit cleanup remains registered. */ }
      return;
    }
    const chunks = chunkText(data).map(text => ({ data: text, bytes: Buffer.byteLength(text, 'utf8') }));
    state.chunks.push(...chunks);
    state.queuedBytes += addedBytes;
    if (state.queuedBytes >= OUTPUT_PAUSE_BYTES) state.pty.pause();
    this.flushOutput(sessionId, state);
  }

  private flushOutput(sessionId: string, state: PtySession): void {
    if (!state.inFlight && state.chunks.length > 0 && !state.closing) {
      const chunk = state.chunks.shift();
      if (!chunk) return;
      const inFlight = { ...chunk, sequence: ++state.sequence };
      state.inFlight = inFlight;
      this.publish({ kind: 'data', sessionId, sequence: inFlight.sequence, data: inFlight.data });
      return;
    }
    if (!state.inFlight && state.chunks.length === 0 && state.exitCode !== undefined && !state.closing) {
      this.publish({ kind: 'exit', sessionId, exitCode: state.exitCode });
      this.removeSession(sessionId, state);
    }
  }

  private removeSession(sessionId: string, state: PtySession): void {
    if (this.sessions.get(sessionId) !== state) return;
    state.disposeData.dispose();
    state.disposeExit.dispose();
    state.resolveExit();
    this.sessions.delete(sessionId);
  }

  private publish(event: LocalTerminalEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* A subscriber cannot interrupt PTY cleanup. */ }
    }
  }
}
