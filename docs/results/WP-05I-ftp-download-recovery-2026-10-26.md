# WP-05I: interrupted FTP download recovery

**Date:** 2026-10-26  
**Branch:** `dev-1`  
**Requirements:** F-005, P-10, P-14

## Covered

- The Windows FTP loopback fixture serves a seeded 4 MiB file but sends only its first 1 MiB, leaving the passive data connection open.
- The E2E requires a clean local staging baseline and observes exactly one nonzero, incomplete `.mrt-*` file before interrupting the transfer.
- It resets both FTP control and passive data sockets, waits for the transfer failure, and verifies that neither the destination nor any local staging file remains.
- The test refreshes the disconnected pane, uses its explicit reconnect action with the saved endpoint, retries the download, and compares completed size and SHA-256 with the fixture.
- The same Windows E2E continues through FTP profile persistence across application restart and saved-profile reopen.

## Validation

- `corepack pnpm typecheck` - passed.
- `corepack pnpm lint` - passed, including static import-boundary checks.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "FTP shows plaintext risk, browses through the utility worker" --reporter=line` - 1/1 passed on Windows.
- `git diff --check` - passed.

## Limits

This is loopback acceptance against the basic FTP fixture. It does not establish FTPS certificate interoperability or interrupted FTP upload cleanup. Interrupted SFTP/FTP upload cleanup, sustained throughput, actual Explorer drag automation, configurable browser behavior, and broader server interoperability remain open. F-005, P-10, P-14, and P-15 remain PARTIAL.
