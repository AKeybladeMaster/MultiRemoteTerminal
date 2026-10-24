# ADR-0010: WP-04B loopback-requested remote SSH forwarding

**Status:** Accepted for WP-04B (2026-10-24)

## Context

WP-04 includes local, remote and dynamic SSH forwarding. WP-04A established a
persisted tunnel catalog, explicit start/stop, host trust, and a dedicated
files-only SSH runtime for local forwarding. Remote forwarding adds a server
listener and sends accepted SSH channels back to a destination on the user's
computer. Non-loopback listeners need a separate exposure and consent policy.
An SSH server's `GatewayPorts` policy can override a requested loopback bind,
so the client cannot guarantee that the listener remains private to the server.
The [OpenBSD `sshd_config(5)` reference](https://man.openbsd.org/sshd_config#GatewayPorts)
documents that `GatewayPorts yes` forces wildcard binding.

## Decision

- Add `remote` as a persisted direction in the existing SSH tunnel definition.
  Both local and remote definitions keep the bind host fixed to `127.0.0.1`;
  the renderer cannot submit another bind address.
- Start only after explicit user action. Reuse the saved SSH profile, host-key
  approval and credentials through a separate files-only SSH runtime. Do not
  request a shell, PTY or SFTP subsystem.
- Request the remote bind with `forwardIn('127.0.0.1', port)`. When port `0` is
  selected, publish the assigned server port only after the server confirms the
  bind. Warn in the manager before start that server `GatewayPorts` policy may
  expose the listener on other interfaces. The SSH worker accepts each matching
  forwarded channel, connects to the configured local destination and relays
  data between the two streams.
- Bound remote bind setup to 10 seconds, channel setup to 15 seconds, unbind
  acknowledgement to 1.5 seconds, and each definition to 64 open or pending
  channels. Stop removes the remote bind, closes paired channels and sockets,
  and closes the dedicated SSH runtime. Runtime shutdown also destroys those
  resources; closing SSH drops any server-side binds that could not be
  acknowledged as unbound.
- Keep tunnel definitions persisted but stopped after app restart. Do not
  persist assigned ports or start tunnels automatically.
- Keep non-loopback remote binds, dynamic SOCKS forwarding and jump-host chains
  out of this slice. Supporting them requires new policy and acceptance
  evidence.

## Consequences

The tunnel model, storage, typed IPC and manager now share local and remote
definitions without widening renderer capabilities. The app requests loopback
and warns that server policy can widen the actual bind; the fixture verifies
the requested address and visible warning, not behavior on every server
configuration. P-24 remains partial until broader server behavior and protected
nonlocal-listener consent are implemented and verified.

## Acceptance evidence

WP-04B requires domain and protocol validation for the remote mode, SQLite
round-trip, worker-level channel-to-local-socket forwarding and cleanup, plus a
Windows E2E from the tunnel manager through the utility worker to a loopback
destination. The E2E must verify the visible server-policy exposure warning,
requested `127.0.0.1` bind, server-assigned port reporting, explicit stop,
app-shutdown cleanup, no shell request and stopped restoration after restart.
Broader SSH server interoperability and actual bind behavior under non-loopback
server policy are not claimed.
