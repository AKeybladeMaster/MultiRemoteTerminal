# WP-02E — SSH host-key rotation acceptance (partial P-42)

**Requirements:** P-42; N-001, N-002
**Date:** 2026-10-29
**Status:** Host-key rotation acceptance passed; broader P-42 and P-03 acceptance remains open.

## Change

The Windows E2E runs the app against two loopback SSH fixtures on the same host and port with different Ed25519 keys. It first explicitly trusts and authenticates the original key, then restarts the app with the same profile against the rotated key. The changed-key dialog must show the new fingerprint while authentication and shell requests remain at zero; the database must still contain the original fingerprint. Clicking **Reset saved host trust** alone still does not connect. A separate reconnect prompts for first-use approval of the new fingerprint; only after **Trust key and connect** does authentication and shell startup proceed. After shutdown, the database contains the approved rotated fingerprint.

The E2E exercises the real Electron main/preload/worker/renderer path and SQLite persistence. Both test SSH servers use `ssh2` and loopback only; this is not disposable OpenSSH or public-host interoperability evidence.

## Verification

- Focused Windows E2E `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep 'changed SSH host key stays blocked' --reporter=line` — passed 1/1.
- Full `corepack pnpm check` — passed typecheck, lint/import boundaries, 578 unit tests, and 70 Windows E2E tests; five package-only tests were skipped. The run also included the custom-logo picker regression verification.
- The build retains Vite's advisory for a renderer bundle above 500 kB.

## Remaining acceptance

P-42 remains partial pending all-flow secret-exclusion review. P-03 still needs disposable OpenSSH interoperability, the real Windows OpenSSH agent service, and packaged native credential prompting. The wider N-001..N-007 release gate, Windows 10 acceptance and signed reproducible distribution remain open.
