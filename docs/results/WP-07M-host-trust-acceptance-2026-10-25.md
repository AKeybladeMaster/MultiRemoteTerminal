# WP-07M — SSH host-trust and gateway security acceptance

**Requirements:** Narrow N-002 security checklist evidence, supporting F-003/P-03 and F-011/P-22 acceptance.

## Evidence

Re-ran the focused host-trust and SSH-controller unit suites:

- `node --test tests/unit/host-trust.test.ts tests/unit/ssh-terminals.test.ts` — passed, 22/22. Coverage includes a previously trusted host presenting a different key, changed-key blocking with a non-secret warning, and approval behavior that does not replace a conflicting stored key.

Re-ran the Windows saved-profile gateway E2E:

- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "SSH saved-profile jump routes" --reporter=line` — passed, 1/1. The loopback SSH fixture verifies endpoint trust separately for a destination and one or two gateways, checks routed shell output, and confirms client/relay cleanup.

## Status

The specific security checklist item for changed-host-key blocking and jump-host verification is now checked in `docs/SECURITY.md`: the changed-key behavior has unit coverage, and the route fixture verifies one-/two-gateway trust. This is not the host-key-rotation E2E acceptance described separately in the threat table, and it does not verify a public OpenSSH server or general internet-host interoperability. F-003/P-03 remain partial for key/agent authentication, packaged native credential prompting and disposable OpenSSH interoperability. F-011/P-22 remain partial for SFTP-only routes, gateway-routed tunnels, longer chains and broader interoperability.

## Review

The Spec-axis reviewer requested that the checklist and result distinguish unit-level changed-key blocking from the still-open host-key-rotation E2E and retain packaged native credential prompting as an F-003/P-03 gap; the follow-up confirmed those corrections. The Standards-axis reviewer initially asked for independent verification of the recorded commands; the commands were run in this checkout with 22/22 unit tests and 1/1 E2E passing, and the reviewer cleared the finding on follow-up. No hard standards findings remain; both axes assessed the documentation-only slice ready to merge.
