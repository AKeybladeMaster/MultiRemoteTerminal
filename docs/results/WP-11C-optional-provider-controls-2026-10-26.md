# WP-11C: Optional provider availability controls

**Date:** 2026-10-26
**Status:** Partial acceptance
**Requirements:** P-31 (partial), P-37 (partial), F-017 (partial); P-04, P-07, P-08, P-10, P-12, P-20 policy controls

## Delivered

- Added a fixed, app-owned allowlist for Telnet, FTP/FTPS, serial, external RDP/VNC viewers, and the local TFTP server. No package, executable path, or plugin runtime was added.
- Added `enabledOptionalConnections` to version 10 workbench preferences. Version 9 and earlier migrate with all supported providers enabled, retaining existing behavior. The value rejects unknown and duplicate IDs and permits an empty list.
- Added the **Optional connection types** section in Settings, with plain descriptions for plaintext Telnet/FTP and the loopback-only TFTP service.
- Hides disabled provider launch actions after settings load, retaining saved profiles but preventing reopening until re-enabled. If TFTP is disabled while already running, its manager action remains available for stopping; its folder-selection and start controls are disabled.
- The main-process broker independently checks persisted preferences before Telnet/FTP open, serial port listing/open, RDP/VNC launch, and TFTP folder selection/start. A settings read or validation failure blocks provider startup.
- Existing terminal and file-session operations remain available, including writes and close; an already-running TFTP server can still be stopped when its provider is disabled.
- Added [ADR-0031](../adr/ADR-0031-optional-provider-availability.md). P-31/P-37/F-017 remain partial because third-party provider provenance, discovery, installation, update, and removal are not included.

## Validation

- `corepack pnpm typecheck` - passed.
- `corepack pnpm lint` - passed, including static import-boundary checks.
- Focused domain, SQLite, and broker tests - 62 passed, 0 failed. Coverage includes v9-to-v10 migration, invalid provider IDs, every new broker entry point, fail-closed settings reads, v10 record corruption, and active-session cleanup.
- `corepack pnpm build` - passed on Windows 11 x64. The existing Vite advisory for a renderer chunk over 500 KiB remains.
- Focused Windows Electron E2E, `local shell tool visibility persists and controls command palette entries after restart` - passed after the TFTP UI follow-up, 1/1. It disables Telnet and TFTP, confirms their launch actions disappear, restarts the app, confirms both preferences persist, re-enables them, and opens the Telnet connection dialog.
- Inspected `test-results/optional-connection-settings.png` at 1164x734. The new section fits the established Settings dialog and the control names and descriptions are visible without clipping in the captured state. This is a scoped visual inspection, not an accessibility certification.
- `git diff --check` - passed.

## Security and remaining acceptance

Provider availability is a local preference with all supported providers enabled by default. It controls new entry points; it does not forcibly terminate already-running sessions or external viewer processes. The main-process broker is authoritative, and a preference read error is fail-closed. This setting does not verify third-party signatures or add plugin lifecycle management. Windows 10, signed packaging, physical devices, and external protocol interoperability remain separate open acceptance items.
