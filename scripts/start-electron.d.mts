import type { ChildProcess } from 'node:child_process';

export declare function createElectronEnvironment(source?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export declare function startElectron(): ChildProcess;
