# WP-05F: representative transfer-size acceptance

**Date:** 2026-10-26
**Branch:** `dev-1`
**Requirements:** F-005; supporting evidence for P-14 and P-15

## Covered

- The Windows loopback SFTP and FTP E2Es each upload an exactly 1 KiB dropped file and verify the remote bytes.
- The SFTP loopback E2E downloads a 100 MiB remote file through the standalone files-only pane.
- The FTP loopback E2E uploads and downloads a 100 MiB file through the utility worker.
- The 100 MiB transfers compare exact size and SHA-256 digests. File hashing reads in bounded 1 MiB chunks.
- The E2E fixtures are local loopback servers; no external hosts, package changes, or production hooks were added.

## Validation

- `corepack pnpm typecheck` — passed.
- `corepack pnpm lint` — passed, including static import-boundary checks.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "SFTP sessions verify trust and transfers|FTP shows plaintext risk" --reporter=line` — 2/2 passed on Windows after the FTP fixture was corrected to resolve full remote `RETR` paths.
- `git diff --check` — passed.

## Limits

These checks verify transfer completion and byte integrity, not a sustained throughput target. A 100 MiB SFTP upload, network-loss recovery, the native Explorer drag gesture, and interoperability against public SFTP/FTP servers remain unverified. P-14, P-15 and F-005 stay PARTIAL.
