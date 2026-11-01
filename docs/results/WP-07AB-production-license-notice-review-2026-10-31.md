# WP-07AB — production license notice and provenance review

**Date:** 2026-10-31  
**Requirement:** N-012 legal/provenance hygiene; related to P-32/N-007 release inventory.  
**Status:** Research findings only; N-012 remains open.

## Scope and method

Reviewed the 29 production package records returned by `corepack pnpm licenses list --json --prod --dir apps/desktop`, the installed package metadata/license-like files, the current notice/SBOM source, and the corresponding lock entries. The 29 records expand to 30 `name@version` rows because `node-addon-api` has versions 7.1.1 and 8.3.0. The package set is: `@serialport/bindings-cpp@13.0.1`, `@serialport/bindings-interface@1.2.2`, `@serialport/parser-delimiter@13.0.0`, `@serialport/parser-readline@13.0.0`, `@serialport/stream@13.0.0`, `@xterm/addon-fit@0.11.0`, `@xterm/xterm@6.0.0`, `asn1@0.2.6`, `basic-ftp@6.2.3`, `buildcheck@0.0.7`, `cpu-features@0.0.10`, `debug@4.4.0`, `has-flag@4.0.0`, `ms@2.1.3`, `nan@2.30.0`, `node-addon-api@7.1.1`, `node-addon-api@8.3.0`, `node-gyp-build@4.8.4`, `node-pty@1.1.0`, `re2js@2.8.7`, `react@19.3.1`, `react-dom@19.3.1`, `safer-buffer@2.1.2`, `scheduler@0.28.0`, `ssh2@1.17.0`, `supports-color@7.2.0`, `bcrypt-pbkdf@1.0.2`, `libsodium-sumo@0.8.4`, `libsodium-wrappers-sumo@0.8.4`, and `tweetnacl@0.14.5`.

The notice generator consumes pnpm's production license listing, validates installed package name/version and path bounds, then scans **only top-level regular files** whose names match its license/notice pattern ([generator source](../../scripts/generate-third-party-notices.mjs#L25-L27), [file selection and identity checks](../../scripts/third-party-notices.mjs#L62-L91)). The worktree already contains uncommitted candidate changes; no tests, builds, package operations, or artifact inspection were run for this report.

## Findings

1. **Nested `cpu-features` licensing is omitted from the generated notice bundle.** `cpu-features@0.0.10` reports MIT at package level, while its upstream `binding.gyp` links `deps/cpu_features/cpu_features.gyp:cpu_features` into the native binding ([package metadata](https://github.com/mscdex/cpu-features/blob/v0.0.10/package.json), [binding target](https://github.com/mscdex/cpu-features/blob/v0.0.10/binding.gyp)). Its nested `deps/cpu_features/LICENSE` contains Apache-2.0 terms and a separate Android Open Source Project three-condition notice for `ndk_compat` ([upstream license text](https://github.com/mscdex/cpu-features/blob/v0.0.10/deps/cpu_features/LICENSE)); the installed copy is under that nested path. Because the generator enumerates only `readdir(packagePath)` top-level files, it includes the package-level MIT `LICENSE` but not this nested file. The build graph confirms the vendored CPU library is compiled; whether the `ndk_compat` files covered by the second notice enter the Windows x64 build was not established.

2. **Nested WinPTY attribution is omitted from the generated notice bundle.** `node-pty@1.1.0` publishes `deps/` in its package file list, but its nested `deps/winpty/LICENSE` names Ryan Prichard and carries a separate MIT text ([upstream package file list](https://github.com/microsoft/node-pty/blob/v1.1.0/package.json), [nested WinPTY license](https://github.com/microsoft/node-pty/blob/v1.1.0/deps/winpty/LICENSE)). The package's top-level `LICENSE` has other MIT notices but not that copyright notice ([top-level license](https://github.com/microsoft/node-pty/blob/v1.1.0/LICENSE)). The current generator therefore does not copy this nested notice into `THIRD-PARTY-NOTICES.txt`. Whether the final installer/portable archive exposes the nested file elsewhere was not inspected.

3. **Release metadata is not bound to package source content.** The pnpm lockfile records integrity values for package tarballs (for example, [`cpu-features@0.0.10`](../../pnpm-lock.yaml#L1009) and [`node-pty@1.1.0`](../../pnpm-lock.yaml#L1677)), but the notice builder checks installed `package.json` name/version only and does not compare license metadata or package bytes to those lock integrities ([identity check](../../scripts/third-party-notices.mjs#L67-L75)). The distribution SBOM records package name/version/purl/license and optionally a registry distribution URL, but does not attach a source commit or per-package hash ([SBOM component construction](../../scripts/generate-distribution-sbom.mjs#L113-L147)). Thus the current source provides a pinned lockfile and artifact-level hashes, but the generated notice/SBOM path does not independently evidence that the copied installed files match a reviewed upstream source revision or locked tarball.

4. **The candidate notice output is not acceptance evidence yet.** Current plan/report notes say the notice and package assertions were authored but not run, and artifacts have not been regenerated from the present source candidate ([WP-07AA inventory update](WP-07AA-dependency-license-inventory-2026-10-30.md), [WP-07D implementation status](../IMPLEMENTATION-PLAN.md#L225)). The findings above describe source behavior and installed package contents, not the contents of a released installer or portable executable.

## Disposition and limits

The inventory's package-level license counts were reproduced; no additional top-level license-text classification discrepancy was established in this bounded review. Two nested notice omissions and a package-content provenance gap remain for follow-up before N-012 can close. This report does not assess license compatibility, interpret legal obligations, inspect every non-package asset, or verify the packaged artifacts.

## Nested notice source remediation - 2026-10-31

The current unverified notice-generator candidate now includes the exact nested license paths for `cpu-features@0.0.10` and `node-pty@1.1.0`. It fails closed if either reviewed package changes version, if a nested file is absent or is not a regular file, or if its resolved path leaves the installed package. Authored unit fixtures cover both included texts and missing-file rejection. Tests and package generation have not run, so the candidate output has not been inspected. The package-content provenance finding and legal compatibility review remain open.

## Lockfile integrity in the SBOM - 2026-10-31

The current unverified SBOM generator now reads the pinned pnpm v9 lockfile format, requires an exact `name@version` SHA-512 integrity record for each runtime component, and emits that digest in the CycloneDX component `hashes`. The parser is bounded and fails closed on an unsupported lockfile, absent package integrity, malformed digest, or conflicting records. Unit coverage for scoped/unscoped lock keys and malformed input, plus a packaged-SBOM assertion for each component, is authored but unrun. This records the repository's locked package integrity; it does not independently compare the installed package tree or final artifact contents to the lock entry. A clean frozen install and generated package/SBOM inspection remain required. The pnpm lockfile integrity and CycloneDX component-hash formats follow the [pinned pnpm release notes](https://pnpm.io/blog/releases/12.15.0) and [CycloneDX guidance](https://cyclonedx.org/guides/sbom/relationships/).

## Bounded installed manifest lookup - 2026-10-31

Static source inspection found the notice generator's installed package.json read lacked a byte bound and file/path checks. The current unverified candidate now rejects non-regular, oversized, symlinked, or out-of-package manifests before parsing the package identity. An oversized-manifest unit assertion was authored but not run. This reduces build-time resource/path exposure; it does not bind installed package contents to the lockfile or close the remaining provenance and legal review findings.

## Bounded notice-file reads - 2026-10-31

Static review found the notice-file size limit was checked only after `readFile` allocated the full content. The current candidate validates the resolved regular file and reads at most 1 MiB plus one detection byte in bounded chunks. An oversized-license regression assertion is authored but unrun. This bounds the generator's per-file read allocation; the notice output has not been regenerated or inspected, and legal/provenance findings remain open.
## N-012 bounded SBOM package metadata read - 2026-10-31

- The SBOM generator now uses the notice pipeline's shared 1 MiB-capped regular-manifest reader, requires each package realpath to remain inside workspace `node_modules`, verifies package name/version, and omits unneeded dependency descriptions. Added unrun unit assertions for matching identity and out-of-root rejection; no notice artifact or package output was generated. Phase 08 and N-012 remain unverified.

## N-012 SBOM URL disclosure boundary - 2026-10-31

- The SBOM generator now emits distribution links only for HTTPS URLs on the public `registry.npmjs.org` host with no user information, custom port, query, or fragment. Private registries and unrecognized URLs are omitted rather than copied into release evidence. Added unit assertions for safe inclusion and rejection of credential/query/fragment/private-host/non-HTTPS URLs; no tests or packages were run. N-012 remains partial.

- Follow-up review applies the bounded package reader to the Electron runtime manifest as well as the transitive dependency graph, and rejects distribution reference strings longer than 2 KiB before URL parsing. No generated BOM or package was inspected.

## Bounded installed-manifest allocation - 2026-10-31

Follow-up static review found that installed `package.json` files were size-checked before `readFile`, but could still be replaced between the check and the read. The current candidate now uses the shared handle-based reader, which reads in bounded chunks and stops after the first byte beyond 1 MiB before parsing. Direct oversized-manifest regression coverage remains authored but unrun; no notice or package output was generated, and source provenance and legal compatibility remain open.
## Bounded package-directory enumeration - 2026-10-31

Static review found the notice generator materialized each entire package root with `readdir` before selecting license files. The candidate now iterates the directory incrementally, caps each package at 4,096 entries, and rejects a symbolic link whose name matches the license/notice pattern. An over-limit regression fixture is authored but unrun. No notice bundle or package was generated; legal/provenance review and N-012 acceptance remain open.
A separate authored unit case confirms that a symlink named `LICENSE` is rejected when the current account can create the fixture; it skips with an explicit reason when Windows denies symlink creation. This coverage is unrun and is not a platform acceptance result.
## Bounded pnpm lockfile read - 2026-10-31

Static review found that the SBOM generator read pnpm-lock.yaml completely before the integrity parser applied its 8 MiB input limit. The source now validates a regular file through a handle, compares its opened file identity with the lstat result, and reads only up to the limit plus one detection byte. SBOM generation uses a strict UTF-8 bounded-lockfile reader. The corresponding size and invalid-encoding assertions are authored but unrun; no generated SBOM or package was inspected. This does not bind installed dependency files to lockfile tarball bytes or establish legal compatibility.
## Streaming distribution hashes - 2026-10-31

Static review found the SBOM generator loaded each installer, portable executable, app.asar, and packaged notice file completely into memory to calculate SHA-256. The current candidate hashes each through a regular-file handle using a fixed 64 KiB buffer, verifies lstat/open file identity and the initial file size, and rejects truncation or growth observed during the read. The unit source adds a known SHA-256 vector but has not run; no SBOM or package has been regenerated. This bounds hashing memory but does not bound file size or total hash time.
## WP-07D bounded SBOM license index - 2026-10-31

Static source review found the SBOM path consumed pnpm's raw production-license JSON separately from the notice generator, bypassing the existing 512-record and metadata/path validation. It now builds the SBOM license index through `productionLicensePackages`, which also rejects conflicting license declarations for the same package/version. Added a regression assertion for conflicting declarations; all related tests and package generation remain unrun. This does not establish upstream source provenance or legal compatibility; N-012 remains partial.
## Registry signature verification follow-up - 2026-10-31

The release package helper now invokes the repository-pinned `pnpm audit signatures --prod` before build. pnpm documents that this validates installed package registry signatures using registry-published keys; pnpm 12.15.0 release notes state signature verification is tied to lockfile integrity. Registries without published keys are skipped, and a registry with keys rejects invalid or absent package signatures. This adds a signed-registry check but does not prove that the installed tree or generated artifact matches the signed archive, nor establish legal compatibility. See [pnpm audit signatures](https://pnpm.io/cli/audit) and [pnpm 12.15.0 release notes](https://pnpm.io/blog/releases/12.15.0). No audit, test, or package command ran.
## N-012 signature-audit workspace scope correction - 2026-11-01

The first authored command targeted the workspace root, which has no production dependencies. It is corrected to `pnpm --filter @mrt/desktop audit signatures --prod`; pnpm's official filtering documentation and 12.7 release notes confirm the audit honors workspace filters. The Windows regression now asserts this exact scoped invocation. No audit, test, build, or package command ran; the previous unfiltered description above is superseded.
## N-012 signature audits include Electron - 2026-11-01

The desktop production audit alone omitted Electron because the SBOM lists it as the packaged runtime while the repository pins it in root `devDependencies`. Packaging now runs both `pnpm --filter @mrt/desktop audit signatures --prod` and `pnpm --workspace-root audit signatures --dev` before build. The second includes Electron and root build dependencies. The Windows package regression asserts both commands precede build. No audit, test, or package command ran; these records supersede the earlier single-audit scope note. N-012 remains partial pending final source/archive and legal review.
## 2026-11-01 bounded-read stability follow-up

The shared bounded reader now rejects when bytes read do not equal the opened file's initial size, preventing a concurrent truncation or growth from producing a partial manifest, notice, or lockfile input. Existing unit coverage still requires the exact bounded file contents; no test or release generation ran. N-012 remains PARTIAL.
## N-012 generated-output file-link protection - 2026-11-01

Static review found that direct SBOM and checksum writes followed pre-existing output-file links, and the notice writer could also modify a hard-linked file outside the workspace. The shared bounded writer now validates fixed output names, rejects symbolic links and multi-link files, and checks the opened file identity before rewriting. The notice, per-artifact SBOM, and checksum outputs use that writer. Regression source covers create/update and sentinel preservation for symbolic-link and hard-link targets; it is unrun. No notice, SBOM, or package artifact was regenerated. N-012 remains PARTIAL pending phase verification, provenance/legal review, and final artifact inspection.## 2026-11-01 atomic generated-output follow-up (unverified)

The shared workspace output helper now writes notice, dependency-inventory, SBOM, and checksum data to a unique exclusive sibling, syncs it, verifies the destination still matches its pre-write absence/identity, then atomically renames it into place. Failure cleanup removes only the owned temporary file and preserves any previous generated output. Updated the package-release unit source to check replacement leaves no temporary sibling. No tests or output generation ran; this does not close legal compatibility, package-provenance, or N-012 review.
