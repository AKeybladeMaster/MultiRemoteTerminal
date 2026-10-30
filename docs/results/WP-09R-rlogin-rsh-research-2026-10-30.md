# WP-09R — Rlogin/RSH protocol scope research

**Date:** 2026-10-30
**Requirements:** F-019 (Could), P-05, WP-09; RSH is named in P-05 and the mission, but WP-09 currently names Rlogin only.
**Status:** Research only; no implementation or interoperability evidence.

## Findings

- BSD Rlogin is documented by [RFC 1282](https://www.rfc-editor.org/rfc/rfc1282.html), an Informational, legacy memo rather than an Internet Standard. It uses TCP port 513, begins with four NUL-terminated fields, and includes terminal-size and urgent-data control semantics. The RFC describes a raw eight-bit stream and warns that trusted-host password bypass can expose all systems in a trust group. The protocol as specified does not provide transport encryption.
- Classic BSD RSH has no RFC located in this review. The [FreeBSD `rshd` manual](https://man.freebsd.org/cgi/man.cgi?query=rshd&sektion=8&manpath=FreeBSD+15.1-RELEASE+and+Ports.quarterly) documents the `rcmd` wire sequence: client source port 512–1023, a NUL-terminated stderr callback port, local and remote usernames, and a NUL-terminated command passed to the server shell. Authorization uses trusted-host records (`hosts.equiv` / `.rhosts`). Its security section says the model assumes client and network integrity, calls it insecure, and says encrypted exchanges should be available. [Oracle's `rcmd` documentation](https://docs.oracle.com/cd/E36784_01/html/E36875/rcmd-3socket.html) further documents that Unix reserved-port binding normally requires superuser privileges. This is a Windows feasibility question, not a reason to request elevation.
- OpenSSH's [security guidance](https://man.openbsd.org/ssh) calls `rlogin`/`rsh` and their host-trust files inherently insecure. Microsoft documents Windows OpenSSH as SSH, with `ssh`, `sshd`, `ssh-agent`, `sftp`, and `scp` components; it is not a Rlogin/RSH provider ([overview](https://learn.microsoft.com/en-us/windows-server/administration/OpenSSH/openssh-overview)). Microsoft's legacy [`rsh` command page](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/rsh) points to installing Subsystem for UNIX-based Applications, so it does not establish a supported in-box Windows RSH runtime.
- The [Node.js v24 `net` API](https://nodejs.org/download/release/v24.20.0/docs/api/net.html) documents TCP stream operations but no urgent-data operation. Since RFC 1282 assigns semantics to TCP urgent data, a Node-only Rlogin implementation must not claim complete protocol interoperability until the pinned Windows Electron/Node stack is shown to handle the required control path. A native adapter would need separate architecture, dependency and security review.

## Scope recommendation

Treat these as two distinct, opt-in legacy protocols, never as SSH aliases or encrypted transports. Limit scope to classic BSD Rlogin and classic BSD `rcmd`/RSH; do not imply support for Kerberos extensions, rexec, rcp, vendor variants, or any credential prompt/password mode. Keep them clearly labeled as plaintext and require a fresh, explicit warning acknowledgement for every connection. If provider availability controls are available, default both providers off. Do not store credentials, trusted-host rules, or RSH command text.

Rlogin may use an isolated utility-worker TCP provider, subject to the Windows urgent-data compatibility proof. Reuse the existing worker lifecycle and consent-broker patterns; do not add a package just to wrap TCP. RSH is remote command execution, not an interactive terminal: require the user to review the exact remote command and explicitly confirm each run; never auto-run it on profile open, reconnect, macro playback, or app startup. Do not shell-escape or execute the command locally. If the client cannot safely meet BSD reserved-source-port and stderr-callback behavior as a standard unelevated Windows user, mark RSH unsupported on that platform rather than requesting elevation or silently falling back to another protocol.

F-019 is a **Could** requirement, so these providers are not required to claim MVP completion. P-05 and WP-09 scope should be reconciled to name RSH explicitly before implementation status is changed.

## Evidence required before acceptance

1. Unit/contract coverage for bounded NUL-field parsing, malformed and oversized fields, authentication denial, partial reads/writes, timeout, cancellation, shutdown, and redacted errors.
2. Windows x64 loopback wire fixtures for each distinct protocol. Rlogin coverage must include handshake, terminal type, window-size requests/changes, server control/urgent-data behavior, input/output, close and denial. RSH coverage must include reserved local source port, stderr callback connection, exact command delivery, separate stdout/stderr, exit/error status, callback rejection, denial and cancellation.
3. A separate end-to-end run against disposable, independently implemented `rlogind` and `rshd` servers on an isolated network, using test-only accounts and trust files. The client must run unelevated. Record OS/server versions and prove that no provider fallback occurred. A loopback protocol fixture alone is not real server interoperability.
4. UI/broker tests proving fresh explicit consent, accurate plaintext labeling, no secret or command persistence/logging, and no automatic command execution after save, reopen, reconnect, import, or app startup.

## Environment note

The coordinator's read-only workstation inspection found no discoverable `rlogin`, `rsh`, or Mosh executable. Windows `ssh-agent.exe` exists, but the `ssh-agent` service is stopped and disabled. This does not substitute for a remote-server fixture or establish protocol interoperability.
