# ADR-0054: Opt-in text editor autosave

- **Status:** Accepted
- **Date:** 2026-10-28
- **Requirement:** F-014 / P-27

## Context

The local and SFTP text editors already save through revision-checked operations and preserve the draft after conflicts. Optional autosave is part of the editor work, but automatic writes must remain visible and under user control.

## Decision

Add a per-open-file checkbox, off by default. When enabled, save one second after the last edit. Use the existing local or SFTP save operation, including its revision check and failure handling. Keep the draft on conflict or any save error, and do not retry until the user edits again or explicitly selects Save. Cancel a pending timer when the file closes, reloads, or the user disables autosave. Reset the option when another file is opened; do not persist it in workbench settings.

Manual Save, Reload, and close/discard confirmation remain available. Autosave changes no IPC command, worker interface, storage schema, logging format or dependency.

## Consequences

- An explicit opt-in is required before the open file can be written automatically.
- Local and remote saves retain the existing staged-write and revision-conflict guarantees.
- A failed save leaves the editor draft in memory for correction or manual recovery; no automatic retry loop runs.
- F-014/P-27 remain partial because broader language profiles remain open.
