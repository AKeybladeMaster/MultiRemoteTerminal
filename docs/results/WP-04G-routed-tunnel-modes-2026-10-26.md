# WP-04G: Routed remote and dynamic tunnel acceptance

**Date:** 2026-10-26

**Branch:** `dev`

**Requirements:** F-006, F-011; P-22, P-24 and P-25 (partial)

## Delivered

Extended the existing Windows SSH gateway E2E fixture to verify remote-forward and dynamic SOCKS traffic through two saved SSH gateways. No production behavior changed in this slice.

The remote-forward case requests a loopback server bind with port `0`, reads the assigned port from tunnel status, sends a length-prefixed TCP frame through the remote listener, and compares the complete response through TCP EOF. After cleanup, the target fixture's raw byte count must equal the frame length exactly. Stop verifies unbind, gateway/client/socket cleanup, and that the remote listener refuses connections.

The dynamic case starts a two-hop route, negotiates unauthenticated SOCKS5, issues a domain-name `CONNECT` to `localhost`, compares the complete TCP response through EOF, and verifies the stopped local SOCKS listener refuses connections. Its target fixture also checks the exact raw request length after cleanup. Across the local, remote and dynamic routed starts, each target request's framed byte count is exact and the SSH target records no PTY, shell or SFTP request.

## Verification

Environment: Windows 11 Pro x64, build 26200; Node 24.14.1; pinned Electron 45.0.0.

| Command | Result |
|---|---|
| `corepack pnpm typecheck` | Passed |
| `corepack pnpm lint` | Passed; import-boundary checks passed |
| `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "SSH saved-profile jump routes verify every hop" --reporter=line` | Passed, 1/1 Windows Electron E2E, covering terminal/SFTP routes and all three routed tunnel modes |
| `git diff --check` | Passed after removing Markdown hard-break trailing spaces |

## Review

Independent review covered `83aec59c95f1bb3195174abb26006198dc913938...af8e6694d689454217ae402629cb95fafa96e1cd`.

- **Standards:** No documented violations or remaining possible Fowler smells.
- **Spec:** No findings or scope creep; the remaining interoperability and route-length limits stay partial.
- **Implementation:** No critical, important or minor issues; ready to merge.

## Remaining limits

The remote and dynamic tests use controlled loopback fixtures. They do not establish public-server interoperability, routes longer than two gateways, non-loopback consent, SOCKS5 UDP/BIND or authenticated SOCKS methods. F-006/F-011 and P-22/P-24/P-25 remain PARTIAL.
