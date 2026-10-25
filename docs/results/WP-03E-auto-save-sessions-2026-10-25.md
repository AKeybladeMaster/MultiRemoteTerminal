# WP-03E: opt-in automatic session saving

**Date:** 2026-10-25
**Requirement:** P-13 automatic saved-session catalog workflows; F-004/P-38 remain open for full 1,000-definition acceptance.

## Behavior

Workbench Settings adds an off-by-default **Automatically save connections I open** option. When enabled, successful in-app local terminal, direct SSH, SFTP, Telnet, FTP/FTPS, and serial opens are added to the per-user saved-session catalog. Reopening a connection with matching normalized protocol settings updates its last-used time instead of adding a duplicate. Existing profile names, folder placement, and favorite state are preserved when a match is found.

Automatic definitions include only validated connection metadata. Credentials, private keys, terminal contents, and command text are not saved. The default startup PowerShell tab is excluded because it was not explicitly opened by the user. Gateway-routed SSH is excluded because its route is not represented in saved definitions. RDP/VNC external launches are excluded because the workbench cannot observe whether the external viewer connected.

The renderer sends a typed `session.remember` request only when its loaded preference is enabled. The main-process broker independently checks the persisted preference before dispatch, so stale or modified renderer state cannot bypass opt-in. The storage worker performs match-and-update or insert through a transaction-safe SQLite operation. Existing settings rows at versions 1 and 2 migrate to version 3 with automatic saving disabled.

## Verification

Commands ran on Windows x64 from the repository root on 2026-10-25:

| Command | Result |
|---|---|
| `corepack pnpm typecheck` | Passed |
| `corepack pnpm lint` | Passed; import boundary check passed |
| `node --test tests/unit/workbench-preferences.test.ts tests/unit/sqlite-workbench-preferences.test.ts tests/unit/workbench-preferences-protocol.test.ts tests/unit/session-catalog.test.ts tests/unit/contracts.test.ts tests/unit/broker.test.ts` | 67 passed, 0 failed |
| `corepack pnpm build` | Passed on Windows x64, including the native addon build; Vite reported its >500 kB renderer chunk advisory |
| `corepack pnpm setup:electron` | Passed |
| `corepack pnpm exec playwright test --grep "opt-in automatically remembers opened terminal"` | 1 Windows Electron E2E passed; checked explicit opt-in, one saved profile after reopening the same shell, and preference/profile persistence after app restart |
| `git diff --check` | Passed |

The settings screenshot from the E2E is `test-results/auto-save-session-settings.png` (local test output only).

## Security and remaining work

Automatic saving is off until the user enables it. The catalog remains local profile data; this application has no separate account logout flow. FTP and Telnet definitions can reveal endpoint metadata, and plaintext protocols retain their existing consent warnings. P-13 sidebar workflows now have Windows acceptance evidence. F-004/P-38 still require the full 1,000-definition Windows workflow; this slice does not close that acceptance gate. Real-world interoperability checks for physical serial hardware, FTPS, and SSH gateway routes remain outside this slice.
