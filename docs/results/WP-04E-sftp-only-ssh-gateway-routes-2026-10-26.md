# WP-04E: SFTP-only targets through SSH gateways

**Date:** 2026-10-26

**Status:** Verified slice; P-22/F-011 remain PARTIAL

**Requirements:** P-22, F-011; related no-shell SFTP behavior in P-11/F-005

## Delivered

Saved SFTP-only profiles now offer the same connection-specific route selection
as saved SSH terminal profiles, with up to two saved SSH gateways. The renderer
sends gateway profile IDs through the typed bridge. The main broker resolves
only saved SSH profiles and validates the route before authentication. The SSH
controller and worker pass through the existing ordered credential and
host-trust flows, then request the destination's SFTP subsystem without a PTY
or shell. The route is not saved with the target, exported in folder bundles or
auto-saved as a new profile.

Gateway credential objects are copied for worker handoff and cleared in both
main and worker process paths. Existing bounded channel-open and full-open
deadlines and worker-owned cleanup apply to the complete route.

## Validation

Validated on Microsoft Windows 11 Pro x64 (build 26200):

- `corepack pnpm typecheck` — passed.
- `corepack pnpm lint` — passed, including import-boundary checks.
- Focused contract, broker, SSH controller, worker protocol, worker host and
  transport tests — 114 passed, 0 failed.
- `corepack pnpm build` — passed, including the pinned Electron native module
  build. Vite reported the existing advisory that the renderer bundle exceeds
  500 kB; the generated JavaScript chunk was 961.82 kB.
- `corepack pnpm setup:electron` — passed.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep
  "SSH saved-profile jump routes verify every hop and clean up one- and
  two-gateway chains"` — passed (1/1). The Windows Electron test verifies the
  existing one- and two-gateway terminal routes and adds a two-gateway
  SFTP-only route, trust for the new SFTP endpoint, remote file listing, no
  shell request and cleanup of all SSH clients and relay sockets.
- `git diff --check` — passed.

## Limits

The loopback fixture uses the pinned `ssh2` implementation on both ends. This
does not establish interoperability with public SSH servers or the Windows
OpenSSH client/server. Gateway-routed tunnel definitions, chains longer than
two gateways, and private-key or agent authentication through a gateway chain
remain unverified. These limits keep P-22/F-011 PARTIAL.

See [ADR-0032](../adr/ADR-0032-sftp-only-ssh-gateway-routes.md), [WP-04D
evidence](WP-04D-ssh-gateway-routes-2026-10-24.md), and the
[feature matrix](../FEATURE-MATRIX.md).

## Independent review

Reviewed against `origin/main...ea8ed8e` (the WP-04E implementation and cleanup
follow-up commits). Standards review passed with no documented violations or
remaining actionable smells. The first review's duplicated credential-cleanup
note was resolved by shared per-process copy/clear helpers. Spec review passed:
the saved SFTP route, no-shell guarantee and Windows E2E match the requirement;
P-22/F-011 remain partial for the limits listed above.
