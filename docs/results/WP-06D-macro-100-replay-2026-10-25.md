# WP-06D — 100-definition macro replay acceptance

**Date:** 2026-10-25

**Requirements:** F-007, P-28, P-40

**Status:** Windows acceptance verifies 100 typed definitions survive restart and each replays through the workbench on PowerShell. P-40 is VERIFIED for this acceptance; F-007/P-28 remain PARTIAL because macro-specific keyboard bindings are not implemented and the limitations below remain open.

## Behavior verified

The Windows E2E creates 100 distinct macros through the typed application bridge. Each contains one send step and one literal wait for a unique output marker. It closes and restarts the app against the same profile, checks that the bridge reloads 100 definitions and that the saved-macro UI renders all 100, then selects and reviews each macro and runs it on the new PowerShell session.

The command constructs its marker from character codes so it does not appear in the echoed command text. Each run waits for that marker in terminal output. A test-only file in the temporary profile confirms that all 100 commands executed exactly once and in order.

## Validation

- `corepack pnpm exec playwright test --grep "100 saved macro definitions survive restart"` — passed, 1 E2E in 44.9 seconds on Windows x64.
- `node --test tests/unit/sqlite-macro-catalog.test.ts` — 2 passed, 0 failed, including the 100-definition storage/reopen case.
- `corepack pnpm typecheck` — passed.
- `corepack pnpm lint` — passed, including import-boundary checks.
- `corepack pnpm build` — passed; current Windows native addon and renderer build succeed.
- `git diff --check` — passed.

The build reports Vite's advisory that the renderer bundle exceeds 500 kB; the latest build is 702.00 kB minified and succeeds.

## Limits

This acceptance runs macro playback on local PowerShell. Macro-specific keyboard bindings are not implemented. Windows macro playback E2E coverage for SSH and Telnet remains open. Secret-prompt detection remains heuristic and cannot recognize every prompt style. See [WP-06B1 results](WP-06B1-macro-recording-2026-10-25.md), [WP-06B2 results](WP-06B2-macro-playback-2026-10-25.md), [WP-06C results](WP-06C-multiexec-2026-10-25.md), and [ADR-0013](../adr/ADR-0013-wp06-macro-safety-and-storage.md).
