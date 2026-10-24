# WP-05B — Contextual SFTP file transfers

**Date:** 2026-10-24
**Branch:** `dev-1`
**Requirements:** F-005 (partial), P-14 (partial); standalone SFTP P-11 and drag/drop P-15 remain planned.
**Status:** Implemented contextual transfer slice; broader WP-05 gate remains open.

## Behavior

The remote-files pane now provides upload and per-file download actions beside a trusted, running SSH terminal. Main owns the native upload/save dialogs and conflict prompt; local paths and file contents stay out of renderer IPC. A supervised SSH utility worker reuses the authenticated SSH client, opens one SFTP channel at a time, streams the file with typed byte progress, and supports cancellation before commit.

Uploads read a regular local source through an opened handle, check its path identity and byte count, and stream into a random exclusive remote sibling ending in `.partial`. Before I/O and again before commit, the worker compares server `realpath` with the normalized requested path and `lstat`s the final object to reject known symlink ancestors. The commit keeps the requested filename when it is available and uses a bounded copy-name retry only after a verified rename collision. Explicit overwrite stages the old remote file under a random backup name and attempts rollback on replacement failure. Downloads reject known symlinks in the remote source path and its ancestors, recheck source metadata around streaming, verify the transferred byte count against the advertised size when available, then commit a staged sibling in the user-selected local directory with no-replace behavior unless overwrite was explicitly chosen. Progress is coalesced to at most one event per 100 ms during transfer plus the final byte count. Unit coverage verifies no-collision names, initial and commit-time conflicts, generic rename errors, explicit overwrite, symlink rejection, short-stream protection, missing files and cancellation cleanup.

The SSH worker now receives the small Windows runtime environment allowlist also used by FTP (`SystemRoot`, `WINDIR`, `PATH`, `TEMP`, `TMP`) plus `MRT_APP_ROOT`. This fixed the Windows utility process failing to create network sockets when the environment contained only the application root. Unrelated parent environment variables remain excluded.

## Architecture decisions

- Preserve the existing domain/application/adapter direction and typed `ssh.files.*` IPC. The renderer sends operation IDs and remote paths only; main selects local paths and the worker owns filesystem/network streams.
- Reuse the trusted SSH host identity and connection rather than creating an independent SFTP login. Serialize file operations per session and publish validated operation-scoped progress.
- Stage remote and local data before commit. SFTP v3 `RENAME` treats an existing destination as an error; the client rechecks the name after a generic rename failure before selecting a copy name. Explicit remote overwrite uses a backup/replace/rollback sequence. See [ADR-0007](../adr/ADR-0007-sftp-transfer-commit.md) and the [SFTP v3 draft](https://datatracker.ietf.org/doc/html/draft-ietf-secsh-filexfer-02#section-6.5).
- Keep cancellation active during preparation and transfer, but disable it once progress enters `committing`. A commit event that arrives after cancellation has scheduled worker termination extends the cleanup grace so commit/rollback can settle. Transfer-idle timeout is 30 seconds; the overall worker request is bounded to one hour, with a longer settlement window if the request deadline arrives during commit.

## Validation

Final `corepack pnpm check` passed on Windows x64 on 2026-10-24:

- TypeScript project and tool typechecks passed.
- ESLint and static/dynamic/import-boundary checks passed.
- 186 unit tests passed, including regressions for short downloads, symlinked ancestor rejection, progress throttling and cancellation/commit timing.
- The native Windows x64 module and Vite renderer built successfully.
- All 15 Electron E2E scenarios passed, including a loopback SSH/SFTP host-trust, listing, upload and download through the actual renderer, main broker, utility worker and filesystem. The E2E asserts the resulting local and remote file contents.
- `git diff --check` passed before evidence recording; it is rerun as part of final review.

The build retains a non-blocking Vite warning that the minified renderer JavaScript chunk exceeds 500 kB. The loopback fixture is an `ssh2`-based SFTP server; this run does not establish compatibility with every production SFTP server.

## Security limitations and remaining work

F-005 and P-14 remain PARTIAL. Standalone SFTP sessions, drag/drop, configurable browser behavior, 1 KB/100 MB throughput acceptance, network-loss recovery and broader server interoperability remain open. P-11 and P-15 remain planned. A forced worker termination or lost SSH connection can leave a remote `.partial` file or local staging file if cleanup cannot finish. Remote source identity uses SFTP v3 metadata and cannot detect every concurrent replacement. Local explicit overwrite has a small identity-check-to-rename race because Windows does not provide a portable identity-conditional rename.

The requested `C:\Users\Beasty\Downloads\MobaXterm_Portable_v26.5.zip` was not present on this workstation during this phase, and no REA analysis tools were registered. No reference-binary behavior was used as implementation evidence; this slice follows the repository specification and its independent SFTP design.
