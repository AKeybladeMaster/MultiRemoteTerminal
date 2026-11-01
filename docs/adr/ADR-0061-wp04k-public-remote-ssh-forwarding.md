# ADR-0061: WP-04K all-interface remote SSH forwarding

**Status:** Proposed; Phase 07 acceptance pending

## Context

WP-04B requests remote SSH forward listeners on `127.0.0.1`. Some users need
clients on other networks to reach a service forwarded through their SSH
server. RFC 4254 defines `0.0.0.0` as listening on all IPv4 addresses and
reports forwarded channels with the port that was requested and the address
that was connected. Server policy can still restrict or widen a requested
bind, so the client cannot promise public reachability from an accepted
`forwardIn` request.

## Decision

- Keep `127.0.0.1` as the default for local and remote forwards. Local TCP
  forwards allow only `127.0.0.1` or `0.0.0.0`; remote TCP forwards accept a
  canonical IPv4 address, including those two values. Dynamic SOCKS listeners
  remain fixed to local loopback.
- Require main-process consent on every remote-forward start. The prompt
  identifies the SSH server, requested remote address and port, and local
  destination. For `0.0.0.0`, explain that devices that can reach the SSH
  server may connect when the address is not in `127.0.0.0/8`. Cancel remains
  the default and opens no SSH runtime.
- Send the selected bind to `forwardIn` and use the same address with
  `unforwardIn`, including late-bind cleanup.
- Accept a `forwarded-tcpip` channel only when its port and address match
  exactly one active remote forward. A `0.0.0.0` request accepts numeric IPv4
  addresses; a specific address accepts only that address. Keep the existing
  channel limit and setup deadlines.
- Before requesting an explicitly consented wildcard bind, adapt the pinned
  `ssh2` client's forwarding lookup so a concrete IPv4 channel address can
  resolve to its registered `0.0.0.0` bind. Preserve exact-address entries
  first; the worker still validates the active port and bind policy before
  accepting a channel. `ssh2` currently rejects this legal channel before
  emitting its event because it looks up only the concrete address. Remove
  this compatibility path when upstream handles wildcard binds correctly.
- Do not create firewall rules or inspect whether the remote service is
  reachable from outside the SSH server. An active status means the server
  accepted the forwarding request, not that every network path can reach it.

This supersedes the loopback-only bind restriction in [ADR-0010](ADR-0010-wp04b-remote-ssh-forwarding.md).

## Consequences

Remote binds are explicit, persisted, and confirmed on every start. Canonical
IPv4 validation prevents malformed addresses; channel matching stays exact for
specific addresses, while the wildcard path remains IPv4-only. `P-24` remains
partial pending the Windows acceptance gate and broad server interoperability.
The compatibility path depends on the pinned client's
internal forwarding map; its regression coverage includes a provider test and
the Windows SSH fixture, but is not a substitute for public-server evidence.

## Acceptance evidence

The Phase 07 gate must verify default loopback behavior, rejection of malformed
IPv4 and non-remote custom binds, SQLite insert/update persistence, specific
and wildcard `forwardIn`/`unforwardIn` address symmetry, address-specific
forwarded-channel matching, cancel-before-SSH behavior, actual specific and
wildcard listener binding in the controlled Windows fixture, traffic relay,
and stop/shutdown cleanup. The fixture does not
establish interoperability with all SSH server implementations or network
reachability through external firewalls.

See [RFC 4254, sections 7.1–7.2](https://www.rfc-editor.org/rfc/rfc4254).
