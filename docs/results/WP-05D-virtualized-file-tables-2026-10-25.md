# WP-05D — Virtualized remote file tables

**Date:** 2026-10-25
**Branch:** `dev-1`
**Requirement:** Architecture §10 performance requirement for virtualized file tables; F-005/P-14 remain partial.
**Status:** Implemented and verified for the covered Windows loopback workflow; the broader WP-05 gate remains open.

## Behavior

Remote SFTP and FTP directory rows use a shared virtualized-list module when the listing exceeds 50 entries. The list renders a bounded viewport plus overscan and preserves keyboard traversal when focus crosses the mounted window in either direction. Each mounted row exposes its position and the known or unknown list size to assistive technology. The standalone SFTP/FTP file pane now fills its tab panel, giving the list a usable scroll viewport.

The shared module also replaces the saved-session-specific virtual list. The saved catalog retains its 80-row threshold and flattened folder/session rows, including non-focusable group headings.

## Validation

On Windows x64:

- `corepack pnpm typecheck` passed.
- `corepack pnpm lint` passed, including import-boundary checks.
- `corepack pnpm build` passed, including the native module build and Vite renderer.
- Focused Playwright E2E passed 2/2: the SFTP workflow opened a nested directory with 100 files, checked bounded rendering, forward/reverse keyboard traversal and both scroll ends; the 1,000 saved-session scale workflow also passed.

The production renderer build still reports Vite's non-blocking chunk-size advisory (907.46 kB minified).

## Remaining acceptance

This change does not complete F-005/P-14 or WP-05. Drag/drop, 1 KB/100 MB transfer acceptance, sustained throughput, disconnect/recovery behavior, configurable browser behavior and broader server interoperability remain open. The listing is still capped at 500 entries. Windows tests use a loopback fixture and do not establish interoperability against public SFTP/FTP servers.
