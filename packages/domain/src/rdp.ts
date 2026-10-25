import { canonicalizeRemoteEndpoint } from './remote-endpoint.ts';

export interface RdpEndpoint {
  readonly host: string;
  readonly port: number;
}

export function canonicalizeRdpEndpoint(value: unknown): RdpEndpoint | undefined {
  return canonicalizeRemoteEndpoint(value);
}

export function formatRdpTarget(endpoint: RdpEndpoint): string {
  const host = endpoint.host.includes(':') ? `[${endpoint.host}]` : endpoint.host;
  return `${host}:${endpoint.port}`;
}
