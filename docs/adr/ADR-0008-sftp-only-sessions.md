# ADR-0008: Standalone SFTP-only sessions

**Status:** Accepted for WP-05C (2026-10-24)

## Context

WP-05A and WP-05B let a trusted SSH terminal browse and transfer remote files. Requirement P-11 also calls for a saved, standalone SFTP session that opens directly into file browsing without creating an interactive shell. It must use the existing host-trust and credential handling, stay within the utility worker, and remain exportable without secrets.

The SQLite `sessions.kind` constraint currently permits `local`, `ssh`, `telnet` and `ftp`; rebuilding the session table solely to encode another persisted kind would add migration risk. The domain model and JSON bundle have exact, versioned schemas and can represent SFTP directly.

## Decision

- Add `sftp.open` / `sftp.close` as fixed typed preload commands. They route through the SSH application controller, which reuses the normal endpoint validation, host-key approval, native credential prompt, cancellation and supervised worker lifecycle.
- Add an explicit files-only connection mode to the SSH transport. After SSH authentication reaches `ready`, this mode resolves without requesting a PTY or shell. It reuses `ssh.files.*` for listing and transfers and rejects terminal write, resize and output acknowledgement operations.
- Represent saved SFTP definitions as `kind: 'sftp'` in the domain and version-3 saved-folder bundle. Continue to import version-1 and version-2 bundles under their original session-kind allowances; version 4 adds RDP profiles and version 5 adds VNC profiles. Each newer version retains import compatibility with the preceding versions and their original session-kind allowances.
- Encode persisted SFTP definitions in the existing SQLite table as `kind: 'ssh'` with the exact options object `{"sftpOnly":true}`. Decode that marker into domain kind `sftp`; reject malformed or extra option fields. This avoids a table rebuild while keeping the storage exception private to the SQLite adapter.
- Persist/export only the validated host and port with ordinary folder/session metadata. Credentials and terminal history are never part of the saved definition or bundle.

## Consequences

File-only sessions share SSH authentication and transport cleanup, while the renderer presents a file tab without a terminal surface. Existing consumers of the domain model see a real SFTP kind; only SQLite knows the compatibility encoding. Bundle version 3 advertises the new exact schema, while earlier bundle versions remain readable under their version-specific session-kind limits. Versions 4 and 5 add RDP and VNC saved-profile kinds respectively.

There is no interactive shell or PTY in this mode. SFTP listing/transfer path policy and commit limitations remain those recorded in [ADR-0007](ADR-0007-sftp-transfer-commit.md). The SQLite encoding depends on exact option validation and could be replaced by a versioned schema migration if future session types make the marker scheme unclear.

## Evidence

Windows loopback E2E covers host trust, authenticated file listing, saving and reopening an SFTP profile, and verifies that the server receives no shell request. Unit tests cover the files-only application/provider lifecycle, typed IPC, SQLite/profile and JSON bundle roundtrips, credential exclusion, and v1/v2 bundle compatibility. See [WP-05C results](../results/WP-05C-sftp-only-sessions-2026-10-24.md).
