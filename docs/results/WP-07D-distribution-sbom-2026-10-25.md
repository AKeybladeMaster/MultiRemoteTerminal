# WP-07D — Windows distribution SBOM and signing plan

**Date:** 2026-10-25
**Branch:** `dev-1`
**Requirement:** P-32 distribution attribution and N-007 signed release/SBOM gate.
**Status:** Partial; unsigned preview package artifacts were generated and smoke-tested on Windows 11 x64.

## Behavior

Windows x64 packaging now creates a CycloneDX 1.6 SBOM for each NSIS installer and portable executable. Each BOM records the corresponding executable SHA-256, the resolved production dependency graph for `@mrt/desktop` and Electron 45.0.0, Authenticode status, and verified build tool versions. Before reading the package graph, the generator checks the running pnpm CLI against the repository's `packageManager` pin. `SHA256SUMS.txt` covers both executables and both BOMs. The generator fails if a runtime package or its declared license is missing, package metadata disagrees with the lock-resolved graph, or the requested signed-release build does not have valid signatures on both executables.

The signed-release procedure, protected certificate inputs, signature verification commands, and publishing gate are documented in [WINDOWS-RELEASE.md](../release/WINDOWS-RELEASE.md). No signing certificate or final product version is configured on this workstation.

## Validation

On Windows 11 x64 with Node.js 24.14.1 and pnpm 12.15.0:

- `corepack pnpm typecheck` passed.
- `corepack pnpm lint` passed, including import-boundary checks.
- `corepack pnpm exec node --test tests/unit/package-release.test.ts` passed (2 tests). It verifies signed-release packaging fails closed without a certificate reference and the SBOM generator rejects a pnpm CLI that does not match the repository pin.
- `corepack pnpm run sbom:win` generated both BOMs from the packaged outputs and identified 31 runtime components in each dependency graph.
- `corepack pnpm package:win:smoke` passed: NSIS install, packaged PowerShell terminal, uninstall, portable profile placement, packaged PowerShell terminal, per-artifact BOM/hash contract (3 E2E cases total).
- The E2E contract confirmed CycloneDX 1.6 declarations, artifact hashes, Electron 45.0.0, production-only dependency scope, resolvable dependency references, unsigned-preview status and SHA-256 manifest entries.
- Windows Authenticode reported `NotSigned` for both generated executables, as expected without a publisher certificate. Their BOMs contain 31 components and 32 dependency graph nodes each (root plus components).
- Generated artifact SHA-256 values were:

  | File | SHA-256 |
  |---|---|
  | `MultiRemoteTerminal Setup 0.0.0.exe` | `709CE4BE1DB851CA99D070804050834936257D77BB13A60A6EF3BE264D02553F` |
  | `MultiRemoteTerminal Setup 0.0.0.exe.cdx.json` | `A0BDE31697A99C0EE32E53E32A51A07864956C2B82E3C998831B843D510EF47E` |
  | `MultiRemoteTerminal 0.0.0.exe` | `848D47AA02B04E874A55197C7B481DD8565E945964570A9EEB63CFF793D06B7C` |
  | `MultiRemoteTerminal 0.0.0.exe.cdx.json` | `71821199E5D1F2BC6B828CA04826213292316B0E400F9C8A2E0604F1501A5DC2` |
- A local JSON Schema validation library was unavailable; the checked-in packaged smoke validates the emitted structure and graph references but is not a full CycloneDX JSON Schema validation.

The package build still reports Vite's existing non-blocking 907.46 kB minified chunk advisory.

## Current candidate filename guard - 2026-10-31

The notice builder now rejects dependency-provided top-level license filenames containing Unicode control or format characters, including bidi controls, before copying the filename into the generated notice bundle. A regression assertion was authored in `tests/unit/package-release.test.ts`; this latest source/test change has not been run and does not supersede the historical results above.

## Nested production notices - 2026-10-31

The current source candidate adds the reviewed nested license files for `cpu-features@0.0.10` and `node-pty@1.1.0` to the bounded notice bundle. It rejects a changed version for either package until its nested license layout is reviewed, and rejects missing, non-regular, or out-of-package nested files. Regression fixtures were authored for both files and their missing-file paths. No test, build, notice generation, or package smoke has run on this candidate. This addresses the two omissions identified in [WP-07AB](WP-07AB-production-license-notice-review-2026-10-31.md); package-source provenance and legal compatibility remain open.

The current source also adds each production runtime package's exact pnpm-lockfile SHA-512 integrity as a CycloneDX component hash and fails when a matching record is absent. Lock-parser and package-smoke assertions are authored but unrun. This records the lockfile's package integrity; installed package bytes and resulting artifacts have not yet been compared or regenerated.

## Remaining acceptance

N-007 and M4 remain open pending a publisher certificate, a signed release build with independently verified Authenticode signatures, and selection of the intended release version. Windows 10, 200% DPI, offline operation, permissions, broader crash/recovery/shutdown checks, and the independent security/release review remain outstanding. This phase does not claim a signed release or MVP completion.
