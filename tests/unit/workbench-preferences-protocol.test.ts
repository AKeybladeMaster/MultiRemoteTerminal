import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRequest } from '../../packages/contracts/src/commands.ts';
import { DEFAULT_WORKBENCH_PREFERENCES } from '../../packages/domain/src/workbench-preferences.ts';
import { parseStorageWorkerMessage, parseStorageWorkerRequest } from '../../apps/desktop/src/workers/storage-protocol.ts';

const requestId = '5726a2ee-03cd-4f5a-a28c-bd72784f80a6';

test('IPC accepts exact preference commands and validated Unicode values only', () => {
  const get = { command: 'preferences.get', requestId, contractVersion: 1, payload: {} };
  const save = { command: 'preferences.save', requestId, contractVersion: 1, payload: { preferences: { startupGreeting: 'Bonjour 👋' } } };
  assert.equal(parseRequest(get).ok, true);
  assert.equal(parseRequest(save).ok, true);
  assert.equal(parseRequest({ ...save, payload: { ...save.payload, startupGreeting: 'extra' } }).ok, false);
  assert.equal(parseRequest({ ...save, payload: { preferences: { startupGreeting: 'bad\u0000text' } } }).ok, false);
  assert.equal(parseRequest({ ...get, payload: { extra: true } }).ok, false);

  const exportTemplate = { command: 'preferences.template.export', requestId, contractVersion: 1, payload: { preferences: DEFAULT_WORKBENCH_PREFERENCES } };
  const importTemplate = { command: 'preferences.template.import', requestId, contractVersion: 1, payload: {} };
  assert.equal(parseRequest(exportTemplate).ok, true);
  assert.equal(parseRequest({ ...exportTemplate, payload: { ...exportTemplate.payload, password: 'no' } }).ok, false);
  assert.equal(parseRequest(importTemplate).ok, true);
});

test('storage worker validates preference requests and reply shape', () => {
  const envelope = { version: 1, type: 'request', requestId };
  assert.ok(parseStorageWorkerRequest({ ...envelope, command: 'preferences.get' }));
  assert.ok(parseStorageWorkerRequest({ ...envelope, command: 'preferences.save', preferences: { startupGreeting: 'Bonjour 👋' } }));
  assert.equal(parseStorageWorkerRequest({ ...envelope, command: 'preferences.save', preferences: { startupGreeting: 'safe', secret: 'hidden' } }), undefined);

  const message = { version: 1, type: 'reply', requestId, ok: true,
    result: { kind: 'preferences', value: { startupGreeting: 'Bonjour 👋' } } };
  assert.ok(parseStorageWorkerMessage(message));
  assert.equal(parseStorageWorkerMessage({ ...message, result: { kind: 'preferences', value: { startupGreeting: 'safe', password: 'hidden' } } }), undefined);

  const template = { ...envelope, command: 'preferences.template.export', path: 'C:\\tmp\\settings.json',
    temporaryPath: 'C:\\tmp\\.settings.json.5726a2ee-03cd-4f5a-a28c-bd72784f80a6.tmp', preferences: DEFAULT_WORKBENCH_PREFERENCES };
  assert.ok(parseStorageWorkerRequest(template));
  assert.ok(parseStorageWorkerRequest({ ...envelope, command: 'preferences.template.import', path: 'C:\\tmp\\settings.json' }));
  assert.equal(parseStorageWorkerRequest({ ...template, preferences: { ...DEFAULT_WORKBENCH_PREFERENCES, password: 'hidden' } }), undefined);
  assert.ok(parseStorageWorkerMessage({ ...message, result: { kind: 'preferencesTemplateExport', value: { bytesSaved: 128 } } }));
});

test('storage worker accepts only exact, credential-free remember-session definitions', () => {
  const envelope = { version: 1, type: 'request', requestId };
  const request = { ...envelope, command: 'session.remember', draft: { kind: 'ssh', name: 'Build host', host: 'build.example.com', port: 22 } };
  assert.ok(parseStorageWorkerRequest(request));
  assert.equal(parseStorageWorkerRequest({ ...request, draft: { ...request.draft, password: 'never-store' } }), undefined);
});
