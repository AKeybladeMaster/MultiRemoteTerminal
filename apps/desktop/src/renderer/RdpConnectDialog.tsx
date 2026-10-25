import type { ReactElement } from 'react';
import { ExternalViewerConnectDialog } from './ExternalViewerConnectDialog.tsx';
import type { ExternalViewerConnectDialogProps } from './ExternalViewerConnectDialog.tsx';

export type RdpConnectDialogProps = Omit<ExternalViewerConnectDialogProps, 'protocol'>;

export function RdpConnectDialog(props: RdpConnectDialogProps): ReactElement {
  return <ExternalViewerConnectDialog protocol="rdp" {...props} />;
}
