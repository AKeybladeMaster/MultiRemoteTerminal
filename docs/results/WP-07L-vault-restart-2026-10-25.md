# WP-07L — Windows vault process-restart persistence

**Requirements:** N-001 locked-vault recovery evidence; F-010/P-29 Windows vault persistence.

## Change

Added a Windows Electron E2E that stores a random credential through the guarded main-process vault probe, checks `credentials.json` for plaintext, closes the app, then launches it again with the same temporary user profile. After vault initialization, the test resolves the same credential through Electron's real `safeStorage` adapter, confirms the user-data path is unchanged, and checks the reopened vault file for plaintext again.

The test-only launch and state-wait helpers are shared with WP-07K so both tests use the same exact `MRT_E2E=1`, unpackaged, `--mrt-e2e-vault-probe` setup. The probe remains main-process-only and inaccessible through renderer IPC or preload.

## Validation

On Windows x64:

- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "safeStorage|session-lock event" --reporter=line` — passed, 2/2 (WP-07K lock recovery and WP-07L restart persistence).
- `corepack pnpm typecheck` — passed.
- `corepack pnpm lint` — passed, including static import-boundary checks.
- `git diff --check` — passed.

The E2E reused the current successful WP-07K build; WP-07L changes the test harness only.

## Review and remaining scope

The test demonstrates app-process restart persistence under the same Windows user and profile. It does not cover profile migration, OS-account changes, reinstall/restore, physical Windows session lock, user-facing vault management or saved-credential integration. Full plaintext exclusion across the database, logs, exports and IPC remains open. N-001 and F-010/P-29 remain partial.
