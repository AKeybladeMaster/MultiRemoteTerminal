# Phase 08 execution ledger — professional features and customization

**Status:** A prior candidate passed automated and packaged smoke checks on 2026-10-31. The current candidate has unverified release-inventory changes and authored 1,000-definition bundle acceptance. Phase 08 remains PARTIAL on provider lifecycle, portable tooling, provenance, and release requirements; review and promotion are not claimed.

## Requirement trace

Phase 08 covers F-009, F-017, F-018, F-024, P-21, P-31, P-33–P-37, P-43, and N-012. Existing implementation and work-package evidence remain indexed in the feature matrix, including WP-03G/H, WP-07B/C/U/V, and WP-11A/C/D.

## Gate evidence

- Pinned Node 24.14.1 and pnpm 12.15.0: `pnpm typecheck`, `pnpm lint` including import boundaries, and all 622 unit tests passed. The Windows x64 native and renderer build passed. The renderer bundle remains 1,043.07 kB minified, above Vite's 500 kB advisory.
- The focused Phase 08 Windows E2E selection passed 6/7: offline help, Unicode startup greeting, explicit PowerShell profile execution, local-shell/provider visibility, settings-template round trip, and local-shell availability enforcement.
- The custom-logo E2E failed during native picker selection because the Windows dialog could not be brought to the foreground. Its cancellation path completed; selection did not. The full `pnpm check` reproduced the same native-dialog focus failure in the local text picker, SSH log Save dialog, encrypted credential bundle picker, and custom-logo picker.
- The full `pnpm check` finished with 64 E2Es passed, 10 failed, and 7 skipped. Its typecheck, lint/boundary, 622-unit, and Windows x64 build stages passed. Four failures are native picker/dialog foreground actions; five depend on clipboard operations that the current Windows session does not complete; the remaining failure was the Phase 07 virtual-list reverse-focus defect, corrected after this gate and still untested.
- After that run, the Windows native-dialog helper was changed to set and verify the file or folder field through UI Automation (with a verified Win32 fallback) and invoke the named native button directly. The previous foreground-focus errors are therefore historical for the earlier helper; current picker behavior is unverified. Earlier clipboard tests also observed an empty system clipboard after `clipboard.writeText`, so they remain blocked pending an interactive Windows rerun.
- Package smoke was not run in this gate. The full check skips package-only tests; packaged credential-dialog acceptance remains open for Phase 11.

## Open requirements and limits

- The available host is Windows 11 Pro Education, build 26200. The old focus-based helper could see the native picker and invoke Cancel but could not activate it for filename entry. The current direct-control helper has not been exercised. The earlier run's clipboard read returned empty immediately after Electron `clipboard.writeText`. No product behavior or acceptance threshold was weakened to bypass these interaction limits.
- F-009/P-37 now have an explicit matrix disposition: the fixed-provider and local-shell visibility/availability controls cover their documented settings subset; they do not satisfy broader tool lifecycle requirements. The six passing E2Es verify settings persistence and enforcement, not arbitrary third-party tool installation. WP-11E still requires Windows package-operation acceptance and provenance/license review.
- F-017 third-party provider provenance/discovery, F-018 wider import/export and signed distribution, executable/package-source portions of F-024, P-31 provider lifecycle, and N-012 supply-chain/license review remain open as stated by the canonical documents. F-024 is now PARTIAL for the previously accepted settings-template transfer of app-managed script text, tool availability and appearance preferences; this does not install tools or verify package-source licensing. P-33 is verified for offline documentation and help in the current feature matrix; additional high-contrast, font-scale, and persisted-theme preferences are architectural follow-up ideas, not open P-33 acceptance criteria.
- No independent specification, standards, or implementation review ran because mandatory verification failed. No Phase 08 promotion is permitted.

## Next actions

Rerun the native picker scenarios with the direct-control helper on an interactive Windows desktop, and recheck clipboard behavior there. Run packaged credential/import-export acceptance, complete the remaining documented work, and request the three independent reviews only after the full gate passes. The matrix disposition does not reduce F-009/P-37 acceptance; broader lifecycle requirements remain open.

## Previous candidate verification evidence - 2026-10-31

- The shared current candidate passed `pnpm check` with pinned Node 24.14.1 / pnpm 12.15.0: typecheck, lint/import boundaries, 644 unit tests, Windows x64 build, and 76 executed Windows Electron E2Es. The E2E set included the native local-file, SSH-log, credential-bundle, and logo picker paths, settings/profile workflows, and clipboard/terminal interactions; the known first-input-after-resize case remains skipped and open.
- `pnpm package:win:smoke` passed 6/6 packaged checks, including the native credential prompt, SBOM/hash manifest, and installer/portable flows. Both generated artifacts remain unsigned.
- These results supersede the earlier statements that the current direct-control native picker helper and clipboard flows were unverified: they passed on this Windows 11 candidate. They do not close F-009/P-37 shell and tool installation/update/removal, F-017 signed third-party provider lifecycle, F-024 portable tool bundles, F-018 signed distribution, or N-012 provenance/license review. Phase 08 remains PARTIAL and unpromoted.

## Latest candidate status - 2026-10-31

- After subsequent Phase 07 review remediation, typecheck, lint/import boundaries, Windows x64 build, and all 647 unit tests passed, but the full Windows E2E stage failed with 66 passed, 10 failed, and 7 skipped. The local native picker still did not close and focused clipboard flows returned empty text on this host. The earlier 76-E2E/6-package-smoke result above belongs to a prior candidate and does not override this later result.
- The current candidate was then changed again for Phase 08 release inventory/signature enforcement. No automated verification or package smoke has run on these exact files; this candidate remains unverified and Phase 08 is not frozen.

## 2026-10-31 implementation update

- F-024 is documented as PARTIAL because accepted settings-template import/export carries the app-managed PowerShell script, fixed provider/shell availability, and appearance preferences without executing the script on import. Executable tool bundles, package sources and their trust/licensing remain open.
- The Windows distribution SBOM generator now requires non-empty Electron and Chromium license notice files from the packaged output, records their SHA-256 hashes in each per-artifact SBOM, and includes them in the checksum manifest. The package-smoke test source checks the notices and hashes. This is N-012 release-integrity implementation only; full legal/provenance review remains open.
- Signed-release mode now requires an expected SHA-1 certificate thumbprint and rejects artifacts whose valid Authenticode signer differs from that identity. This constrains the existing signing path; an authorized publisher certificate and signed artifact acceptance are still unavailable.
- The release flag accepts only unset/`0` or exact `1`; malformed values fail instead of silently selecting unsigned packaging. Assertions are authored but unrun.
- Windows packaging now prepares a bounded notice bundle from production package license/notice files, embeds it as an application resource, and hashes it in each artifact SBOM and checksum manifest. Package-smoke source checks both installer and portable resource paths. This is implementation only; it does not complete legal review or provenance acceptance.
- The notice builder now bounds dependency metadata/path lengths, checks every resolved package directory's installed `package.json` name/version against the pnpm license inventory, and rejects Unicode control/format characters before including license text; mismatch, oversize, and control/format regression assertions are authored but unrun. This prevents unbounded release-input metadata, misattribution, and display-direction controls but does not establish license or source provenance.
- The current package candidate has not regenerated the notice bundle or artifacts after this source change; no test, build, package, or acceptance result is claimed.
- N-012 filename classification now rejects control/format characters even when they interrupt a license-like filename before the whitelist regex (for example, `LICENSE<U+202E>.txt`). Its existing regression fixture now exercises the evasive name; automated validation and notice regeneration remain pending.
- Unsigned release mode now rejects inherited `CSC_LINK`/`WIN_CSC_LINK`, and the SBOM gate requires both named artifacts to report `NotSigned`; signed mode retains the exact signer-thumbprint gate. Authored helper, Windows-script and package-smoke assertions remain unrun.
- Packaging subprocess failures now throw instead of calling `process.exit`, allowing the existing `finally` block to remove the temporary workspace-local pnpm shim. A Windows x64 regression test proves the failing CLI was invoked and the shim is absent afterward; this source/test addition is unrun and does not change Phase 08 acceptance.
- A Windows E2E source now covers a 1,000-definition saved-folder export, fresh-profile import, credential-field absence, and restart persistence. It uses the established native-dialog adapter hook and has not been run; F-018 remains PARTIAL.
- The current host check found no unexpired Code Signing EKU certificate in the current-user or local-machine personal stores. The identity pin is source-level enforcement only; no signed artifact can be accepted on this host as inspected.
- This implementation update has not been typechecked, linted, built, unit-tested, E2E-tested or package-smoke-tested. Phase 08 remains unfrozen; no review, commit, push or promotion occurred.

## Native dialog automation target scoping - 2026-10-31

- Local text picker, custom-logo picker, and encrypted SSH bundle scenarios now pass the Electron app process ID into the Windows UI Automation helper. Dialog discovery and close verification are limited to that process tree, preventing interactions with unrelated windows sharing the same title.
- The helper change and authored picker flows are unverified. No automated check or package smoke ran, and the Phase 08 gate remains open.

## Picker automation foreground-fallback correction - 2026-10-31

- The local text, custom-logo, and credential-bundle path helper now stops with an explicit error when UI Automation and the verified Win32 setter cannot set the selected path. It no longer activates the file dialog or sends picker-path keystrokes. SSH credential-prompt interaction remains separate.
- This source correction and process-tree filtering have not been exercised in a new Windows run; Phase 08 remains unverified.

## Native picker action invocation - 2026-10-31

- File picker actions now use the accessible UI Automation InvokePattern for one uniquely matched enabled button, with a verified native control fallback; ambiguous actions fail closed. Path entry requires direct value setting and no longer falls back to focus/keystrokes.
- This remains authored Windows test automation; the current candidate has not been rerun or accepted.

## WP-11E authored implementation candidate - 2026-10-31

- Added a static PowerShell tool command builder for exact package ID `Microsoft.PowerShell` and a controller path that only writes the generated action into a running local PowerShell session. Typed IPC accepts only install/update/remove. The preload and main-process one-shot gesture token binds the sender, terminal session, and action; removal requires a second confirmation click.
- The candidate checks the exported WinGet source metadata against the documented default record, limits install/update to x64, user scope and MSIX, and leaves package/source agreements and installer interaction visible. It does not verify the package signer before installation. No source changes, arbitrary package IDs, silent mode, agreement bypass, installer overrides, force, or reboot flags are used.
- Authored unit coverage covers command constraints, closed action validation, session routing, contract rejection, broker authorization, and gesture binding. None ran; no package operation ran. The code does not yet perform a publisher allowlist or installed-family check, and package/license/provenance and real Windows interoperability acceptance remain open.
- This source work reopened Phase 08 after the earlier candidate gate record. The current implementation is in progress and unfrozen; no acceptance, review, commit, push, or promotion is claimed.

## WP-11E dedicated-terminal safety correction - 2026-10-31

- Package actions now require a newly opened, app-managed PowerShell tab. They no longer write into an arbitrary selected terminal, which could append to user-entered input. The Settings dialog closes only after command submission succeeds, leaving WinGet output and interactive prompts visible in the fresh tab.
- A Windows E2E case covers isolated-tab creation and action enablement without performing a package operation. It is authored but unrun. The code, test, and documentation remain unverified; package publisher/license/provenance, installed-family validation, and interactive install/update/remove acceptance remain open. Phase 08 is unfrozen and unpromoted.
- The fixed action candidate now checks the installed x64 Microsoft PowerShell MSIX family and publisher after successful WinGet install/update. Removal uses `Get-AppxPackage` plus `Remove-AppxPackage -Confirm` for only that current-user family because WinGet uninstall has no installer-type selector. The builder unit assertions were updated but remain unrun; package operations and certificate/provenance review remain unverified.
- Primary-source follow-up found the current PowerShell 7.6.9 manifest's MSIX rows omit `Scope`; the authored `--scope user` selector therefore still needs a Windows operation acceptance run. The source metadata check is not pre-install signer verification.
- Install/update source validation now also requires exactly the documented `Trusted` and `StoreOrigin` levels and `Explicit: false`; unrecognized extra values fail closed. Assertions are authored, not executed.


## WP-11E scope and elevation disclosure - 2026-10-31

- Settings now distinguishes the requested `--scope user` filter from verified behavior: the reviewed MSIX manifest omits `Scope`, so users are told to cancel any elevation request. The ADR, implementation plan, and feature matrix use the same wording; the Windows E2E asserts the disclosure. No test or package operation ran, and WP-11E remains PARTIAL.

## WP-11E pre-install MSIX verification candidate - 2026-10-31

- Replaced direct WinGet install/upgrade with exact-ID/source/x64/MSIX `winget download`, then checks for one MSIX bundle, `Get-AuthenticodeSignature` status `Valid`, exact Microsoft signer subject, exact `Microsoft.PowerShell` bundle identity, and an x64 application payload before `Add-AppxPackage -Confirm` deploys that same read-locked file for the current user. A unique staging directory is removed in `finally`; installer/source agreement bypasses are not used. The reviewed MSIX manifest's missing `Scope` field no longer controls deployment scope because WinGet only downloads and `Add-AppxPackage` targets the current user.
- Updated the command-builder assertions and Settings E2E disclosure source. The version guard rejects releases older than the reviewed `7.6.9.0` floor and prevents downgrade of an installed package. It does not verify that the source-selected release is Microsoft's newest, so a compromised source could replay an older authentic release at or above the floor. No automated checks or package operations ran. The trust check does not pin a leaf certificate thumbprint; publisher/license/provenance review and real Windows install/update/remove acceptance remain open. P-21/P-37/F-009/F-017/N-012 are not upgraded; Phase 08 remains unfrozen and unpromoted.

## N-012 notice filename control filtering - 2026-10-31

- The production notice builder now rejects license filenames containing C0/C1 control or Unicode format characters before including them in the generated bundle. Added an authored U+202E filename regression assertion in `tests/unit/package-release.test.ts`. No automated check or packaging ran; legal/provenance review and Phase 08 remain open.

## N-012 nested production notices - 2026-10-31

- WP-07AB source review found nested license files for `cpu-features@0.0.10` and `node-pty@1.1.0` were omitted by the top-level-only notice scan. The unverified candidate includes those exact paths and rejects package-version changes, missing files, symlinks/non-regular files, and resolved paths outside the package. It also adds each runtime component's exact pnpm-lockfile SHA-512 integrity and fails closed when an exact package/version record is missing. Unit and package-smoke fixtures are authored but unrun. The digest records locked package integrity, not independent verification of installed files or final artifacts; clean frozen install, package inspection, legal compatibility and Phase 08 acceptance remain open.

## N-012 duplicate lock-key rejection - 2026-10-31

- The production SBOM lockfile parser now rejects repeated exact package mapping keys, including duplicates that previously repeated the same integrity digest. Added a focused regression assertion. No checks or package generation ran; Phase 08 remains unfrozen and N-012 remains PARTIAL.

## Phase 08 E2E contract alignment � 2026-10-31

- Static comparison against the current preload bridge and Settings warning found two stale E2E expectations: the bridge inventory omits the implemented managePowerShellTool method, and the PowerShell warning assertion uses wording superseded by the current source. Updating only those expected values; acceptance assertions remain explicit, and no tests are being run during phase implementation.

- Updated the bridge inventory expectation to include managePowerShellTool and matched the test warning assertion to the current explicit source-recency limitation. These E2Es remain authored but unrun until the full major-phase implementation freeze.

## N-012 bounded installed package-manifest reads - 2026-10-31

- Static review found that the notice builder checked the real package directory but read its package.json without a size/type/containment guard. It now accepts only a bounded regular file whose resolved path stays inside that package before parsing name/version. An oversized-manifest unit regression was authored. No tests or package generation ran; installed-content provenance, legal review and Phase 08 acceptance remain open.
## Phase 08 WP-11E source limitation comment - 2026-10-31

- Added a code-local `shortcut:` comment at the fixed PowerShell release floor to preserve the documented source replay limitation and the condition for revisiting it. This is documentation-only; command behavior, feature status, and acceptance evidence are unchanged. No automated checks or package operations ran.
## Phase 08 WP-11E command-generation placement - 2026-10-31

- Moved the fixed WinGet/AppX command generator from `packages/domain` into `packages/application`; the domain now retains only the closed action type and validator, and the local-terminal use case calls the application module. Updated the builder unit-test import. This keeps Windows command syntax out of domain logic while preserving the existing command and consent flow. No tests, typecheck, or build ran; Phase 08 remains implementation-in-progress.

## WP-11E latest-stable version preflight - 2026-10-31

- Install/update now query GitHub's fixed public latest-stable PowerShell release endpoint with redirects disabled, a 10-second deadline, and a 64 KiB response limit. The script rejects drafts, prereleases, malformed tags and API failures, passes the exact mapped version to `winget download`, and compares the downloaded signed bundle version against that value and the existing `7.6.9.0` floor. This prevents WinGet from choosing a different version than the release result and addresses stale-source replay as of preflight time.
- Added bounded-response/version assertions to the command-builder unit test and updated the Settings warning and Windows E2E disclosure assertion. Updated ADR-0064, SECURITY.md, IMPLEMENTATION-PLAN.md, FEATURE-MATRIX.md and WP-11E research. Source and tests remain unverified; no package operation or automated test ran. GitHub/TLS and Windows publisher trust, package/license/provenance review and interactive Windows package acceptance remain open. Phase 08 remains implementation-in-progress, PARTIAL and unpromoted.

## WP-11E signed-bundle parser bound - 2026-10-31

- The install/update command now opens the downloaded MSIX bundle read-only with write/delete sharing denied and checks the locked stream length is nonzero and no greater than 1 GiB before signature or archive parsing. The official PowerShell v7.6.9 release page lists its MSIX bundle at 336 MB, so the bound leaves substantial headroom. It is post-download and does not cap WinGet's temporary network/disk use during transfer.
- Added an authored command-builder assertion and documented the bound and its limitation in ADR-0064, SECURITY.md, IMPLEMENTATION-PLAN.md, FEATURE-MATRIX.md, and WP-11E research. No test, build, or package operation ran; Phase 08 remains unverified and unpromoted.
## WP-11E signature verifier research - 2026-10-31

- Pinned PowerShell 7.6.9 source confirms `Get-AuthenticodeSignature` file paths enter `SignatureHelper`, which uses `WinVerifyTrust` with `WINTRUST_ACTION_GENERIC_VERIFY_V2`. Microsoft documents that action for Windows app-package signature validation and MSIX docs say the bundle signature covers its contained packages. The candidate's signature check is therefore supported by source-backed inference; the cmdlet reference does not explicitly list `.msixbundle` extensions. This does not replace a real Windows bundle/package-operation acceptance run. See [WP-11E signature research](WP-11E-msix-signature-verification-2026-10-31.md).
- No automated checks or package operations ran. Phase 08 remains in implementation and the current candidate remains unverified.

## N-012 bounded SBOM package metadata read - 2026-10-31

- The SBOM generator now uses the notice pipeline's shared 1 MiB-capped regular-manifest reader, requires each package realpath to remain inside workspace `node_modules`, verifies package name/version, and omits unneeded dependency descriptions. Added unrun unit assertions for matching identity and out-of-root rejection; no notice artifact or package output was generated. Phase 08 and N-012 remain unverified.

## N-012 distribution-reference disclosure guard - 2026-10-31

- SBOM component URLs are now limited to HTTPS references on `registry.npmjs.org` without userinfo, nonstandard ports, queries, or fragments. Custom/private registry locations are omitted; no credentials or signed-query tokens are copied into public release metadata. Unit coverage is authored but unrun; Phase 08 remains unverified.

- The SBOM source guard also caps reference length at 2 KiB and applies the same confined reader to the pinned Electron package manifest. No outputs were generated and no checks ran; current phase evidence remains source-only.

## N-012 bounded notice-file reads - 2026-10-31

- Static review found that the notice builder checked the 1 MiB license-file limit only after `readFile` had allocated the full file. It now validates the resolved regular file and reads in bounded chunks through an open handle, stopping after the first byte beyond the limit. Added an oversized-license regression assertion. No automated checks or notice/package generation ran; N-012 and Phase 08 remain partial and unverified.
- Follow-up review preserves underlying filesystem I/O errors while adding package/file context to policy-validation failures. The master traceability row now reflects the bounded notice reads and current unverified supply-chain changes.

## WP-11E bounded WinGet staging traversal - 2026-10-31

- Static review found recursive package-artifact discovery materialized every `Get-ChildItem` result before enforcing the expected single bundle. The command now streams traversal, stops at 4,096 filesystem entries, and retains the exact-one-MSIX-bundle check. Authored a command-builder assertion and updated ADR-0064 and the implementation plan. No test or package operation ran; WP-11E and Phase 08 remain partial and unverified.

## WP-11E removal postcondition - 2026-10-31

- Static review found that the fixed PowerShell MSIX removal action requested confirmation but could treat a nonterminating cmdlet error or a declined confirmation as if the package were removed. `Remove-AppxPackage` now uses `-ErrorAction Stop`, then re-queries only the already-validated package family, publisher, and x64 architecture and throws unless it is absent.
- Added an authored command-builder assertion for terminating removal errors and the postcondition. Updated ADR-0064 and the SPEC-001, feature matrix, and implementation-plan descriptions. No tests, typecheck, build, package operation, or Windows acceptance ran; Phase 08 remains implementation-in-progress and P-37 remains PARTIAL.
- Follow-up static review also marks the post-removal Get-AppxPackage verification query -ErrorAction Stop, so an unavailable query cannot be mistaken for successful removal. Its assertion is authored and remains unrun.

## N-012 manifest read allocation bound - 2026-10-31

- Follow-up static review found that the installed package manifest reader checked `package.json` size before using `readFile`, leaving a check/read allocation race. It now reads through the existing handle-based reader capped at 1 MiB plus one detection byte before parsing. Added direct oversized-manifest regression coverage; it remains unrun. No tests, SBOM generation, or package operation ran; Phase 08 remains unverified and N-012 remains PARTIAL.
## WP-11E terminating package-registration queries - 2026-10-31

- Static review found install/update treated a nonterminating `Get-AppxPackage` failure as an empty registration list and could proceed to deploy without verifying current state. All package-registration queries now use `-ErrorAction Stop`; added command-builder assertions for both install/update and removal. Tests and Windows package operations remain unrun; WP-11E and Phase 08 remain PARTIAL/unverified.
## N-012 bounded package-directory scan - 2026-10-31

- Static release-source review found that `readdir` materialized every installed package's top-level directory before filtering notice files. The generator now streams directory entries, stops at 4,096 per package, and rejects symbolic links named as license/notice files. Added an unrun 4,097-entry regression fixture. No tests, notice generation, or package operation ran; N-012 and Phase 08 remain PARTIAL/unverified.
- Added symlinked-license regression coverage. It is authored to skip only when Windows denies this account permission to create the fixture; no tests were run.
## N-012 bounded pnpm lockfile read - 2026-10-31

Static review found the SBOM generator passed an unbounded readFile result to a parser that only checked the 8 MiB limit after allocation. The shared release-input reader now checks a regular file, verifies the opened file identity against the initial lstat, and reads at most the configured limit plus one detection byte. SBOM generation now obtains pnpm-lock.yaml through this bounded UTF-8 reader before parsing. Unit assertions cover the exact small-file bound, invalid UTF-8, and an 8 MiB plus one sparse lockfile; they are authored but unrun under the Phase 08 implementation freeze. No package, SBOM, or artifact was generated; installed package contents and legal/provenance review remain open, and Phase 08 remains unverified.
## Phase 11 package shim isolation - 2026-10-31

The Windows package helper previously overwrote a fixed .cache pnpm.cmd before entering its cleanup finally block. It now creates a unique directory under workspace-local .tmp, checks that .tmp is a real directory contained by the workspace, and exclusively creates the shim. Cleanup removes the shim only after this process created it, then removes only the empty unique directory. The existing failure-path unit case now observes the generated PATH entry and asserts its shim and directory are gone. The test is authored but unrun; no package was built, and Phase 11 remains PARTIAL.
## N-012 streaming distribution hashes - 2026-10-31

The SBOM path no longer reads complete installers, portable executables, app.asar, or packaged notice files into memory for hashing. A regular-file handle, opened-file identity check, fixed 64 KiB buffer, and expected-size check are used; growth or truncation observed during hashing fails closed. A known SHA-256 unit assertion is authored but unrun. No artifacts were regenerated or inspected; N-012 and Phase 08 remain partial/unverified.
## Native picker path entry helper alignment - 2026-10-31

Static review found the live Windows helper did not match the recorded UI Automation plus Win32 fallback behavior; path entry was Win32-only. It now selects a unique enabled UIA Edit/ComboBox control with the known common-dialog automation ID, uses ValuePattern only when writable, verifies the assigned path, and otherwise uses the existing Win32 setter with notification and read-back checks. Existing E2Es exercise selection and cancellation across picker types, but none ran on this edit; native dialog and clipboard acceptance remain unresolved and Phase 08 is unverified.
## WP-11E explicit GitHub REST API version - 2026-10-31

The fixed PowerShell release-metadata request now sends `X-GitHub-Api-Version: 2026-03-10` instead of relying on GitHub's default version. GitHub's current REST documentation recommends an explicit version and lists `2026-03-10`; the request remains the same public `GET /repos/PowerShell/PowerShell/releases/latest`. A command-builder assertion was added but not run. No package operation or live API request occurred. [GitHub API versions](https://docs.github.com/en/rest/about-the-rest-api/api-versions) and [latest release endpoint](https://docs.github.com/en/rest/releases/releases#get-the-latest-release).
## WP-11E release asset digest binding - 2026-10-31

- The bounded GitHub release response must now include exactly one uploaded version-matched .msixbundle asset with a 64-hex SHA-256 digest and a size between 1 byte and 1 GiB. The locked WinGet bundle must match both its declared byte length and SHA-256 before the existing signature and package identity checks.
- Added command-builder assertions and updated the Settings disclosure, E2E disclosure assertion, ADR-0064, the implementation plan, security notes, feature matrix, and SPEC-001. This binds the WinGet result to the release response but shares GitHub metadata/TLS trust and does not cap transfer-time disk use.
- No tests, typecheck, build, API request, package operation, or Windows acceptance ran. WP-11E and Phase 08 remain unverified/PARTIAL; no promotion occurred.
## WP-11E direct bounded release download - 2026-10-31

The candidate now streams the exact version-matched PowerShell MSIX asset from its GitHub release URL. It enforces the declared size before each file write (maximum 1 GiB), exact final byte count and SHA-256, a 60-minute timeout, at most three HTTPS redirects to GitHub hosts, unique staging, and cleanup; it retains the Microsoft signer, bundle identity/version, current-user deployment and confirmation checks. ADR-0065 supersedes the prior WinGet retrieval decision. Unit, local-terminal and UI E2E assertions plus Settings disclosure were updated, but no checks or package/network operations ran. Phase 08 remains PARTIAL and unverified; API/TLS metadata and Windows publisher trust are shared dependencies, and provenance/license review remains open.
## WP-11E Windows PowerShell compatibility follow-up - 2026-10-31

The dedicated app terminal resolves to Windows PowerShell 5.1. The command now explicitly loads System.Net.Http and formats the streaming SHA-256 with .NET Framework-compatible BitConverter. Network failures are reported with fixed text so signed GitHub CDN query URLs are not echoed to terminal output/session logs. Download progress is displayed every 16 MiB. These static corrections and assertions are unverified; no test or runtime PowerShell parser check ran.
## WP-11E staging cleanup scope - 2026-10-31

Static review found cleanup recursively removed a GUID staging directory even though `Directory.CreateDirectory` can succeed for a path another same-user process created after the prior existence check. Changed the downloader to write one uniquely named `.msixbundle` directly under app-local `package-staging`, reject a reparse-point staging directory, set an ownership flag only after exclusive `FileMode.CreateNew` succeeds, and remove only that bundle file. Updated command-builder assertions, ADR-0065, SECURITY, IMPLEMENTATION-PLAN, and WP-11E research; older candidate notes remain historical. No tests, typecheck, lint, build, PowerShell execution, network download, or package operation ran. Phase 08 remains unfrozen/PARTIAL; no staging or Git write action occurred.
## WP-11E deployment version postcondition - 2026-10-31

Static review found a user could decline `Add-AppxPackage -Confirm` during update, leaving the older package installed while the identity-only final verification succeeded. The fixed command now requires the verified package version to reach the selected release; an already installed newer version still passes. Added an unrun command-builder assertion and updated ADR-0065, SECURITY, IMPLEMENTATION-PLAN, and WP-11E research. No automated tests, PowerShell execution, release download, or package operation ran. Phase 08 remains unfrozen/PARTIAL and no Git write action occurred.
## WP-11E bundle-manifest stream disposal - 2026-10-31

- Static resource-lifecycle review found the bounded XML reader was given an inline ZIP-entry stream, while `XmlReaderSettings.CloseInput` was not enabled; the entry stream therefore had no explicit cleanup path.
- The generated PowerShell now retains the manifest stream and disposes it in an outer `finally`, including if reader construction or parsing fails. Added an unrun command-builder assertion. No runtime parser check or package operation ran; Phase 08 remains unfrozen/PARTIAL.
## WP-11E redirect port restriction - 2026-10-31

Static review found the downloader's HTTPS GitHub-host allowlist accepted nonstandard ports. Redirect and final-response checks now require the standard HTTPS port 443 in addition to host and scheme checks. Added command-builder assertions and updated ADR-0065, SECURITY, IMPLEMENTATION-PLAN, and WP-11E research. No test, typecheck, lint, build, network request, or package operation ran. Phase 08 remains unfrozen/PARTIAL.
## WP-07D bounded SBOM license index - 2026-10-31

Static source review found the SBOM path consumed pnpm's raw production-license JSON separately from the notice generator, bypassing the existing 512-record and metadata/path validation. It now builds the SBOM license index through `productionLicensePackages`, which also rejects conflicting license declarations for the same package/version. Added a regression assertion for conflicting declarations; all related tests and package generation remain unrun. This does not establish upstream source provenance or legal compatibility; N-012 remains partial.
## N-012 production registry-signature gate - 2026-10-31

The Windows package helper now invokes pinned `pnpm audit signatures --prod` before building. pnpm checks production package registry signatures against published keys and lockfile integrity; registries without keys are skipped. The package-script failure-path test asserts this is the first command and checks existing shim cleanup, but remains unrun. This does not establish installed tree/archive identity, legal compatibility, or source provenance; Phase 08 remains unfrozen and N-012 remains partial.
## N-012 signature-audit workspace scope correction - 2026-11-01

The first authored command targeted the workspace root, which has no production dependencies. It is corrected to `pnpm --filter @mrt/desktop audit signatures --prod`; pnpm's official filtering documentation and 12.7 release notes confirm the audit honors workspace filters. The Windows regression now asserts this exact scoped invocation. No audit, test, build, or package command ran; the previous unfiltered description above is superseded.
## N-012 signature audits include Electron - 2026-11-01

The desktop production audit alone omitted Electron because the SBOM lists it as the packaged runtime while the repository pins it in root `devDependencies`. Packaging now runs both `pnpm --filter @mrt/desktop audit signatures --prod` and `pnpm --workspace-root audit signatures --dev` before build. The second includes Electron and root build dependencies. The Windows package regression asserts both commands precede build. No audit, test, or package command ran; these records supersede the earlier single-audit scope note. N-012 remains partial pending final source/archive and legal review.
## Native picker UIA notification bypass correction - 2026-11-01

The existing Windows E2E failure history showed the native filename edit retained the selected path and the selection action was invoked, yet the dialog stayed open. Static review found `Set-DialogPath` returned immediately when UIA `ValuePattern.SetValue` matched the visible value, skipping the native ComboBoxEx EN/CBN notification sequence already present in the helper. Removed the early return; the path now continues through validated Win32 assignment and notifications. No automated check or UI interaction ran; Phase 08 remains unfrozen and native selection remains unverified.
## 2026-11-01 N-012 bounded-reader stability check

- The shared bounded regular-file reader now rejects truncated or grown input when the total bytes read do not match the opened file size. It is used for installed package manifests, license/notice content, and pnpm-lock.yaml; the existing unit source covers the reader's exact bounded content behavior.
- No automated validation, notice generation, SBOM generation, or package build ran. N-012 and Phase 08 remain PARTIAL/unverified.
## 2026-11-01 common native-picker action fallback

The shared native Windows picker helper now verifies that UI Automation InvokePattern closed a common file dialog before returning. If the dialog remains visible after a bounded 750 ms wait, it proceeds to the existing validated Win32 action fallback. This applies to local-editor and packaged picker acceptance helpers only; production behavior is unchanged. The related E2Es were not run under the whole-phase testing freeze, and Phase 08 remains unverified.
## 2026-11-01 WP-11E generated-command parser acceptance

Added Windows-only coverage that passes generated install, update, and remove command text to Windows PowerShell 5.1's language parser without executing it. The feature matrix and implementation plan record the acceptance condition. The check is authored but unrun; no package operation, PowerShell command, or phase verification ran. Phase 08 remains PARTIAL and unfrozen.
## 2026-11-01 WP-11F TigerVNC lifecycle feasibility

Official-source research found no verified publisher signature or independent artifact-integrity root for the currently listed Windows viewer, and the local retrieval response was HTML rather than a PE artifact. No binary was executed and no provider code changed. Retain the existing user-installed launcher; F-017 remains PARTIAL. See [WP-11F research](WP-11F-tigervnc-provider-lifecycle-research-2026-11-01.md). No tests or package operations ran. The ignored workspace scratch contains one 119133-byte HTML response named vncviewer64-1.16.2.exe; it was not executed and is excluded from Git.
## 2026-11-01 WP-11G RealVNC lifecycle feasibility

The official checksum and security-update pages identify RealVNC Viewer 8.5.3 and its Windows MSI SHA-256, but the local request to the official download page returned HTTP 403. Account sign-in and paid-plan requirements for third-party VNC connections are documented by the vendor; signer, exact artifact URL, install path/ownership, and licensing fit remain open. No installer or product code was added; F-017 remains PARTIAL. See [WP-11G research](WP-11G-realvnc-provider-lifecycle-research-2026-11-01.md). A subagent ran git diff --check on its research report and it passed; this was not a phase gate. No automated tests or package operations ran.
## 2026-11-01 WP-11H TightVNC lifecycle feasibility

Official-source review found plausible protocol compatibility but did not establish a current MSI integrity root/signer, Windows viewer invocation and safe install/removal semantics, or redistribution rights. No artifact or provider operation was performed. Retain user-installed TigerVNC and keep F-017/P-08 PARTIAL; details and next evidence are in [WP-11H research](WP-11H-tightvnc-provider-lifecycle-research-2026-11-01.md). No automated checks ran; the phase remains unfrozen.
## 2026-11-01 Native picker Win32 control-ID correction (unverified)

Static review found the shared native-picker helper required control ID 1148 for an `Edit`, then used that same ID to identify its combo parent. The installed Windows SDK defines `cmb13` as `0x047c` (1148) and `edt1` as `0x0480` (1152); Microsoft documents these as distinct common-dialog controls ([Open and Save As dialog boxes](https://learn.microsoft.com/en-us/windows/win32/dlgbox/open-and-save-as-dialog-boxes)). The helper now locates a unique visible/enabled filename `Edit` either under the `cmb13` ancestry or as the standard direct `edt1` control, and sends the edit notifications to the actual parent. Ambiguous controls fail closed. This is shared E2E automation used by Phase 08/11 picker scenarios; no dialog or automated check was run, so picker selection remains unverified and the phase gates remain open.
## 2026-11-01 WP-11E package-staging parent-link guard

- Static review found the generated installer checked only the final package-staging directory, so a reparse-point LOCALAPPDATA or MultiRemoteTerminal parent could redirect the exclusive download outside the intended app-local location. The generated PowerShell now rejects reparse-point LOCALAPPDATA and app-data parents before creating the staging directory; the existing final-directory check remains.
- Added command-builder regression assertions and updated ADR-0065, SECURITY, and the WP-11E implementation-plan entry. No parser test, package operation, or other automated check ran; WP-11E and Phase 08 remain PARTIAL/unverified.


## 2026-11-01 WP-03G settings-template secret disclosure warning

Workbench settings now identifies exported settings templates as plain JSON and warns that saved PowerShell script text may contain secrets, which should be removed before sharing; the warning also states import never runs the script, and successful export repeats the secret-removal reminder. Added cross-profile E2E assertions scoped to the settings-template section for the warning and to the export status for the repeated reminder and aligned the user guide, security documentation, specification, and feature matrix. No automated checks ran. P-43/F-024 acceptance remains PARTIAL pending the Phase 08 gate. No review or Git promotion occurred.


## 2026-11-01 WP-11E official API/package metadata review

Current [GitHub REST API version documentation](https://docs.github.com/en/rest/about-the-rest-api/api-versions) lists the command builder's 2026-03-10 API version as supported. The official [PowerShell release page](https://github.com/PowerShell/PowerShell/releases) currently publishes the expected PowerShell-7.6.9.msixbundle naming, and Microsoft's [Windows installation guide](https://github.com/MicrosoftDocs/PowerShell-Docs/blob/main/reference/docs-conceptual/install/install-powershell-on-windows.md) documents manual MSIX bundle installation with Add-AppxPackage. This confirms metadata and documented invocation shape only; no package operation or automated check ran, and WP-11E/Phase 08 remain PARTIAL.

## 2026-11-01 WP-11E settings E2E disclosure assertion alignment (unverified)

Manual comparison found the PowerShell tool-management E2E still expected the previous generic signature wording, while SettingsDialog now states the concrete MSIX signature and package-identity checks before current-user Add-AppxPackage deployment. Updated the assertion to match the current disclosure. No tests or other automated checks ran; Phase 08 remains PARTIAL and unfrozen.

## 2026-11-01 WP-11E MSIX dependency-path review

Official PowerShell 7.6.9 source and Microsoft's install guide indicate the reviewed MSIX manifest has no external `PackageDependency`, and `Add-AppxPackage -Path` is the documented bundle install route without `-DependencyPath`. The published bundle was not downloaded or inspected, and no Windows package operation or automated check ran. WP-11E and Phase 08 remain PARTIAL; see [dependency research](WP-11E-powershell-msix-dependencies-2026-11-01.md).
## 2026-11-01 WP-11E management-session authorization (unverified)

- The typed terminal.open request can mark only a new PowerShell session for tool management. The main-process controller stores that eligibility by session ID, removes it on process exit/close, and consumes it before writing one fixed install/update/remove command; ordinary PowerShell sessions and repeated actions are rejected. The typed contract, preload bridge, broker, and Settings open call carry the purpose marker.
- Added contract, bridge, broker, and controller regression coverage, including wrong-shell and second-action rejection. No automated checks, PowerShell parser, package operation, or phase gate ran. WP-11E/P-21/P-37 and Phase 08 remain PARTIAL/unverified.

## 2026-11-01 WP-11E download timeout alignment (unverified)

Static review found the download cancellation token was set to 60 minutes while HttpClient retained its documented 100-second default, which would cause earlier aborts. The generated client now sets Timeout.InfiniteTimeSpan before its first request, leaving the existing cancellation token as the operation bound. Added an unrun command assertion and documented the behavior in ADR-0065, SECURITY, and IMPLEMENTATION-PLAN; ADR-0065 links [Microsoft's HttpClient.Timeout documentation](https://learn.microsoft.com/dotnet/api/system.net.http.httpclient.timeout). No PowerShell parser, package operation, automated check, or Phase 08 gate ran; WP-11E and Phase 08 remain PARTIAL.

## 2026-11-01 WP-11E management-session input invalidation (unverified)

Static review found that the fresh-session lifecycle eligibility survived ordinary terminal input, allowing the fixed command to be appended after manual prompt edits. The controller now clears the eligibility on any write or paste; the management action consumes it before its own write. Added an unrun controller regression, and clarified the behavior in ADR-0065, SPEC-001, SECURITY, FEATURE-MATRIX, and IMPLEMENTATION-PLAN. No automated checks, PowerShell parser, or package operation ran; WP-11E and Phase 08 remain PARTIAL.

## 2026-11-01 WP-11E strict release-metadata encoding (unverified)

The bounded GitHub release-metadata response now uses a strict UTF-8 decoder before JSON parsing, so malformed byte sequences fail closed instead of being replaced. Added command-builder assertions and updated ADR-0065, SECURITY, and IMPLEMENTATION-PLAN. No automated checks, PowerShell parser, network request, or package operation ran; WP-11E and Phase 08 remain PARTIAL.


## 2026-11-01 P-35 current-candidate status correction

An earlier Windows E2E verified native custom-logo picker selection and cancellation. A later current-candidate full check failed to activate picker selection; several shared native-picker helper corrections followed but have not been rerun. FEATURE-MATRIX now records P-35 as PARTIAL on the current candidate, and SPEC-001 distinguishes the earlier pass from the unverified helper. The Windows picker gate remains open; no test ran during this update.
- Added an unverified Windows native-picker helper path for WP-08D: select the unique enabled exact-name file-list item through UI Automation `SelectionItemPattern`, then invoke the actual configured dialog action. This avoids synthetic selection and does not mock `showOpenDialog`; the local-text acceptance rerun is pending. No product source changed.
- Follow-up to the WP-08D picker experiment: the host's Windows Common File Dialog did not expose the fixture file as an enabled UIA `ListItem`/`DataItem`, so the speculative list-selection helper was removed and the existing filename-control helper restored. Focused local-text selection still fails before app-level selection; native picker acceptance remains BLOCKED on this desktop.
## 2026-11-01 generated release-metadata write safety (unverified)

The shared workspace output writer now stages bounded notices, dependency inventory, SBOM, and checksum content in a unique exclusive sibling, syncs it, checks the destination identity before atomic replacement, and removes only its own temporary file on failure. This preserves the prior generated file if the staged write/replacement fails. A package-release assertion covers replacement with no leftover sibling. No automated check or package generation ran; Phase 08/N-012 remain PARTIAL.
