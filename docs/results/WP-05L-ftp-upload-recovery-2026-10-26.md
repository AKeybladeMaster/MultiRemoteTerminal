# WP-05L: interrupted FTP upload recovery

**Status:** Partial verification; F-005 and P-14 remain partial.

**Current implementation update (2026-10-30):** The in-memory reconnect registry and all automatic path-only FTP `DELE` calls have been removed, including while the original control connection is live. Cancellation, failure or late conflict can leave upload artifacts; successful overwrite preserves its generated backup. The renderer asks users to refresh and inspect uncertain uploads, and warns that an overwritten file may remain under a generated backup name. Prior verification below belongs to superseded candidates; final corrective revalidation is pending. See the [WP-05L.1 safety result](WP-05L1-ftp-upload-recovery-safety-2026-10-30.md) and [Phase 04 gate results](PHASE-04-file-transfer-gate-2026-10-30.md).

## Scope

WP-05L originally retained the failed stage path and source size in a bounded, in-memory registry after live cleanup failed. WP-05L.1 removes the registry and all path-only deletion; reconnect never deletes an upload artifact based on size or pathname alone.

The previous implementation checked one pending record after reconnect and used `SIZE` to decide whether to delete an undersized path. That registry is gone. An upload artifact is not deleted on reconnect and may remain until a user inspects and removes it with an FTP client or server-side tools.

Preserved upload artifacts appear in the remote directory listing when the server exposes them. The app does not provide a dedicated cleanup workflow for FTP leftovers; users must inspect artifacts and remove only confirmed leftovers with an FTP client or server-side tools. This prevents deletion of a possible replacement but leaves interrupted-upload cleanup incomplete.

## Historical evidence for the superseded auto-delete implementation

- First ran the expanded Windows loopback test before adding provider recovery. It failed as intended: the upload left its server-selected partial file after both FTP sockets reset and the session reconnected.
- `node --test tests/unit/ftp-files.test.ts`: **14/14 passed** on the prior implementation, including undersized-stage deletion, isolation by FTP username, preservation of a full-size stage, and a simulated smaller same-path replacement that demonstrated the object-identity race.
- `corepack pnpm typecheck`: passed.
- `corepack pnpm build`: passed on Windows x64 with the existing renderer chunk-size warning.
- Focused Windows loopback Playwright test for FTP: **1/1 passed**. It resets both control and passive data sockets during a 100 MiB upload, reconnects, verifies the partial server file was deleted, retries, and compares exact size and SHA-256.

## Remaining limits

Automatic interrupted-upload cleanup is no longer attempted after reconnect. A leftover path may require external cleanup; worker termination/restart, FTP/FTPS interoperability, sustained throughput and actual Explorer drag-gesture automation remain open. F-005/P-14 are not marked verified.
