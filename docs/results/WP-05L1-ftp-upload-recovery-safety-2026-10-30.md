# WP-05L.1: fail-safe FTP interrupted-upload recovery

**Status:** Corrective candidate `b6979d976394bce900d522bb1d000e3d2f79abf5` passed the final Phase 04 code gate (2026-10-30). Broader F-005, P-10 and P-14 acceptance remains partial.

**Review corrections (2026-10-30):** Independent implementation review found that path-only FTP `DELE` could remove a concurrent replacement while the control connection remained live. The current candidate removes all automatic FTP `DELE` calls, preserves upload artifacts and overwrite backups, and reports a conflict for late STOU-name collisions. Standards review also found that upload timeouts lacked an artifact warning; FTP and SFTP upload timeout messages now tell users to reconnect and inspect the remote folder. The unused STOU path callback was removed, and a regression verifies that failure of both replacement and backup restoration preserves both generated artifacts and retires the session. Earlier WP-05L results remain historical.

## Scope

FTP recovery previously issued `DELE` after `SIZE` showed fewer bytes than the interrupted upload's source. That could delete a different file created later at the same pathname. The current candidate removes the in-memory reconnect registry and all automatic path-only FTP deletion. Cancellation, failure and late conflicts can leave upload artifacts, while a successful overwrite preserves the prior file under a generated backup name. The UI asks users to inspect uncertain artifacts before removing them.

The current candidate adds a live-control replacement regression, preserves cancelled stages, collision copies, failed replacement stages and successful-overwrite backups, and keeps the interrupted-upload E2E recovery path visible after reconnect. It also covers double-rename failure, retained backup/stage bytes and session retirement. The live-control replacement regression, overwrite preservation checks, rollback-failure regression and interrupted-upload E2E all passed the final Phase 04 gate. The reconnect listing is virtualized, so the test scrolls to the row before asserting it.

## Verification state

- Runtime: Windows x64, Node 24.14.1, pnpm 12.15.0; absolute gate temp paths were kept under `.tmp/phase04`.
- `git diff --check`, `pnpm typecheck`, `pnpm lint`, import-boundary checks and Windows x64 native/renderer build passed. The renderer bundle is 1,029.41 kB minified / 282.87 kB gzip and retains Vite's 500 kB advisory.
- `pnpm test`: 587 passed, 0 failed.
- Focused Windows E2Es passed: FTP interrupted-upload recovery (1), FTPS certificate and protected-data-channel flow (1), and SFTP transfer/editor/recovery flow (1).
- `pnpm check`: typecheck, lint, boundaries and 587 unit tests passed; full Electron E2E reported 71 passed, 6 skipped, 0 failed. The skips were the known Git Bash first-input-after-resize case and five package-artifact cases, which were run separately below.
- `pnpm package:win:smoke`: 5 passed, including ASAR/fuses, per-artifact SBOM/hash validation, offline NSIS install at 200% scale and uninstall, portable startup/profile placement, and portable SSH-log shutdown.
- No live FTP/FTPS server interoperability, configured disposable OpenSSH fixture, physical Explorer drag automation or physical-device testing was available. This report records fixture-backed acceptance only.
- Prior WP-05L test results describe the superseded auto-delete behavior and are retained as historical evidence only.

Generated unsigned x64 artifacts are under ignored `artifacts/windows/`: `MultiRemoteTerminal Setup 0.0.0.exe` (128,699,413 bytes, SHA-256 `7F7572D55C0A3AD1A513C977E2228D78E65A863CE0A11A5BC8C10E51AA7B95B7`), `MultiRemoteTerminal 0.0.0.exe` (114,715,365 bytes, SHA-256 `61D6E2F6E60EAAADC83219DC3E207B65DDC5A6B88F8F87E0856D39A5A6BD3E35`), per-artifact `.cdx.json` SBOMs and `SHA256SUMS.txt`. The package process reported `NotSigned`; these are local smoke artifacts, not a signed release.

## Remaining limits

FTP artifacts can remain after cancellation, timeout, failure or late conflict, and successful overwrite can leave a backup. Users must inspect artifacts before removing them with another FTP client or server-side tool. Native Explorer drag automation, sustained throughput, forced worker termination/restart cleanup, and broader FTP/FTPS interoperability remain open. Phase 04 is still partial and Phase 02 remains blocked, so no promotion to `main` is authorized.
