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

The test verifies a copied master-password vault under the same Windows account and a new Electron `userData` path. It does not verify another Windows account, DPAPI-mode copy/migration, reinstall/backup tooling, packaged native credential prompts or physical Windows lock/resume. This E2E does not try a wrong password against the copied file; WP-07S's unit suite separately verifies wrong-password rejection for the same versioned vault format. F-010/P-29 remain PARTIAL.

## Review

Independent Spec and Standards reviews covered `git diff origin/main...HEAD`, fixed point `539a1a4ce6652785e12da71dbd60f5d4b34aedbc`, candidate `4039341ac9069a880b6c5544081b7a33e57db4e5`.

- The Spec reviewer found no scope creep or incorrect behavior. It confirmed WP-07T proves only a copied `credentials.json` in a distinct `userData` directory under the same Windows account. Full-profile restore, reinstall, cross-account DPAPI failure and a wrong-password attempt on this copied profile remain outside this slice. The test prompt is a fixed test password and exercises the unlock/KDF path, not the native credential dialog.
- The Standards reviewer found no documented-standard violations. Two non-blocking baseline judgements are tracked: the test variable `reference` could be named more specifically, and vault-probe lookup/guards repeat across separate `app.evaluate` callbacks. The callbacks execute in distinct serialized app contexts, so the small local repetition remains; rename the variable if this test is next edited.
- Reviewers did not run tests or modify files. Root validation passed typecheck, lint/import boundaries, and the two focused Windows master-vault E2Es (2/2).
