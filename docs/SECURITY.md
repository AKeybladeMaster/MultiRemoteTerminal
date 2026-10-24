# Security Architecture and Test Checklist

**Threat model:** Desktop application executes local commands and communicates with untrusted network servers. Remote terminal output, file names, user-supplied profile scripts, third-party viewer processes and network peers must be treated as untrusted. User is assumed to control their Windows login; the app must protect against accidental exposure, compromised servers, malformed inputs, malicious downloads and privilege boundary violations. Protection against fully compromised same-user malware is out of scope.

## Core threats and mandatory controls

| Threat | Attack path | Mitigation | Acceptance proof |
|---|---|---|---|
| Renderer privilege escalation | Terminal escape/XSS to Node or IPC | Sandbox renderer, context isolation, `nodeIntegration=false`, restrictive CSP, typed allowlist with sender checks, deny navigation/window-open | Malicious output test cannot invoke FS/process |
| Command injection | Untrusted host/path interpolated into shell | Structured provider args and APIs, `spawn` without shell, no command concatenation | Host/path with quotes and metacharacters has no side effect |
| MITM via host key | New/changed SSH host silently accepted | Strict trust-on-first-use approval with fingerprint; changed keys BLOCK, explicit trust reset | Fixture replaces key; connection stopped |
| Vault disclosure | Secrets in SQLite/logs/UI | Vault encryption, reference IDs, no renderer secret reads, redacted structured logs | Scan DB/logs; review IPC traces |
| Misleading vault guarantee | Same-user attacker decrypts DPAPI | Explain limits, master-password option, lock and auto-lock | UI documentation + corruption fail-closed and explicit reset |
| X11 exposure | X server accepts unauthenticated remote clients | Local-only X listener, MIT-MAGIC-COOKIE when supported, disable TCP by default, no `-ac` | Unauthorized connection denied |
| Unrestricted tunnel | Forwarded listener exposed to LAN | Bind loopback by default, explicit nonlocal bind opt-in; warn for reverse/dynamic | Default socket binds 127.0.0.1; no 0.0.0.0 |
| Legacy insecure protocols | Plaintext passwords over FTP/Telnet/Rlogin | Plain FTP requires a trusted endpoint-bound confirmation; FTPS is the default; Telnet is explicit and visibly labeled | Warning, transport label and protocol fixture |
| Path traversal / symlink attacks | SFTP remote path tricks and download escapes | Treat remote paths as data; bound and validate each path component; identify symlinks without following them in the browser; for future downloads, normalize the local destination and enforce the chosen target root with safe temporary files | WP-05A unit tests reject traversal-shaped paths and mismatched entry paths; Windows SFTP traversal/transfer fixture remains required |
| Macro secrets | Recorded passwords replayed to wrong host | Secret-input suppression, target scope, explicit MultiExec confirm, no automatic reconnect replay | Secret mask and target tests |
| Third-party supply chain | Untrusted binary/provider injection | Signed/pinned installer deps, license inventory, hash/provenance and opt-in tools | SBOM + allowed binary provenance |
| Unexpected daemon exposure | User starts public listener unknowingly | Loopback default, UI display bind/port, require explicit approval, firewall notes | Daemon exposure test |
| Persistent script execution | Custom profile launches without understanding | Preview and explicit enable; trusted path policy; maintain own allowed startup behavior | Disabled script not executed |
| Information disclosure | Export/backup includes credentials | Export excludes secrets by default; explicitly encrypted opt-in secret export | Export scan |
| Unlimited resource exhaustion | Thousands of sessions create open handles | Unlimited *definitions*, resource-based runtime throttling and queue backpressure | 1,000 persisted, graceful saturation |
| Worker crash & leak | SSH/PTY crashes leaving sockets | Supervisor closes owned streams and listeners, clears secrets, updates status | Kill worker scenario |

## Electron minimum configuration

- Current patched Electron version; renderer `sandbox=true`, `contextIsolation=true`, `nodeIntegration=false`, secure custom app protocol, `webSecurity=true`.
- Deny unnecessary permissions and navigation. The only current permission exception is `clipboard-sanitized-write` for the trusted `mrt://app` main frame; clipboard reads from the renderer, subframes and all other origins remain denied. Copy selection writes only after the explicit terminal-tab action. Ctrl+V and Ctrl+Shift+V require a one-use native keyboard gesture and a matching trusted key event from the focused terminal; the main broker reads clipboard text and never returns it to the renderer. It rejects NUL-containing text and text longer than 16,384 characters before sending it to a session. Electron materializes the clipboard string in main before this length check, so the cap bounds terminal input, not the initial clipboard read. Terminal input is queued in order per session, including across the asynchronous paste authorization step. Multiline text requires a native confirmation because writing raw lines can run multiple shell commands; the paste request waits for the user's decision, and renderer teardown cancels it before any write. External URL access requires allowlisting.
- Strict CSP; no unsafe-eval, no arbitrary HTML/JS rendering of terminal output.
- Validate IPC origin/sender and schemas for **every** command; do not expose raw `ipcRenderer` from preload.
- Main or privileged worker owns filesystem, system processes and vault. Distinguish worker process isolation from a strong OS sandbox.
- Review Electron security guidance before first release: https://www.electronjs.org/docs/latest/tutorial/security/

## SSH rules

- Host authenticity verified on initial connection, reconnection, jump-host chain and SFTP/tunnels. No default `hostVerifier:()=>true`.
- Default key-exchange, cipher and MAC list from well-maintained library; disable deprecated algorithms unless user explicitly opts in with visible warning and scoped host override.
- Password/key/agent auth; no persistent passphrase in plaintext. Agent forwarding disabled by default.
- Unknown host key requires fingerprint display and explicit approval. Mismatched key halts connection and provides a separate administrative reset action.
- Limit connection/login retry frequency and cancellation; do not log authentication payloads.
- High-risk operation output may be sensitive; no transcript logging by default.
- Installers/updates and downloaded tools use HTTPS and integrity validation.
- The WP-05A SFTP browser is reachable only from a trusted, running SSH session. Listing paths and replies are validated at the application, worker protocol and domain boundaries; directory results are capped at 500 entries. Symlink entries are visible but not navigable. Cancellation and timeout close the SFTP channel, and no remote filename is interpreted as a shell command. These controls do not yet cover transfer destinations because upload/download is not implemented.
- WP-09C FTP/FTPS stores only host, port and the explicit-TLS selection in a saved profile. Username and password are collected in the native Windows prompt and are not returned to the renderer, saved in the session catalog or included in saved-folder exports. FTP credentials, requested paths and server-returned names reject control characters before they can enter line-oriented protocol commands. The FTPS connection uses normal TLS certificate validation. Plain FTP visibly warns that account credentials and file contents are unencrypted; the preload and main broker each require a short-lived, one-use user gesture bound to the endpoint. The utility worker disables verbose protocol output, blocks PASV redirection to another host, caps active connections at 32, bounds listing memory/entries and closes on cancellation or shutdown. Only read-only directory listing is implemented; transfer destination traversal, overwrite, partial-file cleanup and cancellation remain unverified until FTP/SFTP transfers are delivered.
- Telnet is inherently plaintext. The Telnet provider stores only a canonical host and port in profiles and leaves credentials to interactive terminal input rather than app storage. Before every connection, including saved-profile reopen, the visible warning dialog must be explicitly submitted by a trusted user event. The isolated preload binds that short-lived, one-use gesture to the displayed endpoint, and the main-process broker independently consumes a sender-, session- and purpose-bound authorization before opening TCP; a direct bridge/IPC command cannot skip the warning. The terminal/status label identifies Telnet as plaintext. The TCP worker has bounded input/output queues, bounded subnegotiation, suppresses duplicate option negotiation replies, and uses explicit connect/IPC deadlines. It closes sockets on cancellation, failure, worker crash and shutdown. This transport is not suitable for secrets or untrusted networks; no Telnet traffic is encrypted or transcript-logged by the app.

## Master-password threat model

OS-protected storage on Windows is encrypted using a user-context mechanism; same-user malware can often access it. Optional master-password mode must add an independently derived encryption key using vetted Argon2id + authenticated encryption, versioned KDF settings, clear lock semantics, failure handling and recovery policy. WP-02 provides no password recovery or escrow: loss requires an explicit vault reset and re-entry of credentials. Application should not transmit master passwords outside local cryptographic path. Test persistence across reinstall, OS account changes and data restore. For WP-02, both vault modes lock after 15 minutes without a validated user-initiated app command and immediately on Windows session lock or suspend; already authenticated SSH transports may stay connected after credentials have been discarded. See [ADR-0003](adr/ADR-0003-wp02-interim-identity-storage.md).

**Caveat from Electron docs:** `safeStorage` synchronous API is deprecated in current docs; use async variant when supported by the selected pinned release. Confirm this API at implementation time, not by guessing Electron version.

## Telemetry and logs

Default is **no external analytics or telemetry**. Diagnostic logs locally opt-in, expiring/rotating, capped; never include passwords, private keys, full terminal output, arbitrary executed commands, auth headers or complete remote file contents. Crash reports off by default or sanitized explicitly. Users can clear local logs, known-host approvals and session metadata independently.

The SQLite storage adapter exposes only static `{component, event, code}` failure events on the local `multi-remote-terminal.storage` diagnostics channel. No listener or persistent log writer is installed by default; a future opt-in logger must remain local, capped and redacted, and must not add paths, SQL, hostnames, request IDs or stored values.

## Secrets and key provenance

- Sessions reference `credential_ref`; vault content remains outside session definitions.
- User may use SSH agent for non-exportable keys; do not copy private key files into DB.
- Clipboard paste and remote text editing may contain secrets: do not silently record.
- Accept known host certificate authorities only after verified implementation of SSH certificate semantics; do not pretend simple fingerprints cover OpenSSH hashed host entries/CA policies.
- Never automatically parse arbitrary SSH configs with command substitutions.

Saved-folder bundle files are explicit user-selected imports/exports through Electron's native file dialogs. Version 2 exports exact folder and local/SSH/Telnet/FTP connection metadata schemas; it continues to accept credential-free version-1 bundles for local/SSH/Telnet profiles. Both versions enforce a 16 MiB file limit and a 100,000-record limit; credentials, private keys and terminal history are rejected or absent. Export writes a temporary file and renames it into place. Import validates the complete file before a single SQLite transaction; any conflicting folder/session ID or uniqueness constraint rolls back the whole import. The bundle format does not encrypt data, so it contains host names, ports, shell choices, folder names and saved-session metadata; users should store it as they would other connection configuration.

## Third-party licensing and integrity

Every bundled or launched provider has `name`, `source`, `version`, `license`, `distribution-rights`, `hash/signature-check`, `update-policy`, `vulnerability-scan-status`. GPL/LGPL components require counsel/maintenance review before bundling; prefer explicit user-installed providers if unclear. Never copy comparison-product proprietary assets or internal scripts.

Optional Git for Windows Bash is user-installed and is not redistributed by the application. Opening a Bash terminal is an explicit user action; its normal `--login -i` startup files therefore run as part of launching the selected shell. This is separate from an app-managed profile script, which remains disabled unless previewed and explicitly enabled. The current resolver checks the standard install path but does not enforce a signature or hash; consult [WP-01's provider record](dependencies/WP-01.md) for the observed machine evidence and its limitation.

## Release security gate

- [ ] Electron checklist reviewed and recorded for pinned version.
- [ ] IPC validation and renderer isolation penetration tests pass.
- [ ] Host-key mismatch and jump-host verification tests pass.
- [ ] Vault survives restart and no plaintext secret in DB/log/export/IPC.
- [ ] SFTP traversal, cancel, symlink and overwrite tests pass.
- [ ] Local/remote/dynamic SSH forwarding policy tests pass.
- [ ] Network daemons/X11, when implemented, not exposed publicly by default.
- [ ] Build dependencies audited, SBOM created, installer hash published.
- [ ] Independent reviewer has no unresolved critical/high finding.
