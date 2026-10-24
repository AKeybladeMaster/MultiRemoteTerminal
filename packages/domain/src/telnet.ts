import { canonicalizeRemoteEndpoint } from './remote-endpoint.ts';
import type { RemoteEndpoint } from './remote-endpoint.ts';

export type TelnetEndpoint = RemoteEndpoint;

export const canonicalizeTelnetEndpoint = canonicalizeRemoteEndpoint;
