import assert from 'node:assert/strict';
import test from 'node:test';
import { createElectronEnvironment } from '../../scripts/start-electron.mjs';

test('Electron child environment clears Node-mode override and preserves other variables', () => {
  const source = { ELECTRON_RUN_AS_NODE: '1', PATH: 'C:\\Windows\\System32', CUSTOM_VALUE: 'kept' };
  const result = createElectronEnvironment(source);

  assert.equal(result.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(result.PATH, source.PATH);
  assert.equal(result.CUSTOM_VALUE, source.CUSTOM_VALUE);
  assert.equal(source.ELECTRON_RUN_AS_NODE, '1');
});
