# WP-08B — External VNC viewer

**Date:** 2026-10-25
**Requirements:** F-015, P-08; credential-free saved-session bundles (F-018)
**Status:** P-08 PARTIAL

## Delivered

- Added a credential-free VNC session definition and endpoint canonicalizer. Saved-folder bundle version 5 exports and imports VNC profiles; versions 1–4 retain their prior accepted session kinds.
- Added a typed `vnc.launch` application/IPC path and Windows TigerVNC adapter. Discovery is limited to `TigerVNC\\vncviewer.exe` inside OS-known Program Files directories. Launch passes a validated `host::port` argument without a shell, does not search `PATH`, removes inherited `VNC_USERNAME` and `VNC_PASSWORD`, and bounds startup wait with cancellation cleanup.
- Required a fresh one-use trusted launch-button gesture, bound to the VNC dialog endpoint and consumed by the main broker. Direct bridge calls without that gesture fail closed.
- Added VNC connect and saved-profile UI. It labels TigerVNC as an external viewer and tells the user that VNC security/encryption depends on server settings and that the app reports only process launch.
- Recorded the provider choice, distribution and integrity limitations in [ADR-0016](../adr/ADR-0016-wp08b-vnc-viewer.md) and the [TigerVNC provider record](../dependencies/WP-08B-tigervnc.md).

## Validation

- Focused Node unit/contract/storage tests — **103 passed, 0 failed**. Coverage includes VNC validation, process arguments and environment, cancellation and launch errors, broker/preload authorization, credential rejection, SQLite persistence, and bundle v1–v5 compatibility. A mixed-case environment-variable regression first failed against exact-case filtering, then passed after the Windows environment cleanup became case-insensitive.
- `corepack pnpm typecheck` — passed.
- `corepack pnpm lint` — passed, including import-boundary checks.
- `corepack pnpm build` — passed on Windows x64, including the native helper. Vite emitted an advisory because the minified renderer chunk is above 500 kB (736.25 kB).
- `corepack pnpm setup:electron` — passed.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts -g "VNC profiles persist"` — **1 passed** on Windows. The test covers warning and dialog behavior, saved profile persistence across restart, Escape/focus restoration, denial of a direct bridge bypass, and explicit launch through a test-only fake viewer.

## Limits and security

No TigerVNC executable or live VNC server was installed or used. The tests verify the application's launch request and UI flow, not a VNC handshake, server authentication, display, keyboard/mouse input, reconnect, or disconnect behavior. The external viewer owns its lifetime after process startup and may keep its own configuration outside the app profile. The app does not verify the viewer's signature, hash, or update state. P-08 therefore remains PARTIAL.

Saved definitions and JSON bundles contain only validated host, port, name, and folder metadata; they are not encrypted. No new runtime dependency was added and no external executable was bundled.

## Review

The Spec review found that connection-aware reconnect remains outside this slice because the app cannot observe the external viewer's later state; that F-015 gap is documented and P-08 remains PARTIAL. The Standards review initially found that mixed-case `VNC_USERNAME` / `VNC_PASSWORD` keys could survive cleanup on Windows. A regression assertion reproduced the issue, and commit `bb2ad86` now removes matching names case-insensitively. The follow-up Standards review found no remaining documented-standard breaches or actionable smells; the follow-up Spec review approved this scoped partial slice. Both recommend merging WP-08B only. Neither review considers F-015/P-08 complete or verifies a live VNC session.
