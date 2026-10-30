# WP-05L.1: fail-safe FTP interrupted-upload recovery

**Status:** Phase 04 code checks passed; broader F-005, P-10 and P-14 acceptance remains partial.

## Scope

FTP recovery previously issued `DELE` after `SIZE` showed fewer bytes than the interrupted upload's source. That could delete a different file created later at the same pathname. The in-memory reconnect registry and automatic post-reconnect deletion are removed. If best-effort cleanup fails on the live connection, the remote path remains after reconnect for user review. The upload error notice asks users to reconnect and inspect the remote directory before removing a partial file.

The recovery regression expects a smaller same-path replacement to remain intact. The Windows interrupted-upload E2E verifies that the partial path remains visible after reconnect, was not deleted, and can be followed by a retry under a new server-selected name. The reconnect listing is virtualized, so the test scrolls to the row before asserting it.

## Verification state

- Runtime: Windows x64, Node 24.14.1, pnpm 12.15.0; gate temp files were kept under `.tmp/phase04`.
- `git diff --check`, `pnpm typecheck`, `pnpm lint`, import-boundary checks and Windows x64 native/renderer build passed. The renderer bundle is 1,028.79 kB minified / 282.67 kB gzip and retains Vite's 500 kB advisory.
- `pnpm test`: 585 passed, 0 failed.
- Focused Windows E2Es passed: FTP interrupted-upload recovery (1), FTPS certificate and protected-data-channel flow (1), and SFTP transfer/editor/recovery flow (1).
- `pnpm check`: typecheck, lint, boundaries and 585 unit tests passed; full Electron E2E reported 71 passed, 6 skipped, 0 failed. The skips were the known Git Bash first-input-after-resize case and five package-artifact cases, which were run separately below.
- `pnpm package:win:smoke`: 5 passed, including ASAR/fuses, per-artifact SBOM/hash validation, offline NSIS install at 200% scale and uninstall, portable startup/profile placement, and portable SSH-log shutdown.
- No live FTP/FTPS server interoperability, configured disposable OpenSSH fixture, physical Explorer drag automation or physical-device testing was available. This report records fixture-backed acceptance only.
- Prior WP-05L test results describe the superseded auto-delete behavior and are retained as historical evidence only.

Generated unsigned x64 artifacts are under ignored `artifacts/windows/`: `MultiRemoteTerminal Setup 0.0.0.exe` (128,699,056 bytes), `MultiRemoteTerminal 0.0.0.exe` (114,714,133 bytes), per-artifact `.cdx.json` SBOMs and `SHA256SUMS.txt`. The package process reported `NotSigned`; these are local smoke artifacts, not a signed release.

## Remaining limits

FTP stages can remain after an interrupted upload when live cleanup fails; the user must inspect and remove them with another FTP client or server-side tool. Native Explorer drag automation, sustained throughput, forced worker termination/restart cleanup, and broader FTP/FTPS interoperability remain open. Phase 04 is still partial and Phase 02 remains blocked, so no promotion to `main` is authorized.
