# WP-07C: persisted startup greeting

**Date:** 2026-10-25

**Requirement:** P-34 (startup workbench greeting; F-009 remains partially open)

## Behavior

Workbench Settings lets the user save a greeting of up to 512 Unicode code points. The greeting is displayed as plain text when the app starts and can be dismissed for the current run. An empty value clears it. The setting remains local to the SQLite profile and is loaded again after app restart.

## Architecture

- Domain validation accepts exactly the `startupGreeting` field, normalizes CRLF/CR to LF, bounds Unicode code points and rejects Unicode control characters other than tabs and newlines (including C1 controls).
- Application logic validates before storage and maps storage failures to stable error categories.
- A versioned `workbench` row in the existing `settings` table stores the value; no schema migration was needed.
- Typed, exact-shape IPC carries read/save calls through preload and the main broker to the supervised SQLite worker.
- React renders the value as text. It is not evaluated or forwarded to a terminal, and it is not a credential or vault secret.
- The settings dialog supports keyboard dismissal and focus return, bounded input, load retry, and visible save/error status.

## Verification

All commands ran on Windows from the repository root on 2026-10-25:

| Command | Result |
|---|---|
| `corepack pnpm typecheck` | Passed |
| `corepack pnpm lint` | Passed; import boundary check passed |
| `node --test --test-reporter=tap tests/unit/workbench-preference-errors.test.ts tests/unit/workbench-preferences.test.ts tests/unit/sqlite-workbench-preferences.test.ts tests/unit/workbench-preferences-protocol.test.ts tests/unit/contracts.test.ts tests/unit/bridge.test.ts tests/unit/broker.test.ts` | 72 passed, 0 failed |
| `corepack pnpm build` | Passed; renderer bundle 725.66 kB minified / 195.02 kB gzip |
| `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "custom Unicode startup greeting saves"` | 1 Windows Electron E2E passed; verifies edit/save, dismissal, keyboard/focus behavior, narrow layout and persistence after relaunch |
| `git diff --check` | Passed |

A focused regression assertion first reproduced acceptance of U+0085, then passed after domain validation was updated to reject Unicode `Cc` characters while retaining tabs and newlines. The independent reviewer also flagged internal storage error codes in the UI; the settings dialog now maps common failures to user-facing retry and recovery messages, covered by a focused unit test.

The production build reports the existing Vite chunk-size advisory (>500 kB). Node also reports that `node:sqlite` is experimental in this runtime. Neither warning failed the checks.

The narrow-layout screenshot is `test-results/startup-settings-dialog-narrow.png` (620 px viewport); the generated screenshot is local test output and is not source evidence required at runtime.

## Security and limitations

The greeting is ordinary local configuration stored in the app profile, not encrypted vault data. The feature provides no account or logout flow. The rest of F-009—logo, profile script and tool visibility settings—remains planned. This Windows UI run covers keyboard focus and responsive layout; it is not a screen-reader or high-contrast acceptance audit, and P-34 does not complete the WP-07 release gate.

## Review status

Independent spec and standards reviews passed. The merge-readiness reviewer found no critical or important issues; the minor error-message finding was addressed and revalidated before promotion to `main`.
