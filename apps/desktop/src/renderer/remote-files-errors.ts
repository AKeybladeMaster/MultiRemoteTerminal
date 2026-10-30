export function transferFailureMessage(code: string, transport: 'sftp' | 'ftp', direction: 'upload' | 'download', droppedFile = false): string {
  if (code === 'TIMEOUT' && direction === 'upload') {
    return `${transport.toUpperCase()} upload timed out. The server may retain an incomplete or complete file; reconnect and inspect the remote folder before removing anything.`;
  }
  if (code === 'NOT_FOUND' && direction === 'upload') {
    return droppedFile ? 'The dropped local file is no longer available. Drop it again.' : 'The selected local file is no longer available. Choose it again.';
  }
  if (code === 'NOT_FOUND' && transport === 'sftp') return 'The remote file is no longer available. Refresh the folder and try again.';
  if (code === 'UNAVAILABLE' && transport === 'ftp' && direction === 'upload') {
    return 'FTP upload failed. Reconnect and inspect the remote folder for upload or backup files before removing anything.';
  }
  if (code === 'CONFLICT') return 'The selected file or destination changed during transfer. Review it and try again.';
  if (code === 'FORBIDDEN') return 'The local file or remote destination denied access.';
  return 'The file transfer failed. Check the connection and server permissions.';
}
