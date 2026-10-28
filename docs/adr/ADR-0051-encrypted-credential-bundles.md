# ADR-0051: Encrypted SSH credential bundles

**Status:** Accepted (2026-10-28)

## Context

F-018 includes user-opt-in export of saved secrets. Saved-folder bundles and settings templates deliberately exclude credentials, and the local credential vault may be protected by the current Windows account, which is not portable to another machine.

## Decision

- Add a separate version-1 `.mrtcred` file containing only saved SSH password credentials. The authenticated payload binds each username/password to its saved session ID and canonical host/port. Private keys, key passphrases, other protocols, host-trust records, settings and session definitions are excluded.
- Require an explicit export/import action, a native file picker, and a separate native Windows credential prompt for a user-chosen bundle passphrase. Export asks for the passphrase twice. Renderer IPC carries neither a path nor a secret and receives only a result/count.
- Use the existing fixed libsodium Argon2id 1.3 profile (2 operations, 64 MiB, 16-byte random salt) and XChaCha20-Poly1305-IETF (24-byte random nonce, 16-byte tag). Authenticate the exact format version and profile as associated data. Reject unknown profile parameters and oversized input before KDF work. Keep the bundle passphrase independent of the current vault protection mode.
- Keep plaintext credentials and decrypted bundle payloads in the main process/application operation only. The credential vault remains the only persistent plaintext-secret boundary; the storage worker receives and writes ciphertext bytes only. The renderer receives no credentials. Clear mutable byte buffers after use where practical; do not claim that JavaScript string copies are erased.
- Export all saved SSH passwords or fail without writing a partial bundle. Import validates the entire decrypted payload first, then attaches credentials only to existing SSH definitions with the same session ID and exact host/port and no credential already attached. Never replace an existing credential. Store new vault entries before one SQLite transaction; roll back those entries on a definite transaction rejection. If storage completion is ambiguous, retain the new entries rather than risk leaving committed database references dangling.
- Bound the encrypted file to 16 MiB, decrypted JSON payload to 10 MiB, and credential count to 10,000; reject duplicate entries, malformed credentials, unknown fields, invalid UTF-8 and unsupported versions. Write by sibling temporary file and atomic rename. Native picker dismissal is a no-op.

## Consequences

Users can move saved SSH passwords between profiles protected by different Windows accounts without weakening the normal vault. A separate passphrase protects the portable file; anyone who obtains it and the passphrase can recover its contents. Import requires profiles to exist first and leaves mismatches/conflicts unchanged. Some vault entries can remain orphaned if the storage worker fails ambiguously during import; retaining them protects against dangling references.

## Verification

Unit and adapter tests cover authenticated round-trip, wrong-password/tamper rejection, exact schema and size limits, path-free contracts, atomic file access, exact profile matching, conflict rollback and ambiguous-worker safety. Windows Electron E2E verifies native Save/Open picker selection and cancellation through UI Automation, cross-profile import/authentication with a test-only passphrase prompt, and secret exclusion from the renderer. F-018 stays PARTIAL pending the signing/release decision.
