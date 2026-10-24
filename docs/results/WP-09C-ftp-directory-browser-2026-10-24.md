# WP-09C — FTP/FTPS saved profiles and directory browser

**Date:** 2026-10-24
**Requirements:** F-016 (partial), P-10 (partial), F-018 credential-free saved metadata (partial)
**Branch:** `dev-1`

## Delivered behavior

The workbench can open explicit FTPS by default or plaintext FTP after a visible, endpoint-bound one-use warning. Account credentials are entered in a separate Windows credential prompt. The app opens the server in an Electron utility worker and displays a read-only remote directory browser with navigation, refresh, file sizes, item kinds and a truncation notice. Saved FTP profiles retain only canonical host, port, and whether explicit FTPS is selected; they survive app restart and request credentials again when reopened. A failed FTP listing marks the connection unusable and offers a reconnect path that requests credentials again.

The FTP worker uses `basic-ftp@6.2.3`, disables protocol logging, caps active connections at 32, serializes access per connection, applies a 30-second server-progress timeout, caps listing bytes at 2 MiB and results at 500 entries, and refuses passive transfer redirects to another host. The main process brokers typed FTP commands; the preload and broker independently gate plaintext FTP on a fresh trusted user action. Cancellation and shutdown cover the credential prompt, connection and active listing.

## Architecture and security decisions

- The application owns validation and lifecycle through `FtpFilesController`; domain endpoint validation has no protocol or desktop dependency.
- FTP credentials, paths and server-provided names reject control characters before reaching the line-oriented FTP protocol, preventing command injection through protocol arguments.
- The renderer receives only typed endpoint and bounded file metadata. Credentials are sent from the native prompt through main to the utility worker and are cleared from owned request objects after connection setup. They are never stored in SQLite or saved-folder bundles.
- FTPS uses the client's default TLS certificate validation. Plain FTP sends credentials and file data unencrypted, so the UI warns before each such connection.
- No architecture departure was required. `basic-ftp` is exact-pinned, MIT-licensed, pure JavaScript, has no runtime dependencies, and declares Node.js `>=10`; package details are in [the dependency review](../dependencies/WP-09C-basic-ftp.md).

## Validation evidence

- `corepack pnpm check` passed on Windows x64: typecheck, lint/import-boundary checks, 159 unit tests, production build and all 14 Electron/Playwright end-to-end tests.
- One earlier full-suite run had a single saved-session menu focus assertion fail; the focused test passed in isolation and in 12 consecutive repeats, and passed again in the successful full run. The Escape handler already returns focus to the menu trigger.
- A repeated diagnostic run exposed a Windows single-instance focus race. Calling Electron's `app.focus()` when activating the primary window made the focused scenario pass 10 consecutive runs. The acceptance case now starts with a hidden window and verifies that the second process makes it visible, unminimized and focused; the full suite passed.
- One merged-tree run had an isolated multi-tab resize assertion fail under full-suite load. The focused Windows resize test then passed five consecutive runs, and the next complete `corepack pnpm check` passed all 159 unit tests and 14 Electron E2E tests, including that resize scenario.
- The focused worker-host tests verify stale-worker cleanup and the composition-root FTP environment allowlist, including omission of unrelated inherited secret variables.
- `corepack pnpm build` passed on Windows x64 with Electron 45 / Node 24. The build reports the existing Vite advisory about the renderer chunk being above 500 kB; there is no build failure.
- The FTP acceptance path in the full 14-test Windows E2E suite passed. Its local passive plaintext fixture verifies the warning, real FTP authentication, root and nested directory navigation through the worker, file/folder metadata, no visible password, saved profile with null username/credential reference, persistence after app restart and reconnect after a dropped connection. It does not verify explicit FTPS handshaking or certificate behavior.
- `corepack pnpm audit --prod` reported no known vulnerabilities.

## Remaining work and limits

This is a read-only FTP/FTPS browser. Upload/download, progress, cancellation of transfers, collision policy, destination-root enforcement, partial-file cleanup and FTPS certificate/server interoperability are not implemented or verified. It does not complete P-10 or F-016. P-10 should remain PARTIAL until transfer tests pass on Windows. Other planned parity providers also remain open.

**Next slice:** implement bounded FTP downloads and uploads with safe local destination selection, transfer progress/cancellation and explicit overwrite handling; then add SFTP transfers through the already trusted SSH connection.
