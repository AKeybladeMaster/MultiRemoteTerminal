# WP-07A — Windows package foundation

**Status:** Package creation and the focused packaged-app smoke cases passed on Windows 11 x64. F-001 and P-32 remain PARTIAL; this evidence does not pass the M4 release gate.

## Scope and requirements

- **F-001 / P-32:** produce an installed Windows app and a portable app that keeps its profile with the portable executable.
- **N-007 (partial):** pin the package tool and lockfile. A distribution SBOM, signed release plan, verified public hashes and release build are still outstanding.
- **Portable location decision:** the user selects the data location by placing the portable executable in a writable folder; see [ADR-0014](../adr/ADR-0014-wp07-portable-profile-location.md).

## Implementation

- `electron-builder@26.18.0` is pinned as a root build-time dependency. Packaging requires a Windows x64 host and declares x64 for each target in `electron-builder.yml`, producing an ASAR-based per-user NSIS installer and portable executable.
- `scripts/build.mjs` stages a self-contained desktop package, builds the app's Electron 45 native addon and generates an original terminal icon.
- Portable launch paths are validated before app readiness. The app creates `MultiRemoteTerminal-data/session-data` beside the portable executable and points Electron's profile paths there. Installed and development launches keep the default Electron profile location.
- Utility workers use the physical resources directory as their working directory; the packaged app root remains separately available for module resolution. The Windows credential helper is copied into packaged resources.
- Smoke cleanup confirms the portable process-tree termination request and retries transient Windows file locks.

## Validation

On the available Windows 11 x64 workstation:

- `corepack pnpm package:win:smoke` — passed; it builds the package then runs both packaged-app smoke cases.
  - `artifacts/windows/MultiRemoteTerminal Setup 0.0.0.exe` — 126,687,500 bytes; SHA-256 `23FBAED20EEC4E0554833E7F5E839E5A42BBE8C02D34F3A2C0D35F6A5C8E2EDF`.
  - `artifacts/windows/MultiRemoteTerminal 0.0.0.exe` — 113,501,400 bytes; SHA-256 `D5ACBC56D528A70035A2512092BB247E3A6DF0DA4F908AA6F082C5ADBDF5F991`.
  - `artifacts/windows/win-unpacked/MultiRemoteTerminal.exe` — 250,031,104 bytes.
- `package:win:smoke` ran the two Playwright checks against those artifacts — **2 passed**.
  - NSIS silently installs to a temporary per-user directory; the packaged app opens a PowerShell terminal and returns the expected output; it then uninstalls cleanly.
  - The portable executable starts from a temporary folder, opens the workbench, runs a local PowerShell command, and creates the SQLite profile beside itself. The smoke connects over a temporary loopback-only debugging port.
- `corepack pnpm typecheck` — passed.
- `corepack pnpm lint` — passed.
- `corepack pnpm exec node --test tests/unit/portable-user-data.test.ts` — **3 passed**.
- `corepack pnpm audit` — no known vulnerabilities reported at review time.
- `Get-AuthenticodeSignature` — the installer, portable executable and unpacked app all report `NotSigned`.

The first full smoke attempt exposed an `EBUSY` error when Windows briefly held the portable SQLite shared-memory file during teardown. Cleanup now terminates the process tree and retries recursive removal for up to ten seconds; the focused portable test and the complete two-case package smoke passed after that change. A later test enhancement found that a portable workbench may start with an existing terminal, so the smoke now checks the workspace and opens a new shell instead of requiring an empty screen.

## Independent review

The final read-only review of `origin/main..662ca99` found no Critical or Important issues on the requesting, Spec, or Standards passes. It confirmed that P-32's location choice is placement-based, and that Windows 10 plus the N-007 distribution SBOM and signed release plan remain open. An earlier standards pass found that portable initialization needed a static redacted failure event; that event was added and documented.

One non-blocking judgment remains: each worker host repeats `cwd: process.resourcesPath ?? this.appRoot`. It stays inline so each worker's launch options show the packaged working-directory rule directly; extracting a one-line forwarding helper would add indirection without owning additional behavior. An earlier review also noted repeated pnpm command-selection logic in the packaging and smoke scripts. That small duplication remains because the scripts run different task sequences; no shared runner is needed for this slice.

## Remaining limits

- Only Windows 11 x64 was exercised. Windows 10 acceptance and other supported-machine coverage are absent.
- This build is version `0.0.0`, unsigned, and not a release candidate. No certificate was available/configured.
- High-DPI, offline installation/use, minimum-permission behavior, packaged SSH credential prompting, crash/recovery/shutdown, 1,000-record acceptance, distribution SBOM and public installer hash publication remain open.
- Therefore F-001/P-32 are partial and M4/N-007 are not complete.

See [the package dependency review](../dependencies/WP-07-electron-builder.md).
