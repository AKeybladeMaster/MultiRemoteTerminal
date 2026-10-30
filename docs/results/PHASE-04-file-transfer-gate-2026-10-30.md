# Phase 04 — file management and transfer gate (2026-10-30)

**Implementation candidate commit:** `b6979d976394bce900d522bb1d000e3d2f79abf5` (removes automatic path-only FTP `DELE`, preserves uncertain upload artifacts and overwrite backups, and warns about uncertain upload timeouts).

**Disposition:** Final code verification passed for the corrective candidate. Phase 04 remains **PARTIAL** because native Explorer gestures, sustained throughput, real FTP/FTPS interoperability and worker-termination cleanup remain unverified. Independent reviews are pending; no promotion to `main` was attempted.

## Verification

Commands ran sequentially on Windows x64 with Node 24.14.1, pnpm 12.15.0, and absolute `TEMP`/`TMP` paths under `.tmp/phase04`:

- `git diff --check` — passed.
- `corepack pnpm typecheck` — passed.
- `corepack pnpm lint` — passed, including import-boundary checks.
- `corepack pnpm build` — passed; native x64 addon and renderer built. Vite reported the existing 1,029.41 kB minified renderer chunk advisory (282.87 kB gzip).
- `corepack pnpm test` — 587 passed, 0 failed.
- Focused FTP interrupted-upload recovery E2E — 1 passed. It verifies no `DELE` for the interrupted path, visible partial bytes after reconnect, and a successful retry under a new name.
- Focused FTPS certificate/data-channel E2E — 1 passed.
- Focused SFTP browser, 100 MiB transfer, editor conflict, and interrupted-transfer E2E — 1 passed.
- `corepack pnpm check` — exit 0; typecheck, lint, boundaries and 587 unit tests passed; Electron E2E reported **71 passed, 6 skipped, 0 failed**. The six skips were the known Phase 02 Git Bash first-input-after-resize case and five package-artifact tests.
- `corepack pnpm package:win:smoke` — **5 passed**. This built x64 NSIS and portable artifacts, generated CycloneDX SBOMs and a SHA-256 manifest, validated ASAR/fuses, installed/launched/uninstalled the NSIS package offline at 200% scale, and exercised portable startup and SSH-log shutdown.

## Artifact record

Artifacts are local and ignored under `artifacts/windows/`:

- `MultiRemoteTerminal Setup 0.0.0.exe` — 128,699,413 bytes; SHA-256 `7F7572D55C0A3AD1A513C977E2228D78E65A863CE0A11A5BC8C10E51AA7B95B7`.
- `MultiRemoteTerminal 0.0.0.exe` — 114,715,365 bytes; SHA-256 `61D6E2F6E60EAAADC83219DC3E207B65DDC5A6B88F8F87E0856D39A5A6BD3E35`.
- Per-artifact `*.cdx.json` SBOMs and `SHA256SUMS.txt`.
- Signing was skipped because no signing certificate is configured; both package signatures are `NotSigned`.

## Scope and open acceptance

The corrected FTP regression and reconnect E2E use a controlled loopback fixture; they are not real server interoperability evidence. `MRT_TEST_SSH_*` was not configured, and no authorized live FTP/FTPS interoperability target was available. Native Explorer drag automation, sustained throughput, forced worker termination/restart residue, and broad server interoperability remain unverified. Physical Windows 10, hardware, and assistive-technology acceptance also remain open. See [WP-05L.1](WP-05L1-ftp-upload-recovery-safety-2026-10-30.md).

The full E2E suite's Git Bash resize test remains an explicit skip and is still a Phase 02 blocker. Five package-only tests skipped in `pnpm check` were covered by the separate 5/5 package-smoke run. No skip was counted as a pass.

The first unit-gate attempt used relative `TEMP`/`TMP` values and failed filesystem fixtures with `Host trust store path must be absolute`. A minimized test reproduced the failure, and the same test passed with absolute workspace-local temp paths. One initial rollback-regression assertion selected an earlier backup in the same fixture; it was narrowed to match the saved bytes. The final unit and full-check reruns passed. Independent specification, standards and implementation reviews of this exact candidate are pending; no promotion is authorized while Phase 02 and broader Phase 04 acceptance remain open.
