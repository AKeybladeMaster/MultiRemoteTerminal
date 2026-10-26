# WP-05H: interrupted SFTP download recovery

**Date:** 2026-10-26  
**Branch:** `dev-1`  
**Requirements:** F-005, P-14

## Covered

- The Windows loopback E2E downloads a 4 MiB SFTP fixture and waits until the local staging file contains a nonzero, incomplete prefix.
- It resets the active files-only SSH TCP connection while the download is in progress.
- After the failed operation, it verifies that neither the destination file nor a `.mrt-` local staging file remains.
- The file pane exposes explicit reconnect. The test reconnects to the saved endpoint, retries the download, and compares the completed file's size and SHA-256 with the source.
- The transfer is interrupted after partial local receipt, so this verifies local download cleanup and recovery, not remote upload cleanup.

## Validation

- `corepack pnpm typecheck` — passed.
- `corepack pnpm lint` — passed, including static import-boundary checks.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "SFTP sessions verify trust and transfers" --reporter=line` — 1/1 passed on Windows in 31.6 seconds.
- `git diff --check` — passed.

## Limits

This is loopback acceptance against the local SSH/SFTP fixture. Interrupted SFTP upload cleanup (which may leave remote `.partial` residue when the transport is gone), FTP disconnect recovery, sustained throughput, actual Explorer drag automation, configurable browser behavior, and broader server interoperability remain open. P-14, P-15, and F-005 stay PARTIAL.
