# WP-07V — Bounded PowerShell profile script

**Requirements:** P-36; F-009 (PowerShell profile-script portion)
**Status:** P-36 VERIFIED for the documented app-managed script workflow; F-009 remains incomplete.

## Behavior

- Workbench settings save an 8,000 UTF-16 code-unit PowerShell script in preference schema v9. The value is local plain text and is not included in saved-session folders or credential storage.
- The PowerShell provider continues to start with `-NoProfile`; saving the script does not edit `$PROFILE` or execute it during application startup or when a terminal opens.
- Settings previews the exact stored script. Main creates a short-lived, one-use preview token bound to one session. The explicit trusted Run action applies only an unchanged saved value to an already-running local PowerShell terminal.
- IPC carries only the session ID and opaque token for application. The script stays in main-process preference storage until the terminal controller writes it to the selected local PowerShell process. Other shells and remote sessions are rejected.

## Validation

- Focused PowerShell profile, local terminal, contract, broker, gesture, workbench preference and SQLite tests: **93/93 passed**.
- `corepack pnpm typecheck`: passed.
- `corepack pnpm lint`: passed, including import-boundary checks.
- `corepack pnpm build`: passed for Windows x64; the bundler emitted its existing large-renderer-chunk advisory.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "PowerShell profile text persists"`: **1/1 passed** on Windows. The test verifies no execution at app startup or on a new tab, exact saved preview, one explicit run in the selected PowerShell tab, and saved text after app restart.
- `git diff --check`: passed.

## Security notes and remaining work

The app-managed script is stored as local plain text. It can execute arbitrary PowerShell commands with the user's Windows account permissions; users must review the preview and must not put secrets in the field. This feature does not sandbox script execution or claim that a preview determines whether a script is safe. Native logo-picker acceptance, provider/tool management and the other documented release gates remain open. See [ADR-0029](../adr/ADR-0029-powershell-profile-execution.md).
