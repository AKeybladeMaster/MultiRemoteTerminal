# WP-08D: Local text editor

## Requirement coverage

- F-014 and P-27: implemented bounded local open/edit/save behavior through the native-picker-backed main flow, explicit save/reload, line-ending preservation, draft retention on conflict, and close confirmation. Automated UI acceptance uses a guarded selected-path hook, so native picker selection and dismissal still need Windows UI verification.
- P-27 and F-014 remain PARTIAL: syntax profiles and autosave are not implemented.

## Behavior

- The app offers **Edit local file** in the global header and opens a native file picker after the user selects it.
- Main retains the selected absolute path behind one in-memory UUID handle. The renderer only sees that handle, the basename, and text capped at 512 KiB.
- A one-shot Electron utility worker accepts regular files with strict UTF-8, rejects NUL and malformed input, and checks SHA-256 content revisions before saving.
- Saves stage an exclusive sibling, recheck the source, move it to a backup and create the replacement without replacing a path created concurrently. Failure attempts a no-replace backup restore.
- The editor requires explicit Save, Reload and Close; confirms before discarding a dirty draft; preserves the draft after a save conflict; and saves with the first line-ending style observed in the file. When the source mixes line endings, both editors disclose that saving normalizes to the first style.
- The app clears the handle on close or shutdown. No file paths or content are logged or persisted by this feature.

## Architecture

- Renderer → typed allowlisted preload IPC → main broker → `LocalTextEditorController` → one-shot `LocalTextFilesWorkerHost` → local file worker.
- The renderer cannot send an arbitrary filesystem path, and it has no Node or filesystem permissions.
- ADR: [ADR-0022](../adr/ADR-0022-local-text-editing.md).

## Validation

- Focused command `node --test tests/unit/local-text-editor.test.ts tests/unit/local-text-file-provider.test.ts tests/unit/broker.test.ts tests/unit/text-editor-format.test.ts tests/unit/text-editor-errors.test.ts`: **35 passed, 0 failed**.
- `corepack pnpm typecheck`: passed.
- `corepack pnpm lint`: passed, including static import-boundary checks.
- `corepack pnpm build`: passed on Windows x64; renderer bundle was 919.22 kB minified and Vite reported its >500 kB chunk warning.
- `corepack pnpm setup:electron`: passed.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "Windows local text editor|SFTP sessions verify trust and transfers" --reporter=line`: **2 passed**. These Windows E2Es verify local and remote mixed-line-ending disclosure and normalization along with conflict preservation/reload. The local test uses the guarded `--mrt-e2e-local-text-file=...` path hook, not Electron's native picker. The controller unit test confirms a canceled picker result does not invoke the file provider; native picker selection/dismissal is not UI-automated.
- `git diff --check`: passed after the mixed-ending changes.

## Limitations and risks

- Windows file ACL preservation after staged replacement is not verified. Typical local NTFS supports the same-directory hard links used for no-replace install and rollback; filesystems without hard-link support fail closed and may leave a backup if rollback cannot restore safely.
- The Windows E2E bypasses the native file picker through a test-only argument guarded by unpackaged mode, `MRT_E2E=1`, and the exact feature flag. Actual native dialog selection/dismissal remains unverified by UI automation.
- Forced worker termination during the short replacement window can leave a `.mrt-*.partial` or `.mrt-*.backup` file for manual recovery.
- The UI currently edits one selected file at a time. No syntax profile, syntax highlighting or autosave is included.

## Review

Final independent review covered `d3a423391a5b233c810d5f87b798433c7a5a966b..3bfb39117217f62cd2910eeaa07f622a80d12573`.

### Standards

No remaining documented-standard violations or baseline smells. The follow-up consolidated local file-open error messages into the shared text-editor error mapper. Native picker selection/dismissal remains explicitly listed as unverified UI evidence.

### Spec

No remaining findings. F-014/P-27 remain partial because syntax profiles and autosave are still open. Local and remote E2Es verify the mixed-line-ending notice and saved bytes use the first detected style. The local E2E's guarded path hook and native-picker automation limitation are accurately documented. No scope creep was identified.
