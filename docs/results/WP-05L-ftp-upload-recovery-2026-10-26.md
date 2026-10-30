# WP-05L: interrupted FTP upload recovery

**Status:** Partial verification; F-005 and P-14 remain partial.

**Current implementation update (2026-10-30):** Reconnect-time FTP stage deletion and the in-memory recovery registry have been removed. If best-effort `DELE` fails on the live upload connection, the remote path remains after reconnect for user review; the app does not infer object identity from `SIZE`. The renderer now tells users to reconnect and inspect the remote folder after an uncertain FTP upload. The replacement-preservation unit regression and interrupted-upload E2E have been updated but not run; validation is deferred to the Phase 04 gate. Existing evidence below belongs to the superseded auto-delete implementation. See the [WP-05L.1 safety result](WP-05L1-ftp-upload-recovery-safety-2026-10-30.md).

## Scope

WP-05L originally retained the failed stage path and source size in a bounded, in-memory registry after live cleanup failed. WP-05L.1 removes that registry and leaves a path in place when cleanup fails, so reconnect does not delete it based on size alone.

The previous implementation checked one pending record after reconnect and used `SIZE` to decide whether to delete an undersized path. That registry is gone. A path left by failed live cleanup is not deleted on reconnect and may remain until a user inspects and removes it with FTP client or server-side tools.

The preserved path appears in the remote directory listing when the server exposes it. The app does not provide a dedicated cleanup workflow for these FTP leftovers; users must inspect them and remove only confirmed partial files with an FTP client or server-side tools. This prevents deletion of a possible replacement but leaves interrupted-upload cleanup incomplete.

## Historical evidence for the superseded auto-delete implementation

- First ran the expanded Windows loopback test before adding provider recovery. It failed as intended: the upload left its server-selected partial file after both FTP sockets reset and the session reconnected.
- `node --test tests/unit/ftp-files.test.ts`: **14/14 passed** on the prior implementation, including undersized-stage deletion, isolation by FTP username, preservation of a full-size stage, and a simulated smaller same-path replacement that demonstrated the object-identity race.
- `corepack pnpm typecheck`: passed.
- `corepack pnpm build`: passed on Windows x64 with the existing renderer chunk-size warning.
- Focused Windows loopback Playwright test for FTP: **1/1 passed**. It resets both control and passive data sockets during a 100 MiB upload, reconnects, verifies the partial server file was deleted, retries, and compares exact size and SHA-256.

## Remaining limits

Automatic interrupted-upload cleanup is no longer attempted after reconnect. A leftover path may require external cleanup; worker termination/restart, FTP/FTPS interoperability, sustained throughput and actual Explorer drag-gesture automation remain open. F-005/P-14 are not marked verified.
