# WP-07R - Saved SSH credential integration

**Requirements:** F-010/P-29; supporting N-002 secret handling and F-018 credential-free profile export.

## Change

Saved SSH terminal profiles can explicitly save or replace a password, forget it, and reconnect with it through the existing encrypted credential vault. The renderer sends only a saved profile ID; main verifies the profile's SSH kind and exact canonical host/port before reading the credential. The password is resolved in main for one connection, passed to the SSH controller, and cleared after handoff. No credential reference or plaintext password is included in the renderer-facing profile, command reply, or saved-folder bundle.

The SQLite storage worker keeps the credential reference private. Updates compare the current reference before attaching or removing one. Replacements rotate references and remove the old vault entry after commit; competing saves cannot both attach their vault entries. A saved-profile connection retries reference resolution once when a concurrent replacement has removed the reference it first read.

Settings shows whether the default Windows-account-protected vault is unlocked, locked or unavailable, and offers explicit lock/unlock controls. It explains that Windows account protection cannot defend against malware running as the same Windows user and that the lock is a local privacy control. Saved-session actions show credential presence and offer save/replace or forget. Removing an SSH profile also removes its attached vault entry.

## Validation

On Windows x64:

- `node --test tests/unit/session-credentials.test.ts tests/unit/session-catalog.test.ts tests/unit/contracts.test.ts tests/unit/broker.test.ts tests/unit/ssh-terminals.test.ts` - passed, 79/79. Coverage includes exact endpoint binding, lock rejection, rotation cleanup, concurrent-save conflict, replacement-during-resolution recovery, compare-and-set catalog updates, safe renderer IPC and credential clearing after SSH provider handoff.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "a lost SSH transport|SSH credentials stay out" --reporter=line` - passed, 2/2. The first loopback SSH scenario saves a password, locks the vault, verifies saved-profile open fails without another prompt, unlocks and verifies reconnect succeeds without a prompt. The second verifies the password canary is absent from the renderer-visible UI, saved SQLite row, folder export, files under the temporary app profile and main/renderer console output.
- `corepack pnpm typecheck` - passed.
- `corepack pnpm lint` - passed, including static import-boundary checks.
- `corepack pnpm build` - passed on Windows x64 with Node 24.14.1 and Electron 45 ABI; Vite reported the existing large-renderer-chunk warning.
- `git diff --check` - passed.

## Status and limits

This verifies saved SSH password management with Electron's Windows `safeStorage` implementation in an unpackaged Windows E2E run. It does not add optional master-password mode, native password prompting in the packaged build, physical Windows lock/resume acceptance, profile migration or OS-account change coverage. The no-plaintext security gate remains open for all protocols and privileged process memory; SSH credentials intentionally cross the private main-to-SSH-worker authentication channel. F-010/P-29 remain PARTIAL.

## Review

Independent Spec and Standards reviews covered `git diff origin/main...HEAD` from merge-base `2e9c33ce94cc6cea194bb7834c701f95948aed79` through `319304b485d02269b1fa8e695ebe69db13846964`.

- The Spec reviewer first found that the UI omitted the same-user malware limitation and used an overly broad "saved securely" phrase. Commit `319304b` adds the limitation to Settings and names Windows account protection in saved-password status and confirmation messages. Follow-up Spec review confirmed the finding is fixed, identified no other mismatch or scope creep, and kept F-010/P-29 partial for the remaining master-password and platform-acceptance gaps.
- The Standards reviewer first noted two non-blocking judgment calls: the ambiguous `forgetSshProfile` name and duplicated storage-error mapping. Commit `319304b` renames the operation to `forgetSshCredential` and centralizes storage-error conversion. Follow-up Standards review found no remaining documented-standard breach or baseline smell.

Reviewers did not run tests or modify files. The requesting-review companion template was unavailable; the paired review prompts followed the installed `code-review` skill's Spec and Standards process. No unresolved Critical or Important finding remains.
