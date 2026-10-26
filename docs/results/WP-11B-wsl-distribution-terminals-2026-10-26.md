# WP-11B — explicit WSL distribution terminals

**Date:** 2026-10-26
**Status:** Partial acceptance
**Requirement IDs:** P-02 (partial), P-21 (partial), F-023 (partial)

## Delivered

- Added WSL to the fixed local-shell palette catalog. The user opens an explicit distribution picker; the list has no preselected item, and opening remains disabled until a listed distribution is selected.
- Added read-only `wsl.exe --list --quiet` discovery through the terminal utility worker. It uses an absolute Windows system-directory path, a five-second timeout, a 128 KiB output cap, UTF-16LE decoding, bounded distribution count/name validation, and cancellation on picker close.
- Revalidates the selected distribution immediately before launch. A stale saved target fails before PTY creation. The terminal starts the exact selection through ConPTY with `--distribution <name> --exec bash --login`; no default-distro fallback or command-shell interpolation is used.
- Persists WSL profiles as local definitions with the exact distribution name, adds them to v7 session-folder bundles, preserves v1-v6 imports, and migrates workbench settings to schema v7 while making WSL visible by default.
- Added a guarded, unpackaged Windows test harness. It fakes discovery and terminal output; it does not invoke WSL or start Docker-managed infrastructure.
- Improved picker keyboard behavior with modal shortcut isolation and focus restoration, and wraps long distribution names within the existing dialog layout.

## Validation

- `corepack pnpm typecheck` — passed.
- `corepack pnpm lint` — passed, including import-boundary checks.
- Focused WSL-related domain/application/catalog/contract/provider/discovery tests — 133 passed, 0 failed.
- `corepack pnpm build` — passed on Windows x64; the native system-directory bridge compiled. Vite reported its existing advisory for a renderer chunk over 500 KiB.
- `corepack pnpm setup:electron` — passed.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "WSL terminals require an explicit distribution and saved profiles reopen the same target"` — passed, 1/1. The test verifies no default selection, keyboard Tab/Shift+Tab trapping and focus return, Escape cancellation, explicit `Debian Dev` selection, exact `wsl.exe` path and argument vector, saved-profile persistence across app restart, and reopening the same distribution.
- `git diff --check` — passed.
- Visually inspected `test-results/wsl-distribution-picker.png` and `test-results/wsl-distribution-terminal.png` at 1164×734 in the Windows dark theme. The picker is centered, the distribution choices are readable, no choice is selected initially, and the terminal shows the expected explicit launch route.

The first E2E attempt failed at a test locator that demanded an exact palette-button accessible name despite the button's keyboard hint. The locator was corrected; the final run passed through restart and profile reopen.

## Architecture and security

The renderer uses typed preload commands only. Electron main brokers discovery and launch to the terminal utility worker; the domain owns launch validation and WSL output parsing. No dependencies were added. Discovery is read-only and occurs only after the user opens the WSL action. A user-selected distribution's normal Bash login may run its own login configuration after that explicit action.

## Remaining acceptance

This slice does not establish interoperability with a real user-managed Linux distribution. The earlier read-only host inventory found only Docker-managed `docker-desktop`, so the E2E deliberately used the guarded fake harness and never launched that distribution. P-02, P-21 and F-023 remain PARTIAL. Validate a user-owned distribution when one is available; toolpack install/update/removal, broader provider availability and full WP-11 parity remain open.
