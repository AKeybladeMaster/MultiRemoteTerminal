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
- Focused Windows Playwright E2E: **failed at the required full RRQ assertion**. Native `curl.exe` receives the first DATA block (512 bytes), then exits with status 28 after waiting for the next block. Disabling TFTP option requests does not change the result.
- Assertions before that final transfer check passed: curl receives ERROR 2 for a WRQ (`Uploads are disabled`) and traversal (`Only top-level file names are allowed`); UI stop and restart work; after application shutdown there is no TFTP response and the listener port can be rebound. The E2E disables curl configuration with `--disable` and checks that the installed binary supports TFTP.
- A temporary focused Windows E2E probe using a native `node:dgram` client against the running app also received DATA block 1, sent ACK 1 successfully, then timed out waiting for DATA block 2. The probe was removed after diagnosis. A standalone Node loopback server/client probe reproduced the receive failure without Electron: the client received DATA from a separately bound transfer socket and its ACK send callback succeeded, but the server transfer socket did not receive a message. A Python standard-library loopback probe also timed out waiting for the ACK. This points to host-local UDP delivery to the ephemeral transfer ID; it does not prove the firewall is responsible.
- The current Windows Firewall profile reports `BlockInbound,AllowOutbound`; packet-filter logging was not enabled, so the firewall is not established as the cause. No firewall rules or policy were changed.
- No debug scripts or runtime packet logging are retained.

## Remaining limits

Do not claim successful file transfer or interoperable TFTP. Active-transfer stop, access from other local processes, loopback isolation under the target Windows policy and P-41's more-than-360-second service lifetime remain unverified. Runtime WRQ/traversal rejection and normal stop/restart/shutdown cleanup are now covered by Windows E2E. Preserve the loopback-only bind and RFC transfer-ID behavior while investigating the missing ACK; do not add a firewall exception or widen the bind as a workaround. The unauthenticated local-read exposure remains the primary user-facing risk and is disclosed before Start.

Next: capture enough loopback packet evidence to distinguish client behavior from host filtering, then require a passing full-transfer Windows E2E before promoting this feature beyond partial status.
