# WP-04C dynamic SSH SOCKS5 forwarding results

**Date:** 2026-10-24  
**Branch:** `dev-1`  
**Requirements:** P-25, F-006 (partial); supports P-23 dynamic-forward coverage.  
**Decision:** [ADR-0011](../adr/ADR-0011-wp04c-dynamic-socks-forwarding.md)

## Delivered

- Saved dynamic tunnel definitions contain no fixed destination; SQLite stores
  null destination columns without a schema migration.
- The tunnel manager offers a dynamic SOCKS5 proxy mode and labels its local
  address, no-authentication behavior and listen port.
- The SSH worker binds a loopback TCP listener and implements SOCKS5
  no-authentication `CONNECT` for IPv4, domain-name and IPv6 requests. It routes
  the requested destination through SSH `forwardOut`, so domain names are sent
  to the SSH server for resolution.
- Unsupported authentication methods, BIND, UDP ASSOCIATE, malformed fields and
  unsupported address types are rejected. The 64-connection cap includes
  rejected SOCKS sockets until they close; the 15-second setup deadline covers
  dynamic connections. Stop and shutdown dispose the listener, local sockets
  and SSH channels.
- Saved definitions restore stopped; no tunnel starts automatically.

## Validation

`corepack pnpm check` passed on Windows x64 with Node 24.14.1 and Electron 45:

- TypeScript checks, ESLint and static import-boundary checks passed.
- All 224 unit/adapter tests passed, including dynamic model, worker IPC,
  SQLite persistence, IPv4 CONNECT relay, IPv6 destination routing, unsupported
  request rejection, listener cleanup and a 64-socket rejection-cap regression.
- Native and renderer builds passed. Vite reports the existing advisory that
  the 643.98 kB minified renderer bundle exceeds its 500 kB warning threshold.
- All 16 Electron E2E scenarios passed. The forwarding scenario verifies the
  saved profile, UI start, SOCKS5 domain-name CONNECT through the SSH worker,
  returned payload, stopped restoration and shutdown listener release.
- The saved tunnel manager was captured and visually inspected at 1184×761 and
  684×681. Controls remain labeled and the narrow layout keeps the list and
  settings reachable with the modal's scroll areas.
- `git diff --check` passed.

The first full E2E run had one saved-session menu focus assertion failure.
That test passed in isolation and on five consecutive repeats; the complete
check was rerun and all 16 E2E scenarios passed. No saved-session code changed
in this slice.

Independent review found that rejected SOCKS sockets left the 64-connection
set before their close grace elapsed. A regression using half-open clients
reproduced admission of a 65th socket; rejection now keeps each slot occupied
until the socket close event, and the test verifies that closed sockets release
their slots. The full check passed again with 224 unit/adapter tests and 16/16
Windows E2E scenarios.

## Limits

P-25 remains partial. This slice does not support SOCKS5 authentication
sub-negotiations, BIND, UDP ASSOCIATE, destination rules or broad SSH-server
interoperability. Any local process able to reach loopback can use the started
proxy and the authenticated SSH profile. Jump-host routes remain WP-04D.
