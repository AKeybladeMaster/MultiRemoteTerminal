# ADR-0017: Bounded, conflict-checked remote text editing

**Status:** Accepted for WP-08C, 2026-10-25

## Context

F-014 and P-27 call for text editing with remote conflict detection. The existing SFTP worker owns remote file I/O, path validation, operation cancellation and channel lifetime. A direct renderer file API would violate the architecture boundary, and buffering an unbounded remote file in the renderer would make memory use unpredictable.

## Decision

- Expose read and save as exact, typed `ssh.files.read-text` and `ssh.files.write-text` IPC commands. The renderer can read contents only after the user chooses **Edit** on a regular SFTP file.
- Accept valid UTF-8 text only, reject NUL and malformed UTF-16 surrogate sequences, and cap encoded content at 512 KiB.
- Identify the loaded contents with a SHA-256 revision. Before commit, re-read the remote file and require both its revision and available SFTP identity metadata to match the original version.
- Write to a unique exclusive sibling `.mrt-*.partial` file. Cross a reported commit boundary, move the original to a unique `.mrt-*.backup`, verify the moved contents, replace the original, and attempt rollback if replacement fails.
- Allow one SFTP operation at a time per session. Honor cancellation before commit; once commit starts, permit bounded cleanup to settle.
- Keep the UI explicit: no autosave, preserve the draft on conflict, and confirm before discarding it for reload or close.

## Consequences

The size limit bounds worker, IPC and renderer memory for one operation. Unsupported binary/large files fail closed without returning partial text. Revision checks prevent overwriting an observed concurrent edit and the retained draft supports recovery. SFTP is path-based, so an untrusted server may race an ancestor between checks; a lost connection or forced worker termination may leave a `.partial` or `.backup` file. Backup cleanup is best effort. The editor does not yet provide local editing, syntax profiles or highlighting.

## Verification

See [WP-08C acceptance evidence](../results/WP-08C-remote-text-editor-2026-10-25.md) for unit, contract, build, lint and Windows loopback UI results.
