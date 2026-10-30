# WP-02D — Security policy settings (partial)

**Requirements:** P-42; N-002, N-006
**Date:** 2026-10-29
**Status:** Partial; security release acceptance remains open.

## Change

Workbench Settings now has an accessible Security policy group describing explicit SSH fingerprint approval, changed-key blocking and recovery, loopback-only local/SOCKS tunnel binds, and the remote-forwarding `GatewayPorts` caveat. The existing credential-vault section remains nearby and exposes its current protection mode, lock state, and lock/mode controls. These policies are informational in Settings; the view adds no state, IPC command, trust bypass, or alternate bind option.

## Verification

- `corepack pnpm check` — passed on Windows x64 with Node 24.14.1 and pnpm 12.15.0: typecheck, lint/import boundaries, 578 unit tests, and 69 Windows E2E tests passed; five package-only tests were skipped by this general command.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep 'security settings explain SSH host verification'` — passed 1/1. The E2E checks the policy copy, accessible region, vault protection/status, and lock/mode controls.
- `corepack pnpm package:win:smoke` — passed 5/5 against freshly rebuilt Windows x64 packages: Electron fuses/ASAR integrity, SBOM/hash metadata, NSIS offline/200%-scale launch and uninstall, portable terminal/profile placement, and SSH-log finalization on shutdown.
- Independent standards and spec review found no remaining concrete issues after follow-up fixes.
- Build output retains Vite's advisory for a renderer bundle above 500 kB. The package artifacts are unsigned because no publisher certificate is configured.

## Remaining acceptance

P-42 remains partial pending the all-flow secret-exclusion review. [WP-02E](WP-02E-host-key-rotation-e2e-2026-10-29.md) closes the host-key-rotation E2E. The wider security release checklist and signing decision also remain open; see [SECURITY.md](../SECURITY.md#release-security-gate).
