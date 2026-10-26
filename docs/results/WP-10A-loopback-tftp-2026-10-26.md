# WP-10A: read-only loopback TFTP server

**Status:** Partial; F-022/P-20 remain partial and P-41 is not verified.

## Scope

Add an opt-in local TFTP server with an explicit folder picker, start/stop controls and visible status. The service is unauthenticated; the dialog warns that any local process can read top-level files in the selected folder while it runs. The listener and transfer sockets bind only to `127.0.0.1`. The worker supports octet RRQ only, rejects writes and unsafe paths, and serves only regular top-level files no larger than 16 MiB. It allows eight active and eight pending transfers, 512-byte blocks, three one-second retries and a 120-second transfer deadline. The default listener port is 69; port 0 asks the OS for a free port. No third-party package was added.

The main process holds the absolute selected path behind an opaque token. Renderer IPC exposes only that token, the safe folder name, the port and typed status. The server runs in a supervised Electron utility worker; application shutdown requests a bounded stop and terminates the worker if needed. The dialog displays the 16 MiB file ceiling. Unexpected transfer IDs receive ERROR 5 without ending the active transfer; malformed packets from the expected peer receive ERROR 4 and end it.

## Evidence

- `corepack pnpm typecheck`: passed.
- `corepack pnpm lint`: passed, including import-boundary checks.
- Focused unit suite for TFTP, bridge, broker, gesture, contracts and preload: **99/99 passed**.
- `corepack pnpm build`: passed on Windows x64; Vite emitted the existing renderer chunk-size advisory.
- Focused Windows Playwright E2E: **failed**. The app starts the service and the client receives DATA block 1, but the client ACK does not produce DATA block 2; the test times out. The same failure occurs when using the default listener port 69.
- A Python standard-library loopback UDP probe reproduced the one-way request/data behavior and did not observe the ACK at the transfer socket. All Windows Firewall profiles report enabled and the current profile reports `BlockInbound,AllowOutbound`; packet-filter logging was disabled, so this is not proof of firewall causality.
- No debug scripts or runtime packet logging are retained.

## Remaining limits

Do not claim successful file transfer, interoperable TFTP, authorization against other local processes, lifecycle under active traffic or P-41's >360-second service lifetime. Keep the transfer sockets loopback-only and preserve RFC TID behavior while investigating the Windows UDP path. No firewall exception was added. The unauthenticated local-read exposure remains the primary user-facing risk and is disclosed before Start.

Next: obtain a passing full-transfer Windows E2E under an approved network policy, then add hostile local-peer and active-stop assertions before promoting the feature beyond partial status.
