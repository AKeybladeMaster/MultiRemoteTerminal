# ADR-0012: WP-04D connection-specific SSH gateway routes

**Status:** Accepted for WP-04D (2026-10-24)

## Context

The SSH forwarding slices use a supervised worker that owns network connections,
host-key verification and connection cleanup. A saved SSH session should be
connectable through one or more saved SSH gateway profiles without persisting
credentials or changing the saved-folder bundle format.

## Decision

- A user starts a route from the action menu of a saved SSH target and selects
  up to two other saved SSH profiles in order. A route is scoped to that one
  connection; it is not stored on the target profile or exported.
- The renderer submits only saved-profile IDs. The main broker resolves every
  ID through `SessionCatalog`, rejects missing/non-SSH profiles, and sends
  canonical endpoint data to the SSH controller. Credentials never enter the
  renderer or the saved-session catalog.
- The credential prompt runs separately for each gateway, then the destination,
  with a sanitized endpoint context. Credentials are operation-scoped, copied
  into the utility worker only for the connection open, and cleared when the
  route open settles or fails. Passwords are removed from each `ssh2` client
  configuration after that endpoint authenticates. The selected route and
  credentials are not logged.
- Each SSH client connects directly to the first gateway. Each following hop
  connects through the previous client's `forwardOut` channel. Only the final
  SSH client requests a terminal shell.
- Every gateway and the destination use the existing strict host-trust flow
  against that endpoint's own host and port. Unknown keys require explicit
  approval; changed keys block the connection.
- A route contains at most two gateways. This bounds credential prompts, SSH
  clients and inter-hop channels. Each inter-hop channel open has a 15-second
  deadline; the existing 130-second route-open deadline bounds the full chain.
  Any failure, cancellation, close or worker shutdown destroys route channels
  and ends clients in reverse order.
- Password authentication is supported through the existing prompt flow.
  Public-key and agent forwarding, routes for SFTP-only targets or forwarding
  definitions, and three-or-more gateway chains are outside this slice.

## Consequences

The implementation supports connection-specific one- and two-gateway SSH
terminal routes while preserving the current credential-free session schema.
Users can export and re-import gateway/target profiles without exporting route
state or secrets. The route is selected again for each connection.

P-22/F-011 remains partial: only saved SSH terminal targets are routable, there
is a two-gateway cap, and server interoperability beyond the Windows loopback
fixture has not been verified.

WP-04E later extends this route mechanism to saved SFTP-only targets; see
[ADR-0032](ADR-0032-sftp-only-ssh-gateway-routes.md).

## Acceptance evidence

- Domain and typed IPC tests reject duplicate profile IDs, more than two IDs,
  and malformed route shapes.
- Broker tests verify that IDs resolve to SSH definitions in order before the
  SSH controller opens the target.
- Application tests verify per-hop credential prompts, host-trust calls in
  route order and clearing of temporary gateway credential objects.
- Worker protocol and transport tests verify route bounds, nested `forwardOut`
  channels, endpoint-specific host verification and complete channel/client
  cleanup.
- Windows Electron E2E connects through one and two loopback gateway servers,
  approves independent host keys for the gateways and target, receives final
  terminal output and confirms client/relay cleanup.

See [WP-04D acceptance results](../results/WP-04D-ssh-gateway-routes-2026-10-24.md).
