# WP-07T — Master-password vault profile restore

**Requirements:** F-010/P-29; ADR-0003 acceptance contract 10.

## Change

Add Windows E2E coverage for restoring a master-password vault to a different application profile directory under the same Windows account. The test creates a master-password vault in a temporary source profile, closes the app, copies only `credentials.json` to a separate temporary profile, and starts another app instance against the restored directory. The restored vault starts locked and rejects credential resolution. Settings then unlocks it through the exact unpackaged E2E prompt hook and the stored credential resolves. The test checks that the password is absent from both source and restored vault files.

This is acceptance evidence only; no runtime or dependency changes were required. The test uses the real Electron utility process and libsodium runtime from WP-07S. The E2E prompt is replaced only for unpackaged launches with `MRT_E2E=1` and `--mrt-e2e-master-password`.

## Validation

On Windows x64 with Node 24.14.1 and Electron 45:

- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "restores into a different app profile" --reporter=list` — passed, 1/1.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "Windows master-password vault" --reporter=list` — passed, 2/2, covering both conversion/restart/reset and profile restore.
- `corepack pnpm typecheck` — passed.
- `corepack pnpm lint` — passed, including static import-boundary checks.
- `git diff --check` — passed.

## Status and limits

The test verifies a copied master-password vault under the same Windows account and a new Electron `userData` path. It does not verify another Windows account, DPAPI-mode copy/migration, reinstall/backup tooling, packaged native credential prompts or physical Windows lock/resume. F-010/P-29 remain PARTIAL.

## Review

Pending independent Spec and Standards review before promotion.
