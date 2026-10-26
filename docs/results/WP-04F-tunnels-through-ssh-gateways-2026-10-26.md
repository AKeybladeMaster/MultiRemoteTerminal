# WP-04F: Saved tunnels through SSH gateways

**Date:** 2026-10-26
**Branch:** `dev`
**Requirements:** F-006, F-011; P-22 and P-23 (partial)

## Delivered

Saved local, remote and dynamic tunnel definitions can be explicitly started directly or through up to two saved SSH gateway profiles. The route is selected for each start and is not written to the saved tunnel definition. Renderer IPC contains profile IDs only; main resolves SSH endpoints and checks them against the saved tunnel's SSH target. The application controller repeats endpoint and route validation before opening the existing files-only SSH runtime.

The UI keeps direct start available and adds a labeled gateway route picker. It excludes the tunnel's SSH target and duplicate endpoint choices. The route opens in order, retains per-endpoint host verification and existing connection/forward cleanup, and does not request a PTY, shell or SFTP subsystem. Identical concurrent starts for one route share their startup; a different route for the same starting tunnel returns `BUSY`.

## Verification

Environment: Windows 11 Pro x64, build 26200; Node 24.14.1; pinned Electron 45.0.0.

| Command | Result |
|---|---|
| `corepack pnpm typecheck` | Passed |
| `corepack pnpm lint` | Passed; import-boundary checks passed |
| `corepack pnpm exec node --test tests/unit/contracts.test.ts tests/unit/bridge.test.ts tests/unit/broker.test.ts tests/unit/ssh-tunnels.test.ts` | Passed, 110/110 |
| `corepack pnpm build` | Passed; Vite reported the existing renderer chunk-size warning (964.01 kB) |
| `corepack pnpm setup:electron` | Passed |
| `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "SSH saved-profile jump routes verify every hop" --reporter=line` | Passed, 1/1 Windows Electron E2E |
| `git diff --check` | Passed |

The Windows E2E uses a dedicated two-gateway route with first-use trust prompts for both gateways and the target. It starts a saved local forward from the UI, verifies that the gateway relays reach the target in order, sends a TCP payload through the returned loopback port, compares the complete echoed byte buffer, and observes no PTY, shell or SFTP request at the tunnel target. After stopping, it waits for all three SSH fixture clients and forwarding sockets to close, then verifies the assigned local port refuses connections. Existing direct tunnel E2Es continue to cover the remote and SOCKS5 modes.

The E2E caught a renderer composition bug where the dialog's parent callback accepted only the tunnel ID and dropped the selected gateway IDs. The callback now forwards both values; the final two-gateway routed acceptance passed.

## Review

Final Standards and Spec reviews found no standards violation, scope creep or incorrect implementation. The independent implementation review initially identified E2E proof gaps for PTY/SFTP absence, complete bytes and cleanup; the follow-up closed those findings with assertions for PTY/shell/SFTP absence, exact response-buffer equality, all fixture clients and sockets closing, and listener release. Final implementation review found no critical, important or minor findings and marked the change ready to merge. Routed remote-forward and dynamic SOCKS roundtrips remain unverified and are recorded as open.

## Remaining limits

Routed remote-forward and dynamic SOCKS roundtrips are not independently exercised in Windows E2E. Routes remain limited to two gateways. Public SSH server interoperability and the broader F-006/F-011, Windows release smoke, signing and packaging gates remain open. Keep P-22, P-23, P-24, P-25, F-006 and F-011 partial.

Follow-up: WP-04G later adds Windows loopback acceptance for routed remote-forward and dynamic SOCKS TCP roundtrips; see [WP-04G results](WP-04G-routed-tunnel-modes-2026-10-26.md). That evidence does not cover public SSH server interoperability or routes longer than two gateways.
