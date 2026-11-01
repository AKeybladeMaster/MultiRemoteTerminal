# ADR-0060: WP-04J local SSH forwards on all IPv4 interfaces

**Status:** Proposed; Phase 07 acceptance pending

## Context

Local SSH forwards bind to loopback by default. Some users need another device
to reach a forwarded service, but `0.0.0.0` makes the listener reachable on all
local IPv4 interfaces subject to Windows Firewall and network policy. The
renderer must not be able to create that exposure silently.

## Decision

- Keep `127.0.0.1` as the default and allow only `127.0.0.1` or `0.0.0.0` for
  local SSH forwards. Do not accept arbitrary local addresses.
- Keep dynamic SOCKS listeners fixed to `127.0.0.1`. WP-04J left remote binds
  at loopback; [ADR-0061](ADR-0061-wp04k-public-remote-ssh-forwarding.md)
  separately adds the confirmed remote all-IPv4 option.
- Require the main-process confirmation on every start of a local forward bound
  to `0.0.0.0`. The dialog identifies the SSH server, local listener, port and
  remote destination; port `0` is shown as OS-assigned.
- Reserve the application start attempt before showing consent. While the dialog
  is pending, edits and deletion of that tunnel are rejected. Cancel or dialog
  failure must not open SSH.
- Do not create or modify Windows Firewall rules. The user controls network
  reachability through the Windows firewall and the remote destination service.

## Consequences

The same persisted tunnel, worker and status path handles both loopback and
all-interface local listeners. Public binding is opt-in for each saved forward
and each start. The IPv4-only allowlist avoids unspecified address parsing and
does not add a broad network configuration surface. P-23/F-006 remain partial
until Phase 07 acceptance passes and broader SSH-server interoperability is
covered.

## Acceptance evidence

The Phase 07 gate must verify domain/IPC rejection of non-allowlisted hosts,
SQLite round-trip for the public local bind, main-process cancel/accept behavior,
no SSH connection on cancellation, the actual Windows listener address, relayed
traffic, stop cleanup and default loopback behavior. SOCKS binds remain
loopback-only. No test or interoperability result is claimed yet.
