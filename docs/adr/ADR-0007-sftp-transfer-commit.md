# ADR-0007: SFTP transfer staging and commit behavior

**Status:** Accepted for WP-05B (2026-10-24)

## Context

WP-05A lists remote files through the SFTP subsystem of an already trusted SSH terminal. WP-05B adds uploads and downloads without exposing local paths to the renderer, creating a second unauthenticated SFTP session, or letting a remote filename become a shell argument. Transfers need explicit conflict behavior, cancellation, bounded progress, and cleanup when the worker or network stops.

SFTP v3 `SSH_FXP_RENAME` treats an existing destination as an error. The server's status for a collision may be the generic failure code, so the client checks the destination again before choosing a copy name. The pinned `ssh2` API exposes the v3 rename operation without the later draft's overwrite flags. See [the SFTP v3 file transfer draft, section 6.5](https://datatracker.ietf.org/doc/html/draft-ietf-secsh-filexfer-02#section-6.5).

## Decision

- Reuse the host-key-approved SSH client and one SFTP channel per session. The supervised utility worker owns remote streams and local file handles; the renderer receives only validated names, transfer state and byte counts. Main selects local upload/download paths with native dialogs.
- Upload from an opened local file after rejecting symlinks and checking the file identity and size. Before remote I/O and again before commit, compare the server's canonical `realpath` with the normalized requested path and `lstat` the final object, rejecting known symlink ancestors. Stream to a random exclusive remote sibling ending in `.partial`, then rename it into place. Keep the requested name when free; if a rename collision occurs, retry with a bounded ` (n)` copy name. Explicit overwrite uses a random remote backup and best-effort rollback. Skip never replaces a target.
- Download only regular remote files, rejecting known symlinks in the source path and its ancestors with the same `realpath` comparison and final-object `lstat`. Recheck metadata before and after streaming and require the transferred byte count to match the advertised size when available. Stream to a random sibling temporary file beside the user-selected destination. Commit new and renamed targets with a no-replace hard link; explicit overwrite verifies the existing file identity before rename.
- Publish typed, operation-scoped progress at most every 100 ms during a stream, plus the final byte count. Cancellation works through preparation and transfer; once the provider starts committing, report that phase and let commit or rollback settle. If commit progress arrives after a cancellation timer was scheduled, extend the worker grace period so it cannot kill a commit in progress. The worker allows bounded cleanup after cancellation and a longer settlement interval if the overall request deadline lands during commit.
- Preserve credentials, local paths and file contents inside main/worker boundaries. The SSH worker inherits only the Windows runtime variables it needs (`SystemRoot`, `WINDIR`, `PATH`, `TEMP`, `TMP`) plus `MRT_APP_ROOT`; unrelated parent environment secrets do not cross this boundary.

## Consequences and limitations

Staging protects the old target from partial content and gives explicit overwrite/skip/copy behavior. The server must implement SFTP v3 rename semantics for no-clobber commits; broader server interoperability remains untested. SFTP v3 offers path-based operations rather than a portable no-follow directory handle, so a hostile remote peer that swaps a checked ancestor concurrently can still create a check-to-use race. Remote file identity uses the metadata available through SFTP v3 and cannot detect every concurrent replacement. Explicit local overwrite has a small check-to-rename race because Windows does not offer a portable identity-conditional rename. Cancellation, connection loss, or forced worker termination may leave `.partial` or backup files if cleanup cannot complete. At the WP-05B stage, drag/drop and standalone SFTP were not implemented; WP-05C later added standalone SFTP, and [ADR-0025](ADR-0025-preload-file-drops.md) records the drop flow. 100 MB throughput and disconnect recovery outside the WP-05K same-worker SFTP upload path remain acceptance work.

### WP-05K interrupted SFTP upload recovery

- A failed or cancelled upload is recorded only when the exclusive generated stage was opened by this worker and its bounded cleanup fails. The in-memory recovery record is keyed by a SHA-256 digest of the canonical SSH route, usernames, and accepted host-key fingerprints; credentials are excluded. A reconnect for the same trusted identity waits for the disconnected upload to settle, then attempts cleanup before its first SFTP operation.
- Cancellation settles independently of ssh2's remote handle-close callback, which may never return after transport loss. The worker destroys the local and remote streams, attempts stage removal with a two-second operation timeout, and retains only the exact owned path if that attempt fails. Recovery validates the generated UUID `.partial` name and absolute path, verifies the canonical parent with `realpath`, and removes no other remote entry.
- The private worker registry is capped at 128 records with a seven-day TTL and at most four cleanup attempts per SFTP channel. Records do not survive worker-process termination or application restart; a killed worker can therefore leave residue. FTP upload recovery is not covered by this decision.
- Windows loopback E2E evidence resets SSH during a partial SFTP upload, reconnects, verifies the stage was removed, retries explicitly, and compares exact bytes. A unit test also simulates a write-stream destroy that never receives its remote close callback. See [WP-05K results](../results/WP-05K-sftp-upload-recovery-2026-10-26.md).

## Evidence

Focused unit tests cover safe local target commits, remote conflicts, no-collision rename behavior, source identity checks, symlink rejection and cancellation cleanup. The Windows loopback SSH/SFTP E2E test verifies host trust, listing, upload/download through the renderer and worker, and final file contents. WP-05E adds drop-handle and broker coverage on top of these transfer guarantees. See [WP-05B results](../results/WP-05B-sftp-transfers-2026-10-24.md) and [WP-05E results](../results/WP-05E-sftp-file-drop-2026-10-26.md).
