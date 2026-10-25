# WP-07S — Optional master-password vault

**Requirements:** F-010/P-29; supporting N-001 vault recovery and N-002 secret handling.

## Change

Settings now supports switching saved SSH credentials between Windows-account protection and optional master-password protection, unlocking after restart, locking immediately and explicitly deleting saved passwords. Password prompts stay in the existing main-process native credential helper; the renderer receives only vault state and mode. The UI explains that the master password cannot be recovered and that same-user malware may access data while the app is unlocked.

The version-2 vault profile uses libsodium Argon2id 1.3 with opslimit 2, a 64 MiB memory limit, a 16-byte random salt and a 32-byte key. Credential entries use XChaCha20-Poly1305-IETF with a fresh 24-byte nonce, 16-byte tag, and authenticated envelope version, profile and reference. An encrypted sentinel validates unlock. The KDF runs in a one-shot Electron utility process with a 30-second timeout; only the password and salt enter that process, and only the derived key returns to main. Master-password mode starts locked after restart. Failed unlock counters and exponential cooldown deadlines persist in the vault file.

Mode conversion serializes behind vault operations, stages only ciphertext, decrypts each staged entry in memory and compares it to the source before atomic replacement. Explicit reset clears the vault and bulk-clears SQLite credential references while preserving session definitions. If vault deletion succeeds but SQLite cleanup fails, the command reports a partial outcome, Settings refreshes the actual vault mode/status, and subsequent profile open can detach a stale reference and request a new password.

## Validation

On Windows x64 with Node 24.14.1 and Electron 45:

- Focused credential/vault suite (`master-password-vault-crypto`, `master-password-key-deriver`, `safe-storage-secret-vault`, `session-credentials`, `session-catalog`, `contracts`, `broker` and `macro-storage-protocol`) — passed, 95/95. Coverage includes Argon2id known-answer and XChaCha20-Poly1305 tamper checks, profile rejection, one-shot process input/output, timeout and lock cancellation, conversion preservation, wrong password, locked restart, cooldown persistence/doubling/cap/reset, exact credential IPC, reset cleanup in SQLite, preserved session definitions, and partial-reset recovery.
- `corepack pnpm exec node --test tests/unit/session-catalog.test.ts tests/unit/session-credentials.test.ts` — passed, 25/25 after adding real SQLite reset-reference assertions.
- `corepack pnpm typecheck` — passed.
- `corepack pnpm lint` — passed, including static import-boundary checks.
- `corepack pnpm build` — passed on Windows x64, including the native bridge build; Vite reported the existing renderer chunk size warning.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "Windows master-password vault" --reporter=list` — passed, 1/1. The test uses the real Electron utility process and libsodium runtime to convert modes, restart locked, unlock, lock and reset. It captures the locked-state Settings view at `test-results/master-password-vault-settings.png`.
- `git diff --check` — passed before review.

## Status and limits

Optional master-password mode, encrypted mode conversion, locked restart, persisted cooldown and explicit reset are implemented and have focused Windows acceptance evidence. F-010/P-29 remain PARTIAL. Physical Windows session lock/resume, account/profile migration, reinstall/restore under both modes, Windows-account change behavior, native prompt behavior in the packaged build, all-protocol secret exclusion and broader privileged-memory review remain unverified. The E2E password prompt is replaced only for the exact unpackaged `MRT_E2E=1` test launch; production prompts remain in main. JavaScript strings/runtime copies cannot be guaranteed erased. A lost master password has no recovery path; explicit reset deletes credentials permanently.

## Review

Pending independent Spec and Standards review before promotion.
