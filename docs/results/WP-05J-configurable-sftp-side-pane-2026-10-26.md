# WP-05J: Configurable contextual SFTP side pane

**Status:** Implemented slice; F-005/P-14 remain partial.
**Requirements:** F-005, P-14.
**Development branch:** `dev-1`; promotion target `main`.

## Behavior

Workbench Settings now has a persistent checkbox for showing the remote file pane beside running SSH terminals. The preference defaults to enabled so existing users keep the previous layout. Saving it off hides the contextual pane and lets the terminal use the full panel layout; the pane remains mounted to preserve active transfer state and stops accepting drops. Standalone SFTP and FTP files-only tabs remain available. Saving it back on restores the contextual pane without reconnecting.

## Architecture

The setting extends the validated `WorkbenchPreferences` domain value and typed Settings save/read flow. SQLite preference schema v5 migrates v4 records with the new setting enabled and preserves explicit false values across database reopen. No new package, credential, filesystem capability or protocol operation was added, so no ADR was required.

## Validation

- `node --test tests/unit/workbench-preferences.test.ts tests/unit/sqlite-workbench-preferences.test.ts` — 13 passed.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "SFTP sessions verify trust and transfers" --reporter=line` — 1 passed on Windows. It checks the default, disables and re-enables the pane during a stalled download, confirms the transfer remains active until explicitly cancelled, verifies local staging cleanup and confirms the standalone SFTP pane remains mounted.
- `corepack pnpm typecheck` — passed.
- `corepack pnpm lint` — passed, including import-boundary checks.
- `corepack pnpm build` — passed. Vite reported the existing large renderer-chunk advisory; native Windows compilation succeeded.
- `git diff --check` — passed.

## Remaining acceptance

The preference completes the configurable-pane behavior only. Native Explorer drag automation, interrupted SFTP/FTP upload cleanup, sustained throughput and broader server interoperability remain open, so F-005/P-14 remain partial.
