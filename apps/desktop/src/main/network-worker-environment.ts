const windowsRuntimeVariables = ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP'] as const;

export function createNetworkWorkerEnvironment(
  appRoot: string,
  parentEnvironment: Readonly<Record<string, string | undefined>>
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { MRT_APP_ROOT: appRoot };
  for (const name of windowsRuntimeVariables) {
    const value = parentEnvironment[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}
