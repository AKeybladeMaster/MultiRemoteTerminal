# WP-08D: Local text editor

## Requirement coverage

- F-014 and P-27: implemented bounded local text opening, explicit save/reload, line-ending preservation, draft retention on conflict, and close confirmation.
- P-27 and F-014 remain PARTIAL: syntax profiles and autosave are not implemented.

## Behavior

- The app offers **Edit local file** in the global header and opens a native file picker after the user selects it.
- Main retains the selected absolute path behind one in-memory UUID handle. The renderer only sees that handle, the basename, and text capped at 512 KiB.
- A one-shot Electron utility worker accepts regular files with strict UTF-8, rejects NUL and malformed input, and checks SHA-256 content revisions before saving.
- Saves stage an exclusive sibling, recheck the source, move it to a backup and create the replacement without replacing a path created concurrently. Failure attempts a no-replace backup restore.
- The editor requires explicit Save, Reload and Close; confirms before discarding a dirty draft; preserves the draft after a save conflict; and saves with the first line-ending style observed in the file.
- The app clears the handle on close or shutdown. No file paths or content are logged or persisted by this feature.

## Architecture

- Renderer → typed allowlisted preload IPC → main broker → `LocalTextEditorController` → one-shot `LocalTextFilesWorkerHost` → local file worker.
- The renderer cannot send an arbitrary filesystem path, and it has no Node or filesystem permissions.
- ADR: [ADR-0022](../adr/ADR-0022-local-text-editing.md).

## Validation

- Focused command `node --test tests/unit/local-text-editor.test.ts tests/unit/local-text-file-provider.test.ts tests/unit/broker.test.ts`: **32 passed, 0 failed**.
- `corepack pnpm typecheck`: passed.
- `corepack pnpm lint`: passed, including static import-boundary checks.
- `corepack pnpm build`: passed on Windows x64; Vite reported the existing large renderer chunk warning.
- `corepack pnpm setup:electron`: passed.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts -g "Windows local text editor"`: **1 passed**. The UI test exercised selected-file open, external-edit conflict, preserved draft, confirmed reload, line-ending-preserving save and hidden-path check.
- `git diff --check`: passed before review.

## Limitations and risks

- Windows file ACL preservation after staged replacement is not verified. Typical local NTFS supports the same-directory hard links used for no-replace install and rollback; filesystems without hard-link support fail closed and may leave a backup if rollback cannot restore safely.
- Forced worker termination during the short replacement window can leave a `.mrt-*.partial` or `.mrt-*.backup` file for manual recovery.
- The UI currently edits one selected file at a time. No syntax profile, syntax highlighting or autosave is included.

## Review

Pending independent Standards and Spec review.
