# ADR-0016: User-installed external TigerVNC viewer

**Status:** Accepted for WP-08B (2026-10-25)

## Context

Requirement F-015 calls for an RDP/VNC remote desktop workflow. F-025 keeps full in-window VNC embedding out of the MVP. The session schema already reserves the `vnc` kind, and the architecture calls for a vetted external provider before any embedded implementation. VNC security depends on the chosen server and authentication configuration, so the app must not imply that all VNC sessions are encrypted.

## Decision

- Use TigerVNC as an optional user-installed viewer. The official release list showed 1.16.2 as the latest stable release at review time. TigerVNC's repository is GPL-2.0, so this phase does not bundle, download, or redistribute its executable.
- Add a VNC domain endpoint, an application `VncViewerController`, and a typed `vnc.launch` capability. The renderer has no executable or filesystem selection capability.
- Resolve `vncviewer.exe` only under OS-known Program Files directories at `TigerVNC\\vncviewer.exe`; do not search `PATH` or trust user-configurable executable paths. Start with a canonical `host::port` target, an argument array, and `shell: false`.
- Require a fresh, one-use trusted click on the VNC dialog's launch button. Bind the preload and main authorization to the sender, provider, host, and port. A direct bridge or broker call without it fails closed.
- Pass no credential arguments and strip ambient `VNC_USERNAME` and `VNC_PASSWORD` from the child environment. Authentication stays in the external viewer. Saved definitions and version-5 JSON bundles contain no credentials.
- Disclose that the viewer is external, authentication is handled by TigerVNC, VNC encryption depends on server settings, and the app can confirm only process launch. The external process owns its lifetime after successful spawn.

## Consequences

P-08 is PARTIAL. Unit, contract, SQLite/bundle, and test-only Windows UI E2E coverage validates the app handoff, but no real TigerVNC installation or VNC server was available. Actual screen, keyboard, mouse, server interoperability, and disconnect behavior remain unverified. The app does not verify the user's viewer signature, checksum, or updates; TigerVNC may store its own settings outside the application profile.

## Evidence and sources

- [TigerVNC releases](https://github.com/TigerVNC/tigervnc/releases) and [license](https://github.com/TigerVNC/tigervnc): release state, project license, and activity.
- [TigerVNC 1.16.2 artifacts](https://sourceforge.net/projects/tigervnc/files/stable/1.16.2/): Windows standalone viewer names and sizes.
- [TigerVNC viewer command reference](https://tigervnc.org/doc/vncviewer.html): direct `host::port` target syntax.
- [TigerVNC build and install documentation](https://github.com/TigerVNC/tigervnc/blob/master/BUILDING.txt): default Windows install prefix.
- Automated coverage is recorded in [WP-08B results](../results/WP-08B-vnc-external-viewer-2026-10-25.md).
