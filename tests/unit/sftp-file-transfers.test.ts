import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSftpFileTransfers } from '../../apps/desktop/src/workers/sftp-file-transfers.ts';

interface FakeFile {
  data: Buffer;
  readonly kind: 'file' | 'directory' | 'symlink';
  mtime: number;
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
    this.size = file.data.length;
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
  delayWrites = false;
  ended = false;
  beforeRename?: (source: string, destination: string) => void;
  renameFailureCode?: number;

  lstat(path: string, callback: (error: Error | null, stats: unknown) => void): void {
    const file = this.files.get(path);
    if (!file) { callback(Object.assign(new Error('Missing file'), { code: 2 }), undefined as never); return; }
    callback(null, new FakeStats(file));
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
    const stream = new Writable({
      write: (chunk: Buffer, _encoding, callback) => {
        const append = () => { file.data = Buffer.concat([file.data, Buffer.from(chunk)]); callback(); };
        if (this.delayWrites) setTimeout(append, 20);
        else append();
      }
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
