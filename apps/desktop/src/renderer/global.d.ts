import type { DesktopBridge } from '../../../../packages/contracts/src/commands.ts';

declare global {
  interface Window { readonly multiRemoteTerminal: DesktopBridge; }
}
