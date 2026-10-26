import { canonicalizeSshHostEndpoint, hostEndpointKey } from './host-trust.ts';
import type { SshHostEndpoint } from './host-trust.ts';

export const MAX_SSH_GATEWAY_HOPS = 3;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isSshGatewayProfileIds(value: unknown): value is readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_SSH_GATEWAY_HOPS) return false;
  const ids = new Set<string>();
  for (const id of value) {
    if (typeof id !== 'string' || !UUID.test(id) || ids.has(id.toLowerCase())) return false;
    ids.add(id.toLowerCase());
  }
  return true;
}

export function normalizeSshGatewayRoute(value: unknown, target: SshHostEndpoint): readonly SshHostEndpoint[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_SSH_GATEWAY_HOPS) return undefined;
  const visited = new Set([hostEndpointKey(target)]);
  const route: SshHostEndpoint[] = [];
  for (const candidate of value) {
    const endpoint = canonicalizeSshHostEndpoint(candidate);
    if (!endpoint) return undefined;
    const key = hostEndpointKey(endpoint);
    if (visited.has(key)) return undefined;
    visited.add(key);
    route.push(endpoint);
  }
  return route;
}
