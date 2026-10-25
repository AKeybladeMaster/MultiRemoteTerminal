# WP-01F dependency review: re2js

**Pinned version:** `re2js@2.8.6` in the workspace manifests and lockfile.  
**License:** MIT, as listed by the package registry and upstream repository.  
**Distribution:** Pure JavaScript; no native addon, Electron ABI build or transitive runtime dependency. The published npm package metadata reports an unpacked size of 870,239 bytes.  
**Compatibility:** The package is used in both the framework-free domain matcher and the renderer bundle. Its upstream documentation describes browser and Node.js use. The project build and Windows x64 Electron E2E exercise both paths.

## Use and bounds

RE2JS is used to compile user-configured terminal highlight patterns. The implementation also limits rule count to 8, source patterns to 128 Unicode code points, compiled program size to 512, capture groups to 16, scanned lines to 2,048 UTF-16 code units, scanned rows to 128 and matches to 24 per line / 96 per refresh. RE2-family syntax intentionally omits backreferences and look-around constructs. Those input and work bounds are application controls; RE2JS's linear-time claim is an upstream property, not a substitute for them.

## Assessment

- **Maintenance and security posture:** upstream repository is active and describes the project as a JavaScript implementation of RE2; Google RE2 documents linear-time matching and the restriction of constructs that require backtracking. No independent security audit of this JavaScript port was identified, so the app retains strict size/work bounds and rejects invalid rules.
- **Windows / Electron support:** no native code means no Node ABI-specific binary. The repository's Windows x64 build and Electron end-to-end test pass on the pinned toolchain.
- **Size:** the production renderer bundle increased from approximately 743 kB to 893 kB uncompressed (245 kB gzip) in this phase. Vite warns that the bundle is above its 500 kB advisory threshold; highlighting is settings functionality, but lazy-loading or worker-based parsing can be evaluated if startup measurements show a material regression.
- **Vulnerability audit:** `corepack pnpm audit --prod` reports no known vulnerabilities in the current production dependency graph.

## Sources

- [RE2JS upstream repository and documentation](https://github.com/le0pard/re2js)
- [RE2JS 2.8.6 package registry record](https://www.npmjs.com/package/re2js)
- [Google RE2 safety and design notes](https://github.com/google/re2)
- [Google RE2 syntax reference](https://github.com/google/re2/wiki/Syntax)
