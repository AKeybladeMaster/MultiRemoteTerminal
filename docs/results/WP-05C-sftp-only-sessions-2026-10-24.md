# WP-05C — Standalone SFTP-only sessions

**Date:** 2026-10-24
**Branch:** `dev-1`
**Requirements:** P-11 (verified for the covered workflow); F-005/P-14 (partial); P-15 remains planned.
**Status:** Standalone files-only SSH/SFTP connection, saved-profile reopen and credential-free bundle support implemented. WP-05 remains open.

## Behavior

The workbench can open a standalone SFTP session through the existing SSH endpoint validation, host-key trust decision and native credential prompt. The SSH transport authenticates but does not request a PTY or shell. The resulting SFTP tab supports remote directory browsing and the existing upload/download operations. Closing a file tab closes the SSH-backed session. Users can save and reopen the endpoint as an SFTP profile.

Saved SFTP definitions contain only the canonical host and port. SQLite stores the profile through the existing allowed `ssh` row kind plus the exact options marker `{"sftpOnly":true}`, which the adapter decodes as domain kind `sftp`. Saved-folder bundle format v3 exports SFTP metadata; versions 1 and 2 retain their prior allowed session kinds. No password, private key, terminal history or local path is saved or exported. The storage decision is recorded in [ADR-0008](../adr/ADR-0008-sftp-only-sessions.md).

The `pnpm start` launcher also removes an inherited `ELECTRON_RUN_AS_NODE` flag from only the Electron child environment. The flag caused this workstation's first interactive start attempts to enter Node mode and fail while importing Electron's main-process `utilityProcess` API. A focused regression test covers this environment handling.

## Validation

`corepack pnpm check` passed on Windows x64:

- TypeScript project and tool typechecks passed.
- ESLint and static/dynamic/import-boundary checks passed.
- 194 unit tests passed, including files-only lifecycle, IPC validation, SQLite and bundle compatibility, and the launcher environment regression.
- The native Windows x64 module and Vite renderer built successfully.
- All 15 Electron Windows E2E scenarios passed. The SSH/SFTP loopback scenario verifies host trust, file listing, existing contextual transfers, standalone SFTP, saved-profile reopen and no shell request.

The standalone SSH/SFTP E2E scenario also passed five consecutive isolated runs. An earlier full run had one transient `ssh2` fixture-key parse error before application startup; it did not reproduce in those five repeats or the final full E2E run. The bridge-surface expectation that also failed in that early run was updated to include `openSftpFiles` and `closeSftpFiles`.

The standalone SFTP tab was visually inspected from a real Electron Playwright capture at 1164×760. The files heading, path row, item count, upload/refresh controls and file download actions were visible within the workbench layout. This was an implementation inspection, not a 1:1 comparison to the 1550×1014 reference image and not a 200% DPI audit.

`pnpm start` was then run with the original inherited flag still present; the sanitized launcher stayed running without the Electron API error. The session was stopped after confirming startup. `git diff --check` passed before commit.

The build retains the non-blocking Vite warning that the minified renderer chunk exceeds 500 kB (630.20 kB in this build).

## Security limits and remaining work

Standalone profiles still require ordinary SSH host verification and interactive authentication. No shell or PTY is created in file-only mode. Existing SFTP path/transfer protections and their limitations remain in force: a path-based SFTP v3 server can race a checked ancestor; Windows overwrite has a small identity-check-to-rename race; forced termination or network loss may leave a partial file. 100 MB throughput, disconnect recovery, configurable browser behavior, drag/drop and broad production-server interoperability remain unverified. These gaps keep F-005/P-14 and the overall WP-05 gate partial.
