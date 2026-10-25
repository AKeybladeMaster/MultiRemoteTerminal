# ADR-0022: Bounded local text editing through selected-file handles

**Status:** Accepted for WP-08D, 2026-10-26

## Context

F-014 calls for local and remote text editing. WP-08C provides bounded, conflict-checked SFTP editing, but local files need to remain outside renderer filesystem access. A renderer-supplied path would turn the narrow IPC bridge into a general file API.

## Decision

- Open a local document only after the user selects a file in the native Windows file picker.
- The main-process application controller retains the absolute path in one in-memory selection and returns an opaque UUID, the basename, and bounded text. Renderer commands can only refer to that selection UUID; they cannot provide or receive a local path.
- Run file reads and writes in a one-shot Electron utility process. Accept regular files only, strict UTF-8, no NUL, and a 512 KiB encoded-content limit. The worker checks file identity and SHA-256 revision before returning or saving.
- Stage saves in a unique exclusive sibling file, verify the source again, move it to a unique sibling backup, and create the replacement without replacing a file that appeared concurrently. Attempt to restore the backup on failure without overwriting a concurrent file.
- Keep save, reload and discard actions explicit. Preserve the draft after conflict and confirm before discarding it. Preserve the first line-ending style when saving. The selected path and draft are not persisted.
- The utility process has a 15-second operation deadline. On app shutdown or renderer teardown, the selection is cleared; temporary or backup cleanup after forced process termination is best effort.

## Consequences

The renderer gets file contents only after a native selection and never receives filesystem permissions or the selected path. A lost process during the replacement window may leave a `.mrt-*.partial` or `.mrt-*.backup` recovery file. Save relies on same-directory hard links for a no-replace commit and rollback; filesystems without that support fail the save and may leave the backup for manual recovery. Replacing a file stages a new file and does not yet have verified Windows ACL-preservation behavior. Windows acceptance must check that limitation before this behavior is marked verified.

This slice completes local file opening and explicit local save/reload behavior. Syntax profiles, automatic saving, shell-aware coloring and broad editor workflows remain outside this decision.

## Verification

See [WP-08D local text editor results](../results/WP-08D-local-text-editor-2026-10-26.md) for focused unit, contract, build, lint and Windows UI evidence.
