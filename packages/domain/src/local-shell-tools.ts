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
  Object.freeze({ shell: 'bash', label: 'Bash', commandLabel: 'New Bash terminal', description: 'Requires Git for Windows. MultiRemoteTerminal does not install or bundle it.' })
]);

export const DEFAULT_VISIBLE_LOCAL_SHELLS: readonly LocalShell[] = Object.freeze(
  LOCAL_SHELL_TOOL_REGISTRY.map(tool => tool.shell)
);

export function normalizeVisibleLocalShells(value: unknown): readonly LocalShell[] | undefined {
  if (!Array.isArray(value) || value.length > LOCAL_SHELL_TOOL_REGISTRY.length) return undefined;
  const selected = new Set<LocalShell>();
  for (const candidate of value) {
    if (!isLocalShell(candidate) || selected.has(candidate)) return undefined;
    selected.add(candidate);
  }
  return Object.freeze(LOCAL_SHELL_TOOL_REGISTRY.filter(tool => selected.has(tool.shell)).map(tool => tool.shell));
}
