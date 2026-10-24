# ADR-0011: WP-04C dynamic SSH SOCKS5 forwarding

**Status:** Accepted for WP-04C (2026-10-24)

## Context

WP-04 requires local, remote and dynamic forwarding. The existing tunnel manager
already persists named definitions and owns explicit start/stop through a
dedicated files-only SSH connection. A dynamic forward must let each local
client select its own destination instead of storing one fixed destination in
the catalog. The listener also must not become an unauthenticated LAN proxy.

## Decision

- Add `dynamic` as a destination-free tunnel mode. SQLite uses the existing
  nullable destination columns as `NULL`; no schema migration is required.
- Start a TCP listener on `127.0.0.1` only, and require the user to start it
  explicitly. Port `0` requests an available local port, reported only after
  the listener is bound. Definitions restore stopped after app restart.
- Support SOCKS5 no-authentication and TCP `CONNECT` requests using IPv4,
  domain-name and IPv6 addresses. The worker passes the requested host and port
  to `ssh2` `forwardOut`, so domain resolution occurs on the SSH server side.
- Reject clients that do not offer no-authentication with method `0xFF`;
  reject `BIND` and `UDP ASSOCIATE` with reply `0x07`; reject unsupported
  address types and malformed fields. No proxy credentials are collected,
  stored or exposed to the renderer.
- Reuse the per-forward limit of 64 pending/open connections and the 15-second
  connection setup deadline. On stop, session close, worker shutdown or app
  shutdown, close the local listener and every paired socket/channel.
- Clearly label the no-authentication, loopback-only listener in the tunnel
  editor. Any local process able to connect to loopback can use the user's
  authenticated SSH connection to reach destinations allowed by the server.

## Consequences

The implementation covers the common SOCKS5 TCP proxy flow with limited local
exposure and bounded resources. It does not claim complete SOCKS5 method
compliance or UDP support: authenticated methods, `BIND`, `UDP ASSOCIATE`,
per-destination rules and broad server interoperability remain open. The
listener is protected from remote network peers by binding only to loopback;
local processes on the same machine are not isolated from it.

## Acceptance evidence

The domain, IPC, worker protocol and SQLite reject destination fields on dynamic
definitions and persist null destination columns. Unit coverage checks a real
SOCKS5 no-auth `CONNECT` roundtrip, an SSH-side destination request, unsupported
UDP and authentication methods, and listener cleanup. Windows Electron E2E
starts the proxy through the manager, connects to a domain-name destination via
the SSH utility worker, verifies returned bytes, confirms shutdown releases the
loopback port and confirms the saved definition restores stopped. This covers
only the listed flow, not every SOCKS5 implementation or SSH server.

## Reference

[RFC 1928, SOCKS Protocol Version 5](https://www.rfc-editor.org/rfc/rfc1928/)
