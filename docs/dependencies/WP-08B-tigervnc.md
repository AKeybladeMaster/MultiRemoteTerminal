# WP-08B provider record: TigerVNC viewer

**Reviewed:** 2026-10-25
**Integration:** User-installed external executable; never bundled or copied by this repository.

## Provider

- **Name:** TigerVNC Windows viewer
- **Selected release:** 1.16.2, shown as the latest stable release on the official project release page at review time.
- **Official sources:** [project releases](https://github.com/TigerVNC/tigervnc/releases), [official SourceForge 1.16.2 artifacts](https://sourceforge.net/projects/tigervnc/files/stable/1.16.2/), [viewer command reference](https://tigervnc.org/doc/vncviewer.html), [build/install documentation](https://github.com/TigerVNC/tigervnc/blob/master/BUILDING.txt).
- **License:** GPL-2.0 project license. The application does not bundle the executable or redistribute its source. Any future bundling requires a separate license and distribution review.
- **Maintenance:** Project release and repository pages showed recent activity and the 1.16.2 stable release dated 2026-03-26. This is a point-in-time check, not a promise of future maintenance.
- **Windows artifacts:** The official 1.16.2 directory lists a 64-bit standalone viewer at 24.1 MB and a 32-bit standalone viewer at 22.1 MB. No artifact was downloaded or installed for this integration.
- **Application compatibility:** The viewer is a separate Windows process, so it has no Electron or Node ABI dependency. MultiRemoteTerminal itself is packaged for Windows x64.
- **Security posture:** The app launches only the expected `TigerVNC\\vncviewer.exe` under OS-known Program Files directories, does not search `PATH`, uses validated arguments and `shell: false`, and strips inherited `VNC_USERNAME` / `VNC_PASSWORD` variables. The app does not verify Authenticode, a checksum, or the viewer's update status. Users should obtain it from the official project distribution links.

## Integration contract

The user installs TigerVNC under the standard `Program Files\\TigerVNC` path (or the matching x86 Program Files path). A typed VNC profile contains only a display name, canonical host, and port. An explicit click opens TigerVNC with a `host::port` target. Credentials remain under TigerVNC's interactive handling and are not saved by the app. The UI warns that VNC security and encryption depend on the selected server configuration.

The app reports only that the external process started. It does not embed the display, observe keyboard/mouse input, know whether authentication succeeded, or track when the external viewer closes. The user's TigerVNC installation may retain its own configuration independently of MultiRemoteTerminal.

## Verification state

Unit and Windows UI E2E tests use an injected/test-only provider. No real TigerVNC executable or VNC server is available in the current acceptance environment; live screen, keyboard, mouse, and server interoperability checks remain open. P-08 therefore remains PARTIAL.
