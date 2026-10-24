# WP-03D saved-folder bundles

**Requirements:** F-018 secure import/export (saved-folder configuration subset); P-13 persisted saved-session folders.

Saved-session folders can be exported as versioned JSON and imported through native file dialogs. Export contains the selected folder, descendants and their saved local/SSH definitions. The format preserves IDs, names, folder relationships, favorites and timestamps, while excluding credentials and terminal history. Imports into another profile retain the folder tree and definitions. Matching IDs and metadata are idempotent; a conflicting folder or session aborts the whole import.

The bundle schema accepts only exact version 1 records, caps the file at 16 MiB and the bundle at 100,000 total records. Invalid UTF-8, malformed JSON, unsupported versions, secret-bearing records and unknown fields are rejected. Export writes a same-directory temporary file and renames it to the selected destination. Import validates before mutation and runs all inserts under one SQLite transaction. The recursive export queries deduplicate IDs and cap result rows before decoding.

Review follow-up: bundle sibling-name validation now matches SQLite's ASCII-only `NOCASE` behavior, so accepted non-ASCII case variants round-trip. Export temp paths are created by the storage host and removed after a worker exit, including cancellation or crash during a partial write. Native file pickers remain user-controlled modal operations: they resolve on selection or dismissal, have no renderer deadline, and discard a selected path if cancellation was requested while the picker was open.

## Validation

- `corepack pnpm check` — passed on Windows x64: TypeScript checks, ESLint and import-boundary checks, 94 unit/adapter tests, native and renderer build, and all 11 Electron E2E tests.
- SQLite adapter tests — verified subtree round-trip, credential-free JSON, idempotent re-import, malformed bundle rejection and transaction rollback after a late ID conflict.
- Windows Electron E2E — exported a saved folder using the app command wired to the native save-dialog adapter, imported it into a fresh profile using the open-dialog adapter, verified the folder/session and count, then restarted the target profile and verified they remained persisted. The test substitutes native dialog results with test-owned paths; the file write, read, SQLite workers and renderer/preload/main flow are real.
- `git diff --check` — passed before commit.

Review follow-up tests cover Unicode sibling-name round-trip, exact temporary-path validation, removal of a partial export after worker cancellation, and a native picker request pending beyond the former 75-second IPC deadline.

## Security and remaining work

The bundle is not encrypted. It can reveal folder names and remote host/port configuration, although it contains no credentials/private keys or terminal output. Users should protect the exported file as connection configuration. The implementation does not add settings-profile templates or opt-in encrypted secret export, so F-018 remains PARTIAL. Saved-session definitions already persist in per-user SQLite across process restart; there is no separate app account/logout flow.
