# WP-05E: bounded local-file drag/drop

**Date:** 2026-10-26  
**Branch:** `dev-1`  
**Requirement:** P-15; partial progress toward F-005/P-14

## Delivered

- The active SFTP or FTP remote-folder pane accepts up to 16 local files in a drop batch. Files upload serially, reusing the existing conflict decision, staged transfer, progress, cancellation and directory refresh. The Upload file button remains available.
- Sandboxed preload code captures trusted drop events and resolves native file paths with Electron `webUtils.getPathForFile`. A dedicated validated IPC channel sends paths only from preload to main.
- Main validates sender/frame, path shape, absolute regular-file status and capacity. It stores each path behind a random, one-use UUID bound to the originating WebContents, protocol, session and exact remote directory. Handles expire after 10 minutes and are cleared when the renderer is destroyed or its process exits.
- Renderer callbacks receive only the opaque token, filename and byte size. Renderer upload requests contain the token; the main broker resolves it and forwards the local selection through the existing protocol worker.
- Unused handles are discarded after a busy-batch rejection, queue completion/failure/cancellation and pane teardown. The discard command is typed and main enforces sender/session/protocol/directory binding; stale, unknown or mismatched tokens are harmless no-ops.
- Preload drops successful registrations when no active pane accepts the returned event. A deferred-registration unit test unsubscribes the only listener before completion and verifies immediate discard; the existing successful-drop test verifies a matching listener receives its event once.
- A guarded test-only preload hook uses a native-backed file to exercise the full upload path. Normal synthetic DOM drops are rejected by the trusted-event gate.

## Validation

- `corepack pnpm typecheck` — passed after the handle-discard follow-up.
- `node --test tests/unit/bridge.test.ts tests/unit/remote-file-drop.test.ts tests/unit/broker.test.ts` — 66/66 passed, including trusted-event gating, bounded payloads, sender/session/protocol/folder binding, one-use consumption, expiry, discard serialization/binding, no-listener cleanup, safe metadata and SFTP/FTP broker routing.
- `corepack pnpm lint` — passed, including ESLint and static import-boundary checks.
- `corepack pnpm build` — passed on Windows x64. Vite reports the existing large renderer bundle advisory (930.90 kB minified, 255.03 kB gzip).
- `corepack pnpm setup:electron` — passed before the handle-discard follow-up.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "SFTP sessions verify trust and transfers" --reporter=line` — 1/1 passed on Windows after the follow-up. The loopback SSH/SFTP fixture verifies uploaded remote bytes for a native-backed file sent through the active SSH file pane.
- `git diff --check` — passed after the follow-up.

## Limits

The E2E uses an E2E-only preload hook because Playwright cannot create an OS-trusted Explorer file-drop gesture. The preload trusted-event gate is covered by unit tests, but actual Windows Explorer drag automation remains unverified. 100 MB throughput, disconnect/recovery, configurable browser behavior and broader SFTP/FTP interoperability remain open; F-005 and P-14 stay partial.
