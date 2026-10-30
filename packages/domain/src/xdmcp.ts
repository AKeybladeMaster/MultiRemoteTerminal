import { canonicalizeRemoteEndpoint } from './remote-endpoint.ts';

export function canonicalizeXdmcpHost(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return canonicalizeRemoteEndpoint({ host: value, port: 177 })?.host;
}
