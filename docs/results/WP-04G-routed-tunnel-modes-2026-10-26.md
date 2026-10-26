# WP-04G: Routed remote and dynamic tunnel acceptance

**Date:** 2026-10-26  
**Branch:** `dev`  
**Requirements:** F-006, F-011; P-22, P-24 and P-25 (partial)

## Delivered

Extended the existing Windows SSH gateway E2E fixture to verify remote-forward and dynamic SOCKS traffic through two saved SSH gateways. No production behavior changed in this slice.

The remote-forward case requests a loopback server bind with port `0`, reads the assigned port from tunnel status, sends TCP data through the remote listener and compares the full response bytes. Stop verifies unbind, gateway/client/socket cleanup, and that the remote listener refuses connections.

The dynamic case starts a two-hop route, negotiates unauthenticated SOCKS5, issues a domain-name `CONNECT` to `localhost`, compares the complete TCP response bytes and verifies the stopped local SOCKS listener refuses connections. Across the local, remote and dynamic routed starts, the tunnel target fixture records no PTY, shell or SFTP request.

## Verification

Environment: Windows 11 Pro x64, build 26200; Node 24.14.1; pinned Electron 45.0.0.

| Command | Result |
|---|---|
| `corepack pnpm typecheck` | Passed |
| `corepack pnpm lint` | Passed; import-boundary checks passed |
| `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "SSH saved-profile jump routes verify every hop" --reporter=line` | Passed, 1/1 Windows Electron E2E, covering terminal/SFTP routes and all three routed tunnel modes |
| `git diff --check` | Passed |

## Review

Independent Standards, Spec and implementation reviews are pending for this phase.

## Remaining limits

The remote and dynamic tests use controlled loopback fixtures. They do not establish public-server interoperability, routes longer than two gateways, non-loopback consent, SOCKS5 UDP/BIND or authenticated SOCKS methods. F-006/F-011 and P-22/P-24/P-25 remain PARTIAL.
