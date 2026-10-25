import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createSerialTransportProvider } from '../../apps/desktop/src/workers/serial-transport-provider.ts';
import type { LocalTerminalEvent } from '../../packages/application/src/local-terminals.ts';
import type { SerialConfiguration } from '../../packages/domain/src/serial.ts';

interface SerialMockBinding {
  reset(): void;
  createPort(path: string, options: { readonly echo: boolean; readonly record: boolean; readonly manufacturer: string; readonly readyData: Buffer }): void;
}

const requireFromDesktop = createRequire(new URL('../../apps/desktop/package.json', import.meta.url));
const { MockBinding } = requireFromDesktop('@serialport/binding-mock') as { readonly MockBinding: SerialMockBinding };
const binding = MockBinding as unknown as NonNullable<NonNullable<Parameters<typeof createSerialTransportProvider>[0]>['connectionBinding']>;
const sessionId = 'a540e2c4-402e-4a33-86fc-60aaea747672';
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

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(predicate(), true, 'serial provider did not publish the expected mock output');
}
