# Phase 11 execution ledger — Windows compatibility and release engineering

**Status:** PARTIAL; historical Windows 11 x64 package acceptance exists, but the current uncommitted candidate has not been packaged or smoke-tested. Windows 10, physical display/accessibility, and signing evidence remain unavailable.

## Current host resource check - 2026-10-31

- The host reports Windows 11 Pro Education, build 26200. Its three present COM ports are all named "Standard Serial over Bluetooth link"; this is not physical serial-device acceptance.
- No unexpired code-signing certificate with the Code Signing EKU is present in the current-user or local-machine personal stores. Signed release acceptance remains blocked on an authorized publisher identity.
- Microsoft Desktop App Installer is installed for this user at version `1.29.380.0`; a bounded `winget.exe --version` query returned `v1.29.380`. No package was searched, installed, updated, or removed, and no source was listed or changed. Availability alone does not approve a package catalog or establish provider lifecycle acceptance.
- These are host availability observations only; no Phase 11 status is upgraded and no automated test was run.

## Requirement trace

Phase 11 covers F-001, P-32, N-001, N-006–N-010, and N-012. Existing package and compatibility records remain authoritative for their exact candidates and hosts.

## Existing implementation and evidence

- WP-07A/WP-07D/WP-07E/WP-07G/WP-07W provide x64 NSIS and portable packaging, per-artifact CycloneDX files and SHA-256 manifests, Electron fuses/ASAR integrity, Windows 11 offline and 200% Electron device-scale smoke, shell launch, profile persistence, and NSIS uninstall. WP-07W's exact package candidate passed 4/4 package E2Es on Windows 11 Pro x64; Phase 04's later package candidate passed 5/5.
- Local installer and portable artifacts were inspected read-only. Their manifest SHA-256 values match the binaries: installer `6729C957FC3C162596FB74F0B6E0D2361A2059993083E60454DAE055CBC5170D`; portable `574C324B58D623EDEE52D5C547FBA79451C03278EF02A79DDE432645B585ADEA`. Authenticode reports both `NotSigned`.
- These artifacts were last written on 2026-10-30 and predate the current uncommitted source changes. They are not presented as builds of the current candidate. The full `pnpm check` native/renderer build passed, but package smoke was not run against it.

## Open requirements and limits

- The available host is Windows 11 Pro Education x64, build 10.0.26200. Windows 10 x64 remains untested; no ARM64 target is claimed.
- P-02/F-002 first-input-after-resize acceptance remains open: the skipped Windows Git Bash regression has historical 19/25 passes, with six runs losing the initial `p` from `printf`. Inspection of pinned node-pty and Microsoft ConPTY sources confirms that the application's resize reply is not a child-redraw acknowledgement, but does not prove the exact root cause. See [WP-01E resize evidence](WP-01E-local-resize-2026-10-29.md).
- Package tests force Electron device scale and do not establish physical Windows DPI, high contrast, screen-reader, or assistive-technology acceptance.
- No publisher certificate is configured. Artifacts must not be described as signed or releasable; do not acquire a signing identity as part of this work.
- After Phase 07 review remediation, the latest recorded full E2E result was 66 passed, 10 failed, and 7 skipped; typecheck, lint/import boundaries, build, and 647 unit tests passed on that intermediate candidate. Phase 08 release-inventory/signature source changed afterward and has not been verified or packaged. The exact current source must pass applicable package smoke after earlier-phase corrections before artifact acceptance.
- The current packaging source now throws on failed build subprocesses so the existing `finally` cleanup removes its temporary pnpm shim; a Windows x64 failure-path assertion is authored but unrun. This candidate remains unverified.
- OS-wide offline behavior, installer upgrade/uninstall edge cases, crash recovery, Windows 10 hardware, and dependency/notice completeness remain open as recorded in the compatibility matrix and release checklist.

## Next actions

After Phase 07–10 candidate corrections, rebuild NSIS and portable artifacts from that exact candidate, run packaged smoke sequentially, verify their generated SBOM/hash manifests and `NotSigned` status, and update this ledger with exact results. Complete Windows 10 and physical accessibility acceptance only on the corresponding available hardware; signing remains blocked on an external publisher identity.

## Packaged native-dialog helper scoping - 2026-10-31

- Packaged SSH session-log selection and shutdown automation now pass the application browser-process ID to the shared Windows helper. All helper actions require a target process ID and filter dialog discovery/close verification to that process tree.
- This is an unverified test-infrastructure correction; package smoke has not rerun and Phase 11 remains partial.

## Packaged dialog path-entry fallback correction - 2026-10-31

- Shared native picker automation now fails explicitly when direct UI Automation and Win32 setters cannot set a path; it does not activate a picker or send path keystrokes. Packaged SSH-log scenarios use the app process tree filter.
- No package smoke or Windows UI automation ran on this candidate; Phase 11 remains partial.

## Packaged Windows dialog action invocation - 2026-10-31

- Shared native dialog automation now uses a uniquely matched enabled UI Automation button's InvokePattern before its native control fallback and rejects ambiguous labels. It remains scoped to the packaged app process tree.
- No package smoke or E2E has been rerun on this candidate; Phase 11 remains partial.

## Host resource refresh - 2026-10-31

- Read-only inspection reports Windows 11 Pro Education build 26200, only Bluetooth virtual COM3/COM4/COM5 ports, and no unexpired Code Signing EKU certificate in the current-user or local-machine personal stores. No Windows 10, physical serial-device, or signing acceptance became available; no package or device operation was run.

## Workspace-local package shim isolation - 2026-10-31

Static review found the packaging script created a fixed .cache pnpm shim before entering try/finally, which could overwrite a stale or user-owned file and could leave a partial shim if setup failed. The script now verifies workspace-local .tmp is a real contained directory, creates a unique temporary directory and opens pnpm.cmd with exclusive creation, then removes only the file this process created and removes its directory only if empty. The Windows failure-path regression now captures the temporary PATH entry and asserts the shim and directory are removed after an injected package-manager failure. It is authored but unrun; no package or smoke test ran, and Phase 11 remains PARTIAL.
## Incremental package artifact hashing - 2026-10-31

The SBOM generator now hashes installers, the portable executable, app.asar, and packaged notice files through regular-file handles with a fixed 64 KiB buffer instead of allocating each whole file. It checks file identity and the initial size, then rejects detected truncation or growth. The known-vector unit assertion is authored but unrun; no package was rebuilt or smoke-tested, and Phase 11 remains partial.
## Native picker automation source correction - 2026-10-31

Static inspection found the live packaged-picker helper had only the Win32 path setter despite the handoff describing UI Automation with a Win32 fallback. It now tries a unique enabled UIA Edit/ComboBox ValuePattern identified by control ID, verifies the entered path, and falls back to the original verified Win32 change-notification path. This improves test-source alignment only; no packaged native-dialog smoke ran, so Phase 11 remains partial.
## N-012 bounded SBOM license index - 2026-10-31

Static source review found the SBOM path consumed pnpm's raw production-license JSON without the notice pipeline's 512-record and metadata/path validation. The generator now reuses `productionLicensePackages`, which also rejects conflicting license declarations for one package/version. A conflict regression assertion is authored but unrun. No package or SBOM was generated; Phase 11 remains PARTIAL and N-012 remains open for provenance, legal review, and final artifact evidence.
## N-012 pinned registry-signature check - 2026-10-31

`scripts/package-win.mjs` now runs `pnpm --filter @mrt/desktop audit signatures --prod` for shipped runtime dependencies and `pnpm --workspace-root audit signatures --dev` for Electron and the root build toolchain. The second check includes Electron, which is the app runtime in the SBOM but a root `devDependency`. pnpm checks signatures against registry-published keys and lockfile integrity; registries without keys are skipped. A package-script regression asserts both checks run before build and verifies shim cleanup after failure, but it remains unrun. No audit command, package build, or artifact generation ran. Phase 11 remains PARTIAL.

## Native picker selection helper correction - 2026-11-01

Packaged picker flows share `tests/e2e/windows-native-dialog.ps1`. UIA filename entry previously returned before the helper's validated Win32 ComboBoxEx notifications, leaving the common dialog's selected item potentially stale even though the text field showed the path. The helper now continues through the native notification path. No package smoke or UI automation ran; Phase 11 remains PARTIAL and picker acceptance remains open.
## 2026-11-01 common native-picker action fallback

The shared packaged-picker helper now verifies that UI Automation InvokePattern dismissed a common file dialog and uses the validated Win32 button fallback when the dialog remains visible after 750 ms. No packaged smoke or native UI automation ran; Phase 11 remains PARTIAL.
## 2026-11-01 N-012 upstream notice filename coverage

The production notice builder now recognizes standard `THIRD-PARTY-NOTICES` filename variants in addition to `LICENSE` and `NOTICE`, so downstream notices are included even when a package also ships its own license. Added a unit regression fixture/assertion; it remains unrun under the major-phase freeze. No package or notice artifact was generated. N-012 remains PARTIAL.
## 2026-11-01 N-012 standalone notice-output path confinement

Static review found `notices:win` created `.tmp` recursively and wrote the notice bundle without independently validating that `.tmp` was a real workspace-contained directory. The command now validates/creates the directory before querying pnpm or writing output. Added an isolated unit regression for a directory link that points outside the workspace; it remains unrun. The full packaging path retains its existing `.tmp` validation. No notice generation or package operation ran; N-012 remains PARTIAL.
## 2026-11-01 N-012 notice-output file-link guard

The validated workspace `.tmp` directory alone did not prevent a pre-existing `THIRD-PARTY-NOTICES.txt` symlink from redirecting the standalone generator's write. The notice writer now rejects non-regular/symlink output paths and uses exclusive creation when the target is absent. Extended the isolated regression to ensure the outside sentinel remains unchanged; it remains unrun. The fixed-name generated output may be replaced only when it is already a regular file in the validated workspace. N-012 remains PARTIAL.

## 2026-11-01 N-012 release-output directory validation

The package and direct SBOM scripts now call the shared workspace-relative directory validator for `artifacts/windows`, including each parent component, before invoking package tools or writing metadata. The package script also reuses it for `.tmp`, replacing its duplicate containment check. Unit regression coverage includes nested directory creation, unsafe components, and rejection of linked directory, symbolic-link file, and hard-link output paths; it is authored but unrun. No package, SBOM, or artifact was generated. N-012 and Phase 11 remain PARTIAL.

## 2026-11-01 Native picker Win32 control-ID correction (unverified)

Static review found the shared native-picker helper required control ID 1148 for an `Edit`, then used that same ID to identify its combo parent. The installed Windows SDK defines `cmb13` as `0x047c` (1148) and `edt1` as `0x0480` (1152); Microsoft documents these as distinct common-dialog controls ([Open and Save As dialog boxes](https://learn.microsoft.com/en-us/windows/win32/dlgbox/open-and-save-as-dialog-boxes)). The helper now locates a unique visible/enabled filename `Edit` either under the `cmb13` ancestry or as the standard direct `edt1` control, and sends the edit notifications to the actual parent. Ambiguous controls fail closed. This is shared E2E automation used by Phase 08/11 picker scenarios; no dialog or automated check was run, so picker selection remains unverified and the phase gates remain open.

## 2026-11-01 N-012 bounded SBOM package-manifest reads (unverified)

The Windows distribution SBOM generator now reads the root and desktop package manifests through the shared 1 MiB bounded regular-file reader with fatal UTF-8 decoding before JSON parsing, replacing unbounded readFile. Existing release-input helper tests cover size and file-type bounds; no tests, SBOM generation, package operation, or phase checks ran. N-012 and Phase 11 remain PARTIAL.


## 2026-11-01 N-012 bounded-reader symlink regression (unverified)

- Added a release-input unit case asserting that the bounded regular-file reader rejects a symlinked package-manifest path; the case skips only if the current Windows account cannot create the fixture link.
- No automated checks or SBOM generation ran. The regression and the SBOM caller change remain unverified; N-012 and Phase 11 remain PARTIAL.

## 2026-11-01 N-012 pnpm JSON capture bound (unverified)

Static bound review found the two release inventory generators relied on Node's 1 MiB `spawnSync` output default, while accepted package path limits permit a larger valid inventory. Both pnpm JSON captures now allow at most 32 MiB. This is still a fixed output bound. No automated checks, SBOM generation, or package build ran; N-012/Phase 11 remain PARTIAL.

The development CycloneDX inventory command now uses the same 32 MiB bound as the notice and Windows distribution-SBOM commands, so all pnpm license JSON capture has an explicit ceiling above the documented 1 MiB default. This does not upgrade the development inventory to distribution evidence. No inventory generation or automated checks ran; Phase 11 remains PARTIAL.

## 2026-11-01 N-012 development inventory output confinement (unverified)

The development CycloneDX script now rejects output paths outside the repository and writes through the shared workspace-safe output helper. Its existing test fixture now creates temporary files under a validated workspace `.tmp` directory. No inventory was regenerated and no test ran; the development inventory remains separate from distribution evidence, and Phase 11 remains PARTIAL.

Follow-up: the output escape check runs before the pnpm subprocess. An invalid environment override therefore exits before package enumeration as well as before writing. No automated check ran.

The shared validated directory helper now allows an empty component list to denote the workspace root, preserving root-level in-workspace output overrides while still rejecting outside paths. Added an unrun helper assertion; no tests ran.

The package-release test suite now creates its `mkdtemp` fixtures only below the validated workspace `.tmp` directory, including the pnpm shim and pin scenarios. It no longer relies on the process temporary directory. No tests ran; Phase 11 remains unverified.

## 2026-11-01 WP-11E MSIX dependency-path review

The tagged PowerShell 7.6.9 source manifest declares no external `PackageDependency`; Microsoft's documented `Add-AppxPackage -Path` workflow does not require `-DependencyPath` for the reviewed package. The published bundle and Windows deployment remain unverified. See [dependency research](WP-11E-powershell-msix-dependencies-2026-11-01.md). Phase 11 remains PARTIAL.

## 2026-11-01 N-012 distribution SBOM bounded-reader import repair (unverified)

Static source review found the Windows SBOM generator's `readJson` helper called `readBoundedRegularFile` without importing it, which would stop generation before package metadata validation. Added the existing bounded reader to the import list. No SBOM generation, automated check, or package operation ran; N-012 and Phase 11 remain PARTIAL.


## 2026-11-01 N-012 hard-linked release-input rejection

Static review found that the shared bounded reader rejected symlinks and checked opened-file identity but accepted hard-linked package manifests, license files, and lockfiles. The reader now requires a link count of one at lstat and opened-handle checks. Added an unrun hard-link regression under workspace-local temporary storage. No notice/SBOM generation, package operation, or automated check ran; N-012 and Phase 11 remain PARTIAL.

## 2026-11-01 N-012 same-size release-input mutation rejection (unverified)

Static review found that byte-count checks could not detect a same-size rewrite while a package manifest, license, lockfile, or packaged artifact was being read. The bounded reader and streaming hash helper now verify the opened handle's identity, link count, size, mode, and nanosecond modification/change times after reading, using Node's BigInt `Stats` fields ([Node.js v24 file-system docs](https://nodejs.org/download/release/v24.20.0/docs/api/fs.html)). Added concurrent mutation regression source for both helpers. No tests, notices, SBOMs, or package artifacts were generated; N-012 and Phase 11 remain PARTIAL.
## 2026-11-01 atomic generated-output staging (unverified)

The shared writer for production notices, dependency inventory, distribution SBOMs, and SHA-256 manifests now stages each bounded output in a unique exclusive workspace-local sibling, syncs it, rechecks the existing destination identity, and atomically replaces the destination. Failure cleanup is limited to the sibling created by that operation, preserving an existing output if writing or replacement fails. Added package-release assertion source checks successful replacement leaves no temp file. No automated check, SBOM generation, or package build ran; N-012/Phase 11 remain PARTIAL.
