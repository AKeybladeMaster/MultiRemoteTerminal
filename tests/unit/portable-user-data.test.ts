import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePortableUserDataDirectory } from '../../apps/desktop/src/main/portable-user-data.ts';

test('portable user data is stored beside the selected portable executable', () => {
  assert.equal(resolvePortableUserDataDirectory(true, {
    PORTABLE_EXECUTABLE_DIR: 'E:\\Tools\\MRT',
    PORTABLE_EXECUTABLE_FILE: 'E:\\Tools\\MRT\\MultiRemoteTerminal.exe'
  }), 'E:\\Tools\\MRT\\MultiRemoteTerminal-data');
});

test('installed and development launches retain Electron profile defaults', () => {
  const environment = {
    PORTABLE_EXECUTABLE_DIR: 'E:\\Tools\\MRT',
    PORTABLE_EXECUTABLE_FILE: 'E:\\Tools\\MRT\\MultiRemoteTerminal.exe'
  };
  assert.equal(resolvePortableUserDataDirectory(false, environment), undefined);
  assert.equal(resolvePortableUserDataDirectory(true, {}), undefined);
});

test('a malformed portable launch environment fails closed', () => {
  assert.throws(() => resolvePortableUserDataDirectory(true, {
    PORTABLE_EXECUTABLE_DIR: 'E:\\Tools\\MRT',
    PORTABLE_EXECUTABLE_FILE: 'E:\\Other\\MultiRemoteTerminal.exe'
  }), /does not match/);
  assert.throws(() => resolvePortableUserDataDirectory(true, {
    PORTABLE_EXECUTABLE_DIR: 'relative',
    PORTABLE_EXECUTABLE_FILE: 'E:\\Tools\\MultiRemoteTerminal.exe'
  }), /valid absolute paths/);
});
