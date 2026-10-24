# WP-05A — Contextual SFTP directory browser

**Date:** 2026-10-24  
**Requirements:** F-005 (partial), P-14 (partial); P-11 and P-15 remain planned.  
**Status:** Implemented code slice; not Windows-SFTP-verified.

## Behavior

A running SSH terminal shows a contextual `Remote files` pane. The pane lists and navigates directories through the SFTP subsystem of the same host-verified SSH connection. Listings are sorted, capped at 500 entries, and marked when truncated. Directory paths and entries are validated at the domain, IPC and worker boundaries. Symlinks are identified and displayed without following them. An unavailable SFTP subsystem produces a clear pane error while leaving the terminal session usable.

The renderer uses a typed `ssh.files.list` command and receives no Node, filesystem or credential capability. The SSH controller accepts cancellation; worker cancellation closes the SFTP channel while preserving the terminal when possible. Each SSH session serializes SFTP requests. Paths are passed as SFTP data and never interpolated into shell commands.

The browser pane uses keyboard-operable folder buttons, labeled controls, live path/status announcements and visible focus styles. Existing saved-session action menus were also corrected: inline position mutations were blocked by the strict style CSP and clipped actions in the scroll area. Their state is now React-owned, and scoped CSS anchor positioning keeps the menu in the window, with Escape and outside-click dismissal.

## Architecture decisions

- Reuse the already pinned `ssh2@1.17.0` client and its trusted SSH lifecycle; no package was added. The pinned [`ssh2` SFTP API](https://github.com/mscdex/ssh2/blob/v1.17.0/SFTP.md) supplies `realpath`, directory handles and `readdir`.
- Keep transport work in the SSH utility worker and expose only the validated typed application command.
- Bound directory responses to 500 entries, the request to 10 seconds, and SFTP subsystem setup to 15 seconds. A subsystem that never answers is treated as a failed transport so the unknown channel cannot remain unowned.
- Use CSS anchor positioning rather than renderer style-attribute mutation for saved-session actions. The application pins Electron 45; its published runtime uses Chromium 156. Chromium shipped anchor positioning in 125 and `anchor-scope` in 131, so the pinned runtime supports the scoped menu layout. See the [Electron 45 runtime version](https://releases.electronjs.org/release/v45.0.0), [Chrome anchor positioning API](https://developer.chrome.com/docs/css-ui/anchor-positioning-api), and [Chrome 131 `anchor-scope` release note](https://developer.chrome.com/release-notes/131?hl=en).

## Validation

- `corepack pnpm check` — passed: typecheck, lint and import-boundary checks; 122 unit tests; production build; all 12 Windows E2E tests.
- Saved-session action menu/delete E2E — passed four consecutive targeted runs after fixing the CSP-blocked positioning and React state race. The test also verifies Escape dismissal and focus restoration.
- `corepack pnpm test:ssh-fixture` — 0 failures; its one OpenSSH/SFTP integration test was skipped because `MRT_TEST_SSH_HOST`, `MRT_TEST_SSH_PORT`, `MRT_TEST_SSH_USERNAME`, `MRT_TEST_SSH_PASSWORD` and `MRT_TEST_SSH_FINGERPRINT` are not configured.
- `git diff --check` — passed.
- Build retains the existing Vite warning that the renderer bundle exceeds 500 kB (about 609 kB minified); build completed successfully.

## Limitations and next slice

There is no real Windows OpenSSH/SFTP fixture in this environment, so the end-to-end SFTP handshake and remote listing remain unverified. This slice does not upload or download files, implement overwrite/collision handling, provide transfer progress/cancellation, or open standalone SFTP sessions. Keep F-005 and WP-05 incomplete until those behaviors pass their Windows acceptance gates. The next independent WP-05 slice should add secure transfer jobs and validate cleanup, symlink/path policy and local destination containment against a disposable Windows SFTP fixture.
