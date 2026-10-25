# WP-07 Electron fuses dependency review

Reviewed 2026-10-25 for the Windows x64 release hardening slice. `@electron/fuses@2.1.3` is pinned exactly as a root development dependency. It is not included in the shipped runtime dependency graph.

| Check | Evidence / decision |
|---|---|
| Version and maintenance | 2.1.3 was the latest upstream release inspected on the review date; the release was published 2026-06-29. [Upstream release](https://github.com/electron/fuses/releases/tag/v2.1.3) |
| License | MIT, confirmed in the tagged upstream [package manifest](https://github.com/electron/fuses/blob/v2.1.3/package.json). |
| Registry metadata | npm metadata reports an unpacked size of 40,898 bytes and Node `>=22.12.0`. The package has no runtime dependencies. The project build host is pinned to Node 24.14.1. |
| Electron and ABI compatibility | This is a JavaScript build tool and adds no native addon ABI. It supports Electron fuse wire v1 and `strictlyRequireAllFuses`; the packaged Electron 45.0.0 Windows x64 binary exposes nine v1 fuses, all explicitly configured and verified. |
| Windows support | The tool reads and updates the packaged Windows executable. The Windows x64 package smoke reads the finished artifact with `getCurrentFuseWire`, then installs and starts the NSIS build and starts the portable build. |
| Security role | The app disables `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`/`NODE_EXTRA_CA_CERTS`, Node inspector arguments, and extra `file://` privileges. It enables cookie encryption, embedded ASAR integrity and ASAR-only loading, retains Wasm trap handlers, and explicitly leaves the unused browser-specific V8 snapshot disabled. The complete mapping is in `scripts/electron-fuses.mjs`. |
| Package impact | Build-time dependency only. It is excluded from the production distribution SBOM and adds 40,898 unpacked bytes to development tooling; it adds no shipped runtime code. |

Electron's [fuse guide](https://www.electronjs.org/docs/latest/tutorial/fuses) recommends disabling unused runtime entry points. Its [ASAR integrity guide](https://www.electronjs.org/docs/latest/tutorial/asar-integrity) recommends pairing embedded integrity validation with ASAR-only app loading. `electron-builder` invokes `afterPack` before signing, so the pinned hook applies the fuse values to the final executable before signing ([v26 hook and fuse guidance](https://www.electron.build/v26/docs/tutorials/adding-electron-fuses/)).

The official [Electron 45 release page](https://releases.electronjs.org/release/v45.0.0) identified 45.0.0 as the latest stable version on the review date. The package output remains unsigned without a publisher certificate. Fuse readback and launch acceptance do not replace independent security review or a tampered-ASAR termination test.
