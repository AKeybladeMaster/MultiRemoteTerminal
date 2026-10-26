import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DroppedUploadRegistry } from '../../apps/desktop/src/main/dropped-upload-registry.ts';
import { installRemoteFileDropStore } from '../../apps/desktop/src/preload/remote-file-drop.ts';
import { MAX_REMOTE_FILE_DROP_COUNT, isRemoteFileDropEvent, parseRemoteFileDropRegistrationRequest, parseRequest } from '../../packages/contracts/src/commands.ts';
import type { RemoteFileDropContext } from '../../packages/contracts/src/commands.ts';

const SESSION_ID = '18f2f903-7b6f-4c8d-9c42-b63a58c4b087';
const TOKEN_ID = '00000000-0000-4000-8000-000000000001';
const context: RemoteFileDropContext = { sessionId: SESSION_ID, transport: 'sftp', remoteDirectory: '/home/user' };

function tokenFor(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

test('drop registration contract bounds paths and exposes only safe one-use metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mrt-drop-registry-'));
  try {
    const path = join(root, 'local secret.txt');
    await writeFile(path, 'abc');
    let now = 1_000;
    let nextToken = 1;
    const registry = new DroppedUploadRegistry(() => now, () => tokenFor(nextToken++));
    const registered = await registry.register(7, context, [path]);
    assert.equal(registered.ok, true);
    if (!registered.ok) return;
    assert.deepEqual(registered.result, [{ token: tokenFor(1), fileName: 'local secret.txt', size: 3 }]);
    assert.equal(registry.pendingCount, 1);
    assert.equal(registry.consume(8, context, tokenFor(1)), undefined);
    assert.equal(registry.consume(7, { ...context, remoteDirectory: '/other' }, tokenFor(1)), undefined);
    assert.equal(registry.consume(7, { ...context, transport: 'ftp' }, tokenFor(1)), undefined);
    assert.deepEqual(registry.consume(7, context, tokenFor(1)), { localPath: path, fileName: 'local secret.txt' });
    assert.equal(registry.consume(7, context, tokenFor(1)), undefined);

    const batchPaths = Array.from({ length: MAX_REMOTE_FILE_DROP_COUNT }, () => path);
    const batch = await registry.register(7, context, batchPaths);
    assert.equal(batch.ok, true);
    assert.equal(registry.pendingCount, MAX_REMOTE_FILE_DROP_COUNT);
    assert.deepEqual(await registry.register(7, context, [path]), { ok: false, error: 'OUTPUT_LIMIT' });
    now += 10 * 60_000 + 1;
    assert.equal(registry.pendingCount, 0);
    assert.equal(registry.consume(7, context, tokenFor(2)), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('drop contract rejects malformed paths and result objects that contain local paths', () => {
  assert.equal(parseRemoteFileDropRegistrationRequest({ ...context, localPaths: ['C:\\local\\file.txt'] }).ok, true);
  assert.equal(parseRemoteFileDropRegistrationRequest({ ...context, localPaths: [] }).ok, false);
  assert.equal(parseRemoteFileDropRegistrationRequest({ ...context, localPaths: Array(1) }).ok, false);
  assert.equal(parseRemoteFileDropRegistrationRequest({ ...context, localPaths: Array(MAX_REMOTE_FILE_DROP_COUNT + 1).fill('C:\\local\\file.txt') }).ok, false);
  assert.equal(isRemoteFileDropEvent({ ...context, ok: true, result: [{ token: TOKEN_ID, fileName: 'safe.txt', size: 1 }] }), true);
  assert.equal(isRemoteFileDropEvent({ ...context, ok: true, result: [{ token: TOKEN_ID, fileName: 'safe.txt', size: 1, localPath: 'C:\\secret.txt' }] }), false);
  const uploadRequest = { requestId: 'c8f87744-bd2c-4c0d-9a18-a4a324dd71fd', contractVersion: 1, command: 'ssh.files.upload-dropped',
    payload: { sessionId: SESSION_ID, operationId: 'cf66fcda-f195-45f0-b8be-1873b56319e3', remoteDirectory: '/home/user', token: TOKEN_ID } };
  assert.equal(parseRequest(uploadRequest).ok, true);
  assert.equal(parseRequest({ ...uploadRequest, payload: { ...uploadRequest.payload, token: 'not-a-token' } }).ok, false);
});

test('preload drop capture accepts trusted folder drops and rejects synthetic page events', async () => {
  let dropListener: ((event: Event) => void) | undefined;
  let removed = false;
  const documentTarget = {
    addEventListener(_type: 'drop', listener: (event: Event) => void) { dropListener = listener; },
    removeEventListener(_type: 'drop', listener: (event: Event) => void) { removed = dropListener === listener; dropListener = undefined; }
  };
  const attributes: Record<string, string> = {
    'data-mrt-remote-file-session-id': SESSION_ID,
    'data-mrt-remote-file-transport': 'sftp',
    'data-mrt-remote-file-directory': '/home/user'
  };
  const pane = {
    closest(selector: string) { return selector === '[data-mrt-remote-file-drop-target="true"]' ? this : null; },
    getAttribute(name: string) { return attributes[name] ?? null; }
  };
  const inner = { closest: pane.closest.bind(pane) };
  let registrations = 0;
  let submittedPaths: readonly string[] | undefined;
  let eventResult: unknown;
  const store = installRemoteFileDropStore(documentTarget, () => 'C:\\private\\secret.txt', async request => {
    registrations++;
    const parsed = parseRemoteFileDropRegistrationRequest(request);
    if (!parsed.ok) return parsed;
    submittedPaths = parsed.result.localPaths;
    return { ...context, ok: true, result: [{ token: TOKEN_ID, fileName: 'secret.txt', size: 4 }] };
  });
  store.subscribe(event => { eventResult = event; });
  const fire = (isTrusted: boolean, count = 1, prevent: () => void = () => {}) => dropListener?.({
    type: 'drop', isTrusted, target: inner, dataTransfer: { files: Array.from({ length: count }, () => ({ name: 'secret.txt' })) }, preventDefault: prevent
  } as unknown as Event);

  fire(false);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(registrations, 0);

  let prevented = false;
  fire(true, 1, () => { prevented = true; });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(prevented, true);
  assert.equal(registrations, 1);
  assert.deepEqual(submittedPaths, ['C:\\private\\secret.txt']);
  assert.equal(isRemoteFileDropEvent(eventResult), true);
  assert.equal(JSON.stringify(eventResult).includes('C:\\private\\secret.txt'), false);

  fire(true, MAX_REMOTE_FILE_DROP_COUNT + 1);
  assert.equal(registrations, 1);
  assert.equal(isRemoteFileDropEvent(eventResult), true);
  assert.equal((eventResult as { ok: boolean }).ok, false);
  store.dispose();
  assert.equal(removed, true);
});
