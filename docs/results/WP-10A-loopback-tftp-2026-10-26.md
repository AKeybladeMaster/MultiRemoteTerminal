# WP-10A: read-only loopback TFTP server

**Status:** Partial; F-022/P-20 remain partial and P-41 is not verified.

## Scope

Add an opt-in local TFTP server with an explicit folder picker, start/stop controls and visible status. The service is unauthenticated; the dialog warns that any local process can read top-level files in the selected folder while it runs. The listener, transfer sockets and initial-error response sockets bind only to `127.0.0.1`. The worker supports octet RRQ only, rejects writes and unsafe paths, and serves regular top-level files no larger than 16 MiB. It allows eight active and eight pending transfers, up to eight initial-error responses in flight, 512-byte blocks, three one-second retries and a 120-second transfer deadline. The default listener port is 69; port 0 asks the OS for a free port. No third-party package was added.

The main process holds the selected absolute path behind an opaque token. Renderer IPC exposes only that token, the safe folder name, the port and typed status. The server runs in a supervised Electron utility worker; application shutdown requests a bounded stop and terminates the worker if needed. The dialog displays the 16 MiB file ceiling. Unexpected transfer IDs receive ERROR 5 without ending the active transfer; malformed packets from the expected peer receive ERROR 4 and end it. Errors denying an initial request come from a separately bound server TID, then close after send, a two-second bound or service stop.

## Evidence

- `corepack pnpm typecheck`: passed.
- `corepack pnpm lint`: passed, including import-boundary checks.
- Final focused TFTP, bridge, broker, gesture, contracts and preload unit suite: **99/99 passed**.
- `corepack pnpm build`: passed on Windows x64; Vite emitted the existing renderer chunk-size advisory.
- Initial Windows Playwright E2E run: **failed at the full RRQ assertion**. Native `curl.exe` received the first DATA block (512 bytes), then exited with status 28 after waiting for the next block. Disabling TFTP option requests did not change that run.
- Assertions before that final transfer check passed: curl receives ERROR 2 for a WRQ (`Uploads are disabled`) and traversal (`Only top-level file names are allowed`); UI stop and restart work; after application shutdown there is no TFTP response and the listener port can be rebound. The E2E disables curl configuration with `--disable` and checks that the installed binary supports TFTP.
- During the resumed audit, the original full-transfer E2E passed **6/6 consecutive runs**, with `curl.exe` output byte-for-byte equal to the 1,024-byte fixture. The E2E was then extended to exercise an active RRQ: it receives DATA blocks 1 and 2, stops the server before ACK 2, observes no retry, and successfully rebinds the transfer-ID port. The final revised end-to-end test passed **4/4 consecutive runs**.
- The temporary Node and Python ACK probes described above remain historical failure evidence. The prior failure is not currently reproduced, and its cause has not been established. The current Windows Firewall profile still reports `BlockInbound,AllowOutbound`; packet-filter logging is unavailable, so no firewall attribution is made.
- Effective `netsh advfirewall` policy remains `BlockInbound,AllowOutbound` on all profiles, while `LogDroppedConnections` is disabled. No firewall rules or policy were changed; the firewall's role in the historical timeout is unknown.
- No debug scripts or runtime packet logging are retained.

## Remaining limits

The recorded Windows loopback environment now verifies exact-byte full RRQ transfer, active-transfer stop, transfer-ID socket release, WRQ/traversal rejection, restart and application-shutdown cleanup. Broader TFTP interoperability, access and isolation from other machines, and P-41's more-than-360-second service lifetime remain unverified. The earlier ACK timeout is not currently reproducible and has no established cause. Preserve the loopback-only bind and RFC transfer-ID behavior; do not add a firewall exception or widen the bind. The unauthenticated local-read exposure remains the primary user-facing risk and is disclosed before Start.

Next: verify broader TFTP interoperability, machine-to-machine exposure/isolation, and service lifetime beyond 360 seconds before changing P-20/F-022/P-41 status.
