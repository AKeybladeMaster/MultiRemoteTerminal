# WP-04H: bounded three-gateway SSH routes

**Date:** 2026-10-26

**Status:** Partial; routes above three hops and broad public-server interoperability remain open.
**Requirements:** F-006, F-011, P-22, P-23, P-24, P-25.

## Delivered

- Saved SSH terminal, SFTP-only and local, remote or dynamic tunnel starts accept up to three ordered saved SSH gateways. Four hops are rejected by the domain, command contracts and worker protocol.
- Terminal/SFTP and tunnel dialogs share `SshGatewayRoutePicker`. It shows no more than the domain limit and filters duplicate profiles, duplicate endpoints and the target endpoint from later choices.
- Renderer IPC continues to carry saved profile IDs only. Routes and credentials remain operation-scoped and are not persisted or exported.
- Each hop retains independent host verification and ordered credential prompts. Only the final terminal target receives a shell, only an SFTP target receives SFTP, and tunnel targets receive no PTY, shell or SFTP subsystem.
- Existing 15-second inter-hop channel and 130-second overall open deadlines, cancellation, credential clearing and full chain cleanup remain in force. Worker protocol version 1 is unchanged.

## Validation

- `corepack pnpm typecheck` — passed.
- Focused SSH/domain/contract/broker tests — **124/124 passed**, including cleanup of all four SSH clients and all three nested channels after a target authentication failure.
- `corepack pnpm lint` — passed, including static import-boundary checks.
- `corepack pnpm build` — passed, including the Windows native addon and production renderer. Vite reported the existing 963.72 kB renderer chunk-size warning.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "SSH saved-profile jump routes verify every hop" --reporter=line` — **1 passed**. The Windows loopback E2E covers one-, two- and three-gateway terminal routes; two- and three-gateway SFTP routes with no PTY or shell at the SFTP target; three-gateway local, remote and dynamic tunnel roundtrips; independent trust, exact relayed bytes, target subsystem policy, tunnel unbind and cleanup.
- `git diff --check` — passed.

## Limitations

Routes longer than three gateways, real public-server interoperability, and Windows OpenSSH agent authentication through gateway routes remain unverified. This slice does not complete the broader MVP release gate.

## Independent review follow-up (2026-10-27)

The Standards, Spec and implementation reviews found no remaining Critical or Important findings. Follow-ups corrected the user guide's gateway count, added a three-gateway target-authentication failure test that asserts all four SSH clients and all three nested channels close, consolidated IPv6 endpoint formatting, and extended the Windows SFTP fixture to assert no PTY or shell request. The targeted E2E, typecheck, lint and `git diff --check` passed after these updates; the 124-test focused unit suite passed after the cleanup regression was added. The reviewers inspected the pinned changes read-only and did not rerun tests. All review findings are resolved; F-006/F-011 and P-22–P-25 remain partial only for their documented interoperability, route-length and forwarding-policy limitations.

One `typecheck` invocation run concurrently with `build` reported TS6305 for generated `dist/types` declarations. Running `corepack pnpm typecheck` after the build completed passed; the final checks used this sequential order.
