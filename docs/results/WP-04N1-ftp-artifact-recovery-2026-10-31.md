# WP-04N.1: durable FTP/FTPS upload artifact names

**Status:** Implementation and acceptance-test source authored; Phase 07 gate not run. N-010 remains PARTIAL.

## Decision

Interrupted transfer records may contain up to two validated remote artifact basenames. They never contain a remote directory, endpoint, session ID or credential. The renderer presents those names for manual inspection after reconnect and never resumes, renames or deletes a remote file. The unverified candidate also marks exact matching regular-file names in the folder the user opens; this is only a possible-artifact clue and does not prove identity or search other folders.

The FTP adapter captures names from its app-generated overwrite stage/backup paths and the server's STOU response. [RFC 1123, section 4.1.2.9](https://www.rfc-editor.org/rfc/rfc1123.html#section-4.1.2.9) requires the server to return the actual STOU pathname in the `125` or `150` response before the transfer. The existing FTP adapter validates that reported pathname resolves inside the requested directory; recovery persists only the basename.

## Implementation

- Recovery metadata adds a bounded `remoteArtifactNames` array. Domain and worker boundaries reject path-like names, duplicates and arrays longer than two.
- SQLite schema v5 adds a JSON column with an empty-array default, preserving existing v4 recovery rows. Existing backup-before-migration and transaction behavior still applies.
- FTP worker progress reports a STOU basename as soon as the preliminary response identifies it. A correlated main-process acknowledgment follows the SQLite write; the FTP worker does not release the STOU preliminary reply to `basic-ftp` until that acknowledgment succeeds. A failed or timed-out write prevents payload bytes from starting. Missing or invalid STOU names fail closed. Overwrite progress reports generated temporary and backup basenames before their rename operations.
- The interrupted-transfer banner tells users to reconnect and inspect the names manually. No server path or credential is retained.
- Unit, storage-protocol, broker, SQLite-migration and Windows FTP worker-failure/restart E2E cases were authored or updated.
- An additional Windows FTP E2E reads the running recovery row on the fixture's first payload bytes and requires the server-selected basename to be committed already.

## Limits and verification

- No automated tests or builds were run for this change. All new and modified checks await the Phase 07 verification freeze.
- A nonconforming STOU server without a usable name now fails before payload transfer. A process failure between its preliminary reply and the SQLite commit can still leave an unidentified zero-byte server object; FTP and SQLite cannot commit atomically.
- Automatic remote-directory lookup, reconciliation/deletion, FTP server interoperability and broader non-SQLite app-configuration recovery remain open. No credentials or remote paths are used to automate recovery.

## 2026-11-01 FTP/FTPS artifact-failure visibility follow-up

- A failed or cancelled FTP/FTPS upload can leave a server-assigned or staged artifact because the application cannot safely delete by path alone. The tracker now settles any unsuccessful FTP/FTPS upload with durably reported artifact names as interrupted, including late conflict outcomes. Artifact-free cancellation and SFTP cancellation are unchanged.
- Added focused unit regressions for cancelled FTP and failed FTPS artifact-bearing transfers. The implementation and test source are unverified pending the complete Phase 07 gate. No remote path, session, endpoint, or credential was added to recovery metadata; no transfer resumes or deletes automatically. N-010 remains PARTIAL.
- Follow-up acceptance source: the existing Windows FTP restart E2E now also requires the cancelled STOU server-assigned artifact name to appear in the recovery banner after application restart. It is authored but unrun under the Phase 07 gate.
