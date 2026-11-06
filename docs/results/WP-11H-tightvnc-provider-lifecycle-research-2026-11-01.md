# WP-11H feasibility research: TightVNC provider lifecycle

**Reviewed:** 2026-11-01
**Scope:** F-017 signed third-party provider discovery, installation, and update; VNC viewer interoperability
**Status:** Research only; no product implementation, artifact download, installation, execution, or acceptance

## Finding

TightVNC is a promising candidate for a separate fixed VNC viewer provider. The current official Windows release is TightVNC 4.0.2, and the vendor publishes x64 and x86 MSI links. The free base edition is described as available for personal and commercial use, and the vendor documents compatibility with standard VNC/RFB servers. However, the evidence reviewed does not establish the current MSI's signature or independent integrity metadata, current Windows viewer command-line contract and install path, viewer-only installation/removal semantics, or redistribution rights for version 4. Defer an app-managed provider; retain the current user-installed TigerVNC integration and keep F-017/P-08 PARTIAL.

## First-party release and integrity evidence

- The official download page currently identifies TightVNC 4.0.2 as the Windows release and links x64 and x86 MSI files. The x64 link resolves to the versioned URL [`tightvnc-4.0.2-x64.msi`](https://www.tightvnc.com/download/4.0.2/tightvnc-4.0.2-x64.msi). The vendor's news page dates 4.0.2 to 2026-10-28; its notes include fixes to Viewer settings/history and other Viewer stability behavior. [Download page](https://www.tightvnc.com/download/), [release news](https://www.tightvnc.com/news.php), [change log](https://www.tightvnc.com/whatsnew.php)
- The reviewed current download page does not publish a SHA-256 checksum or release-manifest signature for the 4.0.2 MSI, and no current MSI Authenticode signer is documented in the release notes. A historical TightVNC 2.0 Beta 2 announcement says valid signatures were added to that beta's installer and executables and names GlavSoft LLC; that statement does not verify the signer or integrity of the 4.0.2 artifact. [Historical Beta 2 announcement](https://www.tightvnc.com/announce-2.0beta2.php)
- No MSI was fetched or inspected for this research. The direct URL and vendor-hosted release listing are evidence of discovery only, not artifact provenance or publisher-signature evidence.
- The vendor says TightVNC 4 supports Windows 7 SP1 and later; this includes the product's Windows 10/11 targets by the stated minimum-version rule, but no application-level Windows compatibility test was performed. [TightVNC FAQ](https://www.tightvnc.com/faq.php)

## Launch, installation, and removal fit

- MultiRemoteTerminal's current fixed TigerVNC provider resolves only `TigerVNC\\vncviewer.exe` under known Program Files roots or the user's known Local AppData Programs directory, then passes a single validated `host::port` argument to `spawn` with `shell: false`. [Current provider adapter](../../apps/desktop/src/adapters/windows-vnc-viewer.ts)
- The current TightVNC release notes confirm that TightVNC 4 has a Windows Viewer, but the first-party current Windows documentation reviewed does not specify its executable path or a Windows 4.x command-line target syntax. TightVNC's generic `vncviewer` manual documents `host[:display]` and `host::port`, but it does not establish that the current Windows 4.x Viewer accepts the same invocation. [TightVNC 4 change log](https://www.tightvnc.com/whatsnew.php), [generic viewer manual](https://www.tightvnc.com/vncviewer.1.php)
- TightVNC 2.5-era MSI documentation names `tvnviewer.exe` and describes `ADDLOCAL=Viewer`; this is older 2.x behavior and must not be assumed for 4.x. The current download page labels the artifact as a TightVNC Windows installer, not as a viewer-only package. A separate adapter would be needed; the existing TigerVNC resolver and argument contract cannot be reused unchanged. [TightVNC 2.5 MSI documentation](https://www.tightvnc.com/doc/win/TightVNC-installer-2.5.2.pdf)
- TightVNC 4 replaces TightVNC 2 during installation, does not support side-by-side installation, and migrates supported server/viewer settings, connection history, and existing VNC passwords. This creates user-data and ownership risks if an app-managed install or update operates on an installation it did not create. The reviewed 4.x material does not establish a viewer-only install, package ownership marker, or version-specific removal workflow. [TightVNC 4 announcement](https://www.tightvnc.com/news/tightvnc-4.0.0/), [change log](https://www.tightvnc.com/whatsnew.php)
- Defer install, update, and removal automation until the vendor documents or verifies component selection, executable path/arguments, install ownership, upgrade behavior, and clean removal for the current release. Do not silently replace an existing TightVNC installation.

## License and protocol compatibility

- TightVNC 4 is closed-source software. The vendor describes its base version as free for personal and commercial use without expiry; optional Pro licensing adds TLS 1.3 session encryption and requires Pro authorization on both endpoints. The public licensing page does not establish that MultiRemoteTerminal may redistribute the 4.x MSI. Free commercial use should not be treated as redistribution permission; seek a specific vendor/legal determination before bundling or mirroring the package. [Licensing](https://www.tightvnc.com/licensing.php), [TightVNC 4 announcement](https://www.tightvnc.com/news/tightvnc-4.0.0/)
- The vendor states TightVNC is compatible with standard RFB/VNC software, including use of its viewer with standard VNC servers. TightVNC 4 retains traditional VNC authentication for compatibility with TightVNC 2 and other VNC software. That legacy authentication retains VNC's eight-character password limit and does not encrypt the session; TightVNC Pro encryption requires licensed support at the other endpoint. These statements make interoperability plausible, but do not substitute for live connection, input, display, authentication, reconnect, and disconnect acceptance against representative third-party servers. [Protocol compatibility](https://www.tightvnc.com/intro.php), [security FAQ](https://www.tightvnc.com/faq.php)

## Decision and next evidence

Do not add TightVNC discovery, download, install, update, or removal in this slice. Retain the user-installed TigerVNC launcher and leave F-017/P-08 PARTIAL. Reconsider TightVNC as a separate fixed provider only after:

1. Inspecting the exact current x64 MSI's Authenticode signer and obtaining a reviewed integrity root or an approved vendor-signature policy.
2. Verifying the current Windows Viewer executable path, exact host/port command-line form, and whether the current installer can install only the Viewer.
3. Establishing the current 4.x install/update/removal semantics and avoiding replacement or removal of user-owned TightVNC 2/4 installations.
4. Resolving app-managed download/redistribution terms with the vendor or legal review.
5. Running Windows live interoperability acceptance against representative non-TightVNC servers after the full Phase 08 implementation freeze.

No artifact was downloaded, installed, inspected, or executed; no product code or tests were changed or run. Research does not verify Authenticode, install behavior, or live VNC interoperability.
