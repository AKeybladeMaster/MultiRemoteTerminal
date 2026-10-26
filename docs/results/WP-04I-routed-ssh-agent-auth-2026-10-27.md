# WP-04I — routed SSH agent authentication evidence

**Date:** 2026-10-27
**Status:** Partial acceptance; P-03/F-003 and P-22/F-011 remain PARTIAL.

## Scope

The existing SSH route implementation allows password, private-key or agent authentication at an SSH terminal or SFTP-only destination. Gateway hops use separate password prompts. This slice adds Windows Electron acceptance for agent authentication at the destination through a three-gateway route; it changes no production behavior, worker messages, saved-session data or credential handling.

## Acceptance evidence

- The focused Windows Electron E2E uses three loopback SSH gateway fixtures, an SSH terminal destination, an SFTP-only destination, and a temporary named pipe implementing `ssh2.AgentProtocol`.
- The UI selects `Windows OpenSSH agent` for each target. The gateway fixtures continue to authenticate with their own password prompts; only the final destination authenticates with the agent's Ed25519 identity.
- The terminal route verifies identity enumeration, a signature accepted by the target, terminal output, all three gateway relays, and cleanup of SSH clients, agent sockets and relay sockets.
- The SFTP route verifies a newly signed target authentication, a remote listing, zero PTY/shell requests at the files-only target, all three gateway relays, and the same cleanup.
- The test verifies the named-pipe path and private key do not appear in renderer-visible text. Agent access stays in the supervised SSH worker; forwarding remains disabled by the existing provider configuration.
- The route E2E first approves each fixture's host key during the password route scenarios, then reuses that saved trust for the two agent-auth scenarios.

## Validation

- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "SSH saved-profile jump routes verify every hop" --reporter=line --workers=1` — Windows 11 Electron E2E passed 1/1, including the existing password routes and the new agent-authenticated terminal and SFTP routes.
- `corepack pnpm typecheck` — passed.
- `corepack pnpm lint` — passed, including static import-boundary checks.
- `corepack pnpm build` — passed on Windows x64; Vite reported the existing 963.69 kB renderer chunk advisory.
- `git diff --check` — passed.

## Limits

The named-pipe mock and SSH target fixtures use the pinned `ssh2` package. This does not verify interoperability with the installed Windows OpenSSH agent service, an independent OpenSSH server, packaged native prompting, or private-key authentication through gateways. Longer gateway chains and broad SSH interoperability remain open. Do not treat P-03/F-003 or P-22/F-011 as complete.

## Review

Independent Standards and Spec reviews pending.
