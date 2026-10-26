# ADR-0033: WP-04F saved tunnels through SSH gateway routes

**Status:** Accepted for WP-04F (2026-10-26)

## Context

WP-04D/E support up to two saved SSH gateway profiles for terminal and SFTP-only
targets. The saved tunnel manager also starts each forward over a dedicated
files-only SSH connection, but it currently always connects directly to its
saved SSH/SFTP endpoint. Tunnel forwarding definitions need to use the same
gateway chain without starting a shell or changing the persisted tunnel schema.

## Decision

- Keep tunnel definitions credential-free and route-free. A user may start a
  saved tunnel directly as before, or explicitly choose **Start through
  gateways** and select up to two saved SSH profiles in route order. The route
  applies only to that start attempt and is selected again after stopping or
  restarting the app.
- The renderer sends profile IDs only in the typed `tunnel.start` request. Main
  resolves each ID through `SessionCatalog`, rejects missing or non-SSH
  profiles, validates the route against the tunnel's saved target endpoint,
  and then passes canonical endpoints to the application controller.
- The tunnel controller opens its existing files-only SSH runtime through the
  route before asking the worker to start the selected forward. No PTY, shell
  or SFTP subsystem is requested. Every SSH endpoint uses the existing strict
  host-trust flow; gateway and target credentials stay in the main/worker
  operation flow.
- Reuse the existing two-gateway maximum, 15-second inter-hop channel bound,
  130-second connection-open bound, forward limits and stop/worker cleanup.
  Same-route concurrent starts continue to coalesce; a concurrent request for
  a different route returns `BUSY` instead of silently joining another path.
- Gateway profile IDs and endpoints are never stored in the tunnel catalog or
  folder bundle. Direct tunnel starts, saved definitions and restart behavior
  remain unchanged.

## Consequences

Any saved local, remote or dynamic tunnel can be started through the bounded
gateway chain while retaining its existing forwarding policy. Routes are
explicit and connection-scoped; users must select them again for each start.
P-22/F-011 remain partial for chains longer than two hops and broad public SSH
server interoperability. F-006 remains partial for non-loopback policy,
SOCKS5 UDP/BIND and broader forwarding interoperability.

## Acceptance evidence

- Contract tests accept zero to two unique gateway IDs and reject malformed,
  repeated or over-limit IDs. The broker resolves saved SSH profiles and
  validates target overlap before starting the tunnel controller.
- Application tests verify that the route reaches the files-only SSH open,
  endpoint overlap fails before runtime startup, identical concurrent routes
  coalesce and different concurrent routes fail with `BUSY`.
- Windows Electron E2E starts a saved local forward through two loopback SSH
  gateways, approves each host independently, verifies a TCP roundtrip and
  confirms no shell or SFTP request and complete channel/listener cleanup.
- WP-04G extends the controlled Windows fixture to routed remote-forward and
  dynamic SOCKS TCP roundtrips, verifying exact bytes, no PTY/shell/SFTP
  request, remote unbind, client/channel cleanup and listener release.

See [WP-04F acceptance results](../results/WP-04F-tunnels-through-ssh-gateways-2026-10-26.md) and
[WP-04G acceptance results](../results/WP-04G-routed-tunnel-modes-2026-10-26.md).
