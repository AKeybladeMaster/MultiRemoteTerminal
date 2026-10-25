# WP-06A Windows evidence: persistent macro library

**Date:** 2026-10-25

**Branch:** `dev-1`

**Requirements:** F-007/P-40 were partial at this WP-06A stage; P-28 recording/replay and P-19 MultiExec were not covered here. WP-06D later verifies P-40.

## Delivered

- Added a versioned exact macro schema for ordered `send`, `waitForText`, `delay`
  and `confirm` steps, with bounded step count and content size.
- Added application-level catalog CRUD, SQLite storage in the existing utility
  worker, typed preload IPC and an accessible macro manager editor.
- Definitions have no target or credential fields and no catalog count cap.
  The UI warns that macro fields are stored in the local database and should
  not contain passwords, tokens or private-key content.
- No recording, playback, secret-input suppression or MultiExec behavior is
  claimed by this slice.

## Windows validation

Ran `corepack pnpm check` on Windows x64 with Node 24.14.1 and Electron 45.0.0:

- TypeScript typecheck: passed.
- ESLint and static import-boundary checks: passed.
- Unit suite: 243 passed, 0 failed, including the boundary-whitespace regression
  for `send` commands and literal wait text.
- Native module and renderer build: passed. Vite reports that the renderer
  bundle exceeds its 500 kB warning threshold.
- Electron E2E: 18 passed, 0 failed. The macro scenario creates a typed
  definition, edits ordered steps, restarts the app using the same profile,
  verifies persisted values, then deletes the definition.
- SQLite adapter test creates and persists 100 definitions across reopen,
  updates one and deletes another, with no count quota.

The E2E suite checks the sandboxed preload method allowlist after the four
macro methods were added. The optional OpenSSH integration fixture was not run
as it is outside `pnpm check` and no fixture credentials were configured.

## Security and remaining limits

The schema rejects credential-shaped properties and stores no connection
target. User-authored names, descriptions and step text remain ordinary local
database content; the editor warns against secrets but does not detect every
secret pattern. Macro text is not logged. Playback must show an exact preview
before this data is sent to any terminal. At the WP-06A stage, F-007/P-40 were
partial while recording, playback, secret suppression, cancellation and
Windows replay acceptance remained open. WP-06B/C/D later address those
slices; P-40 is now verified by WP-06D, and P-28 remains partial because
macro-specific keyboard bindings are not implemented, prompt detection is
heuristic, and SSH/Telnet playback interoperability remains open.

See [ADR-0013](../adr/ADR-0013-wp06-macro-safety-and-storage.md) for the
architecture and safety decisions.
