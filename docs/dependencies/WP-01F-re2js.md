# WP-01F dependency review: re2js

**Pinned version:** `re2js@2.8.7` in both workspace manifests and the lockfile.
**License:** MIT, as listed by the package registry and upstream repository.  
**Distribution:** Pure JavaScript; no native addon or Electron ABI build. The published package has no runtime dependencies and reports an unpacked size of 902,719 bytes.
**Compatibility:** The package is used in both the framework-free domain matcher and the renderer bundle. Version 2.8.7 declares Node.js `>=20.0.0`; the pinned Node 24.14.1 and Electron 45 Windows x64 project build exercise both paths.

## Use and bounds

RE2JS is used to compile user-configured terminal highlight patterns. The implementation also limits rule count to 8, source patterns to 128 Unicode code points, compiled program size to 512, capture groups to 16, scanned lines to 2,048 UTF-16 code units, scanned rows to 128 and matches to 24 per line / 96 per refresh. RE2-family syntax intentionally omits backreferences and look-around constructs. Those input and work bounds are application controls; RE2JS's linear-time claim is an upstream property, not a substitute for them.

## Assessment

- **Maintenance and security posture:** upstream repository is active and describes the project as a JavaScript implementation of RE2; Google RE2 documents linear-time matching and the restriction of constructs that require backtracking. No independent security audit of this JavaScript port was identified, so the app retains strict size/work bounds and rejects invalid rules.
- **Windows / Electron support:** no native code means no Node ABI-specific binary. The repository's Windows x64 build and Electron end-to-end test pass on the pinned toolchain.
- **Size:** the production renderer bundle increased from approximately 743 kB to 893 kB uncompressed (245 kB gzip) in this phase. Vite warns that the bundle is above its 500 kB advisory threshold; highlighting is settings functionality, but lazy-loading or worker-based parsing can be evaluated if startup measurements show a material regression.
- **Vulnerability remediation (2026-10-29):** `pnpm audit` identified CVE-2026-116795 / GHSA-gg6h-894w-4m9c in the former `2.8.6` pins. The advisory affects `2.2.0` through versions below `2.8.7` when the opt-in `LOOKBEHINDS` flag is combined with repeated matching. This app never enables that flag and its existing unit test rejects lookbehind patterns, but both direct pins were upgraded to the fixed `2.8.7` release. The full and production-only `pnpm audit` checks now report no known vulnerabilities; the current unit suite passes 582 tests. The patch release declares Node.js `>=20.0.0`, retains the MIT license and pure-JavaScript distribution, and increases unpacked package size by about 32 kB.

## Sources

- [RE2JS upstream repository and documentation](https://github.com/le0pard/re2js)
- [RE2JS 2.8.7 package registry record](https://www.npmjs.com/package/re2js/v/2.8.7)
- [GitHub advisory GHSA-gg6h-894w-4m9c](https://github.com/advisories/GHSA-gg6h-894w-4m9c)
- [RE2JS 2.8.7 upstream release](https://github.com/le0pard/re2js/releases/tag/2.8.7)
- [Google RE2 safety and design notes](https://github.com/google/re2)
- [Google RE2 syntax reference](https://github.com/google/re2/wiki/Syntax)
