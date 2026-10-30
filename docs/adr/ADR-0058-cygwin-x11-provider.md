# ADR-0058: User-installed Cygwin/X provider for SSH X11 and XDMCP

**Status:** Proposed for Phase 05; live Windows acceptance and independent review remain open.

## Context

F-020/F-021 and P-09/P-16/P-17 require real X11 display, SSH forwarding, and XDMCP support. No X server provider has passed live acceptance. Cygwin/X documents multiwindow display, Windows clipboard integration, SSH-trusted X11 forwarding, XDMCP, MIT cookie authentication, and a default local UNIX socket with TCP disabled. Its FAQ warns that enabling TCP opens an X listener and recommends SSH forwarding for remote X clients.

## Decision

- Use a user-installed 64-bit Cygwin/X provider. Do not bundle or auto-install Cygwin packages. Resolve only the documented per-user install root and the standard `C:\cygwin64` root; never search `PATH` or accept an executable path from the renderer.
- SSH X11 forwarding is off by default, separately disabled in Workbench settings until enabled, and requires fresh per-connection consent. The consent warns that a trusted remote host can control the local X display and read or change the Windows clipboard.
- Start a dedicated Cygwin/X display for each opted-in SSH session with multiwindow and clipboard integration, MIT-MAGIC-COOKIE authorization, indirect GLX disabled, and TCP disabled. Keep its authority file in the current user's app-data directory, pass the cookie only through main-to-worker IPC, and zero app-owned buffers when the session ends.
- Convert the Windows authority-file path with the fixed Cygwin `cygpath -u -U` executable before passing it to the POSIX `xauth` and `XWin` tools; do not assume Cygwin will interpret a native Windows path according to its mount table.
- `ssh2` receives X11 channels only for the destination SSH connection. It receives a random fake MIT cookie; a Cygwin `socat` process relays each accepted channel to that display's Cygwin UNIX socket, where the local worker validates and replaces the fake cookie with the real local cookie. The real cookie is never sent to the SSH peer. No loopback or public TCP listener is introduced for SSH forwarding.
- XDMCP is a separate opt-in path. Require the user to enable the provider and confirm an endpoint-specific warning that XDMCP is unencrypted, opens the X server's TCP display port for the remote XDMCP server's callback, and allows remote X clients on that display to read or change the integrated Windows clipboard. Use the X server's XDMCP authorization; never pass `-ac` or broadcast/multicast discovery. Stop app-owned X servers on session end and application shutdown. The application reports launch intent only; it does not currently observe remote login or session state.
- RDP and VNC remain explicit external viewer handoffs. A successful process start is not reported as a connected desktop.

## Security and consequences

X11 forwarding is trusted forwarding, not a sandbox. The selected SSH destination can inspect or manipulate local X clients and clipboard contents while forwarding is active. A fresh gesture, host-key verification, dedicated display/cookie, local UNIX socket and disabled TCP listener limit accidental exposure but do not make an untrusted SSH host safe.

XDMCP cannot be tunneled through SSH because its discovery/session setup uses UDP. The callback listener is an explicit network exposure and remote X clients can access the integrated Windows clipboard while the display is active; launch is available only after settings enablement and a fresh warning acknowledgement. Live access-control, clipboard and Windows firewall behavior must be verified before claiming support.

Cygwin/X and socat remain user-installed external software. The app does not verify their signatures or updates; a same-user attacker can replace them. See the provider record for package sources, license notes, accepted install locations and acceptance limits.

## Required acceptance

- Windows x64 starts an authorized Cygwin/X display with `-nolisten tcp`; an unauthorized MIT cookie is rejected.
- The local provider queries GLX, Composite and RandR extension presence; a capability probe failure is reported as unknown, not as unsupported.
- A real remote X client reaches the local display through an SSH X11 channel; display, keyboard, mouse and clipboard behavior are verified.
- X11 relay channels, X server processes and authority files are cleaned after close, failure, worker crash and app shutdown.
- XDMCP launches only after endpoint-bound consent, authenticates the display-manager session, exposes only its required callback listener, and stops cleanly.
- Windows 10 and Windows 11, high-DPI behavior, Cygwin/X package compatibility and the actual XDMCP server remain required acceptance evidence.
