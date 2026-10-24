# Full Feature Matrix — MobaXterm Home + Professional Benchmark

**Date:** 2026-10-23. Reference: official [edition comparison](https://mobaxterm.mobatek.net/download.html) and [feature descriptions](https://mobaxterm.mobatek.net/features.html).

This is **requirements coverage**, not an assertion of implemented code. Each feature begins `PLANNED`. Change the status only with a Windows build and linked acceptance evidence.

**Phases:** `MVP` (first independently usable release), `Next` (subsequent development), `Parity` (full-feature verification).  
**Status:** PLANNED / PARTIAL / VERIFIED / BLOCKED / DECLINED. P-01 is VERIFIED from Windows acceptance evidence. P-02 is PARTIAL: the app can launch an installed Git for Windows Bash; WSL and broader Unix-tool acceptance remain pending. F-002 remains incomplete because an exploratory clipboard probe observed supplementary-character input replacement in the tested Git Bash/ConPTY path, and the full packaged shell lifecycle is not verified; the replacement behavior is not yet asserted by a checked-in regression test. P-04 is VERIFIED for the warning-gated Telnet terminal and tested RFC option negotiation; interoperability against historical servers remains broader work. P-13 is PARTIAL: Windows E2E covers explicit save, search, favorites, reopen and folder grouping, but the automatic save preference is not implemented. F-018 is PARTIAL: WP-03D adds credential-free, versioned saved-folder JSON bundles; profile templates and encrypted secret export remain planned. See [WP-01E Bash evidence](results/WP-01E-bash-2026-10-24.md), [WP-03B catalog evidence](results/WP-03B-catalog-2026-10-23.md), [WP-03C folder evidence](results/WP-03C-folders-2026-10-23.md), [WP-03D bundle evidence](results/WP-03D-session-folder-bundles-2026-10-24.md) and [WP-09B Telnet evidence](results/WP-09B-telnet-terminal-2026-10-24.md). Other entries remain PLANNED unless listed above.

WP-00 foundation has separate [Windows acceptance evidence](results/WP-00-2026-10-23.md).
It validates the shell and IPC security controls only; it completes none of the full workflows below.
WP-01 verifies P-01's ten-tab local-terminal workflow in [Windows acceptance evidence](results/WP-01-2026-10-23.md). It does not mark remote protocols, saved sessions, or packaging as implemented.
WP-01D adds confirmed `Ctrl+W` and middle-click tab closure, a terminal-tab-only context menu, and contrast-checked ANSI palettes; see [terminal interaction evidence](results/WP-01D-terminal-interactions-2026-10-24.md). P-30 remains planned because configurable command/syntax highlighting is not implemented.
WP-01E adds an explicitly selected Bash terminal through an installed Git for Windows runtime. Windows E2E covers a shell command, BMP Unicode clipboard paste, resize, saved-session reopen and Ctrl+W closure; paste requires a trusted, session-bound one-use gesture, and multiline text requires native confirmation. Terminal input is ordered across a pending paste, and renderer teardown cancels the pending paste before it writes. App-controlled clipboard access remains in main. An exploratory clipboard probe observed supplementary-character replacement; the observation is not yet a checked-in regression assertion. P-02 is PARTIAL because broader WSL and Unix-tool coverage is not implemented; see [WP-01E evidence](results/WP-01E-bash-2026-10-24.md).
WP-03D adds native-dialog saved-folder JSON export/import, exact credential-free schema validation, bounded files, idempotent merge behavior and transactional rollback on conflict. Windows round-trip and restart evidence is in [WP-03D results](results/WP-03D-session-folder-bundles-2026-10-24.md). This does not complete F-018: profile templates and encrypted secret export remain planned.
WP-05A adds contextual SFTP listing/navigation beside a running SSH terminal. WP-05B adds staged upload/download, typed progress, cancellation, and overwrite/rename/skip choices through that same trusted SSH connection. WP-05C adds standalone SFTP-only sessions with explicit host trust and credential prompts, no shell request, saved-profile reopen and credential-free folder-bundle export/import; Windows loopback E2E verifies standalone listing, persistence and that no shell was requested. P-11 is VERIFIED for that behavior. F-005/P-14 remain PARTIAL because drag/drop, large-file/disconnect acceptance and configurable browser behavior remain open. P-15 remains planned. See [WP-05A evidence](results/WP-05A-sftp-directory-browser-2026-10-24.md), [WP-05B evidence](results/WP-05B-sftp-transfers-2026-10-24.md) and [WP-05C evidence](results/WP-05C-sftp-only-sessions-2026-10-24.md).
WP-09A adds credential-free Telnet saved-session metadata and endpoint validation. WP-09B adds the utility-worker TCP terminal, bounded RFC option codec, trusted endpoint-bound per-connection plaintext acknowledgement, interactive terminal I/O and saved-profile reopen through the Windows loopback E2E path. P-04 is VERIFIED for this implementation; see [WP-09A evidence](results/WP-09A-telnet-profile-2026-10-24.md) and [WP-09B evidence](results/WP-09B-telnet-terminal-2026-10-24.md).
WP-09C adds credential-free FTP/FTPS profiles and bounded directory browsing in a supervised utility worker. WP-09D adds native-dialog upload/download, typed progress and cancellation, explicit conflict choices, standard argumentless FTP STOU in the selected directory, and locally staged download commits. The FTP server assigns each non-overwrite upload its actual filename; that in-progress file is visible during transfer, and removal on cancel is best-effort while the control channel remains usable. Explicit overwrite uses a staged backup/replace sequence with a bounded commit-settlement deadline. Unsupported STOU servers fail closed for non-overwrite uploads. Windows loopback E2E verifies standard STOU syntax, selected-directory CWD restoration, upload/download, profile persistence across restart and reconnect. FTPS certificate behavior and broader server interoperability remain unverified, so P-10 and F-016 stay PARTIAL; see [WP-09C results](results/WP-09C-ftp-directory-browser-2026-10-24.md), [WP-09D results](results/WP-09D-ftp-transfers-2026-10-24.md), and [ADR-0006](adr/ADR-0006-ftp-no-clobber-uploads.md).

| ID | Reference feature | Planned architecture/provider | Phase | Verification/interpretation |
|---|---|---|---|---|
| P-01 | Tabbed terminal (VERIFIED) | React+xterm.js + runtime tabs | MVP | 10 tabs, independent input/resize/close, accessibility |
| P-02 | Local Unix-like commands (PARTIAL) | Local ConPTY, installed Git for Windows Bash; WSL integration later | Next | Windows E2E runs Bash commands and reopens a saved Bash definition; broader WSL/tool coverage remains pending |
| P-03 | SSH sessions | SSH provider with host trust | MVP | Public-key/password, disconnect, host change test |
| P-04 | Telnet sessions (VERIFIED) | Opt-in legacy Telnet provider | Parity | Windows loopback E2E verifies TCP negotiation, trusted warning submission, terminal I/O and per-reopen consent. Provider-wide disable/enable settings remain tracked by P-31. |
| P-05 | Rlogin / RSH sessions | Separate opt-in legacy adapter | Parity | Real login/shell integration, never passed off as SSH |
| P-06 | Mosh sessions | Mosh/WSL provider | Parity | Working UDP transport, intermittent connectivity test |
| P-07 | RDP desktop | External `mstsc.exe` initially | Next | Valid launch and configuration; inline embedding tracked separately |
| P-08 | VNC desktop | Audited external viewer provider initially | Next | Valid working screen + keyboard/mouse session |
| P-09 | XDMCP desktop | Approved local X server capable of XDMCP | Parity | Live XDMCP session; insecure configuration explicitly gated |
| P-10 | FTP/FTPS sessions (PARTIAL) | `basic-ftp` isolated utility worker | Next | Windows E2E verifies consent-gated plaintext FTP listing, upload/download, profile persistence and reconnect; FTPS handshake/certificates and broader interoperability remain open |
| P-11 | Standalone SFTP sessions (VERIFIED) | SSH/SFTP adapter; files-only session mode | MVP | Windows loopback E2E verifies explicit SSH trust/auth, remote listing, saved-profile reopen and no shell request; credential-free profile export is covered by unit tests. See WP-05C evidence. |
| P-12 | Serial/COM sessions | Windows serial adapter | Next | Port list, baud, parity, flow control, hot-unplug |
| P-13 | Auto-saved sessions sidebar (PARTIAL) | Catalog and recently-used UI | MVP | Windows E2E verifies explicit save, search, reopen, favorites and folder groups; automatic save preference remains pending. See WP-03B/WP-03C evidence. |
| P-14 | Graphical automatic SFTP browser (PARTIAL) | SFTP module + sidebar | MVP | Contextual listing/navigation and button-initiated upload/download with progress, cancel and conflict choices are covered by Windows E2E; standalone files-only sessions and saved-profile reopen are also covered. Drag/drop, large-file/disconnect acceptance and configurable behavior remain open. |
| P-15 | File drag & drop | Transfer job module | MVP | SFTP upload/download buttons are implemented; drag/drop is not implemented |
| P-16 | X11 server | Capability-checked local licensed X server provider | Parity | Remote X client displayed, lifecycle supervised |
| P-17 | SSH X11 forwarding | SSH X11 channel forwarded to X server | Parity | DISPLAY negotiation + host-trust test; no open public X access |
| P-18 | OpenGL / Composite / RandR extensions | X-server/provider supported flags | Parity | Actual extension capabilities probed and reported |
| P-19 | Multi-execution | Macro/Input fanout controller | MVP | Explicit target selection, confirmation, error per target |
| P-20 | Embedded local servers | Controlled daemon module | Parity | Service starts/listens/stops, no artificial stop timer |
| P-21 | Embedded tools | Discoverable optional tools via registry | Next | Tool launch works and user's enabled/hidden state persists |
| P-22 | SSH gateway/jump host | SSH route chain provider | MVP | 1+ gateway, each independent host-key/auth check |
| P-23 | SSH local tunnels | Forwarding controller | MVP | L forward TCP roundtrip, closed sockets freed |
| P-24 | SSH remote tunnels | Forwarding controller | MVP | R forward roundtrip; protected nonlocal listening |
| P-25 | SSH dynamic SOCKS tunnels | Forwarding controller | MVP | D forward with SOCKS5 handshake and remote target |
| P-26 | Unix package manager extensibility | WSL package mgr / approved external toolpacks | Parity | Install/list/remove approved tools; no MobApt copy |
| P-27 | Remote file text editor | Remote edit/temp file conflict manager | Next | Fetch/edit/save with conflict detection |
| P-28 | Macro record and replay | Structured recording with secret filtering | MVP | 100 macros, redaction, delay/expect, cancel |
| P-29 | Password management / master password | OS-protected vault + optional user passphrase | MVP | Lock/unlock, corruption test, no plaintext at rest |
| P-30 | Syntax highlighting in terminal | Renderer keyword rules applied to text stream | Next | Optional regex rules with DoS-safe limits and no ANSI corruption |
| P-31 | Plugins / additional tools | Capability provider registry | Next | Enable/disable vetted external integration, no arbitrary plugin runtime |
| P-32 | Installer and portable | Installer + ZIP/portable mode | MVP | Install/uninstall; portable data-location choice |
| P-33 | Documentation and help | Offline manual and keybinding reference | MVP | Covers every MVP command + troubleshooting |
| P-34 | Custom startup message | Settings theme + greeting template | MVP | User-set Unicode greeting at startup; no code execution |
| P-35 | Custom logo | Validated user-owned image reference | MVP | No borrowed MobaXterm branding; missing file fallback |
| P-36 | Modify profile script | Explicit config path/editor + preview | MVP | User-controlled PowerShell initialization; warning before execution |
| P-37 | Remove games/screensaver/tools | Minimal app defaults; tool registry visibility | MVP | Unwanted optional tools can be hidden/disabled, no games bundled |
| P-38 | Unlimited saved sessions | Catalog without app quotas | MVP | 1,000 records, no 12-session cap |
| P-39 | Unlimited tunnels | Tunnel definitions without app quotas | MVP | >2 definitions and multiple active instances within OS limits |
| P-40 | Unlimited macros | Macro catalog without app quotas | MVP | >4 definitions and correct persistence |
| P-41 | Unlimited daemon runtime | No app TTL in daemon controller | Parity | TFTP/Cron/NFS-equivalent service >360s; explicit stop only |
| P-42 | Enhanced security settings | Trust defaults, vault, scope/bind, policy UI | MVP | Host-key strictness, forwarding restrictions, secret protection |
| P-43 | Professional customization defaults | User-config profile/template export | Next | Custom settings for another installation with user consent |
| P-44 | Company deployment / perpetual license / updates | **Product/business policy rather than program behavior** | Excluded | No assertion of matching original vendor commercial terms |

## Security-specific parity criteria

- Host-key mismatches cause a **blocking decision**, not a hidden reconnect.
- No persisted password/private key in SQLite session definition.
- Remote forwarding, public listeners and XDMCP require an informed explicit opt-in.
- Plugin/tool enablement has allowlisted paths and provenance checks.
- Macro recording excludes password dialogs and never replays input after silent reconnect.
- Daemons can run indefinitely but display bind address, listening ports and status.

## Integration quality grades

Provider quality is independently tracked alongside status:

- **Embedded:** implemented and rendered in the app (e.g., xterm).
- **External integrated:** protocol works through an explicitly launched approved tool (e.g., initial RDP).
- **Requires installed tool:** supported only when user has installed compatible executable.
- **Unavailable:** cannot be called parity.
- **Security deferred:** deliberately disabled until threats have an approved mitigation.

Record these grades in the release checklist. Do not use the word “embedded” for an external launcher or bundled tool unless the behavior actually runs in the application context.

## Product comparison caveats

Official edition-limit numbers (12 saved sessions, 2 tunnels, 4 macros and 360-second daemon runtime) describe the **reference Home Edition**, not limits for MultiRemoteTerminal. This product does not reproduce edition/license gating.

No technically credible commitment to a fully embedded X server, native RDP viewer, all OpenGL extensions, or an entire Unix toolchain is possible without subsequent adapter design, licensed dependency inventory and real Windows testing. All are explicitly tracked here instead of hidden behind a false “100% feature complete” claim.
