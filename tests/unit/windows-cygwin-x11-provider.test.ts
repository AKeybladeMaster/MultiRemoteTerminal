import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import type { spawn } from 'node:child_process';
import test from 'node:test';
import { createX11SetupRequest, createXdmcpLaunchArguments, resolveCygwinXPaths, resolveXWinExecutable,
  WindowsCygwinX11Provider } from '../../apps/desktop/src/adapters/windows-cygwin-x11-provider.ts';

class FakeChild extends EventEmitter {
  readonly stdin: Writable;
  readonly stdout = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  pid = 42;
  killed = false;

  constructor(write?: (chunk: Buffer) => void, onEnd?: () => void) {
    super();
    this.stdin = new Writable({
      write(chunk, _encoding, callback) { write?.(Buffer.from(chunk)); callback(); },
      final(callback) { onEnd?.(); callback(); }
    });
  }

  finish(code: number): void {
    if (this.exitCode !== null || this.signalCode !== null) return;
    this.exitCode = code;
    this.emit('exit', code, null);
    this.emit('close', code, null);
  }

  kill(): boolean {
    if (this.exitCode !== null || this.signalCode !== null) return false;
    this.killed = true;
    this.signalCode = 'SIGTERM';
    this.stdout.end();
    this.emit('exit', null, this.signalCode);
    this.emit('close', null, this.signalCode);
    return true;
  }
}

function extensionReplies(): Buffer {
  const replies = Buffer.alloc(96);
  for (let index = 0; index < 3; index += 1) {
    const offset = index * 32;
    replies[offset] = 1;
    replies[offset + 1] = index === 1 ? 0 : 1;
    replies.writeUInt16LE(index + 1, offset + 2);
    replies[offset + 8] = index === 1 ? 0 : index + 1;
  }
  return replies;
}

test('Cygwin/X lookup is limited to the supported roots and fixed executable paths', () => {
  const checked: string[] = [];
  const paths = resolveCygwinXPaths('C:\\Users\\MRT\\AppData\\Local', candidate => {
    checked.push(candidate);
    return candidate.includes('Cygwin64');
  });
  assert.deepEqual(paths, {
    xwinExecutable: 'C:\\Users\\MRT\\AppData\\Local\\Programs\\Cygwin64\\bin\\XWin.exe',
    xauthExecutable: 'C:\\Users\\MRT\\AppData\\Local\\Programs\\Cygwin64\\bin\\xauth.exe',
    cygpathExecutable: 'C:\\Users\\MRT\\AppData\\Local\\Programs\\Cygwin64\\bin\\cygpath.exe',
    socatExecutable: 'C:\\Users\\MRT\\AppData\\Local\\Programs\\Cygwin64\\usr\\bin\\socat.exe'
  });
  assert.equal(checked.length, 4);
  assert.equal(resolveCygwinXPaths('relative\\path', () => true), undefined);
  assert.equal(resolveXWinExecutable('C:\\Users\\MRT\\AppData\\Local', candidate => candidate.endsWith('XWin.exe')),
    'C:\\Users\\MRT\\AppData\\Local\\Programs\\Cygwin64\\bin\\XWin.exe');
  assert.equal(resolveXWinExecutable('relative\\path', () => true), undefined);
});

test('XDMCP starts only a validated single-host display with a TCP callback listener', () => {
  assert.deepEqual(createXdmcpLaunchArguments('DISPLAY.EXAMPLE.COM.', 1400),
    [':1400', '-fullscreen', '-clipboard', '-listen', 'tcp', '-query', 'display.example.com', '-once']);
  assert.throws(() => createXdmcpLaunchArguments('display.example.com -ac', 1400), /Invalid XDMCP target/u);
  assert.throws(() => createXdmcpLaunchArguments('display.example.com', 59_536), /Invalid XDMCP target/u);
});

test('X11 readiness setup sends the MIT cookie in the X11 client setup packet', () => {
  const cookie = Buffer.from('0102030405060708090a0b0c0d0e0f10', 'hex');
  const request = createX11SetupRequest(cookie);
  assert.equal(request[0], 0x6c);
  assert.equal(request.readUInt16LE(2), 11);
  assert.equal(request.readUInt16LE(6), Buffer.byteLength('MIT-MAGIC-COOKIE-1'));
  assert.equal(request.readUInt16LE(8), 16);
  assert.equal(request.subarray(12, 30).toString('ascii'), 'MIT-MAGIC-COOKIE-1');
  assert.deepEqual(request.subarray(32, 48), cookie);
  assert.throws(() => createX11SetupRequest(new Uint8Array(15)), /16-byte MIT cookie/u);
});

test('X11 startup converts the authority path for Cygwin, probes extensions, and removes owned resources on close', async () => {
  const profileDirectory = await mkdtemp(join(tmpdir(), 'mrt-cygwin-x11-'));
  const calls: Array<{ executable: string; args: readonly string[]; options: SpawnOptions; child: FakeChild }> = [];
  const xwinChildren: FakeChild[] = [];
  let socatCount = 0;
  const spawnProcess = ((executable: string, args: readonly string[], options: SpawnOptions): ChildProcess => {
    let child: FakeChild;
    if (executable.endsWith('cygpath.exe')) {
      child = new FakeChild();
      queueMicrotask(() => {
        child.emit('spawn');
        child.stdout.once('end', () => child.finish(0));
        child.stdout.end(Buffer.from('/proc/cygdrive/c/Users/MRT/AppData/Local/Multi Remote/x11-authority/authority\n'));
      });
    } else if (executable.endsWith('xauth.exe')) {
      child = new FakeChild(undefined, () => child.finish(0));
      queueMicrotask(() => child.emit('spawn'));
    } else if (executable.endsWith('XWin.exe')) {
      child = new FakeChild();
      xwinChildren.push(child);
      queueMicrotask(() => child.emit('spawn'));
    } else {
      const isExtensionProbe = socatCount++ > 0;
      child = new FakeChild(chunk => {
        if (chunk[0] === 0x6c) {
          const setup = Buffer.alloc(8);
          setup[0] = 1;
          setup.writeUInt16LE(11, 2);
          child.stdout.write(setup);
        } else if (isExtensionProbe) child.stdout.write(extensionReplies());
      });
      queueMicrotask(() => child.emit('spawn'));
    }
    calls.push({ executable, args, options, child });
    return child as unknown as ChildProcess;
  }) as typeof spawn;
  const provider = new WindowsCygwinX11Provider(
    { getLocalAppDataDirectory: () => 'C:\\Users\\MRT\\AppData\\Local' }, profileDirectory, spawnProcess,
    path => path.includes('XWin.exe') || path.includes('xauth.exe') || path.includes('cygpath.exe') || path.includes('socat.exe'), 'win32'
  );

  try {
    const display = await provider.open('5726a2ee-03cd-4f5a-a28c-bd72784f80a6');
    const authorityPath = join(profileDirectory, 'x11-authority', '5726a2ee-03cd-4f5a-a28c-bd72784f80a6.authority');
    const convertedPath = '/proc/cygdrive/c/Users/MRT/AppData/Local/Multi Remote/x11-authority/authority';
    const conversion = calls.find(call => call.executable.endsWith('cygpath.exe'));
    const xauth = calls.find(call => call.executable.endsWith('xauth.exe'));
    const xwin = calls.find(call => call.executable.endsWith('XWin.exe'));
    assert.deepEqual(conversion?.args, ['-u', '-U', authorityPath]);
    assert.equal(xauth?.args[1], convertedPath);
    assert.equal(xwin && xwin.args[xwin.args.indexOf('-auth') + 1], convertedPath);
    assert.equal(xwin?.options.shell, false);
    assert.deepEqual(display.extensions, { glx: true, composite: false, randr: true });
    assert.equal((await readFile(authorityPath)).byteLength, 0);

    await provider.close('5726a2ee-03cd-4f5a-a28c-bd72784f80a6');
    assert.equal(xwinChildren[0]?.killed, true);
    await assert.rejects(readFile(authorityPath));
    assert.deepEqual(display.cookie, Buffer.alloc(16));

    const xdmcpStartIndex = xwinChildren.length;
    await provider.launch('a90ae1bd-d305-4e8c-9406-f4ce7b25d3a9', 'display.example.net');
    const xdmcpCall = calls.filter(call => call.executable.endsWith('XWin.exe')).at(-1);
    assert.equal(xdmcpCall?.args.includes('-listen'), true);
    assert.equal(xdmcpCall?.args.includes('tcp'), true);
    assert.equal(xdmcpCall?.args.includes('-query'), true);
    assert.equal(xdmcpCall?.args.includes('display.example.net'), true);
    assert.equal(xdmcpCall?.args.includes('-ac'), false);
    await provider.closeAll();
    assert.equal(xwinChildren[xdmcpStartIndex]?.killed, true);
  } finally {
    await provider.closeAll();
    await rm(profileDirectory, { recursive: true, force: true });
  }
});
