# WP-04D SSH gateway routes — Windows evidence

**Date:** 2026-10-24
**Branch:** `dev-1`
**Requirements:** P-22 and F-011 (partial)
**Decision:** [ADR-0012](../adr/ADR-0012-wp04d-ssh-gateway-routes.md)

## Delivered behavior

- An action on a saved SSH target opens a route picker with up to two other
  saved SSH profiles. The choice applies to this connection only.
- Renderer IPC carries the selected profile IDs. Main resolves each ID from the
  catalog, rejects missing/non-SSH profiles and sends only canonical endpoint
  data to the SSH application controller.
- The Windows credential prompt runs separately for each gateway and the final
  destination, with the endpoint shown in context. Secrets are not stored in
  profile data or returned to the renderer.
- The utility worker authenticates the first gateway directly, opens later
  connections through the prior SSH client's `forwardOut` channel, verifies
  each endpoint's host key independently, and requests a shell only at the final
  destination. Per-hop channel setup is bounded to 15 seconds; total open is
  bounded by the existing 130-second deadline.
- Failure, close and worker shutdown dispose of all route channels and clients.

## Validation

`corepack pnpm check` passed on Windows x64 with Node 24.14.1 and Electron 45:

- TypeScript, ESLint, static import-boundary checks and `git diff --check`
  passed.
- All 230 unit tests passed, including broker ID resolution, route bounds,
  contextual credential prompts, per-endpoint trust order, nested transport
  channels and cleanup.
- The Windows native add-on and renderer builds passed. Vite reported the
  advisory that the 646.14 kB minified renderer bundle exceeds its 500 kB
  warning threshold.
- All 17 Electron E2E scenarios passed. The new loopback scenario selects a
  one-gateway and then a two-gateway route through saved profiles, approves the
  three independent first-use endpoint identities in route order, receives
  terminal output from the final destination, and confirms SSH client and relay
  cleanup.
- `corepack pnpm test:ssh-fixture` was invoked; the OpenSSH acceptance test was
  skipped because `MRT_TEST_SSH_HOST`, `PORT`, `USERNAME`, `PASSWORD` and
  `FINGERPRINT` were not configured.

## Limits

P-22/F-011 remains partial. Routes support saved SSH terminal targets through
at most two saved SSH gateway profiles. SFTP-only target routes, gateway-routed
forwarding definitions, longer chains, public-key/agent authentication and
public-server interoperability remain unverified or unsupported. Credential
copies remain in main/worker memory until the route open settles, then are
cleared; they are not persisted or logged.
