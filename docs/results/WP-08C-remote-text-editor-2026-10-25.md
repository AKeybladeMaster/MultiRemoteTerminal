# WP-08C remote SFTP text editor — acceptance evidence

**Date:** 2026-10-25
**Branch:** `dev-1`
**Requirements:** F-014 (partial), P-27 (partial)

## Delivered behavior

- Edit actions appear only for regular files in SFTP sessions.
- Remote reads accept strict UTF-8 up to 512 KiB and return an SHA-256 revision; binary, NUL-containing, malformed UTF-8 and oversized content fail without partial text.
- Saves use a unique exclusive sibling, compare the loaded revision and remote identity before commit, back up and replace the source with rollback attempts.
- Save, reload and close are explicit. Conflicts retain the user's draft; reload and close ask before discarding it.
- Progress, cancellation, operation serialization and exact credential-free IPC validation pass through application, main, worker and SFTP provider boundaries.

## Architecture decisions

The domain stays framework-free and supplies bounded text/revision validation. The SSH application controller owns the per-session operation gate and cancellation. The utility worker owns all SFTP reads/writes. Renderer text access requires an explicit Edit action and uses only the typed preload bridge. The operation limit and staged replacement policy are recorded in [ADR-0017](../adr/ADR-0017-remote-text-editing.md).

## Files changed

Domain: `packages/domain/src/remote-text-file.ts`. Application and IPC: `packages/application/src/ssh-terminals.ts`, `packages/contracts/src/commands.ts`, `apps/desktop/src/preload/client.ts`, `apps/desktop/src/main/broker.ts`, and `apps/desktop/src/main/index.ts`. SSH worker path: `apps/desktop/src/adapters/ssh-terminal-worker-host.ts`, `apps/desktop/src/workers/ssh-protocol.ts`, `apps/desktop/src/workers/ssh-worker.ts`, `apps/desktop/src/workers/ssh-transport-provider.ts`, and `apps/desktop/src/workers/sftp-file-transfers.ts`. UI: `apps/desktop/src/renderer/RemoteFilesPane.tsx`, `apps/desktop/src/renderer/RemoteTextEditorDialog.tsx`, and `apps/desktop/src/renderer/tokens.css`. Focused unit and Windows E2E coverage is in `tests/unit/remote-text-file.test.ts`, `tests/unit/sftp-file-transfers.test.ts`, `tests/unit/ssh-terminals.test.ts`, `tests/unit/contracts.test.ts`, `tests/unit/bridge.test.ts`, `tests/unit/broker.test.ts`, `tests/unit/ssh-worker-protocol.test.ts`, `tests/unit/ssh-terminal-worker-host.test.ts`, and `tests/e2e/foundation.test.ts`.

## Validation results

- `corepack pnpm typecheck` — passed.
- `corepack pnpm lint` — passed, including import-boundary checks.
- Focused test command over domain, SFTP worker, SSH application, IPC contract, preload, broker, worker protocol and worker host — **113/113 passed**.
- `corepack pnpm build` — passed for Windows x64 with the local native build tools. Vite reports the renderer JavaScript chunk at 742.94 kB, above its 500 kB advisory threshold.
- `corepack pnpm setup:electron` — passed.
- Focused Playwright Windows loopback SFTP test — passed. It verifies initial file contents, save bytes on the fixture filesystem, same-size concurrent replacement, conflict reporting, draft retention, explicit reload, cancelled-read recovery, the guarded save-commit phase, CRLF preservation, and the unchanged no-shell SFTP-only path.
- Rendered dialog screenshots were inspected at 980×729 and 650×701. The content area and action row remain visible at the narrower window size. This was a visual inspection, not a pixel comparison against a supplied design target.

## Security risks and limitations

Remote file contents are returned only after explicit user action and are not logged or persisted by this feature. The application rejects unsupported content and enforces the 512 KiB bound across the domain, IPC and worker. SFTP v3 is path-based and cannot fully prevent a hostile server from racing an ancestor between checks. A disconnected or forcibly terminated worker may leave a `.mrt-*.partial` or `.mrt-*.backup` remote file; backup cleanup is best effort. No external/public SFTP server, network-loss recovery, high DPI matrix or 100 MB file test was available. F-014 remains partial: local editing, syntax color profiles, keyword highlighting and autosave remain open.

## Review and promotion

- Standards review against `origin/main...3281920`: no documented-standard breaches. It recorded two judgment calls: repeated SFTP session-lock wrapper logic and revision values represented as strings. These remain tracked for later design review; the wrappers preserve operation-specific behavior and revisions are validated at serialized boundaries.
- Spec review against `docs/SPEC-001-MultiRemoteTerminal.md`: zero actionable findings. F-014 and P-27 remain partial as documented.
- General review found an important close-during-operation lifecycle issue and a line-ending normalization issue. The original UI regression test failed before the fix: after canceling a delayed read, the SFTP Edit action remained disabled.
- Fixed by keeping the dialog open until an operation settles, offering pre-commit cancellation, preventing close/discard while busy or committing, clearing activity on effect cleanup, and preserving the original file's first line-ending style. The Windows E2E regression passes after these changes; it also checks the first-style policy with a CRLF fixture.
- Final independent review: **Ready to merge.** Standards review found no documented-standard breaches; the repeated SFTP wrapper and string revision observations remain judgment calls. Spec review found zero actionable findings. The general reviewer confirmed that the lifecycle and line-ending issues are fixed and found no remaining actionable issues.
- Promotion to `main` is pending remote verification.
