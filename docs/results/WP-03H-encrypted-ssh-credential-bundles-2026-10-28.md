# WP-03H — Encrypted SSH credential bundles

**Status:** Implementation complete; native-picker and release acceptance remain pending.

**Requirements:** F-018; N-002 secret handling.
**Branch:** `dev-1`.

## Delivered

Added explicit `.mrtcred` export and import for saved SSH password credentials. The bundle uses the fixed Argon2id 1.3 and XChaCha20-Poly1305-IETF profile, authenticates its format metadata, and binds each credential to an exact saved session ID, canonical host, and port. Private keys, host-trust entries, session definitions, and other settings are excluded.

Export requires a native save picker and two native passphrase entries. Import requires a native open picker and one passphrase entry. Requests from the renderer carry no file path or secret and return only a count. The main process handles plaintext and vault operations; the storage worker reads and writes encrypted bytes only. Import validates every record and transactionally attaches secrets only to matching SSH profiles that have no saved credential. Existing credentials are never replaced.

The import path rolls back newly stored vault entries after a definite database conflict. It retains references after ambiguous worker completion to avoid dangling database links. Mutable crypto buffers are cleared where practical; JavaScript string copies are not claimed to be erased.

## Verification

All checks ran on Windows x64 using the repository-pinned Node `24.14.1` and pnpm `12.15.0`:

- `corepack pnpm typecheck` — passed.
- `corepack pnpm lint` — passed, including static import-boundary checks.
- `corepack pnpm test` — 563 passed, 0 failed.
- `corepack pnpm build` — passed; native system-directory bridge built for x64.
- Focused Playwright E2E — 1 passed. It exported from one app profile, imported the saved profile definition and credential bundle into another, then confirmed SSH authentication succeeded without prompting again. The test also checked that the password did not appear in renderer text or the encrypted bundle.
- `corepack pnpm package:win` — passed. Created NSIS and portable x64 executables, per-artifact CycloneDX SBOMs, and `SHA256SUMS.txt` under ignored `artifacts/windows/`.
- Packaged-app smoke E2E — 4 passed: Electron fuses/ASAR integrity, SBOM and checksums, NSIS offline install/persistence/tamper rejection/uninstall, and portable startup with local terminal workflows.

Independent N-002 security review found no confirmed findings and verified salt-length validation, credential import/export boundaries, and secret handling. Independent specification and standards reviews found no requirements gaps or hard standards breaches.

## Remaining acceptance

The E2E harness substitutes the native file picker APIs; direct Windows picker selection and cancellation still need manual acceptance. The generated executables are `NotSigned` because no Authenticode release certificate was configured. F-018 therefore remains PARTIAL until picker acceptance and the signing/release decision are complete.

The bundle necessarily exposes plaintext to the main-process export/import operation while it is unlocked. Passphrase quality remains the user's responsibility; anyone with both the bundle and passphrase can recover its saved SSH passwords.
