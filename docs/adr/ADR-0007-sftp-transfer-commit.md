# ADR-0007: SFTP transfer staging and commit behavior

**Status:** Accepted for WP-05B (2026-10-24)

## Context

WP-05A lists remote files through the SFTP subsystem of an already trusted SSH terminal. WP-05B adds uploads and downloads without exposing local paths to the renderer, creating a second unauthenticated SFTP session, or letting a remote filename become a shell argument. Transfers need explicit conflict behavior, cancellation, bounded progress, and cleanup when the worker or network stops.

SFTP v3 `SSH_FXP_RENAME` treats an existing destination as an error. The server's status for a collision may be the generic failure code, so the client checks the destination again before choosing a copy name. The pinned `ssh2` API exposes the v3 rename operation without the later draft's overwrite flags. See [the SFTP v3 file transfer draft, section 6.5](https://datatracker.ietf.org/doc/html/draft-ietf-secsh-filexfer-02#section-6.5).

## Decision

- Reuse the host-key-approved SSH client and one SFTP channel per session. The supervised utility worker owns remote streams and local file handles; the renderer receives only validated names, transfer state and byte counts. Main selects local upload/download paths with native dialogs.
- Upload from an opened local file after rejecting symlinks and checking the file identity and size. Stream to a random exclusive remote sibling ending in `.partial`, then rename it into place. Keep the requested name when free; if a rename collision occurs, retry with a bounded ` (n)` copy name. Explicit overwrite uses a random remote backup and best-effort rollback. Skip never replaces a target.
- Download only regular remote files, rejecting symlinks. Stream to a random sibling temporary file beside the user-selected destination. Commit new and renamed targets with a no-replace hard link; explicit overwrite verifies the existing file identity before rename.
- Publish typed, operation-scoped progress. Cancellation works through preparation and transfer; once the provider starts committing, report that phase and let commit or rollback settle. The worker allows bounded cleanup after cancellation and a longer settlement interval if the overall request deadline lands during commit.
- Preserve credentials, local paths and file contents inside main/worker boundaries. The SSH worker inherits only the Windows runtime variables it needs (`SystemRoot`, `WINDIR`, `PATH`, `TEMP`, `TMP`) plus `MRT_APP_ROOT`; unrelated parent environment secrets do not cross this boundary.

## Consequences and limitations

Staging protects the old target from partial content and gives explicit overwrite/skip/copy behavior. The server must implement SFTP v3 rename semantics for no-clobber commits; broader server interoperability remains untested. Remote file identity uses the metadata available through SFTP v3 and cannot detect every concurrent replacement. Explicit local overwrite has a small check-to-rename race because Windows does not offer a portable identity-conditional rename. Cancellation, connection loss, or forced worker termination may leave `.partial` or backup files if cleanup cannot complete. There is no drag/drop or standalone SFTP connection in this phase, and 100 MB throughput plus disconnect recovery remain acceptance work.

## Evidence

Focused unit tests cover safe local target commits, remote conflicts, no-collision rename behavior, source identity checks, symlink rejection and cancellation cleanup. The Windows loopback SSH/SFTP E2E test verifies host trust, listing, upload/download through the renderer and worker, and final file contents. See [WP-05B results](../results/WP-05B-sftp-transfers-2026-10-24.md).
