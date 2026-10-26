# ADR-0034: WP-04H bounded three-gateway SSH routes

**Status:** Accepted for WP-04H (2026-10-26)

## Context

WP-04D through WP-04G route saved SSH terminals, SFTP-only sessions and tunnel
definitions through at most two saved gateways. The SSH worker already builds
each connection by iterating the ordered route, but the domain, worker
protocol, preload timeout and two route pickers enforce the two-hop cap. P-22
and F-011 still leave longer routes open.

## Decision

- Raise the maximum to three ordered, saved SSH gateway profiles, followed by
  the saved target. The bound remains explicit: one route may open at most four
  SSH clients and three nested `forwardOut` channels.
- Keep routes scoped to the connection or tunnel start. Do not store them in
  saved profiles, tunnel definitions, SQLite migrations or folder bundles.
- Renderer IPC continues to send profile IDs only. Main resolves each ID from
  the session catalog and rejects missing/non-SSH profiles, duplicate IDs,
  duplicate endpoints, and any gateway that repeats the target before asking
  for credentials.
- Continue to verify every gateway and target host independently and request
  credentials in route order. A terminal shell is requested only at the final
  target; SFTP-only routes request SFTP only at the target; tunnel routes
  request no PTY, shell or SFTP subsystem.
- Keep the existing 15-second inter-hop channel-open deadline, 130-second
  overall SSH open deadline, cancellation path, reverse-order cleanup, and
  credential clearing. The preload timeout accounts for up to three gateway
  prompts plus the target prompt.
- Use one shared renderer `SshGatewayRoutePicker` for saved terminal/SFTP and
  tunnel starts. It renders no more than the domain maximum and excludes
  previously selected or endpoint-equivalent profiles from later choices.
- The worker message shape remains unchanged; its validator accepts the newly
  bounded third hop and rejects a fourth. The protocol version remains 1
  because no fields or message semantics change for existing one- and
  two-gateway clients.

## Consequences

The product supports one to three gateway hops for saved SSH terminals,
SFTP-only sessions and local, remote and dynamic tunnel starts. Three remains a
deliberate resource bound rather than an unbounded chain. P-22/F-011 remain
partial for routes longer than three gateways and broad public-server
interoperability, including real OpenSSH agent authentication through routes.

## Acceptance tests defined before implementation

- Domain and command-contract tests accept zero through three unique profile
  IDs, reject four IDs and duplicates, accept three canonical unique gateway
  endpoints, and reject repeated or target-overlapping endpoints.
- Worker-protocol tests accept three gateway credential objects and reject a
  fourth; transport coverage verifies ordered host checks, target-only shell or
  SFTP, and cleanup of all four clients and three nested channels after failure
  and normal close.
- Windows Electron E2E routes a saved terminal and an SFTP-only session
  through three loopback gateways, verifies trust for every endpoint, terminal
  output or directory listing, target subsystem policy, and cleanup.
- Windows Electron E2E starts local, remote and dynamic saved tunnels through
  three loopback gateways, verifies every relay, exact request/response bytes,
  target subsystem policy, remote unbind, and listener/socket/client cleanup.
- Existing direct, one-hop and two-hop acceptance remains covered.

Implementation and acceptance results are recorded in [WP-04H results](../results/WP-04H-three-gateway-routes-2026-10-26.md). See the [WP-04H implementation plan](../IMPLEMENTATION-PLAN.md#wp-04h--bounded-three-gateway-routes).
