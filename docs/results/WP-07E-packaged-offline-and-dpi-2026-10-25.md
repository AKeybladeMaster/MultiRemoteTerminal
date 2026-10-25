# WP-07E — Packaged offline and 200% device-scale smoke

**Date:** 2026-10-25
**Branch:** `dev-1`
**Requirements:** N-006 packaged accessibility scale; N-011 offline local workflow; P-32 installed-app acceptance.
**Status:** Partial; installed build checks passed on Windows 11 x64.

## Behavior checked

The NSIS-installed app launches with `--force-device-scale-factor=2`. The packaged E2E confirms `devicePixelRatio` is 2 and the workbench has no horizontal overflow. It then uses Playwright's browser-context offline emulation and verifies:

- The packaged app reports geolocation permission as denied.
- Local help opens and closes.
- The user can save a Unicode-safe workbench greeting into the local profile.
- A PowerShell terminal launches and returns output.
- After app restart, the greeting is still present while renderer networking is emulated offline.
- The app's user-data folder remains outside the installed application directory.

The E2E uses the real NSIS-installed executable, then uninstalls it. The portable executable keeps its separate placement/profile smoke from WP-07A.

## Validation

On Windows 11 x64 with Node.js 24.14.1 and pnpm 12.15.0:

- `corepack pnpm typecheck` passed.
- `corepack pnpm lint` passed, including import-boundary checks.
- `corepack pnpm package:win:smoke` passed on Windows x64: the native module and both distributable targets built, the generator emitted both CycloneDX SBOMs, and all 3 packaged E2E cases passed. The NSIS case includes the 2× scale, permission denial, offline help/settings/terminal, profile persistence and uninstall checks; the portable and SBOM checks passed unchanged.

## Independent review

The Spec review found no scope creep or incorrect behavior and confirmed that N-006/N-011 remain partial beyond the forced 2× scale and renderer-only offline emulation. The Standards review found no documented-standard violations or baseline smells.

## Limits

`--force-device-scale-factor=2` exercises the renderer at a 2× device scale but does not replace human acceptance with Windows display scaling at 200%. Playwright's offline emulation affects Chromium's regular renderer network stack only. The application starts before offline emulation is enabled; no OS-level network isolation was applied. The verified help, SQLite settings and local PowerShell workflow use local resources. Windows 10 acceptance, signed release, packaged SSH credential prompt, and broader startup/crash/recovery/shutdown acceptance remain open, so P-32 and the M4 release gate remain partial.
