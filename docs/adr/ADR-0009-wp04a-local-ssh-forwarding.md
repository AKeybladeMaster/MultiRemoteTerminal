# ADR-0009: WP-04A loopback local SSH forwarding

**Status:** Accepted for WP-04A (2026-10-24)

## Context

The forwarding requirements call for persisted tunnel definitions and a live
runtime whose listeners are not treated as saved configuration. The existing
SQLite schema already has a `tunnel_definitions` table, but there is no tunnel
domain model, controller, provider operation or user flow. WP-04 also includes
jump-host chains, remote forwarding and dynamic SOCKS forwarding, each with
additional routing and exposure rules.

## Decision

- Implement local TCP forwarding first as a bounded vertical slice. A definition
  refers to a saved SSH session and contains a name, local bind port, remote
  target host and target port.
- Starting a definition is always an explicit user action. The application opens
  a separate, files-only SSH runtime for the saved profile, reusing current
  host-trust and credential handling. It does not request a PTY, shell or SFTP
  subsystem.
- The SSH utility worker owns the local listener and forwarded channels. The
  controller reports `active` only after the listener binds successfully. A
  failed start, stop, SSH failure or worker shutdown closes the listener,
  channels and associated SSH runtime. Listener sockets preserve TCP half-close
  behavior so a client can finish sending while it still receives a response.
- Definitions persist across app restarts but never auto-start. Runtime status
  and assigned ports are ephemeral.
- This slice binds only to `127.0.0.1`. Port `0` asks Windows to select an
  available port. Public binding, remote forwarding, dynamic forwarding and
  jump-host routing remain separate WP-04 slices with their own explicit policy
  and acceptance evidence.

## Consequences

Local forwarding can be accepted without broadening the renderer's privileges
or weakening SSH host checks. It has one deliberately narrow bind policy. The
existing SQLite tunnel table needs a label column; that additive migration is
separate from runtime state. The status UI must distinguish a saved definition
from a running listener and show the actual local port when Windows assigned
one.

## Acceptance evidence

WP-04A must cover a Windows loopback TCP roundtrip through the UI, first-use SSH
trust, persisted definition reopen after restart, port conflict with no leaked
SSH runtime, successful-start-only status, and listener release after stop.
Repository tests must also store more than two definitions. These checks do not
complete P-23/F-006 or WP-04; remote/dynamic forwarding, jump chains, public-bind
confirmation and full failure/interoperability coverage remain open.
