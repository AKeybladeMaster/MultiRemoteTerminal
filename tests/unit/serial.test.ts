import test from 'node:test';
import assert from 'node:assert/strict';
import { createSerialTerminalController } from '../../packages/application/src/serial-terminals.ts';
import type { LocalTerminalEvent } from '../../packages/application/src/local-terminals.ts';
import type { SerialConfiguration, SerialPortInfo } from '../../packages/domain/src/serial.ts';
import { canonicalizeSerialPortPath, normalizeSerialConfiguration, normalizeSerialPortList, serialConfigurationsEqual, serialWriteTimeoutMs } from '../../packages/domain/src/serial.ts';
import { isCommandReply, parseRequest } from '../../packages/contracts/src/commands.ts';

const sessionId = 'a540e2c4-402e-4a33-86fc-60aaea747672';
const configuration: SerialConfiguration = { path: 'COM19', baudRate: 115_200, dataBits: 8, parity: 'none', stopBits: 1, flowControl: 'none' };

test('serial configuration and device listing are canonical and bounded', () => {
  assert.equal(canonicalizeSerialPortPath('com7'), 'COM7');
  assert.equal(canonicalizeSerialPortPath('COM0'), undefined);
  assert.equal(canonicalizeSerialPortPath('COM4096'), undefined);
  assert.equal(canonicalizeSerialPortPath('\\\\.\\COM7'), undefined);
  assert.deepEqual(normalizeSerialConfiguration({ ...configuration, path: 'com19' }), configuration);
  assert.equal(serialConfigurationsEqual(configuration, { ...configuration }), true);
  assert.equal(serialConfigurationsEqual(configuration, { ...configuration, baudRate: 9_600 }), false);
  assert.equal(normalizeSerialConfiguration({ ...configuration, baudRate: 2_000_001 }), undefined);
  assert.equal(normalizeSerialConfiguration({ ...configuration, flowControl: 'software' }), undefined);
  assert.equal(normalizeSerialConfiguration({ ...configuration, credential: 'secret' }), undefined);
  assert.equal(serialWriteTimeoutMs(configuration, 1), 5_001);
  assert.equal(serialWriteTimeoutMs({ ...configuration, baudRate: 300 }, 1_024), 107_400);
  assert.equal(serialWriteTimeoutMs({ ...configuration, baudRate: 300 }, 2_048), 120_000);

  const devices: readonly SerialPortInfo[] = [{ path: 'COM19', manufacturer: 'USB serial adapter' }, { path: 'COM2' }];
  assert.deepEqual(normalizeSerialPortList(devices), [{ path: 'COM2' }, { path: 'COM19', manufacturer: 'USB serial adapter' }]);
  assert.equal(normalizeSerialPortList([{ path: 'COM2' }, { path: 'com2' }]), undefined);
  assert.equal(normalizeSerialPortList([{ path: 'COM2', manufacturer: 'adapter\nserial' }]), undefined);
});

test('serial command contracts reject extra fields and mismatched open replies', () => {
  const open = { command: 'serial.open', requestId: sessionId, contractVersion: 1, payload: { sessionId, configuration, columns: 80, rows: 24 } };
  const parsed = parseRequest(open);
  assert.equal(parsed.ok, true);
  assert.equal(parseRequest({ ...open, payload: { ...open.payload, path: 'COM1' } }).ok, false);
  assert.equal(parseRequest({ ...open, payload: { ...open.payload, credential: 'secret' } }).ok, false);
  if (parsed.ok) {
    assert.equal(isCommandReply({ requestId: sessionId, ok: true, result: { sessionId, configuration, state: 'running' } }, parsed.result), true);
    assert.equal(isCommandReply({ requestId: sessionId, ok: true, result: { sessionId, configuration: { ...configuration, path: 'COM2' }, state: 'running' } }, parsed.result), false);
    assert.equal(isCommandReply({ requestId: sessionId, ok: true, result: { sessionId, configuration, state: 'running', secret: 'x' } }, parsed.result), false);
  }
  const list = { command: 'serial.ports.list', requestId: sessionId, contractVersion: 1, payload: {} };
  const listParsed = parseRequest(list);
  assert.equal(listParsed.ok, true);
  if (listParsed.ok) {
    assert.equal(isCommandReply({ requestId: sessionId, ok: true, result: [{ path: 'COM1' }] }, listParsed.result), true);
    assert.equal(isCommandReply({ requestId: sessionId, ok: true, result: [{ path: 'COM1' }, { path: 'COM1' }] }, listParsed.result), false);
  }
});

test('serial terminal controller validates state, writes, events, acknowledgements, and close', async () => {
  let publish!: (event: LocalTerminalEvent) => void;
  const calls: string[] = [];
  const provider = {
    async listPorts() { return [{ path: 'com19' }]; },
    async open(id: string, config: SerialConfiguration) { calls.push(`open:${id}:${config.path}`); },
    async write(id: string, data: string) { calls.push(`write:${id}:${data}`); },
    async resize(id: string) { calls.push(`resize:${id}`); },
    async acknowledgeOutput(id: string, sequence: number) { calls.push(`ack:${id}:${sequence}`); },
    async close(id: string) { calls.push(`close:${id}`); },
    async shutdown() { calls.push('shutdown'); },
    subscribe(listener: (event: LocalTerminalEvent) => void) { publish = listener; return () => { publish = () => {}; }; }
  };
  const controller = createSerialTerminalController(provider);
  const listed = await controller.listPorts();
  assert.deepEqual(listed, { ok: true, result: [{ path: 'COM19' }] });
  const opened = await controller.open(sessionId, { ...configuration, path: 'com19' }, { columns: 80, rows: 24 });
  assert.deepEqual(opened, { ok: true, result: { sessionId, configuration, state: 'running' } });
  assert.equal((await controller.write(sessionId, 'hello')).ok, true);
  assert.equal((await controller.write(sessionId, 'x'.repeat(1_025))).ok, false);
  assert.equal((await controller.resize(sessionId, { columns: 120, rows: 40 })).ok, true);
  assert.equal((await controller.acknowledgeOutput(sessionId, 1)).ok, true);
  const events: LocalTerminalEvent[] = [];
  controller.subscribe(event => events.push(event));
  publish({ kind: 'data', sessionId, sequence: 1, data: 'device output' });
  publish({ kind: 'exit', sessionId, exitCode: 0 });
  assert.deepEqual(events.map(event => event.kind), ['data', 'exit']);
  assert.equal((await controller.close(sessionId)).ok, true);
  assert.deepEqual(calls, [`open:${sessionId}:COM19`, `write:${sessionId}:hello`, `resize:${sessionId}`, `ack:${sessionId}:1`, `close:${sessionId}`]);
  await controller.dispose();
});
