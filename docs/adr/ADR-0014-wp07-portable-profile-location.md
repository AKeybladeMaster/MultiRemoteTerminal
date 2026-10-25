# ADR-0014: Portable profile follows the executable folder

**Status:** Accepted
**Date:** 2026-10-25
**Requirements:** F-001, P-32, N-007

## Context

The Windows portable target needs a predictable data root while installed and development launches should continue using Electron's normal per-user paths. Electron's portable launcher supplies the selected executable directory and filename. The app must choose paths before it starts its storage worker, and it must not guess a directory from inherited environment variables.

## Decision

Portable mode is an explicit choice to run the portable executable. The user selects the portable data location by placing that executable in a writable folder of their choice. Main validates that the launcher-provided executable path is absolute and has the same parent as the reported executable directory, then stores the profile under `MultiRemoteTerminal-data` in that folder. A `session-data` child directory is created before Electron becomes ready and both `userData` and `sessionData` are pointed there.

Development and installed launches retain Electron's default profile paths. There is no in-app arbitrary-path picker in WP-07A. If the portable folder cannot be prepared, main emits a fixed redacted diagnostic event, presents a generic recovery message, and exits before creating workers.

## Consequences

- Copying or moving the portable executable and its sibling data folder preserves the portable profile location. Moving only the executable selects a new, empty location.
- The chosen folder must be writable by the current user. No elevation is requested.
- Saved connection metadata follows the folder, but OS-protected credentials remain bound to the Windows user's protection context and are not promised to decrypt under another account or machine.
- The Windows 11 smoke test places the executable in a selected temporary folder and verifies the SQLite database, workbench and local PowerShell session there. Windows 10 acceptance remains open.

## Alternatives considered

- **Prompt for any path on first launch:** rejected for this slice; it adds first-run state and migration behavior before Electron path setup without being required by the portable executable workflow.
- **Use the installed per-user profile:** rejected because a portable launch would then not keep its profile with the selected portable folder.
