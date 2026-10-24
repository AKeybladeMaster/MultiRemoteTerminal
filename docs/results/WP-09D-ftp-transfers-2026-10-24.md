# WP-09D FTP transfer evidence

**Date:** 2026-10-24  
**Branch:** `dev-1`  
**Requirements:** F-016 (partial), P-10 (partial)

FTP sessions now support upload and download from the remote-files pane. The renderer sends only a session ID, operation ID and remote path through preload IPC. Main owns native file/save dialogs and asks for overwrite, rename, skip or cancel behavior; the approved local path travels only over the private worker protocol. A supervised FTP utility worker streams one transfer per session and sends validated progress events back through the main broker.

Uploads read a regular local file through an opened file handle, stream to a random remote sibling `.partial` name, then rename into place. Overwrite uses a remote backup/replace sequence where the server permits it. Downloads stream into a sibling local `.partial` file and commit without replacing an unapproved target; explicit overwrite, rename-copy and skip behavior are supported. Cancellation destroys active streams and removes temporary data when the remote server or local filesystem permits. The existing `basic-ftp` dependency is reused; no package was added.

The remote-files pane now has an upload action, per-file download actions, byte progress, and a cancel control. A Windows loopback FTP E2E exercises both directions through the actual Electron renderer, main broker, utility worker and disk. Unit tests cover transfer policy, progress, cancellation cleanup and the renderer/main boundary. P-10 remains PARTIAL because the E2E server is plaintext FTP and does not validate explicit FTPS certificate behavior or broad third-party server interoperability. Serial support also remains open under F-016.

## Validation

`corepack pnpm check` passed on Windows x64 after the transfer implementation and renderer bridge assertion fix:

- TypeScript project and tool typechecks passed.
- ESLint and static/dynamic/import-boundary checks passed.
- 160 unit tests passed.
- The native Windows module and Vite renderer built successfully. Vite reports a non-blocking large JavaScript chunk warning.
- All 14 Electron E2E tests passed, including FTP upload/download and profile persistence/reconnect.

The initial full check exposed a stale expected preload-key list in the terminal isolation E2E. The isolated test failed only on the four newly exposed FTP transfer bridge keys; after updating the assertion, the isolated test and complete check passed.

## Security and remaining scope

Plain FTP remains explicitly warning-gated because credentials and file contents are unencrypted. The UI never accepts local filesystem paths from renderer commands. FTPS certificate and interoperability behavior require additional Windows acceptance against compatible test servers before P-10 can be marked verified. Transfer cancellation cleanup depends on server/filesystem behavior, and conflict handling returns a stable failure when the destination changes during commit.
