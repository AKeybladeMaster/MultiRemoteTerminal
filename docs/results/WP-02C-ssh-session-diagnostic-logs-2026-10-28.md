# WP-02C: SSH session diagnostic logging

**Date:** 2026-10-28
**Requirements:** F-027 and P-45
**Status:** Partial; native Save picker and packaged SSH-log acceptance remain open.

## Delivered

SSH terminal sessions can opt into a per-attempt local `.log` before connecting. Main owns the Save dialog path and asynchronous bounded JSONL writer. Records include ordered lifecycle, host-trust and credential-prompt categories, transport status, terminal input/output and resize/close events. Credential prompt contents and key bytes are excluded; the UI warns that terminal text and endpoint details can be sensitive.

## Windows validation

- `corepack pnpm typecheck` and `corepack pnpm exec eslint apps packages tests` passed; `node scripts/check-boundaries.mjs` and `git diff --check` passed.
- Final focused broker, teardown-owner and log-writer unit tests passed: 50/50. They cover renderer loss before open, during key selection and transport startup, cancellation preventing SSH open, selected-key wiping, bounded I/O deadlines, caps and redaction.
- The most recent full unit run before the final teardown tests passed 543/544; the sole failure was the unrelated TFTP UDP-response timing test, which also failed when run alone.
- The final-tree Windows loopback E2E passed 1/1. It verifies the default-off checkbox resets for each attempt, a refused connection is finalized with its observed transport failure phase, a live session logs input and echoed output, credential values and the local profile path are absent, and closing the app flushes a final record.
- `corepack pnpm package:win` built the Windows x64 NSIS installer and portable executable with per-artifact CycloneDX SBOMs and a SHA-256 manifest. Targeted package smoke passed 3/3: ASAR/fuse validation, SBOM/hash verification, and portable launch with PowerShell and Bash terminals.
- The build is unsigned because no signing certificate is configured. The NSIS install/uninstall smoke was not run because it writes installer state outside the workspace.
- `corepack pnpm build` passed under pinned Node 24.14.1 and pnpm 12.15.0; Vite emitted its existing bundle-size advisory above 500 kB.
- The log E2E uses a guarded unpackaged-app file-root hook to avoid automating the native dialog. Direct Save picker selection/cancellation and packaged SSH-log behavior are not covered by this test.

## Remaining acceptance

P-45 remains PARTIAL until native Save picker selection and cancellation, plus an SSH session-log check in the packaged app, pass on Windows. This evidence uses loopback fixtures and does not verify any external SSH server, VPN route, or real-network interoperability.
