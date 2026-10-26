# Windows compatibility matrix

**Updated:** 2026-10-26  
**Product target:** Windows x64 desktop ([SPEC-001](../SPEC-001-MultiRemoteTerminal.md))

This matrix reports environments that were actually exercised. “Verified on host” means the linked workflow passed on that specific system; it is not a claim of universal compatibility.

| Environment / capability | Status | Evidence and limits |
|---|---|---|
| Windows 11 Pro x64, build `10.0.26200.0` | Verified on the available workstation | Build, typecheck, lint, focused unit/E2E acceptance and package smoke have passed on this host. The full Windows acceptance history is linked from the [implementation plan](../IMPLEMENTATION-PLAN.md). |
| x64 NSIS install, unsigned preview `0.0.0` | Verified on Windows 11 | Install, local PowerShell and Git Bash commands, settings persistence, renderer-offline workflow, 2× Electron device-scale smoke, ASAR tamper termination and uninstall pass. See [WP-07W](../results/WP-07W-package-smoke-revalidation-2026-10-26.md). |
| x64 portable executable, unsigned preview `0.0.0` | Verified on Windows 11 | Profile data is created beside the executable; PowerShell and Git Bash commands pass. The portable profile location is selected by where the user places the executable. See [WP-07W](../results/WP-07W-package-smoke-revalidation-2026-10-26.md). |
| Git for Windows Bash `2.53.0.windows.2`, Bash `5.2.37` | Verified on Windows 11 | Interactive supplementary-character clipboard paste passed three consecutive E2E runs; packaged NSIS and portable launch also execute Bash commands. Git for Windows is an installed runtime and is not bundled. See [WP-01E](../results/WP-01E-bash-supplementary-input-2026-10-26.md). |
| Windows 10 x64, including the documented 1809+ target | Not tested | No Windows 10 host was available for acceptance. Do not claim Windows 10 compatibility until its build, installer/portable lifecycle, terminal and release smoke pass there. |
| Windows ARM64 | Not a release target; not tested | The specification and current package flow target Windows x64. No ARM64 application build or E2E evidence is claimed. |
| Physical OS display scaling, high-contrast mode and screen readers | Not verified | The package smoke forces Electron's 2× device scale; it is not a physical Windows DPI test. The renderer source audit is not a WCAG or screen-reader certification. See [WP-07E](../results/WP-07E-packaged-offline-and-dpi-2026-10-25.md) and [WP-07X](../results/WP-07X-renderer-accessibility-audit-2026-10-26.md). |
| WSL, SSH servers, RDP/VNC viewers, serial hardware and public legacy-protocol servers | Partial / environment-dependent | Loopback fixtures and guarded harnesses cover documented workflows, but real user-managed WSL, OpenSSH agent/server interoperability, RDP/VNC server connection, physical serial devices and broad public-server interoperability remain separate acceptance items. See the linked protocol evidence in [FEATURE-MATRIX](../FEATURE-MATRIX.md). |
| Authenticode-signed distribution | Not available | Current package artifacts are unsigned because no publisher certificate is configured. Follow [WINDOWS-RELEASE](WINDOWS-RELEASE.md); do not label current artifacts as a signed release. |

## Release interpretation

The tested Windows 11 x64 paths support continued development and preview packaging. They do not close the Windows 10, physical DPI, assistive-technology, signing, protocol-interoperability or full M4 gates. Update this matrix only with a linked build or acceptance result for the exact environment tested.
