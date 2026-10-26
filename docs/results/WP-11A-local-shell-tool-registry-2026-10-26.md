# WP-11A — local shell tool registry and palette visibility

**Date:** 2026-10-26
**Status:** Partial acceptance
**Requirement IDs:** P-21 (partial), P-37 (partial); F-023 remains open.

## Delivered

- Added a fixed local-shell registry for PowerShell, Command Prompt (`cmd`), and Bash. The catalog contains only existing typed shell IDs and user-facing descriptions; it does not accept executable paths or third-party registrations.
- Added persisted `visibleLocalShells` workbench preferences. Existing settings schemas migrate with all three choices visible by default. The normalizer rejects unknown shell IDs, duplicate entries, malformed values, and extra fields.
- Added Settings checkboxes that show or hide each shell action from the command palette. Visibility changes do not remove a shell, stop a running terminal, or prevent opening a saved local-shell profile.
- Kept local-shell launch on the existing typed `openTerminal` path. Bash remains an explicitly selected Git for Windows installation and is not bundled or installed by the app.
- Updated offline help, security notes, the implementation plan, and feature matrix.

## Validation

- `corepack pnpm typecheck` — passed.
- `corepack pnpm lint` — passed, including import-boundary checks.
- Focused Node tests for workbench preference validation and SQLite persistence/migration — 6 passed, 0 failed.
- `corepack pnpm build` — passed on Windows x64. The bundler emitted its existing large-renderer-chunk advisory.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "local shell tool visibility" --workers=1` — passed. The test hides PowerShell, verifies the action disappears, restarts the app, verifies the preference persists, restores the action, and launches a PowerShell terminal.
- Visual inspection used the E2E screenshot `test-results/local-shell-tools-settings.png` (1164×734, Windows desktop, dark theme). The controls remain within the existing scrollable settings dialog; no redesign or new package was introduced.

The first focused E2E attempt exposed an ambiguous test locator because both vault and save feedback use the `status` role. The assertion was narrowed to the exact save message; the full focused flow then passed.

## Architecture and security

The registry is a fixed domain allowlist, preferences use the existing settings repository and storage worker, and the renderer continues to use validated workbench preferences plus existing typed shell launch commands. A hidden palette action is a visibility preference, not a security boundary or package-uninstall control. No dependency was added.

## Remaining work

P-21/P-37 remain partial. WSL discovery, optional toolpack install/update/remove, provider availability reporting, malicious-path validation for package providers, and the remaining WP-11 parity review are not implemented by this slice. F-023 is still open. Do not promote this slice as full WP-11 completion.
