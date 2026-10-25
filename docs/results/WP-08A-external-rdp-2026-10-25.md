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

- `corepack pnpm typecheck` — passed.
- `corepack pnpm lint` — passed, including import-boundary checks.
- `corepack pnpm test` — 298 passed, 0 failed.
- `corepack pnpm build` — passed on Windows x64, including the native System32 helper build. Vite reports an advisory renderer chunk above 500 kB.
- Playwright Windows E2E — RDP profile save, reopen after app restart, focus restoration, and external launch disclosure passed. A test-only fake viewer is enabled only with `MRT_E2E=1` and `--mrt-e2e-rdp-viewer`; no actual RDP login was attempted.
- Adapter unit tests verify the absolute System32 executable path, `/v:` argument, no-shell flags, IPv6 formatting, platform/error mapping, and cancellation cleanup.

## Limits and security

This Windows machine has no local RDP server available (`TermService` is stopped and no local 3389 listener was found). The E2E test verifies the user workflow, and adapter tests verify process launch configuration, but neither proves an RDP handshake, server acceptance, Windows credential behavior, reconnect, or display/input. P-07 therefore remains PARTIAL. The result returned to the renderer means only that `mstsc.exe` emitted its process startup event; the viewer owns its later lifetime independently of the app.

No new package dependency was added. Saved profiles and JSON bundles contain no passwords, keys, or terminal history.

## Review

Pending independent spec and standards review before promotion.
