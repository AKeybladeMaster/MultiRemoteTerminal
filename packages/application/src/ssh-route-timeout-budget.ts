import { MAX_SSH_GATEWAY_HOPS } from '../../domain/src/ssh-route.ts';

// Leaves five seconds after the worker's 125-second host-key decision deadline.
export const SSH_ROUTE_CONNECTION_TIMEOUT_MS = 130_000;
export const SSH_ROUTE_CHANNEL_TIMEOUT_MS = 15_000;
const ROUTE_FINAL_SETUP_MARGIN_MS = 20_000;
const ROUTE_WORKER_REPLY_MARGIN_MS = 10_000;

function boundedGatewayCount(gatewayCount: number): number {
  return Number.isSafeInteger(gatewayCount) && gatewayCount > 0
    ? Math.min(gatewayCount, MAX_SSH_GATEWAY_HOPS)
    : 0;
}

export function sshRoutedOpenProviderTimeoutMs(gatewayCount: number): number {
  const gateways = boundedGatewayCount(gatewayCount);
  return (gateways + 1) * SSH_ROUTE_CONNECTION_TIMEOUT_MS + gateways * SSH_ROUTE_CHANNEL_TIMEOUT_MS + ROUTE_FINAL_SETUP_MARGIN_MS;
}

export function sshRoutedOpenWorkerTimeoutMs(gatewayCount: number): number {
  return sshRoutedOpenProviderTimeoutMs(gatewayCount) + ROUTE_WORKER_REPLY_MARGIN_MS;
}

export function sshRoutedOpenPreloadTimeoutMs(gatewayCount: number, credentialPromptTimeoutMs: number, ipcMarginMs: number): number {
  const prompts = boundedGatewayCount(gatewayCount) + 1;
  return prompts * credentialPromptTimeoutMs + sshRoutedOpenWorkerTimeoutMs(gatewayCount) + ipcMarginMs;
}
