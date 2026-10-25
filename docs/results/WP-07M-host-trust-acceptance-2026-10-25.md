# WP-07M — SSH host-trust and gateway security acceptance

**Requirements:** N-002 host-key mismatch prevention and jump-host verification gate; supporting F-003/P-03 and F-011/P-22 acceptance.

## Evidence

Re-ran the focused host-trust and SSH-controller unit suites:

- `node --test tests/unit/host-trust.test.ts tests/unit/ssh-terminals.test.ts` — passed, 22/22. Coverage includes a previously trusted host presenting a different key, changed-key blocking with a non-secret warning, and approval behavior that does not replace a conflicting stored key.

Re-ran the Windows saved-profile gateway E2E:

- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "SSH saved-profile jump routes" --reporter=line` — passed, 1/1. The loopback SSH fixture verifies endpoint trust separately for a destination and one or two gateways, checks routed shell output, and confirms client/relay cleanup.

## Status

The specific security checklist item for changed-host-key blocking and jump-host verification is now checked in `docs/SECURITY.md`. This does not verify a public OpenSSH server or general internet-host interoperability. F-003/P-03 remain partial for key/agent authentication and disposable OpenSSH interoperability. F-011/P-22 remain partial for SFTP-only routes, gateway-routed tunnels, longer chains and broader interoperability.
