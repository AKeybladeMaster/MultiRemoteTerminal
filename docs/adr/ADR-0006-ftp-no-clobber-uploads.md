# ADR-0006: FTP unique uploads and conflict safety

**Status:** Accepted for WP-09D (2026-10-24), extended by WP-05L (2026-10-26)

**History note (2026-10-30):** The interrupted-upload recovery clause below is superseded by [ADR-0058](ADR-0058-ftp-interrupted-upload-preservation.md). The STOU, overwrite and local-download decisions remain in effect.

## Context

FTP `RNTO` has no standard conditional "rename only if the destination does not exist" behavior. A `LIST` followed by `RNTO` therefore leaves a race in which a competing client can create the destination and have its file replaced. RFC 959 defines `STOU` as creating a uniquely named file in the current directory. RFC 1123 requires the server to return that generated pathname in its 125/150 preliminary reply.

The pinned `basic-ftp` 6.2.3 client implements streaming, data-channel setup, FTPS, timeouts and progress for `STOR`, but exposes no public `STOU` method. The worker reuses its protected stream implementation and rewrites only the generated command to the standard argumentless `STOU` form. It changes to the requested directory first, captures and validates the returned name before data flows, then restores the prior working directory. Reassess this pinned integration whenever `basic-ftp` is upgraded.

## Decision

- For rename, skip and non-existing targets, issue standard argumentless `STOU` in the requested directory and accept only a validated server-reported pathname. The server assigns the uploaded file's actual name; the app shows that name on completion. If the server rejects STOU, fail closed and preserve the session when the FTP control channel remains healthy.
- For skip, if a competing client creates the requested name after preflight and STOU allocates another name, remove the unique upload and report skipped. If cleanup fails, report a conflict without replacing the competing file.
- For an existing target with explicit overwrite consent, retain the staged backup/replace sequence. Do not describe it as atomic; server errors can still leave recovery or cleanup work.
- For an existing local download target with explicit overwrite consent, verify the destination identity immediately before replacing it. Node's Windows rename operation does not provide an identity-conditional compare-and-swap, so a concurrent local process can still replace the destination in the small interval between verification and rename; this is an accepted limitation for this slice.
- Capture the STOU path from the initial 125/150 reply before data transfer. On user cancellation, end the upload stream cleanly and try `DELE` while the FTP control connection remains available. If an upload failure prevents immediate cleanup, retain the exact stage path and expected source size in a bounded in-memory worker registry keyed by a digest of endpoint host, port, TLS mode and username; never include the password. On a same-scope reconnect, inspect at most one stage with SIZE and issue DELE only when remote size is smaller than expected. Preserve full-size or larger files because the transfer may have completed before its final reply was lost. FTP SIZE confirms only current path length, not object identity; a concurrent client that replaces the recorded path with a smaller file before reconnect can cause that replacement to be deleted. This is an accepted limitation of same-route FTP recovery, not protection against untrusted concurrent remote writers. A control-channel failure or worker/application restart can still leave residue; the file can also be visible to other listing clients while being written.
- Expose a committing progress phase to disable cancellation after the app crosses a commit boundary. A request deadline during commit does not cancel immediately; the worker gets a bounded two-minute settlement window for the FTP command sequence and rollback. If the commit still does not settle, worker termination can leave the old target under a hidden `.backup` name and the staged replacement under `.partial`; this is an indeterminate recovery case.
- Other transfer deadlines request cancellation and allow two seconds for stream and local-temp cleanup before force termination. A forced worker exit can still leave local or remote partial data.

## Consequences

On a conforming server, non-overwrite STOU uploads cannot silently replace an existing remote file. The server chooses the unique filename; it may differ from the local basename even when that name was free. The server-selected file is visible during upload. A failed upload stage is retried on a same-worker reconnect only when SIZE confirms it is undersized; full-size files are preserved. The in-memory recovery record is bounded to 128 entries, seven days and four attempts, and is lost if the worker exits. This does not verify server identity or remote object identity beyond endpoint and username scope, so a smaller same-path replacement can be deleted and FTP/FTPS interoperability and termination residue remain limitations. Servers that reject STOU cannot be used for safe non-overwrite uploads in this slice. Broader FTP/FTPS interoperability remains part of P-10 acceptance.

## References

- [RFC 959: File Transfer Protocol](https://www.rfc-editor.org/rfc/rfc959.html)
- [RFC 1123: FTP STOU reply format](https://www.rfc-editor.org/rfc/rfc1123.html)
