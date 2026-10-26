# ADR-0032: SFTP-only targets through SSH gateway routes

**Status:** Accepted for WP-04E (2026-10-26)

## Context

WP-04D added connection-specific routes through up to two saved SSH gateway
profiles for interactive SSH targets. Saved SFTP-only session definitions use
the same SSH endpoint, authentication, host-trust and worker lifecycle, but the
broker and worker handoff did not yet carry a route for files-only opens. A
routed file session must preserve the no-shell behavior of standalone SFTP.

## Decision

- The saved SFTP target action offers a connection-specific route through up to
  two saved SSH profiles. The route is not added to the session definition and
  is not included in folder bundle import/export.
- The renderer submits saved profile IDs only. The main broker resolves each
  profile through `SessionCatalog`, accepts only SSH definitions and validates
  the canonical route before credential prompts or worker handoff. Duplicate
  hops and a gateway endpoint that overlaps another hop or the target are
  rejected.
- The SFTP open request carries the authentication method and optional gateway
  profile IDs through the typed preload and IPC contract. Gateway credentials
  remain main/worker data, are cleared after handoff and settlement, and never
  enter renderer IPC or saved definitions.
- The application reuses the SSH route controller. Each gateway and the target
  passes the existing strict host-trust flow in route order. The worker opens
  each nested hop over the prior client's `forwardOut` channel, then requests
  only the SFTP subsystem at the destination. It does not request a PTY or
  shell.
- The existing 15-second per-channel and 130-second whole-open bounds apply.
  Cancellation, timeout, failure, close and worker shutdown release all
  channels and SSH clients through the existing provider cleanup path.
- Password-based two-hop SFTP routing is covered by Windows Electron
  acceptance. Private-key and agent authentication through gateway chains,
  gateway-routed tunnels, chains longer than two gateways and public-server
  interoperability are not claimed by this slice.

## Consequences

Saved SFTP-only targets can now use the bounded gateway route without changing
the session schema or opening a remote shell. Direct SFTP behavior remains the
same. Automatic saving remains disabled for routed sessions because the route
is not part of the saved target definition. P-22/F-011 remain partial while
tunnel routes, longer chains and broader interoperability are open.

## Acceptance evidence

- Contract tests accept valid route IDs and reject malformed or duplicate
  gateway selections.
- Broker tests confirm the selected saved SSH endpoint reaches the files-only
  controller and that no terminal open is issued.
- Application, worker-protocol and worker-host tests cover ordered host
  verification, bounded hop validation, files-only payload shape and clearing
  of temporary gateway credentials.
- Windows Electron E2E verifies a two-gateway SFTP route, independent trust for
  the SFTP target, remote listing, no shell request and complete client/relay
  cleanup.

See [WP-04E acceptance results](../results/WP-04E-sftp-only-ssh-gateway-routes-2026-10-26.md).
