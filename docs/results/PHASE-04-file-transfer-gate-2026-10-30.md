# Phase 04 — file management and transfer gate (2026-10-30)

**Candidate implementation commit:** `886e60712f7646d3a3f5411a7a01f0af239caedf` (FTP reconnect-list scroll assertion fix; transfer safety implementation is in `f39c99046f8e0a495ab970be81e55dd40fd3648b`).

**Disposition:** The earlier candidate passed the gate, but independent implementation review found a path-only FTP `DELE` race while the control connection remained live. Corrective changes remove automatic FTP `DELE` and preserve overwrite backups; final Phase 04 revalidation and review are pending. Phase 04 remains **PARTIAL**, and no promotion to `main` was attempted.

## Verification

Commands ran sequentially on Windows x64 with Node 24.14.1, pnpm 12.15.0, and `TEMP`/`TMP` set under `.tmp/phase04`:

- `git diff --check` — passed.
- `corepack pnpm typecheck` — passed.
- `corepack pnpm lint` — passed, including import-boundary checks.
- `corepack pnpm build` — passed; native x64 addon and renderer built. Vite reported the existing 1,028.79 kB minified renderer chunk advisory (282.67 kB gzip).
- `corepack pnpm test` — 585 passed, 0 failed.
- Focused FTP interrupted-upload recovery E2E — 1 passed. It verifies no `DELE` for the interrupted path, visible partial bytes after reconnect, and a successful retry under a new name.
- Focused FTPS certificate/data-channel E2E — 1 passed.
- Focused SFTP browser, 100 MiB transfer, editor conflict, and interrupted-transfer E2E — 1 passed.
- `corepack pnpm check` — exit 0; typecheck, lint, boundaries and 585 unit tests passed; Electron E2E reported **71 passed, 6 skipped, 0 failed**. The six skips were the known Phase 02 Git Bash first-input-after-resize case and five package-artifact tests.
- `corepack pnpm package:win:smoke` — **5 passed**. This built x64 NSIS and portable artifacts, generated CycloneDX SBOMs and a SHA-256 manifest, validated ASAR/fuses, installed/launched/uninstalled the NSIS package offline at 200% scale, and exercised portable startup and SSH-log shutdown.

## Artifact record

Artifacts are local and ignored under `artifacts/windows/`:

- `MultiRemoteTerminal Setup 0.0.0.exe` — 128,699,056 bytes.
- `MultiRemoteTerminal 0.0.0.exe` — 114,714,133 bytes.
- Per-artifact `*.cdx.json` SBOMs and `SHA256SUMS.txt`.
- Signing was skipped because no signing certificate is configured; both package signatures are `NotSigned`.

## Scope and open acceptance

The corrected FTP regression and reconnect E2E use a controlled loopback fixture; they are not real server interoperability evidence. `MRT_TEST_SSH_*` was not configured, and no authorized live FTP/FTPS interoperability target was available. Native Explorer drag automation, sustained throughput, forced worker termination/restart residue, and broad server interoperability remain unverified. Physical Windows 10, hardware, and assistive-technology acceptance also remain open. See [WP-05L.1](WP-05L1-ftp-upload-recovery-safety-2026-10-30.md).

The full E2E suite's Git Bash resize test remains an explicit skip and is still a Phase 02 blocker. Five package-only tests skipped in `pnpm check` were covered by the separate 5/5 package-smoke run. No skip was counted as a pass.

Independent specification, standards, and implementation review findings will be recorded here before any promotion. No phase promotion is authorized while Phase 02 and Phase 04 acceptance remain open.
