import type { CancellationSignal } from './cancellation.ts';
import type { X11ExtensionCapabilities } from '../../domain/src/x11.ts';

export interface SshX11Display {
  readonly display: number;
  readonly cookie: Uint8Array;
  readonly socatExecutable: string;
  readonly extensions?: X11ExtensionCapabilities;
}

export interface SshX11DisplayProvider {
  open(sessionId: string, cancellation?: CancellationSignal): Promise<SshX11Display>;
  close(sessionId: string): Promise<void>;
  closeAll(): Promise<void>;
}
