# WP-09G — FTPS data-channel session resumption acceptance

- **Status:** Additional acceptance evidence; P-10 and F-016 remain PARTIAL.
- **Requirements:** F-016, P-10.
- **Date:** 2026-10-26.

## Behavior verified

- Extend the Windows loopback explicit-FTPS E2E to record `TLSSocket.isSessionReused()` for every protected data-channel handshake.
- The fixture observed four protected data-channel handshakes during directory browsing and upload; all four resumed a TLS session.
- The acceptance still exercises untrusted-certificate rejection, explicitly trusted test-CA connection, protected control commands, listing, and exact upload bytes from WP-09F.
- The pinned `basic-ftp@6.2.3` dependency is unchanged; its data-channel connector supplies the stored TLS session and captures tickets for later transfers.

## Validation

- `corepack pnpm exec playwright test tests/e2e/ftps.test.ts --workers=1` — 1/1 Windows E2E passed.
- `corepack pnpm typecheck` — passed.
- `corepack pnpm exec eslint tests/e2e/ftps.test.ts` — passed.
- `git diff --check` — passed.

## Limits and follow-up

This proves session resumption only against the controlled local TLS fixture and this Node/Electron runtime. It does not establish interoperability across public FTP/FTPS servers, their TLS policy variations, public certificate chains, or revocation behavior. P-10 and F-016 remain PARTIAL.
