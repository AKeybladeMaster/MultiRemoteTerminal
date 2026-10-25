import { canonicalizeRemoteEndpoint } from './remote-endpoint.ts';

export interface VncEndpoint {
  readonly host: string;
  readonly port: number;
}

export function canonicalizeVncEndpoint(value: unknown): VncEndpoint | undefined {
  return canonicalizeRemoteEndpoint(value);
}

export function formatVncTarget(endpoint: VncEndpoint): string {
  const host = endpoint.host.includes(':') ? `[${endpoint.host}]` : endpoint.host;
  return `${host}::${endpoint.port}`;
}
