# Windows release plan

**Current state:** The available Windows 11 x64 workstation can build and smoke-test unsigned `0.0.0` packages. No publisher certificate or final product version is configured. Do not describe the current artifacts as a signed release or an M4 build. See the [Windows compatibility matrix](WINDOWS-COMPATIBILITY.md) for tested environments and open platform gates.

**Latest recorded packaged smoke (2026-10-31; prior candidate):** The Phase 07 ledger records that x64 NSIS and portable packages were rebuilt, SBOM/hash metadata generated, and 6/6 packaged smoke checks passed (ASAR/fuses, manifest/SBOM, NSIS install/uninstall, portable settings, native SSH credential prompt, and log shutdown). Both artifacts were unsigned. Local artifact timestamps are October 31. This is prior-candidate evidence; the current worktree has newer unverified changes and has not been repackaged. See the [Phase 07 ledger](../results/PHASE-07-execution-ledger.md) and [Phase 08 ledger](../results/PHASE-08-execution-ledger.md). Earlier WP-07W acceptance also covered installed and portable PowerShell and Git Bash launch. Windows 10, Authenticode signing and the rest of the M4 release gate remain open.

## Reproducible build inputs

- Before building release artifacts, `scripts/package-win.mjs` runs two pinned checks: `pnpm --filter @mrt/desktop audit signatures --prod` for shipped runtime dependencies, and `pnpm --workspace-root audit signatures --dev` for Electron plus the root build toolchain. The second check includes Electron, which the SBOM lists as the shipped app runtime but pins in root `devDependencies`. pnpm verifies package registry signatures against published keys and lockfile integrity; registries without keys are skipped and registries with keys reject unsigned or invalid packages. These checks do not prove the installed package tree equals its archive or establish legal compatibility. The package-script test asserts both audits precede build; it is authored but unrun.
- Build on Windows x64 with Node.js `24.14.1` and pnpm `12.15.0`, both pinned by the repository.
- Start from a clean checkout of the reviewed `dev-1` commit. Install with `corepack pnpm install --frozen-lockfile` and run `corepack pnpm check`.
- Run `corepack pnpm package:win:smoke`. The packaging script builds x64 NSIS and portable artifacts, then generates one CycloneDX 1.6 SBOM per executable and a `SHA256SUMS.txt` manifest.
- The package step builds a bounded `THIRD-PARTY-NOTICES.txt` from every production package's declared license and matching top-level license/notice files. It also includes the reviewed nested `cpu-features@0.0.10/deps/cpu_features/LICENSE` and `node-pty@1.1.0/deps/winpty/LICENSE` files; a version change for either package fails closed until its nested license layout is reviewed. Missing, empty, oversized, non-UTF-8, out-of-workspace, or control/format-character notice filenames fail packaging. The SBOM generator hashes this file alongside Electron and Chromium notices and includes the hashes in each per-artifact BOM and `SHA256SUMS.txt`.
- The SBOM generator checks the executing pnpm CLI version against the repository's `packageManager` pin and records the verified version in each BOM.
- Keep the SBOMs and checksum manifest beside the two distributable executables. The manifest covers each executable, its SBOM, Electron and Chromium notice files, and the production dependency notice file; it does not hash itself.
- The SBOM includes the resolved production dependency graph for `@mrt/desktop` and the pinned Electron runtime. Each runtime component carries its package/version SHA-512 integrity from `pnpm-lock.yaml`; generation fails if a matching lock entry is missing. Development tools are excluded. The Electron package's bundled Chromium/Node components are represented by the Electron runtime component; Electron's bundled `LICENSE.electron.txt` and `LICENSES.chromium.html` are required in `win-unpacked`, hashed in each SBOM, and included in the checksum manifest.
- This notice bundle and hash inventory support release review; they do not establish legal compatibility, correct license classification, source provenance, or an exhaustive inventory of every third-party asset.

## Authenticode signing

Use a Windows code-signing certificate for the publisher identity selected by the release owner. Keep the PFX and its password in a protected secret store. Do not add certificates, passwords or private keys to the repository, command arguments, package artifacts or build logs.

The pinned electron-builder v26 configuration uses SHA-256 signatures and the RFC 3161 timestamp service at `http://timestamp.digicert.com`. Supply the PFX through `WIN_CSC_LINK` (or `CSC_LINK`) and its password through `WIN_CSC_KEY_PASSWORD` (or `CSC_KEY_PASSWORD`). The release flag is fail-closed:

```powershell
$env:MRT_SIGNED_RELEASE = '1'
$env:MRT_RELEASE_SIGNER_SHA1 = '<expected 40-character certificate thumbprint>'
$env:WIN_CSC_LINK = '<protected certificate path or secret reference>'
$env:WIN_CSC_KEY_PASSWORD = '<protected secret>'
corepack pnpm package:win:smoke
```

The packaging step accepts only an unset/`0` flag for unsigned packaging or an exact `1` for signed-release mode; other values fail. Unsigned mode rejects inherited `CSC_LINK`/`WIN_CSC_LINK` certificate references, and the SBOM gate requires both expected artifacts to report `NotSigned`. Signed-release mode refuses to proceed without a certificate reference or expected signer thumbprint. The SBOM generator checks both expected executable filenames with Windows Authenticode and refuses to complete unless each matching record is `Valid` and its certificate thumbprint matches `MRT_RELEASE_SIGNER_SHA1`; status and public signer identity are recorded in each SBOM. Before publishing, independently run `signtool verify /pa /v` on both files and verify each entry in `SHA256SUMS.txt` with `Get-FileHash -Algorithm SHA256`.

## Publish gate

Publish only after the version is set to the intended release value, the signed installer and portable executable pass their packaged-app smoke tests, their per-artifact SBOMs and hashes are attached, and all N-001 through N-007 M4 acceptance evidence is reviewed. The current workstation does not have a signing certificate, Windows 10 acceptance, 200% DPI acceptance, or a completed independent security/release review; these items keep the release gate open.

## Official tool references

- [pnpm `list`](https://pnpm.io/cli/list) documents the production dependency graph and JSON output used by the generator.
- [pnpm `licenses list`](https://pnpm.io/cli/licenses) documents the production license inventory.
- [pnpm filtering](https://pnpm.io/filtering) documents the workspace selector used by the production signature audit.
- [CycloneDX 1.6 JSON schema](https://cyclonedx.org/schema/bom-1.6.schema.json) defines the emitted BOM structure.
- [electron-builder v26 Windows code signing](https://www.electron.build/v26/docs/features/code-signing/code-signing-win/) documents `WIN_CSC_LINK`, SHA-256, and RFC 3161 timestamp configuration.
- [Microsoft SignTool](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool) documents SHA-256 signing, timestamping and signature verification.

## 2026-11-01 notice-generation path boundary

The standalone `notices:win` generator validates the workspace `.tmp` directory before its local pnpm inventory query and writes only to a regular `THIRD-PARTY-NOTICES.txt` in that directory. The Windows package and direct SBOM commands validate/create the workspace `artifacts/windows` directory before package tooling or metadata writes. These paths reject linked directory components; notice, SBOM, and checksum writers reject symbolic-link and hard-link output files, stage writes to unique exclusive siblings, sync the staged file, recheck the existing destination identity, and atomically replace it. On write or replacement failure, cleanup removes only the operation's own temporary file and preserves the prior output. The package inventory includes common `THIRD-PARTY-NOTICES` filename variants. These source and test changes are unverified; the release output has not been regenerated.
