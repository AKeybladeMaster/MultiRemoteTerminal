# WP-03F: 1,000-session Windows acceptance

**Date:** 2026-10-25  
**Requirements:** F-004, P-38 and the saved-session search portion of N-009.

## Behavior and implementation

The SQLite storage worker now exposes a typed count-only operation. The renderer uses it to show the total saved-session count without loading every definition just to count rows. Filtered searches do not request a total count because filtering cannot change the catalog size. When search text changes, the workbench clears stale rows and shows its loading state before sending the debounced search. This avoids re-rendering the full 1,000-row list while a new query is pending. Catalog mutations refresh the total count.

The 50 ms search debounce keeps typing responsive while coalescing events. The scale E2E imports a versioned bundle containing 1,000 saved definitions, verifies the total and an initial visible row, alternates searches for two definitions, reopens one as a local terminal, deletes it, and verifies the count falls to 999. The acceptance assertions do not depend on every row being mounted simultaneously. An existing SQLite unit test creates 1,000 additional profiles and checks catalog search, total count, favorite, and delete operations without an application quota.

## Windows validation

- `corepack pnpm typecheck` passed.
- `corepack pnpm lint` passed, including import-boundary checks.
- `corepack pnpm build` passed on Windows x64. The renderer build still reports its existing chunk-size advisory above 500 kB.
- Focused session-catalog, contracts, and broker unit tests passed: 56/56.
- The scale Electron E2E passed four runs after renderer-side instrumentation. Each run imported 1,000 definitions, searched 20 times, reopened a matching local session, and deleted it. The test checks the total and a visible row without requiring the full catalog to be mounted in the DOM.
- Renderer-observed input-to-matching-row search p95 was 66.9 ms, 68.2 ms, 68.3 ms, and 72.4 ms across the four runs (20 samples each), below N-009's 150 ms target.
- `git diff --check` passed. No dependency was added.

## Test environment

- Hardware: System Product Name (generic system model reported by firmware); AMD Ryzen 7 3700X, 8 cores/16 logical processors; 31.9 GiB RAM.
- Storage: repository on `E:`, a Seagate ST2000DM008-2FR102 SATA HDD.
- OS: Windows 11 Pro x64, build 26200.
- Build/source ID: MultiRemoteTerminal `0.0.0`, commit `65731bc`; Node.js `24.14.1`; Electron `45.0.0`.

## Status and limits

F-004 and P-38 are VERIFIED for the stated catalog workflows and the 1,000-definition threshold. N-009's saved-session search target is VERIFIED; its separate memory profile for 20 active SSH sessions remains outstanding. The measured latency starts at the renderer input event and ends when the matching saved-session row appears in the DOM. It is not a benchmark of remote SSH performance.
