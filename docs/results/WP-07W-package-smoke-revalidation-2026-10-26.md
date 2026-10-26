# WP-07W: Windows package smoke revalidation

**Requirements:** F-001, P-32, N-002; partial evidence for the M4 gate.
**Platform:** Windows 11 Pro x64, OS build 10.0.26200.0, Node 24.14.1, pnpm 12.15.0, Electron 45.0.0.
**Status:** Installed and portable package smoke passed on this host. Windows 10, code signing and the full M4 gate remain open.

## Change

The packaged NSIS smoke had a stale Playwright locator: `getByRole('status')` matched both the vault's `Status: Unlocked` and the settings save message. The test now selects the exact `Settings saved.` text. This follow-up adds real Git Bash command checks to both the installed NSIS and portable package launch paths.

## Validation

- `corepack pnpm package:win:smoke` rebuilt the native module and renderer, generated the x64 NSIS and portable executables, emitted per-artifact CycloneDX 1.6 SBOMs for 31 runtime components, and wrote the SHA-256 manifest. Its first packaged E2E invocation exited on the ambiguous locator above.
- After the locator fix and Bash smoke addition, `corepack pnpm package:win:smoke` rebuilt both artifacts and passed 4/4 packaged E2Es:
  - Electron fuse values and ASAR integrity metadata.
  - Per-artifact SBOM dependency references, executable hashes and manifest entries.
  - NSIS install, offline renderer workflow at 200% scale, PowerShell and Git Bash command execution, local settings and profile persistence across restart, ASAR tamper termination, and clean uninstall.
  - Portable PowerShell and Git Bash command execution plus profile storage beside the executable.
- `corepack pnpm typecheck`, `corepack pnpm lint` including import-boundary checks, and `git diff --check` passed after the test edit.

The generated `0.0.0` installer and portable executable are unsigned. The packaged PowerShell and Git Bash lifecycle passes on this Windows 11 host; Windows 10 smoke, Authenticode signing, OS-wide offline behavior, native credential prompting, live SSH package acceptance and the remaining M4 criteria are still open. F-001/P-32 and the release status remain partial.
