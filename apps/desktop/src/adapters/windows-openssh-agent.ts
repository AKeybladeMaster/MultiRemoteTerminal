export const WINDOWS_OPENSSH_AGENT_PIPE_PATH = String.raw`\\.\pipe\openssh-ssh-agent`;

const WINDOWS_NAMED_PIPE_PATH = /^\\\\\.\\pipe\\[A-Za-z0-9._-]{1,128}$/u;

export function isWindowsOpenSshAgentPipePath(value: unknown): value is string {
  return typeof value === 'string' && WINDOWS_NAMED_PIPE_PATH.test(value);
}
