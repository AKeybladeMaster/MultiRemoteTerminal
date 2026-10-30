# Phase 05 — graphical remote sessions gate (2026-10-30)

**Disposition:** BLOCKED / PARTIAL; not accepted.
**Branch:** `dev-1`; candidate changes are uncommitted at this report's creation.
**Last clean base:** `f95c20b`.
**Promotion:** none. The candidate must not be merged into `main`.

## Verification

Checks ran sequentially on Windows x64 with Node 24.14.1, pnpm 12.15.0 and workspace-local `TEMP`/`TMP` paths.

- `git diff --check` — passed.
- `corepack pnpm typecheck` — passed.
- `corepack pnpm lint` — passed, including import-boundary checks.
- Windows x64 native and renderer build — passed. The renderer reports a 1,035.92 kB minified chunk advisory (284.64 kB gzip).
- `corepack pnpm test` — 612 passed, 0 failed.
- Focused XDMCP-consent and offline Help-disclosure E2Es — 2 passed.
- SSH fixture integration test — skipped because no `MRT_TEST_SSH_*` fixture configuration was set.
- Final `corepack pnpm check` — failed in the E2E stage: 63 passed, 7 skipped, 9 failed. Typecheck, lint/boundaries, build and unit tests passed in the same command. The skips were the existing Git Bash first-input-after-resize scenario and six package-only scenarios.
- `corepack pnpm package:win:smoke` — failed: 4 passed, 2 failed. The ASAR/fuses and SBOM/hash-manifest checks passed; the installer ran offline at 200% scale and uninstalled; the portable app opened a terminal. The packaged credential-prompt and session-log tests failed in native Windows prompt/dialog automation.

The E2E failures divide into two environment-dependent groups:

- Four tests that open native file/message dialogs could not focus them. A focused repro found the consent window through UI Automation while `GetForegroundWindow()` returned null.
- Five tests that use clipboard paste/copy received an empty clipboard. The focused 10-tab E2E passed its renderer-isolation API allowlist assertion after the new X11/XDMCP bridge entries were added to its expected list, then failed at clipboard paste.

Temporary diagnostic edits used to identify these conditions were reverted. No test was marked passing because of the environment limitation. The Phase 05 acceptance gate remains blocked until these Windows UI tests can run on an interactive desktop with a working system clipboard.

## Package artifacts

Generated under ignored `artifacts/windows/` and verified against `SHA256SUMS.txt`:

- `MultiRemoteTerminal Setup 0.0.0.exe` — 128,709,593 bytes; SHA-256 `7A93D6731080825CA7E89294A67274FE0388499C688858C0C76BFFCA5AA29D9A`.
- `MultiRemoteTerminal 0.0.0.exe` — 114,724,188 bytes; SHA-256 `7762BDC99049E36B2D04C7F2864A98C9D90E6B5080C43B24A55D13DD6A3C404D`.
- Per-artifact CycloneDX 1.6 SBOMs were generated for 31 resolved runtime components.
- No signing certificate was configured. Both signatures are `NotSigned`; these are smoke-test artifacts, not a release.

## Acceptance still open

- Real RDP and VNC screen/input, reconnect, server security-mode and cleanup acceptance.
- Cygwin/X provider installation, real X11 client/display interaction, XDMCP login, MIT-cookie rejection, extension behavior, clipboard, crash cleanup and session teardown.
- Windows 10/11 interoperability, physical high-DPI and assistive-technology checks.
- Interactive desktop full E2E and native prompt/dialog package smoke.
- Separate specification, standards and implementation reviews of the exact candidate. They have not been performed because the mandatory verification gate did not pass.

No Phase 05 requirement is promoted to VERIFIED based on external handoffs, mock-only coverage or the focused UI tests.
