# ADR-0067 — Per-start SOCKS5 credentials

Status: Proposed; implementation and acceptance pending.
Date: 2026-11-06
Requirements: P-25, F-006, F-012.

## Decision

Offer an explicit per-start username/password option for dynamic tunnels. The
existing unauthenticated mode remains available and labelled. A native credential
prompt collects a separate local proxy account; SSH credentials are never reused.
The renderer sends only the policy flag. No proxy credential is saved in tunnel
definitions, SQLite, exports, status events or logs. Stopping the tunnel releases
the worker-owned credential buffers. JavaScript strings and process IPC copies
cannot be guaranteed erased from memory.

The existing SSH forwarding adapter owns RFC 1929 negotiation before TCP CONNECT,
retaining the listener's loopback bind, 64-connection cap and setup deadline.
Protected starts select only method 2 and reject clients offering only method 0;
authentication failure closes the connection without opening an SSH channel.
Username and password are UTF-8, each 1–255 bytes, and are compared as bytes. This
authentication protects use of the local listener; RFC 1929 sends the credential
in cleartext on the local connection and provides no protection against a
compromised Windows account.

BIND and UDP ASSOCIATE remain explicitly unsupported. BIND still needs an
approved advertised-address/remote-listener consent policy; UDP needs an
authenticated remote datagram relay absent from the current SSH transport.

## Acceptance

Author controller cancellation/policy tests, strict worker-protocol validation,
fragmented/pipelined authentication and exact forwarded-byte tests. Run them only
after all resumed implementation phases finish, then review the final candidate.
Keep P-25 PARTIAL until broader operations/interoperability are accepted.

Sources: [RFC 1929](https://www.rfc-editor.org/rfc/rfc1929),
[RFC 1928](https://www.rfc-editor.org/rfc/rfc1928).
