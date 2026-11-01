export type PowerShellToolAction = 'install' | 'update' | 'remove';

export function isPowerShellToolAction(value: unknown): value is PowerShellToolAction {
  return value === 'install' || value === 'update' || value === 'remove';
}
