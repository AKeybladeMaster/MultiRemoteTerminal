import { createUtilityWorkerEnvironment } from '../adapters/utility-worker-environment.ts';

export function createNetworkWorkerEnvironment(
  appRoot: string,
  parentEnvironment: Readonly<Record<string, string | undefined>>,
  testExtraCaPath?: string,
  opensshAgentPipePath?: string
): NodeJS.ProcessEnv {
  const environment = createUtilityWorkerEnvironment(appRoot, parentEnvironment);
  if (testExtraCaPath !== undefined) environment.MRT_E2E_FTP_CA = testExtraCaPath;
  if (opensshAgentPipePath !== undefined) environment.MRT_OPENSSH_AGENT_PIPE = opensshAgentPipePath;
  return environment;
}
