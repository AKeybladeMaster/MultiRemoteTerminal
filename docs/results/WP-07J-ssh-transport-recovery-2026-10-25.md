# WP-07J — SSH transport-loss recovery acceptance

**Requirements:** N-001 lost-SSH recovery; F-003/P-03 partial Windows acceptance.

## Change

Added a focused Windows E2E using a loopback SSH fixture and the normal renderer → preload → main broker → supervised worker → SSH provider path. The test approves the fixture's first-use host key, authenticates through the test-only credential provider, opens a shell, saves a credential-free profile, and then sends a TCP reset through the pinned `ssh2@1.17.0` fixture's accepted socket. The session tab must enter `failed` and display `UNAVAILABLE`; the test then explicitly opens the saved profile and verifies a new shell connection and terminal output.

The fixture uses `Socket.resetAndDestroy()` to represent abrupt link loss. Calling the server-side `ssh2` client's `end()` would send a normal protocol disconnect and correctly produces an `exited` tab, so the test distinguishes that expected case from a transport failure.

## Validation

On Windows x64:

- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "lost SSH transport" --reporter=line` — passed, 1/1. The test verifies initial authentication/trust, `UNAVAILABLE` failure state after TCP reset, and a successful explicit saved-profile reconnect.
- `corepack pnpm typecheck` — passed.
- `corepack pnpm lint` — passed, including import-boundary checks.

## Review

- Spec-axis review's initial low finding was fixed: changed-host-key blocking remains visible in F-003/P-03 and links to its existing unit test. The follow-up review approved the corrected status.
- Standards-axis review found no hard violation. It noted possible fixture-setup duplication; the separate SSH/SFTP server behaviors make the current fixtures reasonable, and helper extraction is deferred unless more E2Es reuse this setup.

## Remaining scope

This closes the lost-SSH recovery case in N-001 for the loopback fixture. N-001 remains partial until the locked-vault Windows acceptance is covered; existing ConPTY-worker crash and SFTP edit-conflict E2Es provide separate evidence. Changed-host-key blocking remains covered by the existing [SSH unit test](../../tests/unit/ssh-terminals.test.ts). F-003/P-03 remain partial because Ed25519 key/agent authentication and interoperability with a disposable OpenSSH server are not verified. The fixture does not claim public-network reliability.
