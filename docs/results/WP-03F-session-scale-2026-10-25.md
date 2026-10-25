# WP-03F: 1,000-session Windows acceptance

**Date:** 2026-10-25
**Requirements:** F-004, P-38 and the saved-session search portion of N-009.

## Behavior and implementation

The SQLite storage worker now exposes a typed count-only operation. The renderer uses it to show the total saved-session count without loading every definition just to count rows. Filtered searches do not request a total count because filtering cannot change the catalog size. When search text changes, the workbench clears stale rows and shows its loading state before sending the debounced search. This avoids re-rendering the full 1,000-row list while a new query is pending. Catalog mutations refresh the total count.

The 50 ms search debounce keeps typing responsive while coalescing events. Catalogs with more than 80 visible entries use a windowed list with 52-pixel rows and eight-row overscan; smaller catalogs keep the nested list. Keyboard Tab and Shift+Tab move focus across virtual windows, and row positions are exposed with list position metadata. Closed action menus are hidden from layout and tab order.

The scale E2E imports a versioned bundle containing 999 folder sessions, then explicitly saves the startup local session as an unfiled definition to reach 1,000. It verifies the total and that fewer than 1,000 session rows are mounted, checks closed action menus and forward/reverse keyboard navigation (including leaving the list before its non-focusable “Unfiled” heading), scrolls to both ends, alternates searches for two definitions, reopens one as a local terminal, deletes it, and verifies the count falls to 999. An existing SQLite unit test creates 1,000 additional profiles and checks catalog search, total count, favorite, and delete operations without an application quota.

## Windows validation

- `corepack pnpm typecheck` passed.
- `corepack pnpm lint` passed, including import-boundary checks.
- `corepack pnpm build` passed on Windows x64. The renderer build still reports its existing chunk-size advisory above 500 kB.
- Focused session-catalog, folder-bundle, contracts, and broker unit tests passed: 64/64.
- The scale Electron E2E passed four runs after virtualization. Each run imported 1,000 definitions, checked bounded DOM rows and both keyboard directions, searched 20 times, reopened a matching local session, and deleted it.
- Renderer-observed input-to-matching-row search p95 was 68.6 ms, 70.0 ms, 62.4 ms, and 67.6 ms across the four final runs (20 samples each), below N-009's 150 ms target.
- `git diff --check` passed. No dependency was added.

## Test environment

- Hardware: System Product Name (generic system model reported by firmware); AMD Ryzen 7 3700X, 8 cores/16 logical processors; 31.9 GiB RAM.
- Storage: repository on `E:`, a Seagate ST2000DM008-2FR102 SATA HDD.
- OS: Windows 11 Pro x64, build 26200.
- Build/source ID: MultiRemoteTerminal `0.0.0`, source commit `f3a64af`; Node.js `24.14.1`; Electron `45.0.0`.

## Status and limits

F-004 and P-38 are VERIFIED for the stated catalog workflows and the 1,000-definition threshold. N-009's saved-session search target is VERIFIED; its separate memory profile for 20 active SSH sessions remains outstanding. The measured latency starts at the renderer input event and ends when the matching saved-session row appears in the DOM. It is not a benchmark of remote SSH performance.
