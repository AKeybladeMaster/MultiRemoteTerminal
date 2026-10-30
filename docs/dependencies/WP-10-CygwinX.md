# WP-10 Cygwin/X provider record

**Selection:** Proposed user-installed Cygwin/X. The application will neither bundle nor download provider binaries.

## Provider and compatibility

- Required executable capabilities: `bin\XWin.exe`, `bin\xauth.exe`, `bin\cygpath.exe`, and `usr\bin\socat.exe`; X11 authority support uses `-auth` and MIT-MAGIC-COOKIE-1. XDMCP additionally requires XWin `-query`, `-once`, and TCP display transport.
- Supported discovery roots: `%LOCALAPPDATA%\Programs\Cygwin64` and `C:\cygwin64`. All executable paths are fixed below a root; the app does not search `PATH`.
- Official Cygwin Setup supports an unprivileged, per-user installation using `--no-admin`; users can select a custom Cygwin root. The application recognizes only the listed roots until a reviewed settings workflow supports custom roots.
- Current official package records reviewed 2026-10-30 list xorg-server 21.1.21-1 for x86_64, xauth 1.1.4-1, and stable socat 1.8.1.0-1. These are source inventory facts, not minimum versions enforced by the app. The test package socat 1.8.1.0-2 is not selected.
- The xorg-server package itself is about 1,005 KiB and socat about 236 KiB compressed; these are not the install size. Cygwin Setup's base install is about 100 MB before X11 dependencies. The application adds no npm/native ABI dependency for this provider.

## License and maintenance

- Cygwin/X identifies its X server as MIT/X11-style licensed; the full Cygwin distribution contains packages with separate licenses. Cygwin Setup must remain the user's package and license source of truth.
- socat is GPL-2.0 with its documented OpenSSL linking exception. xauth is MIT-licensed. No provider executable is redistributed or linked into MultiRemoteTerminal.
- Cygwin's package pages identify the xorg-server and xauth maintainers and publish stable x86_64 builds. Cygwin Setup checks signed setup metadata and documents GPG verification for the setup executable.
- The app does not verify Authenticode, package signatures after install, hashes, updates, or same-user file replacement. The provider runs with the current user's Windows privileges and can access clipboard data for opted-in X11/XDMCP use.

## Network and process policy

- Before passing the app-data authority filename to Cygwin `xauth` or `XWin`, convert it with the fixed `cygpath -u -U` executable. This yields a Cygwin POSIX path and honors the installation's mount table.
- The SSH worker caps active X11 channels at 16, bounds pre-authentication setup bytes, and closes a relay if the local X server does not respond within 10 seconds. The deadline ends at the first local X server response, not during later GUI use.
- SSH X11 forwarding: `-multiwindow -clipboard -auth <per-session authority> -nolisten tcp -iglx`. `ssh2` advertises a random fake MIT cookie and the worker replaces it only after validating the first forwarded X11 setup packet on the local Cygwin UNIX socket. The real cookie is not sent to the remote SSH peer. The helper connects only to `/tmp/.X11-unix/X<display>` and uses stdio pipes; it does not create a TCP listener.
- After local display startup, the provider sends bounded X11 `QueryExtension` requests for GLX, Composite and RandR and returns the server's advertised presence flags to the explicit SSH launch result. Failed probes remain unknown and are not inferred from launch flags. Indirect GLX remains disabled.
- XDMCP: endpoint-bound explicit consent, one host with `-query`, `-once`, no broadcast/multicast, and TCP enabled only because the XDMCP server must connect back to the selected display. XDMCP is unencrypted and may expose the display port beyond the selected peer; remote X clients can read or change the integrated Windows clipboard. `-ac` is forbidden. Firewall, clipboard and authentication behavior remain acceptance gates.
- X11 helper processes, XWin processes, random MIT cookies, and authority files must be owned by an active session and cleaned on cancellation, close, process exit, worker/app shutdown, and startup failure.

## Official sources

- [Cygwin `cygpath` manual](https://cygwin.com/cygwin-ug-net/cygpath.html)
- [Cygwin/X XWin manual](https://x.cygwin.com/docs/man1/XWin.1.html)
- [Cygwin/X remote SSH clients](https://x.cygwin.com/docs/ug/using-remote-apps.html)
- [Cygwin/X XDMCP guide](https://x.cygwin.com/docs/ug/using-remote-session.html)
- [OpenSSH ssh(1) X11 forwarding and fake-cookie substitution](https://man.openbsd.org/ssh.1#X11_FORWARDING)
- [Cygwin/X clipboard integration](https://x.cygwin.com/docs/ug/using-clipboard-integration.html)
- [Cygwin/X FAQ](https://cygwin.com/xfree/docs/faq/cygwin-x-faq.html)
- [Cygwin Setup instructions](https://cygwin.com/install.html)
- [Cygwin xorg-server package](https://cygwin.com/packages/summary/xorg-server.html), [xauth package](https://cygwin.com/packages/summary/xauth.html), and [socat package](https://cygwin.com/packages/summary/socat.html)

## Status

Provider selection is not approved until the Phase 05 specification, standards, and implementation reviews pass and Windows 10/11 real-server acceptance is recorded. No provider binary has been installed or run in the current acceptance environment. The implementation and tests are still under Phase 05 development; tests remain deferred until phase code freeze.
