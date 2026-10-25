import type { ReactElement } from 'react';
import { ExternalViewerConnectDialog } from './ExternalViewerConnectDialog.tsx';
import type { ExternalViewerConnectDialogProps } from './ExternalViewerConnectDialog.tsx';

export type VncConnectDialogProps = Omit<ExternalViewerConnectDialogProps, 'protocol'>;

export function VncConnectDialog(props: VncConnectDialogProps): ReactElement {
  return <ExternalViewerConnectDialog protocol="vnc" {...props} />;
}
