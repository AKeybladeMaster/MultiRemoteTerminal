# ADR-0058: Preserve FTP upload stages after connection loss

**Status:** Accepted (2026-10-30); Phase 04 verification pending.

**Supersedes:** The interrupted-upload recovery clause in [ADR-0006](ADR-0006-ftp-no-clobber-uploads.md).

## Context

WP-05L retained an upload pathname and used `SIZE` on same-worker reconnect. It issued `DELE` when the current size was smaller than the original source. A concurrent FTP client could replace that pathname before reconnect; `SIZE` reports the current size but does not prove the current file is the original stage. RFC 3659 defines separate `Size` and `Unique` facts, but the current upload path does not capture a pre-interruption unique value.

## Decision

- Keep best-effort cleanup while the failed upload's FTP connection is still usable.
- If that cleanup fails, do not retain an in-memory recovery record and do not issue `DELE` on a later reconnect. Leave the remote path for user review.
- Tell users to reconnect and inspect the remote directory after an FTP upload reports an uncertain result.
- Any future automatic remote deletion must prove object identity across the failure boundary or use an explicit user choice. `SIZE` alone is not sufficient.

## Consequences

Reconnect cannot delete a different file that was later placed at the same path. Interrupted uploads can leave remote residue, and the app has no dedicated FTP leftover-cleanup workflow. The previous WP-05L test results remain historical evidence for the superseded behavior; the replacement-preservation regression and interrupted-upload E2E must pass at the Phase 04 gate before updating acceptance status.

## References

- [RFC 3659: Extensions to FTP](https://www.rfc-editor.org/rfc/rfc3659.html)
- [WP-05L.1 safety result](../results/WP-05L1-ftp-upload-recovery-safety-2026-10-30.md)
