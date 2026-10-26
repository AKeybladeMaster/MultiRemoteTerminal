# WP-05K — interrupted SFTP upload recovery

**Date:** 2026-10-26
**Requirements:** P-14 / F-005 (partial); follow-up to WP-05B and WP-05E.

## Behavior and evidence

- SFTP upload writes to an exclusive, generated `.mrt-<UUID>.partial` sibling. If transport loss or cancellation interrupts the stream, cancellation settles without waiting indefinitely for ssh2's remote write-handle close callback. The worker attempts bounded cleanup and retains only the exact stage path it opened if cleanup fails.
- Recovery records are private to the SSH utility worker and scoped by a SHA-256 digest of the canonical route, usernames, and accepted host-key fingerprints. Passwords and key material are excluded. A new connection with that same trusted identity waits for a disconnected upload to settle, then checks the remote parent and attempts to remove the generated stage before its first SFTP operation.
- Recovery is bounded to 128 paths, seven days, and four attempts per SFTP channel. Cleanup validates the absolute path and generated UUID stage name, verifies the canonical parent with `realpath`, and only then unlinks the recorded path. A cancelled cleanup keeps the record eligible for a later operation.
- Focused unit coverage simulates an upload whose write-stream destruction never receives a close callback, verifies the worker-owned partial stage is recorded, confirms another trust scope cannot remove it, and verifies a later same-scope cleanup removes it. It also checks that cancelling cleanup preserves the record.
- Focused Windows loopback E2E begins a 512 KiB dropped upload, waits until a partial remote stage contains bytes, resets the live SSH socket, and confirms no final target was committed. It reconnects to the saved SFTP endpoint, verifies recovery removed the stage before the remote listing, explicitly retries the upload, and compares the completed remote bytes with the original buffer.

## Validation

- `corepack pnpm test` — **406 passed, 0 failed**.
- `corepack pnpm typecheck` — passed.
- `corepack pnpm lint` — passed; static import-boundary checks passed.
- `corepack pnpm build` — passed on Windows x64, including the native addon build. Vite reported its existing advisory that the renderer chunk exceeds 500 kB.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "SFTP sessions verify trust and transfers" --reporter=line` — **1 passed** after the final source build (35.1 seconds).
- `git diff --check` — passed before commit.

## Scope and remaining work

This verifies interrupted SFTP upload cleanup and explicit retry only when the same trusted route reconnects while the SSH utility worker remains alive. Recovery records are in-memory; worker termination or application restart can leave a remote stage. FTP interrupted-upload recovery, native Explorer drag automation, sustained throughput, and broader server interoperability remain open. P-14/F-005 stay **PARTIAL**.
