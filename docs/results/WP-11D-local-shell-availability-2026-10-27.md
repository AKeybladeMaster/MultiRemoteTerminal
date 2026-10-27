# WP-11D: Local shell availability and saved-profile policy

**Date:** 2026-10-27  
**Status:** Partial acceptance  
**Requirements:** P-21 (partial), P-37 (partial), F-009 (partial)

## Delivered

- Added a fixed availability list for PowerShell, cmd, Git Bash, and WSL, separate from command-palette visibility. Workbench preference schema v11 stores it; schema v10 migrates with every currently supported local shell enabled.
- Added Settings controls explaining that disabled shells cannot start new sessions or reopen saved profiles. Existing sessions remain usable and closable, while saved definitions stay visible with a disabled reopen action.
- The renderer waits for a successful preferences read before showing shell launch actions. The main-process broker also checks persisted policy for `terminal.open` and WSL distribution discovery; a failed settings read blocks those starts.
- The app starts its default PowerShell session only after settings load and only when PowerShell is enabled. It does not choose a fallback shell. The automatic startup launch leaves an already-open command palette and its search state untouched.
- Added [ADR-0035](../adr/ADR-0035-local-shell-availability.md). No arbitrary executable paths, installations, updates, or removals are supported.

## Validation

- `node --test tests/unit/workbench-preferences.test.ts tests/unit/sqlite-workbench-preferences.test.ts tests/unit/broker.test.ts` - 66 passed, 0 failed. Coverage includes schema v10 migration, allowlist validation, fail-closed broker checks, active-session continuity, and disabled-shell launch rejection.
- Focused Windows Electron E2E for local-shell visibility and availability - 2 passed. It covers delayed preference loading with an open palette, availability persistence, active Bash continuity, disabled saved-profile reopen, direct broker denial, no default PowerShell when disabled, and explicit re-enable/reopen.
- `corepack pnpm typecheck` - passed.
- `corepack pnpm lint` - passed, including static import-boundary checks.
- `corepack pnpm build` - passed on Windows x64. Vite reports the existing renderer bundle above 500 KiB.
- Inspected the Settings screenshot `test-results/local-shell-availability-settings.png` at 1164x734. The new availability controls and their descriptions are readable in the scrolled dialog; this is not an accessibility certification.

## Security and remaining acceptance

The preference gates new local-shell entry points; it does not terminate running processes. The main broker is authoritative, saved profiles remain available for re-enabling, and settings-read failure is closed to new starts. P-21/P-37/F-009 remain partial for broader provider lifecycle, native logo-picker acceptance, real WSL interoperability, and Windows 10 and signed-release acceptance.
