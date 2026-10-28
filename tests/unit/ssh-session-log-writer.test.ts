import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { finished } from 'node:stream/promises';
import { Writable } from 'node:stream';
import type { WriteStream } from 'node:fs';
import { createSshSessionLogWriter, SSH_SESSION_LOG_MAX_PENDING_BYTES, waitForSshSessionLogStream } from '../../apps/desktop/src/adapters/ssh-session-log-writer.ts';

const sessionId = '11111111-1111-4111-8111-111111111111';
const workspaceTempRoot = resolve('.tmp');

async function createWorkspaceTempDirectory(): Promise<string> {
  await mkdir(workspaceTempRoot, { recursive: true });
  return mkdtemp(join(workspaceTempRoot, 'mrt-ssh-log-'));
}

test('SSH session log writes ordered JSONL with escaped terminal data and no filesystem path', async () => {
  const directory = await createWorkspaceTempDirectory();
  const path = join(directory, 'session.log');
  const writer = createSshSessionLogWriter();
  try {
    const started = await writer.start(sessionId, path, [{ host: 'linux.internal', port: 22 }]);
    assert.equal(started.ok, true);
    if (!started.ok) return;
    assert.equal(started.result.fileName, 'session.log');
    writer.append({ type: 'terminal-input', sessionId, data: 'sudo\n\u001b[31m' });
    writer.append({ type: 'terminal-output', sessionId, sequence: 1, data: 'Password: \u001b[0m' });
    await writer.finish(sessionId, 'session-closed');

    const contents = await readFile(path, 'utf8');
    const records = contents.trimEnd().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
    assert.deepEqual(records.map(record => record.type), ['attempt-started', 'terminal-input', 'terminal-output', 'log-finished']);
    assert.equal(records[3]?.reason, 'session-closed');
    assert.equal(records[0]?.target && (records[0].target as { host?: string }).host, 'linux.internal');
    assert.equal(records[1]?.data, 'sudo\n\u001b[31m');
    assert.equal(records[2]?.data, 'Password: \u001b[0m');
    assert.equal(JSON.stringify(records).includes(directory), false);
    assert.ok(records.every(record => typeof record.timestamp === 'string' && typeof record.elapsedMs === 'number'));
  } finally {
    await writer.closeAll();
    await rm(directory, { recursive: true, force: true });
  }
});

test('SSH session log rejects duplicate live session IDs and finalizes an attempt failure', async () => {
  const directory = await createWorkspaceTempDirectory();
  let status: unknown;
  const writer = createSshSessionLogWriter(event => { status = event; });
  try {
    const started = await writer.start(sessionId, join(directory, 'failed.log'), [{ host: 'linux.internal', port: 22 }]);
    assert.equal(started.ok, true);
    const duplicate = await writer.start(sessionId, join(directory, 'duplicate.log'), [{ host: 'other.internal', port: 22 }]);
    assert.equal(duplicate.ok, false);
    writer.append({ type: 'transport', sessionId, outcome: 'failed', code: 'UNAVAILABLE', networkFailure: 'DNS_LOOKUP_FAILED' });
    writer.append({ type: 'connection-failed', sessionId, phase: 'credential-prompt', code: 'TIMEOUT' });
    await writer.finish(sessionId, 'connection-failed');
    const contents = await readFile(join(directory, 'failed.log'), 'utf8');
    assert.match(contents, /"phase":"credential-prompt"/u);
    assert.match(contents, /"type":"connection-failed"/u);
    assert.match(contents, /"networkFailure":"DNS_LOOKUP_FAILED"/u);
    assert.deepEqual(status, { sessionId, status: 'finished', reason: 'connection-failed', fileName: 'failed.log' });
  } finally {
    await writer.closeAll();
    await rm(directory, { recursive: true, force: true });
  }
});

test('SSH session log stops at its file cap and keeps a complete final record', async () => {
  const directory = await createWorkspaceTempDirectory();
  const path = join(directory, 'capped.log');
  let status: unknown;
  const writer = createSshSessionLogWriter(event => { status = event; }, 2_048);
  try {
    assert.equal((await writer.start(sessionId, path, [{ host: 'linux.internal', port: 22 }])).ok, true);
    writer.append({ type: 'terminal-output', sessionId, sequence: 1, data: 'x'.repeat(2_048) });
    await writer.closeAll();
    const content = await readFile(path, 'utf8');
    const records = content.trimEnd().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
    assert.equal(records.at(-1)?.type, 'log-finished');
    assert.equal(records.at(-1)?.reason, 'file-size-limit');
    assert.ok(Buffer.byteLength(content) <= 2_048);
    assert.deepEqual(status, { sessionId, status: 'stopped', reason: 'file-size-limit', fileName: 'capped.log' });
  } finally {
    await writer.closeAll();
    await rm(directory, { recursive: true, force: true });
  }
});

test('SSH session log bounds the pending writer queue', async () => {
  const directory = await createWorkspaceTempDirectory();
  const path = join(directory, 'queued.log');
  let status: unknown;
  const writer = createSshSessionLogWriter(event => { status = event; });
  try {
    assert.equal((await writer.start(sessionId, path, [{ host: 'linux.internal', port: 22 }])).ok, true);
    for (let sequence = 1; sequence <= 100; sequence += 1) {
      writer.append({ type: 'terminal-output', sessionId, sequence, data: 'x'.repeat(16_000) });
    }
    await writer.closeAll();
    assert.deepEqual(status, { sessionId, status: 'stopped', reason: 'queue-limit', fileName: 'queued.log' });
    const content = await readFile(path, 'utf8');
    assert.ok(Buffer.byteLength(content) <= SSH_SESSION_LOG_MAX_PENDING_BYTES);
    assert.equal(content.split('\n').filter(Boolean).every(line => { try { JSON.parse(line); return true; } catch { return false; } }), true);
  } finally {
    await writer.closeAll();
    await rm(directory, { recursive: true, force: true });
  }
});

test('SSH session log open deadline destroys a stalled stream', async () => {
  const stream = new Writable({ write() {} }) as WriteStream;
  const keepAlive = setInterval(() => {}, 1_000);
  try {
    await assert.rejects(waitForSshSessionLogStream(new Promise<void>(() => {}), stream, 5), /timed out/u);
    assert.equal(stream.destroyed, true);
  } finally {
    clearInterval(keepAlive);
    stream.destroy();
  }
});

test('SSH session log flush deadline destroys a stalled stream', async () => {
  const stream = new Writable({ write() {} }) as WriteStream;
  stream.write('buffered');
  const flushing = finished(stream);
  stream.end();
  const keepAlive = setInterval(() => {}, 1_000);
  try {
    await assert.rejects(waitForSshSessionLogStream(flushing, stream, 5));
    assert.equal(stream.destroyed, true);
  } finally {
    clearInterval(keepAlive);
    stream.destroy();
  }
});
