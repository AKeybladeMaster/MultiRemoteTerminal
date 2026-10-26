import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { createSftpFileTransfers } from '../../apps/desktop/src/workers/sftp-file-transfers.ts';
import { MAX_REMOTE_TEXT_FILE_BYTES } from '../../packages/domain/src/remote-text-file.ts';

interface FakeFile {
  data: Buffer;
  readonly kind: 'file' | 'directory' | 'symlink';
  mtime: number;
  readonly reportedSize?: number;
}

class FakeStats {
  readonly mode: number;
  readonly uid = 1000;
  readonly gid = 1000;
  readonly size: number;
  readonly atime = 1_800_000_000;
  readonly mtime: number;
  constructor(file: FakeFile) {
    this.mode = file.kind === 'directory' ? 0o040700 : file.kind === 'symlink' ? 0o120777 : 0o100600;
    this.size = file.reportedSize ?? file.data.length;
    this.mtime = file.mtime;
  }
  isDirectory(): boolean { return (this.mode & 0o170000) === 0o040000; }
  isFile(): boolean { return (this.mode & 0o170000) === 0o100000; }
  isSymbolicLink(): boolean { return (this.mode & 0o170000) === 0o120000; }
  isBlockDevice(): boolean { return false; }
  isCharacterDevice(): boolean { return false; }
  isFIFO(): boolean { return false; }
  isSocket(): boolean { return false; }
}

class FakeSftp extends EventEmitter {
  readonly files = new Map<string, FakeFile>([['/', { data: Buffer.alloc(0), kind: 'directory', mtime: 1_800_000_000 }],
    ['/home', { data: Buffer.alloc(0), kind: 'directory', mtime: 1_800_000_000 }]]);
  readonly realpathOverrides = new Map<string, string>();
  delayWrites = false;
  writeDelayMs = 20;
  ended = false;
  hangWriteStreamDestroy = false;
  beforeRename?: (source: string, destination: string) => void;
  renameFailureCode?: number;
  writeFailureCode?: number;
  unlinkFailureCode?: number;

  lstat(path: string, callback: (error: Error | null, stats: unknown) => void): void {
    const file = this.files.get(path);
    if (!file) { callback(Object.assign(new Error('Missing file'), { code: 2 }), undefined as never); return; }
    callback(null, new FakeStats(file));
  }

  realpath(path: string, callback: (error: Error | null, resolvedPath: string) => void): void {
    callback(null, this.realpathOverrides.get(path) ?? (path.startsWith('/') ? posix.normalize(path) : posix.resolve('/home', path)));
  }

  createReadStream(path: string): Readable {
    const file = this.files.get(path);
    if (!file) throw Object.assign(new Error('Missing file'), { code: 2 });
    return Readable.from([Buffer.from(file.data)]);
  }

  createWriteStream(path: string): Writable {
    if (this.files.has(path)) {
      const stream = new Writable({ write(_chunk, _encoding, callback) { callback(Object.assign(new Error('Already exists'), { code: 11 })); } });
      queueMicrotask(() => stream.emit('error', Object.assign(new Error('Already exists'), { code: 11 })));
      return stream;
    }
    const file: FakeFile = { data: Buffer.alloc(0), kind: 'file', mtime: 1_800_000_000 };
    this.files.set(path, file);
    const hangDestroy = this.hangWriteStreamDestroy;
    const stream = new Writable({
      write: (chunk: Buffer, _encoding, callback) => {
        const append = () => {
          file.data = Buffer.concat([file.data, Buffer.from(chunk)]);
          callback(this.writeFailureCode === undefined ? undefined : Object.assign(new Error('SFTP write failed'), { code: this.writeFailureCode }));
        };
        if (this.delayWrites) setTimeout(append, this.writeDelayMs);
        else append();
      },
      destroy: (error, callback) => { if (!hangDestroy) callback(error); }
    });
    queueMicrotask(() => stream.emit('open', Buffer.from('fake')));
    return stream;
  }

  rename(source: string, destination: string, callback: (error: Error | null) => void): void {
    this.beforeRename?.(source, destination);
    if (this.renameFailureCode !== undefined) {
      callback(Object.assign(new Error('SFTP rename failed'), { code: this.renameFailureCode }));
      return;
    }
    const file = this.files.get(source);
    if (!file) { callback(Object.assign(new Error('Missing source'), { code: 2 })); return; }
    if (this.files.has(destination)) { callback(Object.assign(new Error('Destination exists'), { code: 11 })); return; }
    this.files.set(destination, file);
    this.files.delete(source);
    callback(null);
  }

  unlink(path: string, callback: (error: Error | null) => void): void {
    if (this.unlinkFailureCode !== undefined) {
      callback(Object.assign(new Error('SFTP unlink failed'), { code: this.unlinkFailureCode }));
      return;
    }
    if (!this.files.delete(path)) { callback(Object.assign(new Error('Missing file'), { code: 2 })); return; }
    callback(null);
  }

  end(): void { this.ended = true; this.emit('close'); }
}

const transfers = createSftpFileTransfers();
const sessionId = '11111111-1111-4111-8111-111111111111';
const operationId = '22222222-2222-4222-8222-222222222222';

test('SFTP upload with rename conflict policy keeps the requested name when it is available', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-sftp-upload-name-'));
  const sourcePath = join(directory, 'report.txt');
  const source = Buffer.from('new remote file');
  await writeFile(sourcePath, source);
  const sftp = new FakeSftp();
  try {
    const uploaded = await transfers.upload(sessionId, operationId, sftp as never, sourcePath, '/home', 'report.txt', 'rename');
    assert.deepEqual(uploaded, { direction: 'upload', fileName: 'report.txt', bytesTransferred: source.length, state: 'completed' });
    assert.deepEqual(sftp.files.get('/home/report.txt')?.data, source);
    assert.equal(sftp.files.has('/home/report (1).txt'), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('SFTP upload resolves a commit-time rename collision without replacing the competing file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-sftp-upload-race-'));
  const sourcePath = join(directory, 'report.txt');
  const source = Buffer.from('new remote file');
  const competitor = Buffer.from('created by another client');
  await writeFile(sourcePath, source);
  const sftp = new FakeSftp();
  let injected = false;
  sftp.beforeRename = (_source, destination) => {
    if (injected || destination !== '/home/report.txt') return;
    injected = true;
    sftp.files.set(destination, { data: competitor, kind: 'file', mtime: 1_800_000_001 });
  };
  try {
    const uploaded = await transfers.upload(sessionId, operationId, sftp as never, sourcePath, '/home', 'report.txt', 'rename');
    assert.deepEqual(uploaded, { direction: 'upload', fileName: 'report (1).txt', bytesTransferred: source.length, state: 'completed' });
    assert.deepEqual(sftp.files.get('/home/report.txt')?.data, competitor);
    assert.deepEqual(sftp.files.get('/home/report (1).txt')?.data, source);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('SFTP upload does not misreport a generic rename failure as a successful copy-name transfer', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-sftp-upload-rename-error-'));
  const sourcePath = join(directory, 'report.txt');
  await writeFile(sourcePath, 'new remote file');
  const sftp = new FakeSftp();
  sftp.renameFailureCode = 4;
  try {
    await assert.rejects(transfers.upload(sessionId, operationId, sftp as never, sourcePath, '/home', 'report.txt', 'rename'),
      error => (error as { code?: string }).code === 'UNAVAILABLE');
    assert.equal([...sftp.files.keys()].some(path => path.startsWith('/home/report')), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('SFTP upload stages content, preserves a name collision, reports progress, and supports explicit overwrite', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-sftp-upload-'));
  const sourcePath = join(directory, 'report.txt');
  const source = Buffer.from('remote terminal file transfer');
  await writeFile(sourcePath, source);
  const sftp = new FakeSftp();
  sftp.files.set('/home/report.txt', { data: Buffer.from('keep me'), kind: 'file', mtime: 1_800_000_000 });
  const progress: string[] = [];
  try {
    const renamed = await transfers.upload(sessionId, operationId, sftp as never, sourcePath, '/home', 'report.txt', 'rename',
      undefined, event => progress.push(event.phase));
    assert.deepEqual(renamed, { direction: 'upload', fileName: 'report (1).txt', bytesTransferred: source.length, state: 'completed' });
    assert.deepEqual(sftp.files.get('/home/report.txt')?.data, Buffer.from('keep me'));
    assert.deepEqual(sftp.files.get('/home/report (1).txt')?.data, source);
    assert.deepEqual(progress, ['transferring', 'transferring', 'committing']);

    const replaced = await transfers.upload(sessionId, '33333333-3333-4333-8333-333333333333', sftp as never,
      sourcePath, '/home', 'report.txt', 'overwrite');
    assert.deepEqual(replaced, { direction: 'upload', fileName: 'report.txt', bytesTransferred: source.length, state: 'completed' });
    assert.deepEqual(sftp.files.get('/home/report.txt')?.data, source);
    assert.equal([...sftp.files.keys()].some(path => /\.(?:partial|backup)$/u.test(path)), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('SFTP download uses a staged local target, respects skip collisions, and removes staging on cancellation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-sftp-download-'));
  const targetPath = join(directory, 'remote.txt');
  await writeFile(targetPath, 'keep local');
  const sftp = new FakeSftp();
  const content = Buffer.from('download bytes from SFTP');
  sftp.files.set('/home/remote.txt', { data: content, kind: 'file', mtime: 1_800_000_000 });
  try {
    assert.deepEqual(await transfers.download(sessionId, operationId, sftp as never, '/home/remote.txt', targetPath, 'skip'),
      { direction: 'download', fileName: 'remote.txt', bytesTransferred: 0, state: 'skipped' });
    assert.equal(await readFile(targetPath, 'utf8'), 'keep local');

    const downloadedPath = join(directory, 'fetched.txt');
    const downloaded = await transfers.download(sessionId, '33333333-3333-4333-8333-333333333333', sftp as never,
      '/home/remote.txt', downloadedPath, 'rename');
    assert.deepEqual(downloaded, { direction: 'download', fileName: 'fetched.txt', bytesTransferred: content.length, state: 'completed' });
    assert.deepEqual(await readFile(downloadedPath), content);

    const sourcePath = join(directory, 'upload.bin');
    await writeFile(sourcePath, Buffer.alloc(256 * 1024, 7));
    sftp.delayWrites = true;
    const cancellation = new AbortController();
    const upload = transfers.upload(sessionId, '44444444-4444-4444-8444-444444444444', sftp as never,
      sourcePath, '/home', 'upload.bin', 'rename', cancellation.signal, progress => {
        if (progress.bytesTransferred > 0) cancellation.abort();
      });
    await assert.rejects(upload, error => (error as { code?: string }).code === 'CANCELLED');
    assert.equal([...sftp.files.keys()].some(path => path.endsWith('.partial')), false);
    const names = await readdir(directory);
    assert.equal(names.some(name => name.startsWith('.mrt-')), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('SFTP reconnect removes only an owned orphaned upload stage for the same trusted connection scope', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-sftp-upload-recovery-'));
  const sourcePath = join(directory, 'report.txt');
  await writeFile(sourcePath, Buffer.alloc(32 * 1024, 9));
  const recoveryTransfers = createSftpFileTransfers();
  const disconnected = new FakeSftp();
  disconnected.writeFailureCode = 4;
  disconnected.unlinkFailureCode = 4;
  const recoveryScope = 'trusted-route-account-one';
  try {
    await assert.rejects(recoveryTransfers.upload(sessionId, '55555555-5555-4555-8555-555555555555', disconnected as never,
      sourcePath, '/home', 'report.txt', 'rename', undefined, undefined, recoveryScope),
    error => (error as { code?: string }).code === 'UNAVAILABLE');
    const stagedPath = [...disconnected.files.keys()].find(path => path.endsWith('.partial'));
    assert.ok(stagedPath, 'the failed transfer must have created its exclusive staging path');
    assert.ok((disconnected.files.get(stagedPath)?.data.length ?? 0) > 0, 'the staged upload must contain partial bytes');

    const reconnected = new FakeSftp();
    reconnected.files.clear();
    for (const [path, file] of disconnected.files) reconnected.files.set(path, file);
    await recoveryTransfers.cleanupOrphanedUploads(reconnected as never, 'different-trusted-route');
    assert.ok(reconnected.files.has(stagedPath), 'a different connection identity must not remove a remote path');

    const cancelledCleanup = new AbortController();
    cancelledCleanup.abort();
    await assert.rejects(recoveryTransfers.cleanupOrphanedUploads(reconnected as never, recoveryScope, cancelledCleanup.signal),
      error => (error as { code?: string }).code === 'CANCELLED');
    assert.ok(reconnected.files.has(stagedPath), 'cancelled cleanup must retain its record for a later SFTP operation');

    await recoveryTransfers.cleanupOrphanedUploads(reconnected as never, recoveryScope);
    assert.equal(reconnected.files.has(stagedPath), false);
    assert.equal(reconnected.files.has('/home/report.txt'), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('SFTP upload cancellation settles when closing the remote write handle never answers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-sftp-upload-hung-close-'));
  const sourcePath = join(directory, 'large.bin');
  await writeFile(sourcePath, Buffer.alloc(256 * 1024, 5));
  const recoveryTransfers = createSftpFileTransfers();
  const disconnected = new FakeSftp();
  disconnected.hangWriteStreamDestroy = true;
  disconnected.delayWrites = true;
  disconnected.writeDelayMs = 200;
  disconnected.unlinkFailureCode = 4;
  const cancellation = new AbortController();
  const recoveryScope = 'trusted-route-hung-close';
  try {
    const upload = recoveryTransfers.upload(sessionId, '66666666-6666-4666-8666-666666666666', disconnected as never,
      sourcePath, '/home', 'large.bin', 'rename', cancellation.signal, progress => {
        if (progress.bytesTransferred > 0) cancellation.abort();
      }, recoveryScope);
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      deadlineTimer = setTimeout(() => reject(new Error('SFTP cancellation did not settle')), 2_000);
    });
    try { await assert.rejects(Promise.race([upload, deadline]), error => (error as { code?: string }).code === 'CANCELLED'); }
    finally { clearTimeout(deadlineTimer); }
    const stagedPath = [...disconnected.files.keys()].find(path => path.endsWith('.partial'));
    assert.ok(stagedPath, 'the interrupted upload must retain its worker-owned stage for reconnect cleanup');

    const reconnected = new FakeSftp();
    reconnected.files.clear();
    for (const [path, file] of disconnected.files) reconnected.files.set(path, file);
    await recoveryTransfers.cleanupOrphanedUploads(reconnected as never, recoveryScope);
    assert.equal(reconnected.files.has(stagedPath), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('SFTP download rejects remote symbolic links and absent paths before creating a local file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-sftp-invalid-'));
  const sftp = new FakeSftp();
  sftp.files.set('/home/link.txt', { data: Buffer.from('target'), kind: 'symlink', mtime: 1_800_000_000 });
  try {
    await assert.rejects(transfers.download(sessionId, operationId, sftp as never, '/home/link.txt', join(directory, 'link.txt'), 'overwrite'),
      error => (error as { code?: string }).code === 'INVALID_REQUEST');
    await assert.rejects(transfers.download(sessionId, '33333333-3333-4333-8333-333333333333', sftp as never,
      '/home/missing.txt', join(directory, 'missing.txt'), 'overwrite'), error => (error as { code?: string }).code === 'NOT_FOUND');
    assert.deepEqual(await readdir(directory), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('SFTP upload and download reject symlinked remote parent directories', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-sftp-parent-symlink-'));
  const sourcePath = join(directory, 'source.txt');
  await writeFile(sourcePath, 'upload');
  const sftp = new FakeSftp();
  sftp.files.set('/home/alias', { data: Buffer.alloc(0), kind: 'symlink', mtime: 1_800_000_000 });
  sftp.files.set('/home/alias/remote.txt', { data: Buffer.from('download'), kind: 'file', mtime: 1_800_000_000 });
  sftp.realpathOverrides.set('/home/alias', '/home/real-target');
  sftp.realpathOverrides.set('/home/alias/remote.txt', '/home/real-target/remote.txt');
  try {
    await assert.rejects(transfers.upload(sessionId, operationId, sftp as never, sourcePath, '/home/alias', 'source.txt', 'rename'),
      error => (error as { code?: string }).code === 'INVALID_REQUEST');
    await assert.rejects(transfers.download(sessionId, '33333333-3333-4333-8333-333333333333', sftp as never,
      '/home/alias/remote.txt', join(directory, 'download.txt'), 'overwrite'),
    error => (error as { code?: string }).code === 'INVALID_REQUEST');
    assert.equal([...sftp.files.keys()].some(path => path.endsWith('.partial')), false);
    assert.deepEqual(await readdir(directory), ['source.txt']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('SFTP download rejects a short remote stream without replacing the selected local target', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-sftp-short-download-'));
  const targetPath = join(directory, 'report.txt');
  await writeFile(targetPath, 'preserve existing content');
  const sftp = new FakeSftp();
  sftp.files.set('/home/report.txt', { data: Buffer.from('short'), reportedSize: 30, kind: 'file', mtime: 1_800_000_000 });
  try {
    await assert.rejects(transfers.download(sessionId, operationId, sftp as never, '/home/report.txt', targetPath, 'overwrite'),
      error => (error as { code?: string }).code === 'CONFLICT');
    assert.equal(await readFile(targetPath, 'utf8'), 'preserve existing content');
    assert.deepEqual((await readdir(directory)).sort(), ['report.txt']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('SFTP progress reports are coalesced during multi-chunk transfers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mrt-sftp-progress-'));
  const sourcePath = join(directory, 'large.bin');
  await writeFile(sourcePath, Buffer.alloc(1024 * 1024, 3));
  const sftp = new FakeSftp();
  sftp.delayWrites = true;
  sftp.writeDelayMs = 15;
  const progress: Array<{ phase: string; bytesTransferred: number; at: number }> = [];
  try {
    await transfers.upload(sessionId, operationId, sftp as never, sourcePath, '/home', 'large.bin', 'rename', undefined,
      event => progress.push({ phase: event.phase, bytesTransferred: event.bytesTransferred, at: performance.now() }));
    const transferProgress = progress.filter(event => event.phase === 'transferring');
    assert.ok(transferProgress.length >= 3, 'the delayed fixture must produce an interval progress update');
    const intervalReports = transferProgress.slice(0, -1);
    for (let index = 1; index < intervalReports.length; index += 1) {
      const elapsed = (intervalReports[index]?.at ?? 0) - (intervalReports[index - 1]?.at ?? 0);
      assert.ok(elapsed >= 90, `progress updates should be coalesced to roughly 100 ms intervals, received ${elapsed.toFixed(1)} ms`);
    }
    assert.equal(transferProgress.at(-1)?.bytesTransferred, 1024 * 1024);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('SFTP text editor reads strict bounded UTF-8 and atomically saves against its loaded revision', async () => {
  const sftp = new FakeSftp();
  const original = Buffer.from('line one\r\nserver café\n');
  const replacement = 'line one\r\nserver résumé\n';
  sftp.files.set('/home/edit.txt', { data: original, kind: 'file', mtime: 1_800_000_000 });
  const file = await transfers.readText(sessionId, operationId, sftp as never, '/home/edit.txt');
  assert.equal(file.content, original.toString('utf8'));
  assert.equal(file.bytes, original.byteLength);

  const saved = await transfers.saveText(sessionId, '33333333-3333-4333-8333-333333333333', sftp as never,
    '/home/edit.txt', replacement, file.revision);
  assert.deepEqual(sftp.files.get('/home/edit.txt')?.data, Buffer.from(replacement, 'utf8'));
  assert.equal(saved.bytesSaved, Buffer.byteLength(replacement));
  assert.notEqual(saved.revision, file.revision);
  assert.equal([...sftp.files.keys()].some(path => /\.mrt-[0-9a-f-]+\.(?:partial|backup)$/u.test(path)), false);
});

test('SFTP text editor rejects binary and oversized files without exposing partial text', async () => {
  const sftp = new FakeSftp();
  sftp.files.set('/home/binary.dat', { data: Buffer.from([0x43, 0xff, 0x41]), kind: 'file', mtime: 1_800_000_000 });
  sftp.files.set('/home/large.txt', { data: Buffer.alloc(MAX_REMOTE_TEXT_FILE_BYTES + 1), kind: 'file', mtime: 1_800_000_000 });
  await assert.rejects(transfers.readText(sessionId, operationId, sftp as never, '/home/binary.dat'),
    error => (error as { code?: string }).code === 'NOT_SUPPORTED');
  await assert.rejects(transfers.readText(sessionId, '33333333-3333-4333-8333-333333333333', sftp as never, '/home/large.txt'),
    error => (error as { code?: string }).code === 'OUTPUT_LIMIT');
});

test('SFTP text editor detects a concurrent replacement and preserves the remote version', async () => {
  const sftp = new FakeSftp();
  const original = Buffer.from('original');
  const changed = Buffer.from('changed outside the editor');
  sftp.files.set('/home/edit.txt', { data: original, kind: 'file', mtime: 1_800_000_000 });
  const file = await transfers.readText(sessionId, operationId, sftp as never, '/home/edit.txt');
  let injected = false;
  sftp.beforeRename = (source, destination) => {
    if (injected || source !== '/home/edit.txt' || !destination.endsWith('.backup')) return;
    injected = true;
    sftp.files.set(source, { data: changed, kind: 'file', mtime: 1_800_000_001 });
  };
  await assert.rejects(transfers.saveText(sessionId, '33333333-3333-4333-8333-333333333333', sftp as never,
    '/home/edit.txt', 'my unsaved edit', file.revision), error => (error as { code?: string }).code === 'CONFLICT');
  assert.deepEqual(sftp.files.get('/home/edit.txt')?.data, changed);
  assert.equal([...sftp.files.keys()].some(path => /\.mrt-[0-9a-f-]+\.(?:partial|backup)$/u.test(path)), false);
});

test('SFTP text editor cancels a staged save and leaves the original remote file intact', async () => {
  const sftp = new FakeSftp();
  const original = Buffer.from('keep remote data');
  sftp.files.set('/home/edit.txt', { data: original, kind: 'file', mtime: 1_800_000_000 });
  const file = await transfers.readText(sessionId, operationId, sftp as never, '/home/edit.txt');
  sftp.delayWrites = true;
  const cancellation = new AbortController();
  const pending = transfers.saveText(sessionId, '33333333-3333-4333-8333-333333333333', sftp as never,
    '/home/edit.txt', 'x'.repeat(MAX_REMOTE_TEXT_FILE_BYTES), file.revision, cancellation.signal, progress => {
      if (progress.bytesTransferred > 0) cancellation.abort();
    });
  await assert.rejects(pending, error => (error as { code?: string }).code === 'CANCELLED');
  assert.deepEqual(sftp.files.get('/home/edit.txt')?.data, original);
  assert.equal([...sftp.files.keys()].some(path => path.endsWith('.partial')), false);
});
