# WP-07D — Windows distribution SBOM and signing plan

**Date:** 2026-10-25
**Branch:** `dev-1`
**Requirement:** P-32 distribution attribution and N-007 signed release/SBOM gate.
**Status:** Partial; unsigned preview package artifacts were generated and smoke-tested on Windows 11 x64.

## Behavior

Windows x64 packaging now creates a CycloneDX 1.6 SBOM for each NSIS installer and portable executable. Each BOM records the corresponding executable SHA-256, the resolved production dependency graph for `@mrt/desktop` and Electron 45.0.0, Authenticode status, and pinned build tool versions. `SHA256SUMS.txt` covers both executables and both BOMs. The generator fails if a runtime package or its declared license is missing, package metadata disagrees with the lock-resolved graph, or the requested signed-release build does not have valid signatures on both executables.

The signed-release procedure, protected certificate inputs, signature verification commands, and publishing gate are documented in [WINDOWS-RELEASE.md](../release/WINDOWS-RELEASE.md). No signing certificate or final product version is configured on this workstation.

## Validation

On Windows 11 x64 with Node.js 24.14.1 and pnpm 12.15.0:

- `corepack pnpm typecheck` passed.
- `corepack pnpm lint` passed, including import-boundary checks.
- `corepack pnpm exec node --test tests/unit/package-release.test.ts` passed (1 test). It verifies signed-release packaging fails closed without a certificate reference.
- `corepack pnpm run sbom:win` generated both BOMs from the packaged outputs and identified 31 runtime components in each dependency graph.
- `corepack pnpm package:win:smoke` passed: NSIS install, packaged PowerShell terminal, uninstall, portable profile placement, packaged PowerShell terminal, per-artifact BOM/hash contract (3 E2E cases total).
- The E2E contract confirmed CycloneDX 1.6 declarations, artifact hashes, Electron 45.0.0, production-only dependency scope, resolvable dependency references, unsigned-preview status and SHA-256 manifest entries.
- Windows Authenticode reported `NotSigned` for both generated executables, as expected without a publisher certificate. Their BOMs contain 31 components and 32 dependency graph nodes each (root plus components).
- Generated artifact SHA-256 values were:

  | File | SHA-256 |
  |---|---|
  | `MultiRemoteTerminal Setup 0.0.0.exe` | `31981D753692561B0ABD8048C5FF497ED98E654D36FBCE9B882711F687FEAB20` |
  | `MultiRemoteTerminal Setup 0.0.0.exe.cdx.json` | `FC5DCC700A343A2278A20D3759B12BD2AE51F6A3C63B375948BCE8FC25A61626` |
  | `MultiRemoteTerminal 0.0.0.exe` | `813786FA81C49A2EBC9D9BC002F7A3C13338931953F0106EE4D276E5940BCC63` |
  | `MultiRemoteTerminal 0.0.0.exe.cdx.json` | `7679B968E1078EB6900981DF665E7D8E27BB6F8106F8D98030CB8AF0AABBCA9E` |
- A local JSON Schema validation library was unavailable; the checked-in packaged smoke validates the emitted structure and graph references but is not a full CycloneDX JSON Schema validation.

The package build still reports Vite's existing non-blocking 907.46 kB minified chunk advisory.

## Remaining acceptance

N-007 and M4 remain open pending a publisher certificate, a signed release build with independently verified Authenticode signatures, and selection of the intended release version. Windows 10, 200% DPI, offline operation, permissions, broader crash/recovery/shutdown checks, and the independent security/release review remain outstanding. This phase does not claim a signed release or MVP completion.
