# WP-11F feasibility research: TigerVNC provider lifecycle

**Reviewed:** 2026-11-01
**Scope:** F-017 signed third-party provider discovery, installation, and update
**Status:** Research only; no product implementation or acceptance

## Finding

TigerVNC is a plausible fixed external viewer integration, but the evidence available does not support a safe app-managed download and update lifecycle. Keep the existing user-installed launcher and leave F-017 PARTIAL. Do not treat the download portal's malware scan or HTTPS delivery as a publisher signature or an independent artifact-integrity check.

## First-party release evidence

- TigerVNC's GitHub release page labels 1.16.2 as the latest release, dated 2026-03-26, and directs users to SourceForge for binaries. The release describes 1.16.2 as a security-fix release for x0vncserver. [TigerVNC v1.16.2 release](https://github.com/TigerVNC/tigervnc/releases/tag/v1.16.2)
- The official SourceForge project folder lists vncviewer64-1.16.2.exe (24.1 MB) and tigervnc64-1.16.2.exe (4.6 MB). Its README identifies vncviewer-X.Y.Z.exe as a standalone viewer and tigervnc-X.Y.Z.exe as a viewer installer; the separate tigervnc-winvnc artifacts are server installers. The listing says the binaries are provided directly by the TigerVNC team. [Official SourceForge 1.16.2 folder](https://sourceforge.net/projects/tigervnc/files/stable/1.16.2/)
- The release listing exposes versioned artifacts but no checksum or signature metadata in the page content reviewed. This is not proof that no additional project-published integrity channel exists.
- A local, non-executing retrieval attempt against both the SourceForge download URL and its downloads.sourceforge.net artifact URL returned HTML documents instead of a PE executable. The retrieved files began with an HTML doctype and remain only in ignored workspace scratch under .tmp/tigervnc-lifecycle-research; they were not executed. Therefore no artifact hash, Authenticode status, signer, or installer behavior was established.

## Trust, lifecycle, and licensing

- The versioned project release page provides useful discovery metadata, but a latest-release page plus HTTPS does not independently bind a downloaded binary to a publisher. An app-managed updater needs a publisher-signed artifact or release manifest, or another reviewed integrity root. No such root was verified here.
- The standalone viewer format could fit a per-user managed copy in principle, but the official listing does not document an installer command, per-user scope, silent switches, or cleanup behavior. Do not invoke the viewer installer with guessed flags or claim that a copy-based installation is accepted until the artifact and its runtime dependencies are verified.
- TigerVNC's source repository provides GPL version 2 licensing and notes that the project includes code from other sources. The current app record avoids bundling TigerVNC. Any app-managed redistribution or packaging needs a separate complete license and notice review. [TigerVNC license file](https://github.com/TigerVNC/tigervnc/blob/master/LICENCE.TXT)
- The repository's current integration remains a user-installed external process located only at known OS paths. It removes ambient VNC username/password variables and does not claim to track viewer connection state. [Existing TigerVNC provider record](../dependencies/WP-08B-tigervnc.md)

## Decision and next evidence

Do not add automatic discovery, download, install, update, or removal for TigerVNC from the reviewed evidence. F-017 remains PARTIAL. Reconsider only after obtaining a real official x64 artifact and confirming its publisher signature or vendor-published integrity metadata, standalone runtime dependencies, installation/removal semantics, and GPL/source-notice obligations. Live VNC interoperability remains a separate acceptance requirement.
