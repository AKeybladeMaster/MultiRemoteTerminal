# ADR-0029: Store and manually apply a PowerShell profile script

**Status:** Accepted for WP-07V
**Date:** 2026-10-26
**Requirements:** P-36, F-009

## Context

P-36 asks for a user-controlled PowerShell profile script with a preview, and F-009 explicitly forbids silent profile execution. Windows PowerShell normally loads profile files during shell startup, while this application deliberately starts its local PowerShell provider with `-NoProfile`. Changing the process startup arguments to load an arbitrary user path would run code whenever a terminal opens and would make a path, file permission, file replacement and startup-failure part of the app's security boundary.

## Decision

- Store a bounded script as plain text in workbench preferences schema v9. Do not store an executable path, read a user-selected script file, modify the user's normal `$PROFILE`, override execution policy, or execute the text during application startup or terminal creation.
- The general startup preference command returns a typed projection with the script field omitted. Only the explicit Settings read and the session-bound preview command can return the saved script text to the renderer.
- Limit the script to 8,000 UTF-16 code units, normalize line endings, reject malformed surrogate pairs, unsupported control characters, bidirectional formatting controls, and Unicode line/paragraph separators, and convert normalized newlines to Windows CRLF only when sending to a terminal. This keeps the complete text and final Enter within the local terminal's single-write bound while keeping the preview visually stable.
- Settings can edit and save the text. A separate preview command returns the exact saved value and a random, short-lived one-use token bound to the selected session. Applying requires a fresh trusted click on the Run button for the same session. The main broker consumes the gesture, the application controller verifies the token and that the stored text has not changed, and the local terminal controller accepts only a running local PowerShell session.
- The apply IPC payload contains only the session ID and opaque preview token; it never contains script text or a filesystem path. The main process reads the saved text and sends it through the existing terminal provider write capability.
- Explain in Settings and the user guide that the value is local plain text and can run commands with the user's Windows permissions. Users should not store passwords, tokens or other secrets in it.
- Warn users to run only at an idle PowerShell prompt; the app verifies that the terminal session is running but cannot detect whether another foreground program or prompt will receive the input.

## Consequences

- The application-owned script provides a previewed, explicit initialization action without adopting PowerShell's automatic profile-loading behavior. It is a saved script editor rather than a `$PROFILE` path manager; that documented scope change intentionally avoids renderer-visible filesystem paths and silent startup execution.
- Preference schema v8 migrates to v9 with an empty script. Unit and SQLite tests cover bounds, newline normalization, migration, persistence and backup/restore. Windows E2E verifies no startup/new-tab execution, exact preview, explicit per-session run and restart persistence.
- Saved settings are not encrypted. Script commands are not sandboxed and can change files, start processes, or contact network services allowed to the current Windows account. The preview is a safety check, not a security analysis of PowerShell code.
- PowerShell's documented profile startup behavior and `-NoProfile` switch are described in Microsoft's [about_Profiles](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_profiles?view=powershell-5.1) and [about_PowerShell.exe](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_powershell_exe?view=powershell-5.1) references.
