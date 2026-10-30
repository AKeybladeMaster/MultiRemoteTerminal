# ADR-0058: Preserve FTP upload artifacts without identity proof

**Status:** Accepted (2026-10-30); final Phase 04 revalidation pending.

**Supersedes:** The interrupted-upload recovery clause in [ADR-0006](ADR-0006-ftp-no-clobber-uploads.md).

## Context

WP-05L retained an upload pathname and used `SIZE` on same-worker reconnect. It issued `DELE` when the current size was smaller than the original source. A concurrent FTP client could replace that pathname before reconnect; `SIZE` reports the current size but does not prove the current file is the original stage. The same identity problem applies to path-only cleanup while the original control connection is still live. RFC 3659 defines separate `Size` and `Unique` facts, but the current upload path does not capture a pre-interruption unique value.

## Decision

- Do not issue path-only `DELE` after cancellation, transfer failure, or a late conflict, even while the control connection is live. The path does not prove object identity.
- Do not retain an in-memory reconnect cleanup record or issue automatic deletion after reconnect. Leave uncertain stages and collision copies for user review.
- Preserve the previous target under its generated `.backup` name after a successful explicit overwrite. On a failed replacement, preserve any stage or backup that could not be safely restored.
- Tell users to inspect the remote directory after cancellation, conflict, or an uncertain FTP upload result, and warn after overwrite that the previous file may remain under a generated backup name.
- Any future automatic remote deletion must prove object identity; `SIZE` alone is not sufficient.

## Consequences

The application cannot delete a different file that was later placed at the same path. Cancellation, failure and late conflicts can leave remote upload artifacts; successful overwrites can leave a backup. There is no dedicated FTP leftover-cleanup workflow, so users must inspect artifacts and remove confirmed leftovers with another FTP client or server-side tool. The previous WP-05L test results remain historical evidence for the superseded behavior; the live-control replacement regression, overwrite preservation regression and interrupted-upload E2E must pass at the Phase 04 gate before updating acceptance status.

## References

- [RFC 3659: Extensions to FTP](https://www.rfc-editor.org/rfc/rfc3659.html)
- [WP-05L.1 safety result](../results/WP-05L1-ftp-upload-recovery-safety-2026-10-30.md)
