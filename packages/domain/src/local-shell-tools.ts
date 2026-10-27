import { isLocalShell } from './local-terminal.ts';
import type { LocalShell } from './local-terminal.ts';

export interface LocalShellToolDefinition {
  readonly shell: LocalShell;
  readonly label: string;
  readonly commandLabel: string;
  readonly description: string;
}

/** Fixed set of shell launch actions supported by the application. This is not an executable-path registry. */
export const LOCAL_SHELL_TOOL_REGISTRY: readonly LocalShellToolDefinition[] = Object.freeze([
  Object.freeze({ shell: 'powershell', label: 'PowerShell', commandLabel: 'New PowerShell terminal', description: 'Windows PowerShell is provided by Windows.' }),
  Object.freeze({ shell: 'cmd', label: 'Command Prompt (cmd)', commandLabel: 'New cmd terminal', description: 'Command Prompt is provided by Windows.' }),
  Object.freeze({ shell: 'bash', label: 'Bash', commandLabel: 'New Bash terminal', description: 'Requires Git for Windows. MultiRemoteTerminal does not install or bundle it.' }),
  Object.freeze({ shell: 'wsl', label: 'WSL distribution', commandLabel: 'New WSL terminal', description: 'Choose an installed Windows Subsystem for Linux distribution.' })
]);

export const DEFAULT_VISIBLE_LOCAL_SHELLS: readonly LocalShell[] = Object.freeze(
  LOCAL_SHELL_TOOL_REGISTRY.map(tool => tool.shell)
);

/** New local sessions are enabled by default; this policy is separate from palette visibility. */
export const DEFAULT_ENABLED_LOCAL_SHELLS: readonly LocalShell[] = DEFAULT_VISIBLE_LOCAL_SHELLS;

export function normalizeVisibleLocalShells(value: unknown, allowWsl = true): readonly LocalShell[] | undefined {
  const acceptedLength = allowWsl ? LOCAL_SHELL_TOOL_REGISTRY.length : LOCAL_SHELL_TOOL_REGISTRY.length - 1;
  if (!Array.isArray(value) || value.length > acceptedLength) return undefined;
  const selected = new Set<LocalShell>();
  for (const candidate of value) {
    if (!isLocalShell(candidate) || (!allowWsl && candidate === 'wsl') || selected.has(candidate)) return undefined;
    selected.add(candidate);
  }
  return Object.freeze(LOCAL_SHELL_TOOL_REGISTRY.filter(tool => selected.has(tool.shell)).map(tool => tool.shell));
}

export function normalizeEnabledLocalShells(value: unknown): readonly LocalShell[] | undefined {
  return normalizeVisibleLocalShells(value);
}
