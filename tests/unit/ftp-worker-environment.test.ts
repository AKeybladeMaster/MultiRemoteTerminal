import test from 'node:test';
import assert from 'node:assert/strict';
import { createFtpWorkerEnvironment } from '../../apps/desktop/src/main/ftp-worker-environment.ts';

test('FTP worker environment includes required Windows runtime variables and excludes unrelated parent secrets', () => {
  assert.deepEqual(createFtpWorkerEnvironment('installed-app', {
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

test('FTP worker environment omits absent Windows runtime variables', () => {
  assert.deepEqual(createFtpWorkerEnvironment('installed-app', { FTP_TOKEN: 'hidden' }), {
    MRT_APP_ROOT: 'installed-app'
  });
});
