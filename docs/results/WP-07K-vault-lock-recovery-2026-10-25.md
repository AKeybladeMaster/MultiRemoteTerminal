# WP-07K — Windows vault lock and recovery acceptance

**Requirements:** N-001 locked-vault recovery; F-010/P-29 partial Windows acceptance.

## Change

Added a Windows-only Electron E2E that exercises the real `SafeStorageSecretVault` adapter with Electron `safeStorage`. The test stores a random test credential, resolves it, emits the registered `powerMonitor` `lock-screen` event, verifies the vault enters `locked` and resolution fails with the `locked` error category, explicitly unlocks, and verifies resolution works again. It then checks the persisted `credentials.json` does not contain the plaintext test secret.

The test uses a small main-process probe guarded by the existing `isE2ETestHookEnabled` policy: the app must be unpackaged, `MRT_E2E=1`, and launched with the exact `--mrt-e2e-vault-probe` argument. The probe is never added to preload or renderer IPC. The test emits a synthetic Electron event; it does not lock/unlock the Windows desktop itself.

## Validation

On Windows x64:

- `corepack pnpm build` — passed. Vite reported the existing renderer bundle size advisory (>500 kB); the build completed successfully.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "session-lock event" --reporter=line` — passed, 1/1 after rebuilding the compiled app.
- `corepack pnpm typecheck` — passed.
- `corepack pnpm lint` — passed, including static import-boundary checks.
- `git diff --check` — passed.

An initial focused E2E attempt before rebuilding used the previously compiled main-process bundle, which did not yet contain the new test probe. The test passed after rebuilding from the modified sources.

## Review and remaining scope

This is adapter-level Windows evidence for the lock handler and recovery semantics, not a full user-flow test. The event is synthetic, the unlock is invoked directly through a test-only main-process probe, and saved SSH credentials are not yet wired to the vault. User-facing vault management, optional master-password mode, physical Windows session-lock acceptance, vault restart acceptance, and plaintext exclusion across DB/log/export/IPC remain open. N-001 and F-010/P-29 remain partial.
