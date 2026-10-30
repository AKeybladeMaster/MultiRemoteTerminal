# Phase 04 — file management and transfer gate (2026-10-30)

**Implementation candidate commit:** `8e8c2e2fb5c2a73132c0a5beebe26520fd6c1e37` (removes automatic path-only FTP `DELE` and preserves uncertain upload artifacts and overwrite backups).

**Disposition:** Final code verification passed for the corrective candidate. Phase 04 remains **PARTIAL** because native Explorer gestures, sustained throughput, real FTP/FTPS interoperability and worker-termination cleanup remain unverified. Independent reviews are pending; no promotion to `main` was attempted.

## Verification

Commands ran sequentially on Windows x64 with Node 24.14.1, pnpm 12.15.0, and `TEMP`/`TMP` set under `.tmp/phase04`:

- `git diff --check` — passed.
- `corepack pnpm typecheck` — passed.
- `corepack pnpm lint` — passed, including import-boundary checks.
- `corepack pnpm build` — passed; native x64 addon and renderer built. Vite reported the existing 1,029.22 kB minified renderer chunk advisory (282.80 kB gzip).
- `corepack pnpm test` — 585 passed, 0 failed.
- Focused FTP interrupted-upload recovery E2E — 1 passed. It verifies no `DELE` for the interrupted path, visible partial bytes after reconnect, and a successful retry under a new name.
- Focused FTPS certificate/data-channel E2E — 1 passed.
- Focused SFTP browser, 100 MiB transfer, editor conflict, and interrupted-transfer E2E — 1 passed.
- `corepack pnpm check` — exit 0; typecheck, lint, boundaries and 585 unit tests passed; Electron E2E reported **71 passed, 6 skipped, 0 failed**. The six skips were the known Phase 02 Git Bash first-input-after-resize case and five package-artifact tests.
- `corepack pnpm package:win:smoke` — **5 passed**. This built x64 NSIS and portable artifacts, generated CycloneDX SBOMs and a SHA-256 manifest, validated ASAR/fuses, installed/launched/uninstalled the NSIS package offline at 200% scale, and exercised portable startup and SSH-log shutdown.

## Artifact record

Artifacts are local and ignored under `artifacts/windows/`:

- `MultiRemoteTerminal Setup 0.0.0.exe` — 128,699,760 bytes; SHA-256 `F658C5EFCE604CDBC2E07739D053AA11D09F3BBC7F8D9E83338C900DDE984D8F`.
- `MultiRemoteTerminal 0.0.0.exe` — 114,713,420 bytes; SHA-256 `ADA22B47D74A1A682E211397F3D1B3998E9DA29A8FE009D9AEE9C7DF2E680CF6`.
- Per-artifact `*.cdx.json` SBOMs and `SHA256SUMS.txt`.
- Signing was skipped because no signing certificate is configured; both package signatures are `NotSigned`.

## Scope and open acceptance

The corrected FTP regression and reconnect E2E use a controlled loopback fixture; they are not real server interoperability evidence. `MRT_TEST_SSH_*` was not configured, and no authorized live FTP/FTPS interoperability target was available. Native Explorer drag automation, sustained throughput, forced worker termination/restart residue, and broad server interoperability remain unverified. Physical Windows 10, hardware, and assistive-technology acceptance also remain open. See [WP-05L.1](WP-05L1-ftp-upload-recovery-safety-2026-10-30.md).

The full E2E suite's Git Bash resize test remains an explicit skip and is still a Phase 02 blocker. Five package-only tests skipped in `pnpm check` were covered by the separate 5/5 package-smoke run. No skip was counted as a pass.

Independent specification, standards and implementation reviews of the verified candidate are in progress. No promotion is authorized while Phase 02 and broader Phase 04 acceptance remain open.
