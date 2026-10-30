# WP-09D FTP transfer evidence

**Date:** 2026-10-24
**Branch:** `dev-1`
**Requirements:** F-016 (partial), P-10 (partial)

The no-clobber upload decision and its server compatibility limits are recorded in [ADR-0006](../adr/ADR-0006-ftp-no-clobber-uploads.md).

**Current implementation update (2026-10-30):** This record describes the earlier implementation, which attempted DELE on cancellation. The current provider issues no path-only FTP DELE after cancellation, failure or conflict and preserves upload artifacts and overwrite backups for review. Final corrective Phase 04 revalidation passed; see [ADR-0058](../adr/ADR-0058-ftp-interrupted-upload-preservation.md).

FTP sessions now support upload and download from the remote-files pane. The renderer sends only a session ID, operation ID and remote path through preload IPC. Main owns native file/save dialogs and asks for overwrite, rename, skip or cancel behavior; the approved local path travels only over the private worker protocol. A supervised FTP utility worker streams one transfer per session and sends validated progress events back through the main broker.

At the time of this result, uploads read a regular local file through an opened file handle and verify its byte count and identity. Non-overwrite uploads use standard argumentless FTP `STOU`; the worker changes to the selected remote folder, captures the server-assigned path from the preliminary reply, validates it, then restores the prior working directory. The server's actual name is reported on completion. If the server rejects STOU, the app fails closed. Explicit overwrite stages a random remote sibling `.partial` file and uses a backup/replace commit sequence where the server permits it. Downloads stream into a sibling local `.partial` file and commit without replacing an unapproved target; explicit overwrite, rename-copy and skip behavior are supported. Explicit local overwrite verifies destination identity just before rename, but the filesystem operation cannot condition the rename on that identity; another local process could replace the target in the short interval between verification and rename. This is an accepted limitation for WP-09D. A committing phase disables cancellation; cancellation before commit prevents replacement, while a commit already underway settles to its real success or failure. Cancelling an active upload ends its data stream cleanly, then attempts `DELE` while the FTP control connection remains available. Cancelling a download closes the FTP connection. A lost control connection, forced worker exit or cleanup failure can leave an incomplete remote STOU file; local partial downloads are removed where the filesystem permits. On request deadline, non-commit operations get two seconds for cancellation cleanup. If the deadline lands during commit, the worker receives a bounded two-minute settlement window; an unresponsive worker may leave a local `.partial` file or remote `.backup`/`.partial` files. The existing `basic-ftp` dependency is reused; no package was added.

The remote-files pane now has an upload action, per-file download actions, byte progress, and a cancel control. A Windows loopback FTP E2E exercises both directions through the actual Electron renderer, main broker, utility worker and disk, and asserts the exact `STOU` command, selected-folder CWD and restoration, and cancellation cleanup with `DELE`. Unit tests cover transfer policy, server-generated names and races, progress/finalization state, cancellation before and during transfer, commit boundaries, source mutation, local filesystem error categories, timeout cleanup requests, and the renderer/main boundary. Native file and conflict dialogs are not subject to a renderer-side timeout; the worker applies the transfer deadline after those dialogs settle. P-10 remains PARTIAL because the E2E server is plaintext FTP and does not validate explicit FTPS certificate behavior or broad third-party server interoperability. Serial support also remains open under F-016.

## Validation

Final `corepack pnpm check` passed on Windows x64 on 2026-10-24:

- TypeScript project and tool typechecks passed.
- ESLint and static/dynamic/import-boundary checks passed.
- 170 unit tests passed.
- The native Windows module and Vite renderer built successfully. Vite reports a non-blocking large JavaScript chunk warning.
- All 14 Electron E2E tests passed, including FTP upload/download, exact `STOU` wire command and CWD behavior, cancel/`DELE` cleanup, and profile persistence/reconnect.

The complete E2E run also passed the terminal-tab actions test after it had transiently failed once in an earlier full run; the isolated reproduction passed as well.

## Security and remaining scope

Plain FTP remains explicitly warning-gated because credentials and file contents are unencrypted. The UI never accepts local filesystem paths from renderer commands. FTPS certificate and interoperability behavior require additional Windows acceptance against compatible test servers before P-10 can be marked verified. FTP server STOU behavior is verified by the loopback fixture only; broader interoperability remains open. Transfer cancellation cleanup depends on server/filesystem behavior, and a forced worker termination after the bounded cleanup grace can leave a local partial file. Explicit local overwrite has the documented identity-check-to-rename race with concurrent local writers.
