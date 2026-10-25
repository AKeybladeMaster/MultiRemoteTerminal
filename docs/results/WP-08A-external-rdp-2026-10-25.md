# WP-08A — External Windows RDP launch

**Date:** 2026-10-25
**Requirements:** F-015, P-07; saved-session persistence and credential-free folder bundles
**Status:** P-07 PARTIAL

## Delivered

- Added an RDP endpoint validator, application controller, fixed typed `rdp.launch` command, and Windows adapter that resolves `mstsc.exe` under System32.
- The adapter launches `/v:<host>[:<port>]` through an argument array with `shell: false`, waits up to five seconds for process startup, and supports cancellation before the viewer starts. IPv6 targets are bracketed. The syntax follows [Microsoft's `mstsc` command reference](https://learn.microsoft.com/windows-server/administration/windows-commands/mstsc).
- Added saved RDP profiles with host and port only. Saved-folder bundle version 4 supports RDP; import compatibility for versions 1 through 3 is retained with each version's previous kind limits.
- The RDP dialog and saved profile labels identify the provider as external. The dialog states that Windows handles authentication and that the app neither stores RDP credentials nor tracks connection state.
- Updated the stale SQLite migration unit fixtures to reflect the repository's existing schema version 3 and remove its v3 table before simulating an older schema.

## Validation

- `corepack pnpm typecheck` — passed after the launch-gesture security fix.
- `corepack pnpm lint` — passed after the launch-gesture security fix, including import-boundary checks.
- `corepack pnpm test` — 301 passed, 0 failed after the launch-gesture security fix.
- `corepack pnpm build` — passed on Windows x64, including the native System32 helper build. Vite reports an advisory renderer chunk above 500 kB.
- Playwright Windows E2E — RDP profile save, reopen after app restart, focus restoration, direct bridge-call rejection without a trusted click, and explicit external launch passed. A test-only fake viewer is enabled only with `MRT_E2E=1` and `--mrt-e2e-rdp-viewer`; no actual RDP login was attempted.
- Adapter unit tests verify the absolute System32 executable path, `/v:` argument, no-shell flags, IPv6 formatting, platform/error mapping, and cancellation cleanup.

## Limits and security

This Windows machine has no local RDP server available (`TermService` is stopped and no local 3389 listener was found). The E2E test verifies the user workflow, and adapter tests verify process launch configuration, but neither proves an RDP handshake, server acceptance, Windows credential behavior, reconnect, or display/input. P-07 therefore remains PARTIAL. The result returned to the renderer means only that `mstsc.exe` emitted its process startup event; the viewer owns its later lifetime independently of the app.

No new package dependency was added. Saved profiles and JSON bundles contain no passwords, keys, or terminal history.

## Review

Independent spec review found no blocking issue and confirmed that P-07 and F-018 remain correctly tracked as partial. The standards review initially found a missing main-broker gesture check; this was fixed in the follow-up commit by requiring a fresh trusted launch-button click, binding it to the canonical endpoint, and consuming a sender-scoped one-shot authorization in the main broker. The standards follow-up found no remaining bypass and ran the four relevant unit files (75 passed, 0 failed). The final Windows E2E, including its direct bridge-bypass assertion and trusted UI launch flow, passed locally. Both reviewers recommended merge for WP-08A only; this does not pass the M4 release gate or verify a live RDP connection.
