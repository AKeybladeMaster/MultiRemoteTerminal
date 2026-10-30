# Phase 05 — Graphical remote sessions execution ledger

**State:** Phase 05 implementation code freeze entered 2026-10-30; verification gate blocked by the unavailable interactive Windows desktop/clipboard. The phase remains PARTIAL and is not accepted.
**Development branch:** `dev-1`. Existing remote refs must be fetched and verified before any commit push or promotion.
**Last known clean development checkpoint:** `f95c20b` (the working tree now contains uncommitted Phase 05 changes).

## Requirement traceability

| Requirement | Current implementation/evidence | Status | Open acceptance |
|---|---|---|---|
| P-07 / F-015 RDP | WP-08A uses the Windows Remote Desktop client through a validated shell-free handoff. | PARTIAL | Connect to a real RDP server; verify authentication, reconnect and Windows 10/11 behavior. |
| P-08 / F-015 VNC | WP-08B uses an explicitly discovered external TigerVNC viewer. | PARTIAL | TigerVNC and VNC server are unavailable in the current environment; verify a real screen, keyboard, mouse, server security modes and cleanup. |
| P-09 / F-021 XDMCP | Working-tree provider candidate starts one Cygwin/X `-query` display after optional-provider enablement and endpoint-bound explicit consent disclosing the unencrypted TCP callback listener and Windows clipboard access. Broadcast discovery and `-ac` are excluded. | PARTIAL | Verify a real authenticated display-manager session, access-control, firewall and clipboard behavior, session end and process shutdown. Login state is not observed by the application. |
| P-16 / F-020 local X server | Working-tree Cygwin/X provider candidate uses a per-display MIT authority file, converts authority paths through fixed `cygpath`, uses a local UNIX socket, supervises the process and bounds readiness/extension probes. | PARTIAL | Provider package is absent. Verify remote X clients, keyboard/mouse/clipboard, unauthorized-cookie rejection, crash cleanup, Windows 10/11 and physical high DPI. |
| P-17 / F-020 SSH X11 | Working-tree SSH path is opt-in, disabled by default, requires trusted-host consent, caps active channels and setup bytes, applies a 10-second setup deadline, relays through the local Cygwin socket and substitutes a random fake MIT cookie locally. | PARTIAL | Verify a real remote GUI application, cookie rejection, clipboard behavior and failure/worker-crash cleanup on Windows. |
| P-18 / F-021 X11 extensions | Working-tree X11 provider queries GLX, Composite and RandR through bounded X11 `QueryExtension` requests and returns advertised presence to the SSH launch response/UI. Failed probing is reported as unknown. | PARTIAL | Verify the actual provider replies and extension behavior; advertised GLX does not prove indirect GLX rendering, which remains disabled. |

## Work packages

- WP-08A and WP-08B remain partial under their existing evidence. This phase does not reclassify external process launch as a connected desktop.
- WP-10B implementation candidate includes fixed-path Cygwin/X lookup, POSIX authority-path conversion, local MIT-cookie X11, a bounded SSH fake-cookie relay, XDMCP single-host launch and consent, extension presence probes, and optional-provider controls. XDMCP disclosures cover its unencrypted listener and Windows clipboard integration in the UI, settings, Help and user guide.
- Windows x64 build, typecheck, lint/boundaries and 612 unit tests passed after code freeze. The focused XDMCP-consent and Help-disclosure E2Es passed (2/2).
- The final `pnpm check` run reported 63 E2Es passed, 7 explicitly skipped and 9 failed. Five failures require clipboard paste/copy and received an empty clipboard; four native-dialog flows could not acquire a foreground window. A focused 10-tab run confirmed the updated preload allowlist, then failed at clipboard paste. No E2E result is counted as passing for those failures.
- Windows package smoke built installer and portable artifacts and passed 4/6 checks. ASAR/fuses, SBOM/hash manifest, offline installer at 200% scale and basic portable startup passed. Native credential-prompt and SSH-log native-dialog automation failed because this runner has no active foreground window. The artifacts are unsigned.
- The SSH fixture integration test was skipped because no `MRT_TEST_SSH_*` fixture configuration is present.
- Independent specification, standards and implementation reviews have not run: the mandatory automated gate did not pass. No review or phase acceptance is claimed.

## Environment and blockers

- A focused native-dialog repro found the consent window in UI Automation while `GetForegroundWindow()` returned null; this explains why the keyboard automation cannot focus it in this runner. Clipboard write/read E2Es also returned an empty clipboard. Temporary diagnostic changes were removed.
- The current Windows command lookup found `mstsc.exe`; it found no `XWin.exe`, `xauth.exe`, `socat.exe` or `vncviewer.exe`.
- No real RDP, VNC or XDMCP server fixture, compatible remote X client, second Windows version, physical DPI setup or assistive-technology setup is available in this execution environment.
- No provider was installed. Real interoperability evidence therefore remains external to the current implementation work.
- The package outputs are under ignored `artifacts/windows/`: installer `MultiRemoteTerminal Setup 0.0.0.exe` (128,709,593 bytes, SHA-256 `7A93D6731080825CA7E89294A67274FE0388499C688858C0C76BFFCA5AA29D9A`) and portable `MultiRemoteTerminal 0.0.0.exe` (114,724,188 bytes, SHA-256 `7762BDC99049E36B2D04C7F2864A98C9D90E6B5080C43B24A55D13DD6A3C404D`). Both hashes match `SHA256SUMS.txt`; per-artifact CycloneDX SBOMs were generated. Signatures are `NotSigned` because no signing identity is configured.
- WP-08A, WP-08B, WP-10B and all Phase 05 requirements remain PARTIAL. Real RDP/VNC/XDMCP/X11 interoperability, Cygwin/X provider behavior, Windows 10/11 and physical display/accessibility acceptance remain open. No Phase 05 review result, release claim or promotion is made.

## Gate plan

1. Code freeze completed; automated verification ran sequentially after the freeze.
2. The production type/build/unit/lint gates passed; full E2E and package smoke are blocked by missing interactive foreground/clipboard capabilities. See [Phase 05 gate results](PHASE-05-graphical-sessions-gate-2026-10-30.md).
3. Separate reviews and promotion are deferred until the mandatory Windows gate can run in an interactive desktop and external protocol acceptance is available.
4. Continue with independent Phase 06 work while keeping Phase 05 PARTIAL; do not promote this candidate to `main`.
