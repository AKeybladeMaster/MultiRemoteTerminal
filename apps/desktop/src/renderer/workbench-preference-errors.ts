export function workbenchPreferenceFailureMessage(operation: 'load' | 'save', code: string | undefined): string {
  const retryAction = operation === 'load' ? 'loading settings' : 'saving the greeting';
  switch (code) {
    case 'BUSY': return `The local settings store is busy. Wait a moment, then retry ${retryAction}.`;
    case 'TIMEOUT': return `The local settings store did not respond in time. Try ${retryAction} again.`;
    case 'UNAVAILABLE': return `The local settings store is unavailable. Restart the app, then retry ${retryAction}.`;
    case 'CORRUPT': return 'Saved settings could not be read. Restart the app; if this continues, the local profile may need repair.';
    case 'CONFLICT': return 'Settings changed while this operation was in progress. Reload the value, then try again.';
    default: return `Workbench settings could not be ${operation === 'load' ? 'loaded' : 'saved'}. Try again.`;
  }
}
