import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalTextEditorController } from '../../packages/application/src/local-text-editor.ts';
import type { LocalTextFilePayload, LocalTextFileProvider } from '../../packages/application/src/local-text-editor.ts';

const selectionId = '5726a2ee-03cd-4f5a-a28c-bd72784f80a6';
const selectedPath = 'C:\\private\\local-settings.txt';
const source: LocalTextFilePayload = { fileName: 'local-settings.txt', content: 'value=old', revision: 'a'.repeat(64), bytes: 9 };

test('local editor keeps the selected path in main and gates operations on its opaque selection id', async () => {
  const calls: unknown[] = [];
  let current = source;
  let releaseShutdown!: () => void;
  const shutdownGate = new Promise<void>(resolve => { releaseShutdown = resolve; });
  const provider: LocalTextFileProvider = {
    async read(path) { calls.push({ kind: 'read', path }); return current; },
    async save(path, content, expectedRevision) {
      calls.push({ kind: 'save', path, content, expectedRevision });
      current = { ...source, content, revision: 'b'.repeat(64), bytes: Buffer.byteLength(content) };
      return { revision: current.revision, bytesSaved: current.bytes };
    },
    async shutdown() { calls.push({ kind: 'shutdown' }); await shutdownGate; }
  };
  const controller = createLocalTextEditorController(provider, async () => ({ absolutePath: selectedPath, fileName: 'local-settings.txt' }), () => selectionId);

  const opened = await controller.open();
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  assert.deepEqual(opened.result, { selectionId, fileName: 'local-settings.txt', content: 'value=old', revision: 'a'.repeat(64), bytes: 9 });
  assert.equal(JSON.stringify(opened).includes(selectedPath), false);
  assert.deepEqual(await controller.reload('11111111-1111-4111-8111-111111111111'), { ok: false,
    error: { code: 'NOT_FOUND', target: 'application', retryable: false } });

  const saved = await controller.save(selectionId, 'value=new', 'a'.repeat(64));
  assert.deepEqual(saved, { ok: true, result: { revision: 'b'.repeat(64), bytesSaved: 9 } });
  assert.deepEqual(calls.slice(0, 2), [
    { kind: 'read', path: selectedPath },
    { kind: 'save', path: selectedPath, content: 'value=new', expectedRevision: 'a'.repeat(64) }
  ]);
  assert.equal((await controller.close(selectionId)).ok, true);
  assert.equal((await controller.save(selectionId, 'later', 'b'.repeat(64))).ok, false);
  const firstShutdown = controller.closeAll();
  const secondShutdown = controller.closeAll();
  assert.equal(calls.filter(call => (call as { readonly kind?: string }).kind === 'shutdown').length, 1);
  releaseShutdown();
  await Promise.all([firstShutdown, secondShutdown]);
  assert.deepEqual(calls.at(-1), { kind: 'shutdown' });
});

test('cancelled file selection does not invoke the file provider', async () => {
  let readCount = 0;
  const provider: LocalTextFileProvider = {
    async read() { readCount++; return source; }, async save() { throw new Error('unused'); }, async shutdown() {}
  };
  const controller = createLocalTextEditorController(provider, async () => undefined, () => selectionId);
  assert.equal((await controller.open()).ok, false);
  assert.equal(readCount, 0);
  await controller.closeAll();
});
