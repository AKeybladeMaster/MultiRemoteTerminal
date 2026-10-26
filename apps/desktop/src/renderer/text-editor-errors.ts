type EditorKind = 'local' | 'remote';
type ErrorMessages = Readonly<Record<string, string>> & { readonly default: string };

const messages: Readonly<Record<EditorKind, ErrorMessages>> = {
  local: {
    CONFLICT: 'The local file changed since it was opened. Your draft is preserved; reload the latest version before saving again.',
    NOT_SUPPORTED: 'This is not a regular UTF-8 text file. It was not changed.',
    OUTPUT_LIMIT: 'This file exceeds the 512 KB editor limit.',
    NOT_FOUND: 'The selected file no longer exists. Open it again from its current location.',
    FORBIDDEN: 'Windows denied access to this file. Check the file permissions.',
    TIMEOUT: 'The local file operation timed out. Check the file before retrying.',
    CANCELLED: 'The local file operation was cancelled.',
    default: 'The local text file could not be saved or loaded.'
  },
  remote: {
    CONFLICT: 'The remote file changed since it was opened. Your draft is preserved; reload the latest version before saving again.',
    NOT_SUPPORTED: 'This file is not valid UTF-8 text. It was not changed.',
    OUTPUT_LIMIT: 'This file exceeds the 512 KB editor limit.',
    NOT_FOUND: 'The SFTP session or file no longer exists. Reconnect and refresh the folder.',
    FORBIDDEN: 'The server denied access. Check the file permissions.',
    TIMEOUT: 'The request timed out and may have reached the server. Reload the file to check its current contents before retrying.',
    CANCELLED: 'The request was cancelled.',
    default: 'The remote text file could not be saved or loaded. Check the SFTP connection and permissions.'
  }
};

export function textEditorErrorMessage(code: string, kind: EditorKind): string {
  return messages[kind][code] ?? messages[kind].default;
}
