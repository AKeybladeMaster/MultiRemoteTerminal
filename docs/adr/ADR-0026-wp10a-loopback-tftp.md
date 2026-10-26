# ADR-0026: Opt-in read-only loopback TFTP server

**Status:** Accepted for partial WP-10A implementation; transfer acceptance remains open (2026-10-26)

## Context

F-022 calls for optional local daemons and P-20 requires controlled server lifecycle. TFTP has no authentication, so a running service can expose files to local processes. The service must not start at application launch, listen beyond loopback, accept uploads or let renderer code choose arbitrary filesystem paths. TFTP also assigns transfer identifiers (UDP ports) that remain fixed for the duration of a transfer; see [RFC 1350, section 4](https://www.rfc-editor.org/rfc/rfc1350.html#section-4).

## Decision

- Require a native folder selection and explicit Start action. Display a clear warning that TFTP has no authentication and any local process can read top-level files in that folder while the server is running. Stop is explicit; application shutdown also closes the worker.
- Bind the listener and each transfer socket only to IPv4 loopback (`127.0.0.1`). The listener defaults to UDP 69; port 0 permits the OS to choose an available port. Do not add an automatic Windows Firewall rule.
- Implement RRQ in octet mode only. Reject WRQ, subdirectory paths, traversal, symlinks/reparse points, non-regular files and files over 16 MiB. Ignore well-formed optional request fields without negotiating unsupported extensions. Reply with TFTP ERROR 5 to a packet from an unexpected transfer ID without disturbing the active transfer; return ERROR 4 and terminate for malformed transfer packets from the expected peer.
- Keep filesystem access in a supervised Electron utility worker. Main stores the selected absolute path behind an opaque token; typed IPC carries only that token, a validated port and status. Renderer code never receives the path or opens a network socket.
- Bound service work to eight active and eight pending transfers, a 120-second transfer deadline, 512-byte blocks, three retries at one-second intervals and worker-owned cleanup on stop/exit. Add no arbitrary total runtime timeout.
- Do not add a third-party protocol package; use the pinned Node runtime's `node:dgram` and filesystem APIs.

## Consequences and limits

The server is unauthenticated and intentionally exposes every permitted top-level file to local processes while running. It has no write path, subdirectory browsing or network-interface selection. The TFTP transfer E2E currently receives block 1 but cannot complete the first ACK/block 2 exchange on the available Windows host. The same behavior was observed in a Python standard-library loopback probe. Windows Firewall is enabled with inbound block policy, but no filtering logs were collected, so the cause is not attributed to the firewall. No protocol or bind-security workaround is accepted until interoperability and loopback isolation are independently verified. P-20/F-022 remain partial and P-41 remains unverified.

## Verification

See [WP-10A results](../results/WP-10A-loopback-tftp-2026-10-26.md). Static checks and focused unit tests pass; full transfer, active-stop behavior, unauthorized local access and >360-second lifetime remain open.
