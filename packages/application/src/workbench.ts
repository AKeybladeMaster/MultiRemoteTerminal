// The composition root supplies facts; application code has no OS or Electron imports.
export interface AppFacts {
  readonly version: string;
  readonly platform: string;
}

export interface WorkbenchSnapshot {
  readonly name: 'MultiRemoteTerminal';
  readonly version: string;
  readonly platform: string;
  readonly stage: 'foundation';
}

export function describeWorkbench(facts: AppFacts): WorkbenchSnapshot {
  return { name: 'MultiRemoteTerminal', version: facts.version, platform: facts.platform, stage: 'foundation' };
}
