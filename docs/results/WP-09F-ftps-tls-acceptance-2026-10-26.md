# WP-09F — Explicit FTPS certificate and data-channel acceptance

- **Status:** PARTIAL acceptance slice; P-10 and F-016 remain PARTIAL.
- **Requirements:** F-016, P-10.
- **Date:** 2026-10-26.

## Behavior verified

- The app opens explicit FTPS through its FTP utility worker.
- A server with a certificate absent from the worker trust configuration is rejected before `USER` or `PASS` is sent.
- An explicitly trusted test CA allows the test server connection without disabling certificate validation.
- The fixture observes FTP account commands only after the control socket is encrypted and confirms `PBSZ 0` plus `PROT P`.
- The listing data connection negotiates TLS, and a small upload uses a TLS-protected FTP data channel. The test checks the uploaded bytes exactly.
- The test uses only loopback sockets and a synthetic payload. Its root certificate and server PFX are test fixtures; the PFX private key is protected with the documented test-only passphrase in the test source.

The app's test-only `--mrt-e2e-ftp-ca=` argument is accepted only when the un-packaged app also runs with the existing `MRT_E2E=1` and FTP credential test flag. The main process passes that explicit path only to the FTP worker, which adds the file contents as a per-connection TLS CA option. The ordinary network-worker environment allowlist remains unchanged for all parent variables, and packaged builds cannot enable this hook.

## Validation

- `corepack pnpm typecheck` — passed.
- `corepack pnpm exec eslint apps/desktop/src/main/index.ts apps/desktop/src/main/network-worker-environment.ts apps/desktop/src/workers/ftp-worker.ts tests/unit/network-worker-environment.test.ts tests/e2e/ftps.test.ts` — passed.
- `node --test tests/unit/network-worker-environment.test.ts` — 3/3 passed.
- `corepack pnpm build` — passed for Windows x64; Vite reported the existing renderer chunk-size advisory.
- `corepack pnpm exec playwright test tests/e2e/ftps.test.ts --reporter=list` — 1/1 Windows E2E passed.
- `git diff --check` — passed.

## Limits and follow-up

This verifies a controlled local explicit-FTPS flow; it does not verify public CA chains, certificate revocation behavior, server-specific TLS policies, or broad public FTP/FTPS server interoperability. WP-09G separately verifies data-channel session reuse against a controlled local fixture. No production certificate-validation policy was relaxed. P-10 and F-016 remain PARTIAL.
