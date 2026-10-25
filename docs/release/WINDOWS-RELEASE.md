# Windows release plan

**Current state:** The available Windows 11 x64 workstation can build and smoke-test unsigned `0.0.0` packages. No publisher certificate or final product version is configured. Do not describe the current artifacts as a signed release or an M4 build.

## Reproducible build inputs

- Build on Windows x64 with Node.js `24.14.1` and pnpm `12.15.0`, both pinned by the repository.
- Start from a clean checkout of the reviewed `dev-1` commit. Install with `corepack pnpm install --frozen-lockfile` and run `corepack pnpm check`.
- Run `corepack pnpm package:win:smoke`. The packaging script builds x64 NSIS and portable artifacts, then generates one CycloneDX 1.6 SBOM per executable and a `SHA256SUMS.txt` manifest.
- Keep the SBOMs and checksum manifest beside the two distributable executables. The manifest covers each executable and its SBOM; it does not hash itself.
- The SBOM includes the resolved production dependency graph for `@mrt/desktop` and the pinned Electron runtime. Development tools are excluded. The Electron package's bundled Chromium/Node components are represented by the Electron runtime component; Electron's bundled `LICENSE.electron.txt` and `LICENSES.chromium.html` remain in the packaged directory.

## Authenticode signing

Use a Windows code-signing certificate for the publisher identity selected by the release owner. Keep the PFX and its password in a protected secret store. Do not add certificates, passwords or private keys to the repository, command arguments, package artifacts or build logs.

The pinned electron-builder v26 configuration uses SHA-256 signatures and the RFC 3161 timestamp service at `http://timestamp.digicert.com`. Supply the PFX through `WIN_CSC_LINK` (or `CSC_LINK`) and its password through `WIN_CSC_KEY_PASSWORD` (or `CSC_KEY_PASSWORD`). The release flag is fail-closed:

```powershell
$env:MRT_SIGNED_RELEASE = '1'
$env:WIN_CSC_LINK = '<protected certificate path or secret reference>'
$env:WIN_CSC_KEY_PASSWORD = '<protected secret>'
corepack pnpm package:win:smoke
```

The packaging step refuses signed-release mode when no certificate reference is provided. The SBOM generator checks both distributable executables with Windows Authenticode and refuses to complete unless both signatures are `Valid`; their status and public signer identity are recorded in each SBOM. Before publishing, independently run `signtool verify /pa /v` on both files, check the signer matches the selected publisher identity, and verify each entry in `SHA256SUMS.txt` with `Get-FileHash -Algorithm SHA256`.

## Publish gate

Publish only after the version is set to the intended release value, the signed installer and portable executable pass their packaged-app smoke tests, their per-artifact SBOMs and hashes are attached, and all N-001 through N-007 M4 acceptance evidence is reviewed. The current workstation does not have a signing certificate, Windows 10 acceptance, 200% DPI acceptance, or a completed independent security/release review; these items keep the release gate open.

## Official tool references

- [pnpm `list`](https://pnpm.io/cli/list) documents the production dependency graph and JSON output used by the generator.
- [pnpm `licenses list`](https://pnpm.io/cli/licenses) documents the production license inventory.
- [CycloneDX 1.6 JSON schema](https://cyclonedx.org/schema/bom-1.6.schema.json) defines the emitted BOM structure.
- [electron-builder v26 Windows code signing](https://www.electron.build/v26/docs/features/code-signing/code-signing-win/) documents `WIN_CSC_LINK`, SHA-256, and RFC 3161 timestamp configuration.
- [Microsoft SignTool](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool) documents SHA-256 signing, timestamping and signature verification.
