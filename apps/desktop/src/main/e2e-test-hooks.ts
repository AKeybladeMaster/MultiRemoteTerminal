export function isE2ETestHookEnabled(
  flag: string,
  isPackaged: boolean,
  environment: Readonly<Record<string, string | undefined>>,
  argumentsList: readonly string[]
): boolean {
  return !isPackaged && environment.MRT_E2E === '1' && argumentsList.includes(flag);
}
