# WP-07A — Windows package foundation

**Status:** Package creation and the focused packaged-app smoke cases passed on Windows 11 x64. F-001 and P-32 remain PARTIAL; this evidence does not pass the M4 release gate.

## Scope and requirements

- **F-001 / P-32:** produce an installed Windows app and a portable app that keeps its profile with the portable executable.
- **N-007 (partial):** pin the package tool and lockfile. A distribution SBOM, signed release plan, verified public hashes and release build are still outstanding.

## Implementation

- `electron-builder@26.18.0` is pinned as a root build-time dependency. The Windows x64 configuration builds an ASAR-based per-user NSIS installer and a portable executable.
- `scripts/build.mjs` stages a self-contained desktop package, builds the app's Electron 45 native addon and generates an original terminal icon.
- Portable launch paths are validated before app readiness. The app creates `MultiRemoteTerminal-data/session-data` beside the portable executable and points Electron's profile paths there. Installed and development launches keep the default Electron profile location.
- Utility workers use the physical resources directory as their working directory; the packaged app root remains separately available for module resolution. The Windows credential helper is copied into packaged resources.
- Smoke cleanup retries transient Windows file locks after stopping the portable process tree.

## Validation

On the available Windows 11 x64 workstation:

- `corepack pnpm package:win` — passed; generated:
  - `artifacts/windows/MultiRemoteTerminal Setup 0.0.0.exe` — 126,687,436 bytes.
  - `artifacts/windows/MultiRemoteTerminal 0.0.0.exe` — 113,498,783 bytes.
  - `artifacts/windows/win-unpacked/MultiRemoteTerminal.exe` — 250,031,104 bytes.
- `MRT_PACKAGE_E2E=1 corepack pnpm exec playwright test tests/e2e/package-smoke.test.ts` — **2 passed** against those artifacts.
  - NSIS silently installs to a temporary per-user directory; the packaged app opens a PowerShell terminal and returns the expected output; it then uninstalls cleanly.
  - The portable executable starts from a temporary folder and creates the SQLite profile beside itself.
- `corepack pnpm typecheck` — passed.
- `corepack pnpm lint` — passed.
- `corepack pnpm exec node --test tests/unit/portable-user-data.test.ts` — **3 passed**.
- `corepack pnpm audit` — no known vulnerabilities reported at review time.
- `Get-AuthenticodeSignature` — the installer, portable executable and unpacked app all report `NotSigned`.

The first full smoke attempt exposed an `EBUSY` error when Windows briefly held the portable SQLite shared-memory file during teardown. Cleanup now retries recursive removal for up to ten seconds; the focused portable test and the complete two-case package smoke both passed after that change.

## Remaining limits

- Only Windows 11 x64 was exercised. Windows 10 acceptance and other supported-machine coverage are absent.
- This build is version `0.0.0`, unsigned, and not a release candidate. No certificate was available/configured.
- High-DPI, offline installation/use, minimum-permission behavior, packaged SSH credential prompting, crash/recovery/shutdown, 1,000-record acceptance, distribution SBOM and public installer hash publication remain open.
- Therefore F-001/P-32 are partial and M4/N-007 are not complete.

See [the package dependency review](../dependencies/WP-07-electron-builder.md).
