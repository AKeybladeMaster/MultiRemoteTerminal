import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalTerminalController } from '../../packages/application/src/local-terminals.ts';
import type { LocalTerminalEvent, LocalTerminalProvider } from '../../packages/application/src/local-terminals.ts';
import type { LocalTerminalLaunch, TerminalSize } from '../../packages/domain/src/local-terminal.ts';

const size: TerminalSize = { columns: 100, rows: 30 };
const sessionId = '5726a2ee-03cd-4f5a-a28c-bd72784f80a6';

class FakeTerminalProvider implements LocalTerminalProvider {
  readonly events: ((event: LocalTerminalEvent) => void)[] = [];
  readonly opened: string[] = [];
  readonly launches: LocalTerminalLaunch[] = [];
  readonly closed: string[] = [];
  openGate?: Promise<void>;
  writeGate?: Promise<void>;
  onOpen?: (id: string) => void;

  async open(id: string, launch: LocalTerminalLaunch): Promise<void> {
    this.opened.push(id);
    this.launches.push(launch);
    this.onOpen?.(id);
    await this.openGate;
  }
  async listWslDistributions() { return [{ name: 'Ubuntu' }]; }
  cancelWslDistributionDiscovery() {}
  async write(): Promise<void> { await this.writeGate; }
  async resize(): Promise<void> {}
  async acknowledgeOutput(): Promise<void> {}
  async close(id: string): Promise<void> { this.closed.push(id); }
  async shutdown(): Promise<void> {}
  subscribe(listener: (event: LocalTerminalEvent) => void): () => void {
    this.events.push(listener);
    return () => this.events.splice(this.events.indexOf(listener), 1);
  }
}

test('terminal lifecycle validates dimensions, bounds pending input and closes owned sessions', async () => {
  const provider = new FakeTerminalProvider();
  let releaseWrite!: () => void;
  provider.writeGate = new Promise<void>(resolve => { releaseWrite = resolve; });
  const controller = createLocalTerminalController(provider);

  const invalid = await controller.open(sessionId, { shell: 'powershell' }, { columns: 1, rows: 30 });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.error.code, 'INVALID_REQUEST');

  const opened = await controller.open(sessionId, { shell: 'powershell' }, size);
  assert.deepEqual(opened, { ok: true, result: { sessionId, shell: 'powershell', state: 'running' } });
  assert.deepEqual(provider.opened, [sessionId]);

  const pendingWrites = Array.from({ length: 4 }, () => controller.write(sessionId, 'x'.repeat(16_384)));
  const overflow = await controller.write(sessionId, 'x');
  assert.equal(overflow.ok, false);
  if (!overflow.ok) assert.equal(overflow.error.code, 'BUSY');
  releaseWrite();
  assert.ok((await Promise.all(pendingWrites)).every(reply => reply.ok));

  assert.equal((await controller.close('c1f3ace8-9464-449b-9459-a41b642dc2a7')).ok, false);
  assert.deepEqual(await controller.close(sessionId), { ok: true, result: {} });
  assert.deepEqual(provider.closed, [sessionId]);
  await controller.dispose();
});

test('terminal events received during open are delivered in order and returned state is current', async () => {
  const provider = new FakeTerminalProvider();
  const delivered: LocalTerminalEvent[] = [];
  provider.onOpen = id => provider.events[0]?.({ kind: 'exit', sessionId: id, exitCode: 0 });
  const controller = createLocalTerminalController(provider);
  controller.subscribe(event => delivered.push(event));

  assert.deepEqual(await controller.open(sessionId, { shell: 'cmd' }, size), {
    ok: true, result: { sessionId, shell: 'cmd', state: 'exited' }
  });
  assert.deepEqual(delivered, [{ kind: 'exit', sessionId, exitCode: 0 }]);
  await controller.dispose();
});

test('closing an opening terminal cancels the pending open and cleans up its provider session', async () => {
  const provider = new FakeTerminalProvider();
  let releaseOpen!: () => void;
  provider.openGate = new Promise<void>(resolve => { releaseOpen = resolve; });
  const controller = createLocalTerminalController(provider);

  const opening = controller.open(sessionId, { shell: 'powershell' }, size);
  assert.deepEqual(provider.opened, [sessionId]);
  assert.deepEqual(await controller.close(sessionId), { ok: true, result: {} });
  releaseOpen();

  const result = await opening;
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'CANCELLED');
  assert.ok(provider.closed.length >= 1);
  assert.ok(provider.closed.every(id => id === sessionId));
  await controller.dispose();
});

test('local terminal controller validates and returns an explicit WSL distribution launch', async () => {
  const provider = new FakeTerminalProvider();
  const controller = createLocalTerminalController(provider);
  assert.deepEqual(await controller.listWslDistributions(), { ok: true, result: [{ name: 'Ubuntu' }] });
  assert.deepEqual(await controller.open(sessionId, { shell: 'wsl', distribution: 'Ubuntu' }, size), {
    ok: true, result: { sessionId, shell: 'wsl', distribution: 'Ubuntu', state: 'running' }
  });
  assert.deepEqual(provider.launches, [{ shell: 'wsl', distribution: 'Ubuntu' }]);
  await controller.dispose();
});
