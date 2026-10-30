# ADR-0006: FTP unique uploads and conflict safety

**Status:** Accepted for WP-09D (2026-10-24), extended by WP-05L (2026-10-26)

**History note (2026-10-30):** FTP upload artifact cleanup and preservation are superseded by [ADR-0058](ADR-0058-ftp-interrupted-upload-preservation.md). The STOU and local-download decisions remain in effect; FTP overwrite retains its staged backup without path-only cleanup.

## Context

FTP `RNTO` has no standard conditional "rename only if the destination does not exist" behavior. A `LIST` followed by `RNTO` therefore leaves a race in which a competing client can create the destination and have its file replaced. RFC 959 defines `STOU` as creating a uniquely named file in the current directory. RFC 1123 requires the server to return that generated pathname in its 125/150 preliminary reply.

The pinned `basic-ftp` 6.2.3 client implements streaming, data-channel setup, FTPS, timeouts and progress for `STOR`, but exposes no public `STOU` method. The worker reuses its protected stream implementation and rewrites only the generated command to the standard argumentless `STOU` form. It changes to the requested directory first, captures and validates the returned name before data flows, then restores the prior working directory. Reassess this pinned integration whenever `basic-ftp` is upgraded.

## Decision

- For rename, skip and non-existing targets, issue standard argumentless `STOU` in the requested directory and accept only a validated server-reported pathname. The server assigns the uploaded file's actual name; the app shows that name on completion. If the server rejects STOU, fail closed and preserve the session when the FTP control channel remains healthy.
- If a competing client creates the requested name after preflight and STOU allocates another name, preserve the server-named upload and report a conflict. FTP path-only `DELE` cannot prove which object it would remove.
- For an existing target with explicit overwrite consent, retain the staged backup/replace sequence. Do not describe it as atomic; server errors can still leave recovery or cleanup work.
- For an existing local download target with explicit overwrite consent, verify the destination identity immediately before replacing it. Node's Windows rename operation does not provide an identity-conditional compare-and-swap, so a concurrent local process can still replace the destination in the small interval between verification and rename; this is an accepted limitation for this slice.
- Do not issue path-only `DELE` after cancellation, failure or a collision, whether the control connection is live or reconnected. A path does not prove object identity. Do not keep a reconnect cleanup registry. Preserve server-named collision uploads and report a conflict. Tell users to inspect leftovers before removing them.
- Expose a committing progress phase to disable cancellation after the app crosses a commit boundary. A request deadline during commit does not cancel immediately; the worker gets a bounded two-minute settlement window for the FTP command sequence and rollback. After a successful explicit overwrite, preserve the previous target under its generated `.backup` name. A failed rollback can leave the backup and staged replacement for review.
- Other transfer deadlines request cancellation and allow two seconds for stream and local-temp cleanup before force termination. A forced worker exit can still leave local or remote partial data.

## Consequences

On a conforming server, non-overwrite STOU uploads cannot silently replace an existing remote file. The server chooses the unique filename; it may differ from the local basename even when that name was free. The server-selected file is visible during upload. Cancellation, failure or a late collision can leave an upload artifact; a successful overwrite can leave the previous target under a generated backup name. The application does not delete FTP paths automatically because it cannot prove that a pathname still names the object it created. Servers that reject STOU cannot be used for safe non-overwrite uploads in this slice. Broader FTP/FTPS interoperability and worker-termination residue remain part of P-10 acceptance.

## References

- [RFC 959: File Transfer Protocol](https://www.rfc-editor.org/rfc/rfc959.html)
- [RFC 1123: FTP STOU reply format](https://www.rfc-editor.org/rfc/rfc1123.html)
