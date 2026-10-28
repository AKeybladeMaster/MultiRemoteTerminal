# SSH session log watcher (F-027 / P-45)

**Status:** In progress (WP-02C). Windows loopback acceptance now covers a failed open, active terminal input/output, credential exclusion and flush on close. Native Save picker selection/cancellation and packaged SSH-log acceptance remain open; P-45 is PARTIAL.

## Problem

The renderer currently maps the SSH `TIMEOUT` error to “The SSH connection timed out.” That category can come from the native SSH credential prompt (120-second timeout) or SSH transport setup (130-second timeout); the UI does not identify the phase. A user troubleshooting a VPN route also needs to see which connection operations ran and what the terminal returned.

## User behavior

- SSH terminal recording is **off by default** and is chosen separately for each connection attempt. It is not a saved-session or workbench preference.
- The SSH connect flow offers **Record this SSH session to a local `.log` file** with a clear sensitive-content warning. Main repeats the plain-text warning in a native confirmation before Electron's Save dialog chooses the destination. The log is initialized before the SSH attempt starts, so failed opens are captured. Canceling either dialog cancels the logging-enabled connection attempt; it never silently continues without a log.
- The log is local to the selected path. No analytics, upload, cloud sync or automatic sharing is added.
- The UI shows when recording starts, if recording stops early, and when the file is finalized. Finishing a log does not close or interrupt a still-running SSH session.

## Records and limits

Use bounded JSON Lines records with a UTC timestamp, monotonic elapsed time from attempt start, session ID, event name and only the event fields listed below. JSON escaping keeps terminal control characters from becoming record delimiters.

- Connection attempt start, selected target endpoint and ordered gateway endpoints, host-trust outcome, credential-prompt category/outcome, transport start/ready/failure, failure code/observable phase (`preflight`, `credential-prompt`, `host-trust`, `authentication`, or `transport`), and session close. A ready SSH transport implies successful protocol authentication; the log does not expose the authentication method or username.
- Terminal input as accepted by the SSH application/provider write boundary and terminal output as received from the SSH transport, including their data chunks. Record terminal resize operations. Preserve order and escape data as JSON strings.
- Do not infer DNS, TCP, key-exchange or authentication phases from a generic `TIMEOUT`; include a phase only when the relevant adapter observed it. This limitation must be visible in the log/UI. The logger is diagnostic context, not a packet capture or root-cause verdict.

The file cap is 64 MiB and the pending write queue cap is 1 MiB. Writes are asynchronous and must not hold up SSH input/output; file open and flush waits are capped at 10 seconds. If a cap or I/O error is reached, stop recording at a complete record, finalize the file when possible, notify the user, and leave SSH connected. Flush/close on connection failure, normal close, explicit recording stop, worker failure and app shutdown. Output is never silently dropped while the UI still says recording.

## Security and privacy

The feature records exact shell input/output by design. A user can type credentials or secrets into a shell, and remote output may echo or print secrets. The destination path and endpoint/gateway names may expose company network details. Before the native Save dialog, disclose that the `.log` is local plain text containing terminal input/output and connection metadata, and tell the user to store/delete it according to company policy. Never call this a redacted or compliance-grade audit log.

SSH password, key passphrase and agent username prompt values; private-key bytes; vault references; SFTP file contents/transfers; tunnel payloads; and other protocol sessions are excluded. A shell password typed into the terminal is ordinary terminal input and will be recorded after the user explicitly opts in. No heuristic secret detector is used as a substitute for this warning.

The renderer never receives or supplies a filesystem path. A trusted submit with the recording checkbox selected creates a one-use main-process consent bound to the session ID, canonical target and ordered gateway profile IDs. Main obtains the path from Electron's native Save dialog and binds it to that renderer, the resolved endpoint chain and the matching `ssh.open` request; the binding expires after 30 seconds if no open follows. Mismatched or expired logged opens fail closed. The writer accepts only bounded, typed session records for that handle. No log path, content or recording preference is persisted to SQLite or included in session exports.

## Acceptance

1. Default connection and saved-profile reopen create no log and record no terminal content.
2. Explicit opt-in creates the chosen `.log` before the connection attempt; native picker cancellation starts neither logging nor the connection.
3. A failed attempt contains ordered start, observable phase/failure and elapsed-time records; the same `TIMEOUT` code alone is never presented as proof of a VPN, TCP or SSH-protocol cause.
4. A live SSH session records writes from every existing terminal input path and received output, with timestamps and escaped data, plus resize and close.
5. Credential dialog contents, private-key bytes, passwords passed through the vault, SFTP contents and tunnel traffic do not enter the log.
6. Queue/file caps, disk-full, worker crash and shutdown finalize or safely stop the logger without blocking or closing the SSH transport. The UI reports the final recording state.
7. Windows E2E verifies native path selection, failed open, live input/output, final flush and content boundaries. Focused application/adapter tests verify validation, order, caps and cleanup.

## Related decisions

- [ADR-0050: SSH session diagnostic logs](adr/ADR-0050-ssh-session-diagnostic-logs.md)
- [WP-02C implementation plan](IMPLEMENTATION-PLAN.md#wp-02--sshtrustvault)
- [Security policy](SECURITY.md#telemetry-and-logs)
