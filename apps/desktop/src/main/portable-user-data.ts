import { win32 } from 'node:path';

export const PORTABLE_DATA_DIRECTORY_NAME = 'MultiRemoteTerminal-data';

export function resolvePortableUserDataDirectory(isPackaged: boolean, environment: Readonly<NodeJS.ProcessEnv>): string | undefined {
  const executableDirectory = environment.PORTABLE_EXECUTABLE_DIR;
  const executableFile = environment.PORTABLE_EXECUTABLE_FILE;
  if (!isPackaged || (executableDirectory === undefined && executableFile === undefined)) return undefined;
  if (!executableDirectory || !executableFile || !win32.isAbsolute(executableDirectory) || !win32.isAbsolute(executableFile)) {
    throw new Error('Portable launcher did not provide valid absolute paths');
  }

  const resolvedDirectory = win32.resolve(executableDirectory);
  const resolvedLauncherDirectory = win32.dirname(win32.resolve(executableFile));
  if (resolvedDirectory.toLowerCase() !== resolvedLauncherDirectory.toLowerCase()) {
    throw new Error('Portable launcher directory does not match its executable path');
  }
  return win32.join(resolvedDirectory, PORTABLE_DATA_DIRECTORY_NAME);
}
