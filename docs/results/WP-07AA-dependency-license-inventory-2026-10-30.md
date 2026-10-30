# WP-07AA — dependency license inventory

**Date:** 2026-10-30
**Requirement:** P-32/N-007 distribution and security release gate.
**Status:** Partial inventory; legal review and publication remain open.

## Commands and findings

- `corepack pnpm licenses list --json --prod --dir apps/desktop` returned 29 production package records: 25 MIT, 2 ISC, 1 BSD-3-Clause, and 1 Unlicense. No record lacked license metadata. Each record had at least one installed package path with a top-level `LICENSE`, `LICENCE`, `COPYING`, or `NOTICE` file.
- Both generated x64 CycloneDX SBOMs contained 31 components and no component was missing license metadata.
- `corepack pnpm licenses list --json --dir .` returned 332 package records for the workspace-root project, all with declared license metadata. A direct-file scan found a top-level `LICENSE`, `LICENCE`, `COPYING`, or `NOTICE` file in at least one installed path for 307 records; 25 records had no such file in their installed package directory.
- `corepack pnpm licenses list --json --recursive --dir .` ran the license command for every workspace project and returned 359 package records, all with declared license metadata. This count is the recursive command's combined record count, not a de-duplicated package count. The direct-file scan found a matching top-level license file for 334 records; 25 records had no such file. The same 25 package names were missing in both scans, and all are outside the desktop production scope:

  `@esbuild/win32-x64`, `@rolldown/binding-win32-x64-msvc`, `app-builder-lib`, `chromium-pickle-js`, `compare-version`, `cross-dirname`, `dmg-builder`, `emoji-regex`, `err-code`, `ignore`, `imurmurhash`, `isarray`, `lazy-val`, `natural-compare`, `node-api-version`, `punycode`, `read-binary-file-arch`, `temp-file`, `tiny-async-pool`, `tmp-promise`, `esrecurse`, `@humanfs/types`, `filelist`, `jake`, and `truncate-utf8-bytes`.

- The workspace scans include MPL-2.0 and WTFPL license expressions; they do not appear in the desktop production scan. No compatibility judgment was made.

## Limits and next acceptance

This is a package-metadata and top-level file-presence inventory, not a review of license texts, source provenance, notice obligations, or legal compatibility. The missing build/test package files and workspace license expressions still need review. The SBOM and hash manifest exist locally, but publication and signed-release verification are not complete. Keep the SECURITY.md checklist item open.
