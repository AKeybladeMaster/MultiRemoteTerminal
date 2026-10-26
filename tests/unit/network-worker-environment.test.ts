import test from 'node:test';
import assert from 'node:assert/strict';
import { createNetworkWorkerEnvironment } from '../../apps/desktop/src/main/network-worker-environment.ts';

test('network worker environment includes required Windows runtime variables and excludes unrelated parent secrets', () => {
  assert.deepEqual(createNetworkWorkerEnvironment('installed-app', {
    SystemRoot: 'C:\\Windows',
    WINDIR: 'C:\\Windows',
    PATH: 'C:\\Windows\\System32',
    TEMP: 'C:\\Users\\Alice\\AppData\\Local\\Temp',
    TMP: 'C:\\Users\\Alice\\AppData\\Local\\Temp',
    FTP_TOKEN: 'must-not-cross-process-boundary',
    AWS_SECRET_ACCESS_KEY: 'must-not-cross-process-boundary'
  }), {
    MRT_APP_ROOT: 'installed-app',
    SystemRoot: 'C:\\Windows',
    WINDIR: 'C:\\Windows',
    PATH: 'C:\\Windows\\System32',
    TEMP: 'C:\\Users\\Alice\\AppData\\Local\\Temp',
    TMP: 'C:\\Users\\Alice\\AppData\\Local\\Temp'
  });
});

test('network worker environment omits absent Windows runtime variables', () => {
  assert.deepEqual(createNetworkWorkerEnvironment('installed-app', { FTP_TOKEN: 'hidden' }), {
    MRT_APP_ROOT: 'installed-app'
  });
});

test('network worker environment accepts only an explicitly supplied FTP test CA path', () => {
  assert.deepEqual(createNetworkWorkerEnvironment('installed-app', {
    NODE_EXTRA_CA_CERTS: 'must-not-cross-process-boundary',
    FTP_TOKEN: 'must-not-cross-process-boundary'
  }, 'tests/fixtures/ftps-test-cert.pem'), {
    MRT_APP_ROOT: 'installed-app',
    MRT_E2E_FTP_CA: 'tests/fixtures/ftps-test-cert.pem'
  });
});
