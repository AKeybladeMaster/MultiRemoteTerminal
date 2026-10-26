# WP-02A — SSH private-key authentication evidence

## Scope

Added explicit private-key authentication for direct SSH terminal and standalone SFTP opens. Electron main reads the selected native-dialog file as a regular file capped at 1 MiB. The renderer supplies only the authentication mode; neither a key path nor key bytes enter renderer IPC. Username and optional passphrase are requested through the existing protected Windows credential prompt. Key bytes and credential strings are cleared from transient application and worker buffers after setup/authentication. Private keys are not saved with profiles or written to logs.

The Windows loopback E2E generates an encrypted Ed25519 OpenSSH private key, uses the guarded unpackaged test hook for key selection and the existing credential-prompt test stub, verifies first-use host trust and a server-validated public-key signature, and confirms terminal output plus absence of the key path, key body and passphrase in renderer-visible text. The same E2E opens a separate standalone SFTP connection with private-key auth, verifies a real remote file listing, confirms the SFTP login requests no shell, and verifies the protected passphrase prompt is used for that second connection too. The key reader has unit coverage for successful bounded reads, missing files, directories and oversized files.

The implementation uses the repository's already-pinned `ssh2@1.17.0`; no package or lockfile change was needed. Its [official API documentation](https://github.com/mscdex/ssh2/blob/master/README.md) describes private-key buffers, optional passphrases and OpenSSH, RFC4716 and PPK parsing. This phase's interoperability evidence covers encrypted Ed25519 OpenSSH format only. Mutable key buffers are zeroed; JavaScript strings cannot be reliably overwritten, so passphrase and username references are cleared as soon as their respective work completes.

## Validation

- `corepack pnpm typecheck` — passed.
- `corepack pnpm lint` — passed, including import-boundary checks.
- Focused SSH, broker, contract and key-reader unit suites — 100/100 passed.
- `corepack pnpm build` — passed on Windows x64, including the native addon build. Vite reported the existing advisory that the renderer JavaScript chunk exceeds 500 kB.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "SSH private-key mode" --workers=1 --reporter=list` — 1/1 Windows Electron E2E passed, covering SSH terminal and standalone SFTP private-key authentication.
- `git diff --check` — passed.

## Remaining acceptance work

P-03/F-003 remains PARTIAL. The native file picker and real protected credential prompt were exercised through test hooks rather than interactive packaged acceptance. SSH agent authentication, key authentication through gateway routes, disposable Windows OpenSSH interoperability, packaged native prompt behavior, cross-format key acceptance and final Windows release security/packaging gates remain open.
