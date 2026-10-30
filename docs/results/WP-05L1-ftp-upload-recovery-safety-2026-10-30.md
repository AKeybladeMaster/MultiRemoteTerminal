# WP-05L.1: fail-safe FTP interrupted-upload recovery

**Status:** Implementation updated; Phase 04 verification deferred. F-005, P-10 and P-14 remain partial.

## Scope

FTP recovery previously issued `DELE` after `SIZE` showed fewer bytes than the interrupted upload's source. That could delete a different file created later at the same pathname. The in-memory reconnect registry and automatic post-reconnect deletion are removed. If best-effort cleanup fails on the live connection, the remote path remains after reconnect for user review. The upload error notice asks users to reconnect and inspect the remote directory before removing a partial file.

The recovery regression now expects a smaller same-path replacement to remain intact. The Windows interrupted-upload E2E now expects the partial path to remain visible after reconnect, verifies it was not deleted, then retries the upload under a new server-selected name. These checks are authored but have not run; the mission's test policy defers them to the Phase 04 gate.

## Verification state

- Automated tests run for this candidate: **none**.
- Typecheck, lint, build, package smoke and E2E: **deferred** until Phase 04 implementation is complete.
- No FTP server interoperability or physical-device testing was performed for this change.
- Prior WP-05L test results describe the superseded auto-delete behavior and are retained as historical evidence only.

## Remaining limits

The app does not have a dedicated FTP leftover-cleanup workflow. An interrupted upload can leave a visible remote path that the user must inspect and remove with an FTP client or server-side tool. Phase 04 remains partial; this change does not accept the broader transfer, throughput, Explorer gesture or server-interoperability requirements.

The data-loss fix was pulled forward ahead of broad Phase 03 legacy-protocol work because it addresses an already documented destructive race. Phase 02 remains blocked, so no promotion to `main` is authorized.
