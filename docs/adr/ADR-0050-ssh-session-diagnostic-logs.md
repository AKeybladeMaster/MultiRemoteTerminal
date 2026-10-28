# ADR-0050: Explicit local SSH session diagnostic logs

**Status:** Accepted; implementation has partial Windows acceptance (2026-10-28)

## Context

Users need evidence for SSH failures that occur before a terminal is established and for activity after it opens. The current renderer uses the same `TIMEOUT` message for a credential prompt timeout and SSH transport setup timeout. A session transcript is sensitive because terminal input and output may contain secrets, so general diagnostic logging rules cannot silently collect it.

## Decision

- Provide one per-attempt local `.log` file, selected through Electron's native Save dialog after a native plain-text content warning. Recording is off by default, requires a fresh trusted submit with the checkbox selected, and starts before the SSH open request so failure is captured. Main binds the selected file to the initiating renderer, session ID, resolved route and one matching SSH open; unused bindings expire after 30 seconds. Do not persist the opt-in.
- Store structured JSON Lines records for observable connection lifecycle, host-trust and credential-prompt outcomes, transport state, terminal input/output and resize/close events. A ready transport implies successful protocol authentication, but the log does not expose the authentication method or username. Capture terminal input at the SSH provider write boundary so keyboard input, paste, macros and other existing write paths are represented consistently. Capture output at the SSH transport receive boundary.
- Include UTC and monotonic timestamps, the session ID, endpoint and ordered gateway endpoint metadata, event category and bounded payload fields. Do not claim an unobserved network stage or cause; a `TIMEOUT` code alone is not proof of VPN, DNS, TCP, handshake or authentication failure.
- Keep the native-selected path in main-process state behind a renderer/session/route-bound handle. Write asynchronously with a bounded queue, a 64 MiB file cap and 10-second open/flush deadlines. On logging failure or limit, stop and report recording state without blocking terminal transport or disconnecting SSH. Finalize on every failure/close/shutdown path.
- Do not record app-level SSH password/passphrase/agent-username prompt values, private keys, vault references, SFTP file contents, or tunnel payloads. Warn users that terminal content and endpoint metadata may be sensitive plain text; do not claim heuristic secret redaction.
- Do not add a session-viewer tab, external telemetry, a general application log, persistent setting, or automatic cleanup policy in this slice.

## Consequences

The user can inspect the complete opted-in terminal exchange and connection lifecycle, including a failed open. The file may contain a secret deliberately typed into the remote shell or printed by the remote host; the user must handle it as sensitive company data. File size and write queue are bounded. Events not observable at an application/transport boundary remain unknown, and this log is not a packet capture or a compliance audit record.

## Verification

Focused unit tests cover ordered JSONL records, duplicate IDs, failed-open finalization, file and queue caps, and SSH lifecycle/I/O events without credential values. Windows loopback E2E verifies opt-in failed-connect logging, terminal input/output, credential exclusion, and flush on close. Native picker selection/cancellation and packaged SSH-log acceptance remain open, so P-45 stays PARTIAL. See [WP-02C results](../results/WP-02C-ssh-session-diagnostic-logs-2026-10-28.md) and [the feature design](../SSH-SESSION-LOG-WATCHER.md).
