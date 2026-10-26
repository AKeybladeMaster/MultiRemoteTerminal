# WP-05L: interrupted FTP upload recovery

**Status:** Partial verification; F-005 and P-14 remain partial.

## Scope

The FTP utility worker now retains a failed upload stage when immediate remote cleanup cannot use the lost control connection. Recovery is limited to a captured and validated remote stage path. The in-memory record includes the expected source byte count and is scoped by a SHA-256 digest of endpoint host, port, TLS mode and username; it does not contain the password.

Before making an FTP session available after reconnect, the worker checks at most one pending record for that scope. It asks the server for the recorded path size and issues `DELE` only when the remote file is smaller than the original source. A file at or above the expected size is preserved because the transfer may have completed even when its final control reply was lost. Records are capped at 128, expire after seven days and are discarded after four recovery attempts. FTP `SIZE` support and server behavior vary; an unsupported or inconclusive check does not trigger deletion. The registry exists only for the lifetime of the FTP worker, so worker termination or application restart can leave residue.

FTP exposes no stable object identity in this recovery path. A concurrent client with access to the same account could remove and recreate the captured pathname with a smaller file before reconnect; the `SIZE` check cannot distinguish that replacement from the upload stage, and cleanup would delete it. This is an explicit limitation of the same-route recovery policy and assumes trusted concurrent writers.

## Evidence

- First ran the expanded Windows loopback test before adding provider recovery. It failed as intended: the upload left its server-selected partial file after both FTP sockets reset and the session reconnected.
- `node --test tests/unit/ftp-files.test.ts`: **14/14 passed**, including removal of an undersized captured stage, isolation by FTP username, preservation of a stage whose remote size reached the expected source size, and a simulated smaller same-path replacement that demonstrates the documented object-identity race.
- `corepack pnpm typecheck`: passed.
- `corepack pnpm build`: passed on Windows x64 with the existing renderer chunk-size warning.
- Focused Windows loopback Playwright test for FTP: **1/1 passed**. It resets both control and passive data sockets during a 100 MiB upload, reconnects, verifies the partial server file was deleted, retries, and compares exact size and SHA-256.

## Remaining limits

Recovery requires the same endpoint, TLS mode, username and still-running worker. FTP does not provide the same accepted host-key identity used by SFTP, and this check scopes the record by route rather than proving server identity or remote object identity. A smaller same-path replacement can be deleted, as covered by the regression case. Full-size or larger stages are intentionally preserved. FTP/FTPS interoperability, cleanup after worker termination/restart, sustained throughput and actual Explorer drag-gesture automation remain open. F-005/P-14 are not marked verified.
