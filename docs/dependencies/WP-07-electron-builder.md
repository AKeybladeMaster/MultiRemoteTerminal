# WP-07 Windows packaging dependency review

Reviewed 2026-10-25 for the Windows x64 packaging slice. `electron-builder@26.18.0` is pinned exactly as a root development dependency in `package.json` and `pnpm-lock.yaml`; it does not ship as an application runtime dependency.

| Check | Evidence / decision |
|---|---|
| Version and maintenance | Version 26.18.0 was the current stable v26 release inspected on the review date. The project runs package creation under pinned host Node 24.14.1. [Release](https://github.com/electron-userland/electron-builder/releases/tag/v26.18.0) |
| License | MIT, confirmed from the upstream [license](https://github.com/electron-userland/electron-builder/blob/master/LICENSE). |
| Registry metadata | npm metadata reported `engines.node >=14.0.0` and an unpacked package size of 84,535 bytes. This is the package itself, not the installed dependency tree or generated application size. |
| Windows support | Official v26 documentation describes Windows NSIS and portable targets, ASAR packaging, and the two-package workspace layout: [NSIS](https://www.electron.build/v26/docs/nsis/), [ASAR](https://www.electron.build/v26/docs/contents/), [workspace layout](https://www.electron.build/v26/docs/tutorials/two-package-structure/). Both configured targets completed on Windows x64. |
| Electron / native ABI | The selected Electron runtime is pinned at 45.0.0. `npmRebuild: false` avoids a redundant node-gyp rebuild of `node-pty`; the shipped `node-pty@1.1.0` Windows x64 N-API prebuild passed the Windows Electron 45 local-shell lifecycle E2E before packaging. The app's `system_directory.node` is separately built against Electron 45 by `scripts/build.mjs`; packaged native modules and executables are unpacked from ASAR. |
| Security scan | `corepack pnpm audit` reported no known advisories on 2026-10-25. Install output warned about deprecated transitive packages (`boolean@3.2.0`, `glob@7.2.3`, `inflight@1.0.6`, and `rimraf@2.6.3`); they are in the build-tool dependency tree and are not application runtime modules. Recheck before release. |
| Signing | No signing certificate was configured. The tested installer, portable executable and unpacked application report `NotSigned`; this is a preview build only and does not satisfy the signed release-plan gate. |

The tested configuration sets `asar: true`, unpacks native modules and executables, adds the credential-prompt helper as a resource, and builds per-user NSIS plus portable x64 targets. `docs/results/WP-07A-windows-package-2026-10-25.md` records exact artifact sizes and smoke results. Windows 10 compatibility, packaged SSH credential prompting, distribution SBOM, signature verification and public artifact hashes remain release work.
