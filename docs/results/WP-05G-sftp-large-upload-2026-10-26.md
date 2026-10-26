# WP-05G: 100 MiB SFTP drop upload acceptance

**Date:** 2026-10-26  
**Branch:** `dev-1`  
**Requirements:** F-005, P-14, P-15

## Covered

- The Windows loopback SSH/SFTP E2E dispatches a three-file drop batch to the active contextual SFTP folder: an exactly 1 KiB file, a small second file, and a 100 MiB file.
- The fixture records upload start and rename/commit events and asserts that all three uploads complete in order.
- The test compares the remote bytes of both small files and the committed 100 MiB file's exact size and SHA-256 digest to the local source.
- The test-only SFTP fixture removes its synthetic write delay for the large upload; this is byte-integrity acceptance, not throughput measurement.

## Validation

- `corepack pnpm typecheck` — passed.
- `corepack pnpm lint` — passed, including static import-boundary checks.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "SFTP sessions verify trust and transfers" --reporter=line` — 1/1 passed on Windows in 30.6 seconds.
- `git diff --check` — passed.

## Limits

The E2E-only preload hook simulates the drop dispatch; actual Windows Explorer drag automation remains unverified. Sustained throughput, network-loss/disconnect recovery, configurable browser behavior, and broader SFTP interoperability remain open. P-14, P-15, and F-005 stay PARTIAL.
