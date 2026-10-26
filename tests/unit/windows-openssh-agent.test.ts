import test from 'node:test';
import assert from 'node:assert/strict';
import { isWindowsOpenSshAgentPipePath, WINDOWS_OPENSSH_AGENT_PIPE_PATH } from '../../apps/desktop/src/adapters/windows-openssh-agent.ts';

test('Windows OpenSSH agent endpoint accepts only bounded local named pipes', () => {
  assert.equal(WINDOWS_OPENSSH_AGENT_PIPE_PATH, String.raw`\\.\pipe\openssh-ssh-agent`);
  assert.equal(isWindowsOpenSshAgentPipePath(WINDOWS_OPENSSH_AGENT_PIPE_PATH), true);
  assert.equal(isWindowsOpenSshAgentPipePath(String.raw`\\.\pipe\mrt-agent_test-1`), true);
  for (const value of [
    undefined, '', String.raw`C:\agent.sock`, 'tcp://127.0.0.1:2200', String.raw`\\remote\pipe\agent`,
    String.raw`\\.\pipe\bad name`, String.raw`\\.\pipe\bad\nested`, String.raw`\\.\pipe\${'a'.repeat(129)}`
  ]) assert.equal(isWindowsOpenSshAgentPipePath(value), false, String(value));
});
