const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface TftpRootSelection {
  readonly selectionId: string;
  readonly folderName: string;
}

export type TftpServerStatus =
  | { readonly state: 'stopped' }
  | { readonly state: 'running'; readonly address: '127.0.0.1'; readonly port: number; readonly folderName: string };

export function isTftpPort(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 65_535;
}

export function isTftpRootSelection(value: unknown): value is TftpRootSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const selection = value as Record<string, unknown>;
  return Object.keys(selection).length === 2 && UUID.test(String(selection.selectionId ?? '')) &&
    typeof selection.folderName === 'string' && selection.folderName.length > 0 && selection.folderName.length <= 255 &&
    !/[\u0000-\u001f\u007f]/u.test(selection.folderName);
}

export function isTftpServerStatus(value: unknown): value is TftpServerStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const status = value as Record<string, unknown>;
  if (status.state === 'stopped') return Object.keys(status).length === 1;
  return status.state === 'running' && Object.keys(status).length === 4 && status.address === '127.0.0.1' &&
    isTftpPort(status.port) && status.port !== 0 && typeof status.folderName === 'string' &&
    status.folderName.length > 0 && status.folderName.length <= 255 && !/[\u0000-\u001f\u007f]/u.test(status.folderName);
}
