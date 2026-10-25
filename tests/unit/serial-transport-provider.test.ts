import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createSerialTransportProvider } from '../../apps/desktop/src/workers/serial-transport-provider.ts';
import { createSerialTerminalController } from '../../packages/application/src/serial-terminals.ts';
import type { LocalTerminalEvent } from '../../packages/application/src/local-terminals.ts';
import type { SerialConfiguration } from '../../packages/domain/src/serial.ts';

interface SerialMockBinding {
  reset(): void;
  createPort(path: string, options: { readonly echo: boolean; readonly record: boolean; readonly manufacturer: string; readonly readyData: Buffer }): void;
  list(): Promise<readonly unknown[]>;
  open(options: unknown): Promise<unknown>;
}

interface ClosableMockPort {
  close(): Promise<void>;
  emitData(data: Buffer | string): void;
  read(buffer: Buffer, offset: number, length: number): Promise<{ readonly buffer: Buffer; readonly bytesRead: number }>;
}

const requireFromDesktop = createRequire(new URL('../../apps/desktop/package.json', import.meta.url));
const { MockBinding } = requireFromDesktop('@serialport/binding-mock') as { readonly MockBinding: SerialMockBinding };
const binding = MockBinding as unknown as NonNullable<NonNullable<Parameters<typeof createSerialTransportProvider>[0]>['connectionBinding']>;
const sessionId = 'a540e2c4-402e-4a33-86fc-60aaea747672';
const reconnectedSessionId = 'b650e2c4-402e-4a33-86fc-60aaea747672';
const configuration: SerialConfiguration = { path: 'COM4095', baudRate: 9_600, dataBits: 8, parity: 'none', stopBits: 1, flowControl: 'none' };

test('serial provider lists, opens, reads, writes, acknowledges, and closes a mock port', async () => {
  MockBinding.reset();
  MockBinding.createPort('COM4095', { echo: true, record: true, manufacturer: 'MRT mock device', readyData: Buffer.from('MRT serial ready\r\n') });
  const provider = createSerialTransportProvider({ connectionBinding: binding, listBindings: [binding] });
  const events: LocalTerminalEvent[] = [];
  const unsubscribe = provider.subscribe(event => events.push(event));
  assert.deepEqual(await provider.listPorts(), [{ path: 'COM4095', manufacturer: 'MRT mock device' }]);

  await provider.open(sessionId, configuration);
  await waitFor(() => events.some(event => event.kind === 'data' && event.data.includes('MRT serial ready')));
  await provider.write(sessionId, 'MRT serial input');
  await waitFor(() => events.some(event => event.kind === 'data' && event.data.includes('MRT serial input')));
  const outputEvents = events.filter((event): event is Extract<LocalTerminalEvent, { kind: 'data' }> => event.kind === 'data');
  assert.deepEqual(outputEvents.map(event => event.sequence), outputEvents.map((_event, index) => index + 1));
  await provider.acknowledgeOutput(sessionId, outputEvents.at(-1)?.sequence ?? 1);
  await provider.close(sessionId);
  unsubscribe();
  await provider.shutdown();
});

test('serial disconnect fails the active session and permits a later explicit reconnect', async () => {
  MockBinding.reset();
  MockBinding.createPort('COM4095', { echo: true, record: true, manufacturer: 'MRT mock device', readyData: Buffer.from('MRT serial ready\r\n') });
  let openPort: ClosableMockPort | undefined;
  let simulateDisconnect = false;
  const disconnectableBinding = {
    list: () => MockBinding.list(),
    open: async (options: unknown) => {
      const opened = await MockBinding.open(options);
      const mockPort = opened as ClosableMockPort;
      const originalRead = mockPort.read.bind(mockPort);
      mockPort.read = (...readArgs) => simulateDisconnect ? Promise.reject(new Error('Device disconnected')) : originalRead(...readArgs);
      openPort = mockPort;
      return opened;
    }
  } as unknown as typeof binding;
  const provider = createSerialTransportProvider({ connectionBinding: disconnectableBinding, listBindings: [binding] });
  const controller = createSerialTerminalController(provider);
  const providerEvents: LocalTerminalEvent[] = [];
  const events: LocalTerminalEvent[] = [];
  const unsubscribeProvider = provider.subscribe(event => providerEvents.push(event));
  controller.subscribe(event => events.push(event));

  try {
    const opened = await controller.open(sessionId, configuration, { columns: 80, rows: 24 });
    assert.equal(opened.ok, true);
    assert.ok(openPort);
    simulateDisconnect = true;
    openPort.emitData(Buffer.alloc(0));
    await waitFor(() => providerEvents.some(event => event.kind === 'failure'),
      `Expected provider failure; provider events=${JSON.stringify(providerEvents)}; controller events=${JSON.stringify(events)}`);
    const failure = events.find((event): event is Extract<LocalTerminalEvent, { kind: 'failure' }> => event.kind === 'failure');
    assert.deepEqual(failure && { sessionId: failure.sessionId, code: failure.error.code, retryable: failure.error.retryable }, {
      sessionId, code: 'UNAVAILABLE', retryable: true
    });
    assert.deepEqual(await controller.write(sessionId, 'must not be written'), {
      ok: false, error: { code: 'NOT_FOUND', target: 'terminal', retryable: false }
    });
    assert.equal((await controller.close(sessionId)).ok, true);

    MockBinding.reset();
    MockBinding.createPort('COM4095', { echo: true, record: true, manufacturer: 'MRT mock device', readyData: Buffer.from('MRT serial reconnected\r\n') });
    const reconnected = await controller.open(reconnectedSessionId, configuration, { columns: 80, rows: 24 });
    assert.equal(reconnected.ok, true);
    assert.equal(reconnected.ok && reconnected.result.state, 'running');
    assert.equal((await controller.close(reconnectedSessionId)).ok, true);
  } finally {
    unsubscribeProvider();
    await controller.dispose();
  }
});

async function waitFor(predicate: () => boolean, message = 'serial provider did not publish the expected mock output'): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(predicate(), true, message);
}
