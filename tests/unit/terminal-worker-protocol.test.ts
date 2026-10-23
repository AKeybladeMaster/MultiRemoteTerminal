import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTerminalWorkerMessage } from '../../apps/desktop/src/workers/protocol.ts';

const sessionId = '5726a2ee-03cd-4f5a-a28c-bd72784f80a6';

test('worker startup messages register only bounded session/process identifiers', () => {
  assert.deepEqual(parseTerminalWorkerMessage({ version: 1, type: 'started', sessionId, pid: 4820 }), {
    version: 1, type: 'started', sessionId, pid: 4820
  });
  for (const input of [
    { version: 1, type: 'started', sessionId, pid: 0 },
    { version: 1, type: 'started', sessionId, pid: 1.5 },
    { version: 1, type: 'started', sessionId: '../other-process', pid: 4820 },
    { version: 1, type: 'started', sessionId, pid: 4820, command: 'taskkill' }
  ]) assert.equal(parseTerminalWorkerMessage(input), undefined);
});
