# WP-07W: Windows package smoke revalidation

**Requirements:** F-001, P-32, N-002; partial evidence for the M4 gate.
**Platform:** Windows 11 Pro x64, OS build 10.0.26200.0, Node 24.14.1, pnpm 12.15.0, Electron 45.0.0.
**Status:** Installed and portable package smoke passed on this host. Windows 10, code signing and the full M4 gate remain open.

## Change

The packaged NSIS smoke had a stale Playwright locator: `getByRole('status')` matched both the vault's `Status: Unlocked` and the settings save message. The test now selects the exact `Settings saved.` text. The application UI and runtime were unchanged.

## Validation

- `corepack pnpm package:win:smoke` rebuilt the native module and renderer, generated the x64 NSIS and portable executables, emitted per-artifact CycloneDX 1.6 SBOMs for 31 runtime components, and wrote the SHA-256 manifest. Its first packaged E2E invocation exited on the ambiguous locator above.
- After the locator fix, `MRT_PACKAGE_E2E=1 corepack pnpm exec playwright test tests/e2e/package-smoke.test.ts --workers=1 --reporter=list` passed 4/4 against those freshly built artifacts:
  - Electron fuse values and ASAR integrity metadata.
  - Per-artifact SBOM dependency references, executable hashes and manifest entries.
  - NSIS install, offline renderer workflow at 200% scale, local settings and profile persistence across restart, ASAR tamper termination, and clean uninstall.
  - Portable PowerShell terminal launch and profile storage beside the executable.
- The focused NSIS case was also rerun after the selector fix and passed 1/1.
- `corepack pnpm typecheck`, `corepack pnpm lint` including import-boundary checks, and `git diff --check` passed after the test edit.

The generated `0.0.0` installer and portable executable are unsigned. This is Windows 11 evidence only; Windows 10 smoke, Authenticode signing, OS-wide offline behavior, native credential prompting, live SSH package acceptance and the remaining M4 criteria are still open. F-001/P-32 and the release status remain partial.
