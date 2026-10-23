# Implementation Plan — Independent Vertical Slices for Codex

**Start point:** only these documentation files are required. No code needs to be imported from a prior generated archive.

## Branching and release protocol

- Inspect `git status`, branch graph and `origin` before changes; preserve existing repository contents unless user directs a clean reset.
- Create or use `dev` from current `main` baseline. Work on `feature/WP-XX` branches or directly on `dev`, but integrate code to `dev` **first**.
- Keep commits scoped per work package, with spec/acceptance test references. All changes reviewed on `dev`.
- Merge `dev` -> `main` only after M4 release gate and independent review. Prefer a PR / regular merge commit; no force-push.
- Verify remote branch history with `git ls-remote` after publishing. Credentials and GitHub privileges are user-controlled.
- No direct source pushes to `main` and no blanket claim that dev/main already contain code.

## Shared definition of done for every work package

1. Review requirement IDs and relevant ADRs.
2. Read applicable local `SKILL.md` and log exact publisher/path used.
3. Define and test port contracts with a fake adapter.
4. Build one working UI-to-application-to-adapter-to-runtime slice on actual Windows.
5. Include cancel/close/error/disconnect/retry path and cleanup of resources.
6. Run lint, types, unit, affected integration and Windows smoke test.
7. Perform code-review against spec and security; resolve blocking findings.
8. Update feature matrix state **with evidence**, not as an optimistic checklist.

### WP-00 — Bootstrap & contracts

**Target:** foundation and docs alignment.  
**Requires:** none.  
**Deliver:** pinned Node/pnpm/Electron toolchain, workspace, TypeScript strict, stable app identifiers, contract validation, CI, Windows E2E runner, design-token preview.  
**Tests:** type checks, import dependency rule, malicious/unknown IPC rejection.  
**Skills:** codebase-design + grill-with-docs when ambiguous.  
**Gate:** no untrusted renderer code can access privileged APIs.

Implementation checkpoint (2026-10-23): WP-00 source and Windows acceptance tests are on `dev`.
See [contracts and ownership](WP-00-CONTRACTS.md) and [actual results](results/WP-00-2026-10-23.md).
This checkpoint does not satisfy M1 or the M4 promotion gate. WP-01 is the next independent slice.

### WP-01 — Desktop shell and ConPTY

**Requires:** WP-00.  
**Deliver:** independently branded dense desktop layout, sidebar/tabs/panes, local terminal, PowerShell/cmd selection, resizing, themes, keyboard focus/command palette.  
**Tests:** 10 tabs, tab lifecycle, open cancellation, UTF-8/unicode, paste, command line, 200% DPI, worker-crash cleanup and restart.\
**Skills:** frontend-design, ui-taste, web-design-guidelines, codebase-design.  
**Gate:** no process leaks after repeated tab open/close.

Visual contract for this slice (preserve / local extension): a familiar Windows workbench for opening and operating local shells. Keep WP-00's slate surfaces, blue-gray separators, pale-blue accent, amber focus, Segoe UI Variable interface type and Cascadia Mono terminal type. At first launch, show a compact Sessions rail, tab strip and one dominant terminal pane; keep errors and terminal status in the work area and status strip. The primary action is opening a PowerShell or cmd session. The approved renderer target is [WP-01-local-terminal-target.png](evidence/WP-01-local-terminal-target.png), 1550×1014 pixels; it depicts generic sample text and the dark theme. It is a spatial reference, not a source of shell behavior or operating-system chrome. Check both themes at 100% and 200% display scale. At 200%, exercise the full workflow with ten live tabs, keyboard operation, Unicode input/output, clipboard paste and resizing.

Implementation checkpoint (2026-10-23): WP-01's P-01 workflow passed on Windows 11 x64. A follow-up selected system ConPTY after repeated evidence that the bundled-DLL path could leave PowerShell's reported dimensions stale with multiple sessions open. A focused vertical-resize regression also required an explicit constrained workspace grid row so terminal sizing follows the window height. See [ADR-0004](adr/ADR-0004-system-conpty-for-local-terminals.md), [acceptance evidence](results/WP-01-2026-10-23.md) and the [terminal dependency review](dependencies/WP-01.md). This does not satisfy M1/M4 or authorize promotion to `main`.

### WP-02 — SSH/trust/vault

**Requires:** WP-00/01.  
**Deliver:** ssh2-backed remote terminal, host verification, password/key/agent paths, vault and optional master password, status/error/reconnect UI.  
**Tests:** disposable OpenSSH fixture, fingerprint mismatch, unknown-host approve/reject, wrong password, cancellation, native secret-entry isolation, idle/OS-triggered lock and restart, same-account reinstall/restore and cross-account fail-closed behavior.
**Skills:** codebase-design, diagnosing-bugs on failures, code-review.  
**Gate:** zero plaintext secrets in DB, logs and renderer IPC.

Dependency review: [WP-02 dependency decision](dependencies/WP-02.md). Interim host-identity and credential persistence before the WP-03 SQLite catalog is specified in [ADR-0003](adr/ADR-0003-wp02-interim-identity-storage.md). WP-02 includes OS-protected default storage, a main-process-only Windows native secret prompt, and optional master-password lock/unlock; P-03/F-003 stays unverified until the Windows OpenSSH fixture tests pass.

Implementation checkpoint (2026-10-23): the default OS-protected credential-vault adapter now stores ciphertext separately from session definitions, supports operation-scoped resolution, lock/unlock, explicit credential-only reset, delete, strict bounded decoding and safeStorage key-rotation writes. Generation checks prevent asynchronous initialization or unlock from overriding a later lock; a manual lock also persists across retries after OS encryption becomes unavailable. Electron main acquires the single-instance lock before startup, composes the vault with async `safeStorage`, and locks it after 15 minutes without validated terminal activity, Windows lock-screen/suspend and shutdown. A Windows/Electron smoke test covers second-instance exit; unit tests use fake safeStorage and timers. A typed Windows credential-prompt adapter, bounded private-pipe decoder and repository-owned `GetSystemDirectoryW` bridge now build; the x64 Electron-header build and environment-override smoke check pass. The adapter is not yet wired to a product action, and native-dialog use, Windows DPAPI acceptance, master-password mode, SSH authentication/UI flow and Windows OpenSSH acceptance remain pending. P-03/F-003 and all feature-matrix entries remain PLANNED.

### WP-03 — Persisted sessions and settings

**Requires:** WP-00, ideally WP-02.  
**Deliver:** SQLite normalized schema and migrations, folders, search, favorites, auto-save on explicit user settings, import/export without secrets, customizable greeting/logo/profile/tool visibility.  
**Tests:** migrations, corruption recovery, 1,000 saved sessions, invalid settings, startup with missing logo.  
**Gate:** persistent definitions independent from sockets, no 12-session cap.

### WP-04 — SSH jump hosts / forwarding

**Requires:** WP-02/03.  
**Deliver:** SSH connection chains, local/remote/dynamic forwarding, tunnel start/stop/status, persisted definitions, loopback policy.  
**Tests:** 1 and 2 SSH hops; L/R/D roundtrip; port conflict; public bind confirmation; force-close cleanup; >2 tunnel definitions.  
**Gate:** host trust for *every* SSH hop and all bound ports released.

### WP-05 — SFTP file browser and transfer

**Requires:** WP-02/03.  
**Deliver:** automatic contextual SFTP pane, standalone browser mode, upload/download with progress/cancel, overwrite policies, drag/drop, temporary file rename.  
**Tests:** directory navigation, 1KB/100MB files, disconnect, symlinks, conflicts, path traversal, partial cleanup.  
**Gate:** no unexpected local overwrite outside user-selected path.

### WP-06 — Macros and MultiExec

**Requires:** WP-01/02/03.  
**Deliver:** typed macro definition with record/replay controls, playback progress/cancel, safe wait-for-pattern, fanout confirmation, per-target results.  
**Tests:** >4 and 100 saved macros, 3 independent hosts, secret-input suppression, mid-run disconnect/cancel.  
**Gate:** no automatic replay or shell script interpretation.

### WP-07 — Security and Windows release (MVP)

**Requires:** WP-01..06.  
**Deliver:** UI accessibility audit, sanitized diagnostics, security review, portable + installed distribution, Windows compatibility matrix, user help, third-party attribution.  
**Tests:** install/uninstall, portable data isolation, local offline use, permissions, high DPI, startup/crash/shutdown, 1,000 records.  
**Skills:** web-design-guidelines, code-review, requesting-code-review.  
**Gate:** M4 in spec; merge dev into main only then.

### WP-08 — RDP/VNC and local editor

**Requires:** MVP.  
**Deliver:** explicit external viewer providers first (RDP via Windows, VNC vetted app); remote text editor with save conflict semantics.  
**Tests:** real RDP/VNC fixture or test server; fallback without viewer; remote edit conflict.  
**Gate:** provider classification (`external`, not `embedded`) visible to users.

### WP-09 — Serial/FTP, legacy protocols, Mosh

**Requires:** MVP/provider registry.  
**Deliver:** serial adapter, opt-in FTP/Telnet/Rlogin, functional Mosh provider through installed compatible runtime.  
**Tests:** each actual protocol, disable/enable, credentials redaction, serial unplug, Mosh UDP mobility.  
**Gate:** never present plain protocol as encrypted.

### WP-10 — X11, XDMCP and daemons

**Requires:** WP-02/provider registry; separate security review before release.  
**Deliver:** supported licensed local X server integration, SSH X11 forwarding, capabilities/extension probe, XDMCP if provider supports, opt-in TFTP/NFS/Cron and other local daemons.  
**Tests:** remote X11 application on Windows; proper server lifecycle, unauthorized display denied, XDMCP connection; daemon runs >360 seconds until stopped.  
**Gate:** no unsecured X11 or network listener enabled by default; license sign-off.

### WP-11 — Unix tools / package ecosystem and full-parity review

**Requires:** previous.  
**Deliver:** WSL/toolpack providers, optional tool toggles, controlled updates, offline help, full feature matrix evidence.  
**Tests:** package install/disable/remove via approved mechanisms, malicious path, import/export, end-to-end parity review.  
**Gate:** P-01..P-43 each verified, blocked with explicit rationale or transparently identified as unavailable.

## Suggested merge checkpoints

- `dev` can accept small reviewed vertical slices throughout.
- `main` receives only verified milestones, not task stubs.
- Release tags like `v0.1.0` mean a *tested MVP*, not completion of all MobaXterm parity features.
- If already-existing app source contradicts this spec, assess before replacing; `docs/adr/` holds reasoned changes.

## Test matrix (minimum)

| Suite | Unit | Integration | E2E Windows |
|---|---|---|---|
| Domain state rules | yes | fake provider | session tab lifecycle |
| SSH identity/auth | known-host rules | OpenSSH fixture | UI key warning |
| Vault | KDF and envelope | OS encryption API | lock/restart |
| Local PTY | dispatch | ConPTY process | typing/resize |
| SQLite | repository migrations | real temporary DB | restart persistence |
| Tunnel modes | policy | local/remote/SOCKS fixture | status and stop |
| SFTP | path policy | real SSH/SFTP fixture | drag/drop and progress |
| Macros | cancellation/redaction | fake/real output streams | playback/broadcast |
| RDP/VNC | configuration | viewer availability | screen/session |
| X11/daemons | policy | X server/provider fixture | actual listener lifetime |

## Performance baselines to record

Windows hardware model, CPU/RAM, OS build, disk type, build ID, memory after 10/20 connections, terminal input p95, startup p95, 1,000-item search p95, SFTP throughput, sustained >360s daemon, and error recovery. Store numerical results under `docs/results/` with redacted identifiers; no auto-telemetry.
